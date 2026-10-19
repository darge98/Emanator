import { randomUUID } from 'node:crypto';
import { MAX_TOOL_NAME_LENGTH, type ToolOutput } from '@emanator/engine';
import { errorMessage, type Logger } from '@emanator/shared/server';
import { auth, UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  type CallToolResult,
  ErrorCode,
  McpError,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { type Capability, type CapabilityTool, capabilityToolName } from '../domain/capability.ts';
import type { CapabilityStore } from './capability-store.ts';
import { type BrowserAuthorization, CapabilityOAuthProvider } from './oauth-provider.ts';

export interface CapabilityConnectionsDeps {
  store: CapabilityStore;
  /** Where the authorization server sends the Owner's browser back, on the dashboard. */
  redirectUrl: string;
  /** Tells the Owner a Capability must be authorized again; called once per lapse. */
  notifyNeedsAuthorization: (capability: Capability) => Promise<void>;
  logger: Logger;
  /**
   * Hosts besides its own server that a Capability's sign-in may reach, e.g. Google's for a
   * catalog entry; any host when undefined. Its client secret then reaches no one else.
   */
  signInHostsOf?: (capability: Capability) => readonly string[] | undefined;
  fetch?: FetchLike;
}

/** The browser came back with a state the Harness doesn't know, or knew too long ago. */
export class AuthorizationExpiredError extends Error {
  override name = 'AuthorizationExpiredError';
  constructor() {
    super('This authorization has expired. Start it again from the dashboard.');
  }
}

/** Long enough to log in, short enough that a stray link doesn't stay valid. */
const AUTHORIZATION_TTL_MS = 10 * 60_000;

/** A Tool's output beyond this is cut, so one long email thread can't fill the context. */
export const MAX_OUTPUT_LENGTH = 100_000;

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_TOOL_PAGES = 20;

/**
 * The Harness's connections to the Capabilities' MCP servers. The Harness is the only MCP
 * and OAuth client: the Engine sees the Tools as the Harness's own and never the tokens.
 */
export class CapabilityConnections {
  private readonly clients = new Map<string, Promise<Client>>();
  /** Capabilities whose server failed the last call, so status is written only on changes. */
  private readonly failing = new Set<string>();

  constructor(private readonly deps: CapabilityConnectionsDeps) {}

  /**
   * Connects and lists the server's Tools. Returns where the Owner must go to authorize,
   * when the server wants it; a server that needs no authorization just connects.
   */
  async connect(capability: Capability): Promise<string | undefined> {
    // The Owner is at the dashboard already, so a lapse needs no Telegram notice here.
    if (await this.list(capability, false)) return undefined;
    const browser: BrowserAuthorization = { state: randomUUID() };
    const provider = this.provider(capability, browser);
    try {
      if ((await this.authorize(provider, capability)) === 'AUTHORIZED') {
        await this.list(capability, false);
        return undefined;
      }
      if (!browser.authorizationUrl || !browser.codeVerifier) {
        throw new Error('The server did not start an authorization.');
      }
      await this.deps.store.savePendingAuthorization(
        browser.state,
        capability.id,
        browser.codeVerifier,
        AUTHORIZATION_TTL_MS,
      );
      return browser.authorizationUrl.toString();
    } catch (error) {
      throw await this.fail(capability, error);
    }
  }

  /** Completes an authorization when the browser comes back, and returns its Capability's id. */
  async finishAuthorization(
    state: string,
    code: string,
    capabilityOf: (id: string) => Promise<Capability | undefined>,
  ): Promise<string> {
    const pending = await this.deps.store.takePendingAuthorization(state, AUTHORIZATION_TTL_MS);
    const capability = pending && (await capabilityOf(pending.capabilityId));
    if (!pending || !capability) throw new AuthorizationExpiredError();
    const provider = this.provider(capability, { state, codeVerifier: pending.codeVerifier });
    try {
      await this.authorize(provider, capability, code);
    } catch (error) {
      throw await this.fail(capability, error);
    }
    await this.forget(capability.id);
    if (!(await this.list(capability, false))) {
      throw new Error('The server still asks for an authorization.');
    }
    return capability.id;
  }

  /**
   * Lists the server's Tools into the cache and records how the connection went.
   * Returns false when the server wants an authorization first.
   */
  refreshTools(capability: Capability): Promise<boolean> {
    return this.list(capability, true);
  }

  private async list(capability: Capability, notify: boolean): Promise<boolean> {
    const provider = this.provider(capability);
    const client = new Client({ name: 'emanator', version: '1.0.0' });
    try {
      await client.connect(this.transport(capability, provider));
      const tools = await listAll(client);
      const version = capability.updatedAt;
      // An edit made meanwhile wins: these Tools come from the settings it replaced.
      if (
        await this.deps.store.replaceTools(
          capability.id,
          this.usableTools(capability, tools),
          version,
        )
      ) {
        await this.deps.store.setStatus(capability.id, 'connected', undefined, version);
      }
      this.failing.delete(capability.id);
      return true;
    } catch (error) {
      if (provider.needsAuthorization || error instanceof UnauthorizedError) {
        await this.lapse(capability, notify);
        return false;
      }
      throw await this.fail(capability, error);
    } finally {
      await client.close().catch(() => {});
    }
  }

  /**
   * Calls a Tool on the Capability's server. Every failure becomes an error result the model
   * can explain to the Owner: a Capability that is down never fails a turn.
   */
  async call(
    capability: Capability,
    tool: string,
    input: Record<string, unknown>,
  ): Promise<ToolOutput> {
    try {
      const client = await this.client(capability);
      const result = (await client.callTool({ name: tool, arguments: input })) as CallToolResult;
      if (this.failing.delete(capability.id)) {
        await this.deps.store.setStatus(
          capability.id,
          'connected',
          undefined,
          capability.updatedAt,
        );
      }
      return toToolOutput(result);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        await this.forget(capability.id);
        await this.lapse(capability, true);
        return {
          text: `"${capability.title}" must be authorized again from the Harness dashboard; the Owner has been told.`,
          isError: true,
        };
      }
      this.deps.logger.warn('A Capability Tool call failed', {
        capability: capability.slug,
        tool,
        error: describeFailure(error),
      });
      // A refused request leaves the connection usable for the other turns sharing it.
      if (!isRequestError(error)) {
        await this.forget(capability.id);
        if (!this.failing.has(capability.id)) {
          this.failing.add(capability.id);
          const version = capability.updatedAt;
          await this.deps.store.setStatus(capability.id, 'error', describeFailure(error), version);
        }
      }
      return {
        text: `Could not use "${capability.title}": ${describeFailure(error)}`,
        isError: true,
      };
    }
  }

  /** Drops the open connection, e.g. after the Capability changed or was deleted. */
  async forget(capabilityId: string): Promise<void> {
    const client = this.clients.get(capabilityId);
    this.clients.delete(capabilityId);
    await client?.then((open) => open.close()).catch(() => {});
  }

  async close(): Promise<void> {
    await Promise.all([...this.clients.keys()].map((id) => this.forget(id)));
  }

  private client(capability: Capability): Promise<Client> {
    let client = this.clients.get(capability.id);
    if (!client) {
      const provider = this.provider(capability);
      const opening = new Client({ name: 'emanator', version: '1.0.0' });
      client = opening.connect(this.transport(capability, provider)).then(() => opening);
      this.clients.set(capability.id, client);
      // A failed connection must not be handed to the next call, nor evict a newer one.
      const opened = client;
      opened.catch(() => {
        if (this.clients.get(capability.id) === opened) this.clients.delete(capability.id);
      });
    }
    return client;
  }

  /** Records why the connection failed and returns an error that says it. */
  private async fail(capability: Capability, error: unknown): Promise<Error> {
    const message = describeFailure(error);
    await this.deps.store.setStatus(capability.id, 'error', message, capability.updatedAt);
    return new Error(message, { cause: error });
  }

  /** Marks the Capability as needing an authorization, telling the Owner only the first time. */
  private async lapse(capability: Capability, notify: boolean): Promise<void> {
    const previous = await this.deps.store.setStatus(
      capability.id,
      'needs-auth',
      'The server asks for a new authorization.',
      capability.updatedAt,
    );
    if (!notify || previous === undefined || previous === 'needs-auth') return;
    try {
      await this.deps.notifyNeedsAuthorization(capability);
    } catch (error) {
      this.deps.logger.warn('Could not tell the Owner a Capability needs authorizing', {
        capability: capability.slug,
        error: errorMessage(error),
      });
    }
  }

  private authorize(
    provider: CapabilityOAuthProvider,
    capability: Capability,
    authorizationCode?: string,
  ) {
    return auth(provider, {
      serverUrl: capability.url,
      // Left to itself the SDK asks for every scope a server lists, e.g. full Gmail access.
      ...(provider.scope && { scope: provider.scope }),
      ...(authorizationCode !== undefined && { authorizationCode }),
      fetchFn: this.fetchFor(capability),
    });
  }

  private provider(capability: Capability, browser?: BrowserAuthorization) {
    return new CapabilityOAuthProvider(capability, this.deps.store, this.deps.redirectUrl, browser);
  }

  private transport(capability: Capability, provider: CapabilityOAuthProvider) {
    return new StreamableHTTPClientTransport(new URL(capability.url), {
      authProvider: provider,
      fetch: this.fetchFor(capability),
    });
  }

  /**
   * Every request of a Capability goes through here. Where its sign-in hosts are known, a
   * server whose metadata names another authorization server can't get the client secret.
   */
  private fetchFor(capability: Capability): FetchLike {
    const send: FetchLike = this.deps.fetch ?? ((url, init) => fetch(url, init));
    const signIn = this.deps.signInHostsOf?.(capability);
    if (!signIn) return send;
    const allowed = new Set([new URL(capability.url).host, ...signIn]);
    return (url, init) => {
      const { host } = new URL(url);
      if (allowed.has(host)) return send(url, init);
      return Promise.reject(
        new Error(`Refused to contact ${host}: "${capability.title}" does not sign in there.`),
      );
    };
  }

  /** Leaves out Tools whose names the Engine can't carry, rather than losing them silently. */
  private usableTools(capability: Capability, tools: readonly Tool[]): CapabilityTool[] {
    const seen = new Set<string>();
    const usable: CapabilityTool[] = [];
    for (const tool of tools) {
      const name = capabilityToolName(capability.slug, tool.name);
      if (!TOOL_NAME_PATTERN.test(tool.name) || name.length > MAX_TOOL_NAME_LENGTH) {
        this.deps.logger.warn('A Capability Tool was left out: its name is not usable', {
          capability: capability.slug,
          tool: tool.name,
        });
        continue;
      }
      if (seen.has(tool.name)) continue;
      seen.add(tool.name);
      usable.push(toCapabilityTool(tool));
    }
    return usable;
  }
}

/** The server answered and refused this request; the connection itself still works. */
function isRequestError(error: unknown): boolean {
  return error instanceof McpError && error.code !== ErrorCode.ConnectionClosed;
}

/** What the usual network failures mean for the Owner, who sees them in the dashboard. */
const UNREACHABLE: Record<string, string> = {
  ENOTFOUND: 'the server’s address does not resolve: is the server running?',
  ECONNREFUSED: 'nothing answers at the server’s address: is the server running?',
};

/** Network errors say only "fetch failed"; their cause says why, e.g. ECONNREFUSED. */
function describeFailure(error: unknown): string {
  const message = errorMessage(error);
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const detail = typeof cause?.code === 'string' ? cause.code : cause?.message;
  if (typeof detail !== 'string' || !detail || message.includes(detail)) return message;
  const meaning = UNREACHABLE[detail];
  return meaning ? `${message} (${detail}): ${meaning}` : `${message} (${detail})`;
}

async function listAll(client: Client): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const result = await client.listTools(cursor === undefined ? undefined : { cursor });
    tools.push(...result.tools);
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

function toCapabilityTool(tool: Tool): CapabilityTool {
  const readOnly = tool.annotations?.readOnlyHint === true;
  return {
    name: tool.name,
    title: tool.annotations?.title ?? tool.title ?? tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as CapabilityTool['inputSchema'],
    // MCP reads a missing destructiveHint as destructive, unless the Tool only reads.
    hints: { readOnly, destructive: tool.annotations?.destructiveHint ?? !readOnly },
  };
}

/** Text the model can read; content it can't, such as images, is named instead. */
export function toToolOutput(result: CallToolResult): ToolOutput {
  const parts = (result.content ?? []).map((block) => {
    switch (block.type) {
      case 'text':
        return block.text;
      case 'resource':
        return 'text' in block.resource ? block.resource.text : `[file: ${block.resource.uri}]`;
      case 'resource_link':
        return `[link: ${block.uri}]`;
      default:
        return `[${block.type} not shown]`;
    }
  });
  let text = parts.join('\n');
  if (!text && result.structuredContent) text = JSON.stringify(result.structuredContent);
  if (text.length > MAX_OUTPUT_LENGTH) {
    text = `${text.slice(0, MAX_OUTPUT_LENGTH)}\n[… output cut at ${MAX_OUTPUT_LENGTH} characters]`;
  }
  return { text, isError: result.isError === true };
}
