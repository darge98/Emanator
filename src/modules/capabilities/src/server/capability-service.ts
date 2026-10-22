import type { JsonSchemaToolDefinition } from '@emanator/engine';
import { defaultPolicy, type ToolGroup, type ToolInfo } from '@emanator/policies';
import {
  type Capability,
  type CapabilityInput,
  type CapabilityTool,
  CapabilityValidationError,
  capabilityToolName,
  validateCapabilityInput,
  validateNewCapability,
} from '../domain/capability.ts';
import type { CatalogItem } from '../domain/catalog.ts';
import type { CapabilityCatalog } from './capability-catalog.ts';
import type { CapabilityConnections } from './capability-connections.ts';
import type { CapabilityStore } from './capability-store.ts';

export interface CapabilityServiceDeps {
  store: CapabilityStore;
  connections: Pick<
    CapabilityConnections,
    'connect' | 'finishAuthorization' | 'refreshTools' | 'call' | 'forget'
  >;
  /** Drops the Policies of a deleted Capability's Tools, which a new one must not inherit. */
  forgetPolicies: (tools: readonly string[]) => Promise<void>;
  /** The Capabilities the Owner only connects; none when omitted. */
  catalog?: Pick<CapabilityCatalog, 'offers' | 'offer'>;
}

/** A Capability's Tool as Policies and turns see it: described once, run through its server. */
export type CapabilityToolDefinition = ToolInfo & JsonSchemaToolDefinition;

export type CapabilityToolGroup = ToolGroup<CapabilityToolDefinition>;

/** What connecting asks of the Owner: nothing, or a visit to the authorization page. */
export interface ConnectOutcome {
  capability: Capability;
  authorizationUrl?: string;
}

/**
 * What the dashboard and turns do with Capabilities. It keeps the Capabilities and their
 * cached Tools in memory, so Policies can read them without waiting on the database.
 */
export class CapabilityService {
  private capabilities: Capability[] = [];
  private tools = new Map<string, CapabilityTool[]>();

  constructor(private readonly deps: CapabilityServiceDeps) {}

  /**
   * Loads the Capabilities, after bringing those from the catalog in line with `.env`. A
   * Capability whose entry left the catalog goes, with its Policies.
   */
  async init(): Promise<void> {
    for (const offer of this.deps.catalog?.offers() ?? []) {
      const existing = await this.deps.store.getByCatalog(offer.entry.id);
      if (existing && offer.input) await this.sync(existing, offer.input);
    }
    await this.reload();
    for (const capability of this.capabilities) {
      if (capability.catalogId && !this.deps.catalog?.offer(capability.catalogId)) {
        await this.delete(capability.id);
      }
    }
  }

  /** The catalog, with what each entry still needs and the Capability made from it. */
  async catalog(): Promise<CatalogItem[]> {
    // One query for every entry: this also runs on every turn, for the Agent's self report.
    const all = await this.deps.store.list();
    return (this.deps.catalog?.offers() ?? []).map(({ entry, missing }) => {
      const capability = all.find(({ catalogId }) => catalogId === entry.id);
      return {
        id: entry.id,
        title: entry.title,
        description: entry.description,
        icon: entry.icon,
        ...(entry.requires && { requires: entry.requires }),
        missing,
        ...(capability && { capability }),
      };
    });
  }

  /**
   * Connects a catalog entry, making its Capability the first time; undefined when there is
   * no such entry. Its settings come from `.env` at every connection.
   */
  async connectCatalog(id: string): Promise<ConnectOutcome | undefined> {
    const offer = this.deps.catalog?.offer(id);
    if (!offer) return undefined;
    if (!offer.input) {
      throw new CapabilityValidationError(`Set ${offer.missing.join(' and ')} in .env first.`);
    }
    const existing = await this.deps.store.getByCatalog(id);
    const capability = existing
      ? await this.sync(existing, offer.input)
      : await this.deps.store.create(offer.input, id);
    await this.reload();
    return this.connect(capability.id);
  }

  list(): Promise<Capability[]> {
    return this.deps.store.list();
  }

  get(id: string): Promise<Capability | undefined> {
    return this.deps.store.get(id);
  }

  async create(input: unknown): Promise<Capability> {
    const capability = await this.deps.store.create(validateNewCapability(input));
    await this.reload();
    return capability;
  }

  /** Returns undefined when the Capability doesn't exist. */
  async update(id: string, input: unknown): Promise<Capability | undefined> {
    if ((await this.deps.store.get(id))?.catalogId) {
      throw new CapabilityValidationError(
        'This Capability comes from the catalog: its settings live in .env.',
      );
    }
    const capability = await this.deps.store.update(id, validateCapabilityInput(input));
    await this.deps.connections.forget(id);
    await this.reload();
    return capability;
  }

  /** Turns a Capability on or off; undefined when it doesn't exist. */
  async setEnabled(id: string, enabled: unknown): Promise<Capability | undefined> {
    if (typeof enabled !== 'boolean') {
      throw new CapabilityValidationError('enabled must be true or false.');
    }
    const current = await this.deps.store.get(id);
    if (!current) return undefined;
    const capability = await this.deps.store.update(id, { ...settingsOf(current), enabled });
    await this.reload();
    return capability;
  }

  /** Returns the deleted Capability, or undefined when it didn't exist. */
  async delete(id: string): Promise<Capability | undefined> {
    const capability = await this.deps.store.delete(id);
    if (!capability) return undefined;
    const tools = (this.tools.get(id) ?? []).map(({ name }) =>
      capabilityToolName(capability.slug, name),
    );
    await this.deps.connections.forget(id);
    await this.reload();
    await this.deps.forgetPolicies(tools);
    return capability;
  }

  /** Returns undefined when the Capability doesn't exist. */
  async connect(id: string): Promise<ConnectOutcome | undefined> {
    const capability = await this.deps.store.get(id);
    if (!capability) return undefined;
    try {
      const authorizationUrl = await this.deps.connections.connect(capability);
      return {
        capability: await this.current(id, capability),
        ...(authorizationUrl && { authorizationUrl }),
      };
    } finally {
      await this.reload();
    }
  }

  /** Completes an authorization when the browser comes back; returns the Capability's id. */
  async finishAuthorization(state: string, code: string): Promise<string> {
    try {
      return await this.deps.connections.finishAuthorization(state, code, (id) =>
        this.deps.store.get(id),
      );
    } finally {
      await this.reload();
    }
  }

  /** Lists the server's Tools again; undefined when the Capability doesn't exist. */
  async refreshTools(id: string): Promise<Capability | undefined> {
    const capability = await this.deps.store.get(id);
    if (!capability) return undefined;
    try {
      await this.deps.connections.refreshTools(capability);
      return await this.current(id, capability);
    } finally {
      await this.reload();
    }
  }

  /** The cached Tools of a Capability, as its server lists them. */
  async toolsOf(id: string): Promise<CapabilityTool[] | undefined> {
    const capability = await this.deps.store.get(id);
    return capability && this.toolsFor(capability);
  }

  /** Every Capability's Tools, for Policies: disabled Capabilities keep theirs. */
  groups(): CapabilityToolGroup[] {
    return this.capabilities.map((capability) => ({
      kind: 'capability',
      name: capability.slug,
      title: capability.title,
      tools: this.toolsFor(capability).map((tool) => this.definition(capability, tool)),
    }));
  }

  /** The Tools turns may get: those of the enabled Capabilities. */
  turnTools(): CapabilityToolDefinition[] {
    const enabled = new Set(this.capabilities.filter((c) => c.enabled).map((c) => c.slug));
    return this.groups()
      .filter(({ name }) => enabled.has(name))
      .flatMap(({ tools }) => tools);
  }

  private definition(capability: Capability, tool: CapabilityTool): CapabilityToolDefinition {
    return {
      name: capabilityToolName(capability.slug, tool.name),
      title: tool.title,
      // The account matters to the model: two Capabilities may offer the same Tools.
      description: `[${capability.title}] ${tool.description}`.trim(),
      inputSchema: tool.inputSchema,
      hints: tool.hints,
      defaultPolicy: defaultPolicy(tool.hints),
      run: (input) => this.deps.connections.call(capability, tool.name, input),
    };
  }

  /** The cached Tools that belong to the Capability: a catalog entry may take only some. */
  private toolsFor(capability: Capability): CapabilityTool[] {
    const tools = this.tools.get(capability.id) ?? [];
    const names =
      capability.catalogId && this.deps.catalog?.offer(capability.catalogId)?.entry.tools;
    if (!names) return tools;
    const belongs = new Set(names);
    return tools.filter(({ name }) => belongs.has(name));
  }

  /** Brings a catalog Capability in line with `.env`, keeping the Owner's on/off choice. */
  private async sync(capability: Capability, input: CapabilityInput): Promise<Capability> {
    const synced = await this.deps.store.update(capability.id, {
      ...input,
      enabled: capability.enabled,
    });
    await this.deps.connections.forget(capability.id);
    return synced ?? capability;
  }

  private async current(id: string, fallback: Capability): Promise<Capability> {
    return (await this.deps.store.get(id)) ?? fallback;
  }

  private async reload(): Promise<void> {
    const [capabilities, tools] = await Promise.all([
      this.deps.store.list(),
      this.deps.store.tools(),
    ]);
    this.capabilities = capabilities;
    this.tools = tools;
  }
}

/** What the store needs to keep a Capability as it is; its secret stays untouched. */
function settingsOf(capability: Capability): CapabilityInput {
  return {
    title: capability.title,
    url: capability.url,
    scopes: capability.scopes,
    enabled: capability.enabled,
    ...(capability.clientId && { clientId: capability.clientId }),
  };
}
