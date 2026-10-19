import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';

export interface FakeMcpServerOptions {
  /** Whether the MCP endpoint wants a bearer token, as an OAuth-protected server does. */
  protected: boolean;
  tools?: Tool[];
  /** What a call answers; by default it echoes the Tool and its arguments. May throw. */
  answer?: (name: string, args: Record<string, unknown>) => CallToolResult;
  /** The authorization server its metadata names; itself by default. */
  authorizationServer?: string;
}

interface IssuedCode {
  challenge: string;
  clientId: string;
  scope: string;
}

export const FAKE_TOOLS: Tool[] = [
  {
    name: 'search',
    description: 'Searches the mail.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    annotations: { title: 'Search mail', readOnlyHint: true },
  },
  {
    name: 'trash',
    description: 'Moves a thread to the trash.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  { name: 'bad.name', description: 'Unusable name.', inputSchema: { type: 'object' } },
];

/**
 * A real MCP server on a random local port with a minimal OAuth authorization server, for
 * tests: discovery, dynamic registration, PKCE codes, refresh, and switches to make tokens
 * expire or refreshes fail.
 */
export async function startFakeMcpServer(options: FakeMcpServerOptions) {
  const accessTokens = new Set<string>();
  const refreshTokens = new Set<string>();
  const codes = new Map<string, IssuedCode>();
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const registrations: unknown[] = [];
  let counter = 0;
  let refreshBroken = false;

  const http = createServer((request, response) => {
    handle(request, response).catch((error) => {
      response.statusCode = 500;
      response.end(String(error));
    });
  });
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
  const metadataUrl = `${base}/.well-known/oauth-protected-resource/mcp`;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', base);
    if (url.pathname === '/.well-known/oauth-protected-resource/mcp' && options.protected) {
      return json(response, 200, {
        resource: `${base}/mcp`,
        authorization_servers: [options.authorizationServer ?? base],
        scopes_supported: ['mail.read', 'mail.all'],
      });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server' && options.protected) {
      return json(response, 200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      });
    }
    // What the Owner's browser would do: agree at once and go back to the redirect URI.
    if (url.pathname === '/authorize' && options.protected) {
      const { state, code } = approve(url.toString());
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', state);
      response.writeHead(302, { Location: back.toString() });
      return void response.end();
    }
    if (url.pathname === '/register' && request.method === 'POST') {
      const metadata = JSON.parse(await body(request));
      registrations.push(metadata);
      return json(response, 201, { ...metadata, client_id: `dynamic-${registrations.length}` });
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      return token(new URLSearchParams(await body(request)), response);
    }
    if (url.pathname === '/mcp') {
      const bearer = request.headers.authorization?.replace(/^Bearer /, '');
      if (options.protected && (!bearer || !accessTokens.has(bearer))) {
        response.writeHead(401, {
          'WWW-Authenticate': `Bearer resource_metadata="${metadataUrl}"`,
        });
        return void response.end();
      }
      return mcp(request, response);
    }
    response.writeHead(404).end();
  }

  function token(form: URLSearchParams, response: ServerResponse) {
    if (form.get('grant_type') === 'authorization_code') {
      const issued = codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (!issued || issued.challenge !== challenge || issued.clientId !== form.get('client_id')) {
        return json(response, 400, { error: 'invalid_grant' });
      }
      codes.delete(form.get('code') ?? '');
      return json(response, 200, grant(issued.scope));
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (refreshBroken || !refreshTokens.has(form.get('refresh_token') ?? '')) {
        return json(response, 400, { error: 'invalid_grant' });
      }
      const access = `access-${++counter}`;
      accessTokens.add(access);
      return json(response, 200, { access_token: access, token_type: 'Bearer', expires_in: 3600 });
    }
    json(response, 400, { error: 'unsupported_grant_type' });
  }

  function grant(scope: string) {
    const access = `access-${++counter}`;
    const refresh = `refresh-${counter}`;
    accessTokens.add(access);
    refreshTokens.add(refresh);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: 3600,
      scope,
    };
  }

  async function mcp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const server = new McpServer(
      { name: 'fake', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    server.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: options.tools ?? FAKE_TOOLS,
    }));
    server.server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
      const args = params.arguments ?? {};
      calls.push({ name: params.name, args });
      return (
        options.answer?.(params.name, args) ?? {
          content: [{ type: 'text', text: `${params.name} ${JSON.stringify(args)}` }],
        }
      );
    });
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    response.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    const raw = await body(request);
    await transport.handleRequest(request, response, raw ? JSON.parse(raw) : undefined);
  }

  /** What the authorization page does once the Owner agrees: issues a code. */
  function approve(authorizationUrl: string): { state: string; code: string } {
    const params = new URL(authorizationUrl).searchParams;
    const code = `code-${++counter}`;
    codes.set(code, {
      challenge: params.get('code_challenge') ?? '',
      clientId: params.get('client_id') ?? '',
      scope: params.get('scope') ?? '',
    });
    return { state: params.get('state') ?? '', code };
  }

  return {
    url: `${base}/mcp`,
    calls,
    registrations,
    approve,
    /** Every access token stops working, as when they expire. */
    expireAccessTokens: () => accessTokens.clear(),
    /** Refreshing fails too, as when the Owner revoked the grant. */
    breakRefresh: () => {
      refreshBroken = true;
    },
    close: () =>
      new Promise<void>((resolve) => {
        http.closeAllConnections();
        http.close(() => resolve());
      }),
  };
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
}
