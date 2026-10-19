import type { JsonObjectSchema, ToolHints } from '@emanator/engine';

/**
 * An integration with an external system for one account, added as a remote MCP server
 * (see CONTEXT.md). Its secrets never leave the server: the dashboard only learns whether
 * a client secret is set.
 */
export interface Capability {
  id: string;
  /** Fixed at creation: it prefixes the Capability's Tool names, which Policies are keyed by. */
  slug: string;
  title: string;
  url: string;
  /** OAuth scopes to ask for; empty means those the server advertises. */
  scopes: string[];
  /** A disabled Capability keeps its connection but gives no Tools to turns. */
  enabled: boolean;
  /** A pre-registered OAuth client; without one the Harness registers itself dynamically. */
  clientId?: string;
  hasClientSecret: boolean;
  status: CapabilityStatus;
  /** Set when the Capability comes from the catalog, which then owns its settings. */
  catalogId?: string;
  /** Why the last connection attempt failed, while status is `error` or `needs-auth`. */
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const CAPABILITY_STATUSES = ['disconnected', 'connected', 'needs-auth', 'error'] as const;

export type CapabilityStatus = (typeof CAPABILITY_STATUSES)[number];

/** What the Owner edits. */
export interface CapabilityInput {
  title: string;
  url: string;
  scopes: string[];
  enabled: boolean;
  clientId?: string;
  /** Write-only: undefined keeps the stored secret, an empty string removes it. */
  clientSecret?: string;
}

/** Only on creation: the slug can't change afterwards. */
export interface NewCapabilityInput extends CapabilityInput {
  slug: string;
}

/** A Capability the Owner submitted breaks a rule; the message says which. */
export class CapabilityValidationError extends Error {
  override name = 'CapabilityValidationError';
}

/** Separates the slug from the server's own Tool name, e.g. `gmail-work__search`. */
export const TOOL_NAME_SEPARATOR = '__';

/**
 * Short enough that the Capability's Tool names keep room within the Engine's limit. A slug
 * never contains the separator, so a Tool name always splits back unambiguously.
 */
export const MAX_SLUG_LENGTH = 40;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SCOPES = 30;

/** Suggests a slug from a title: `Gmail · Work` becomes `gmail-work`. */
export function suggestSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '');
}

/** Checks a new Capability; without a slug, one is suggested from the title. */
export function validateNewCapability(input: unknown): NewCapabilityInput {
  const fields = validateCapabilityInput(input);
  const given = (input as Record<string, unknown>).slug;
  const slug = given === undefined || given === '' ? suggestSlug(fields.title) : given;
  if (typeof slug !== 'string' || slug.length > MAX_SLUG_LENGTH || !SLUG_PATTERN.test(slug)) {
    throw new CapabilityValidationError(
      `The slug must be 1 to ${MAX_SLUG_LENGTH} lowercase letters or digits, separated by single hyphens.`,
    );
  }
  return { ...fields, slug };
}

/** Checks and normalizes what the dashboard sends; throws CapabilityValidationError. */
export function validateCapabilityInput(input: unknown): CapabilityInput {
  if (!input || typeof input !== 'object') {
    throw new CapabilityValidationError('Invalid Capability.');
  }
  const value = input as Record<string, unknown>;
  const title = text(value.title, 'title', 100);
  const url = serverUrl(value.url);
  if (typeof value.enabled !== 'boolean') {
    throw new CapabilityValidationError('enabled must be true or false.');
  }
  const clientId = optionalText(value.clientId, 'clientId', 500);
  const clientSecret =
    value.clientSecret === undefined || value.clientSecret === null
      ? undefined
      : text(value.clientSecret, 'clientSecret', 500, true);
  if (clientSecret && !clientId) {
    throw new CapabilityValidationError('A client secret needs a client ID.');
  }
  return {
    title,
    url,
    scopes: scopes(value.scopes),
    enabled: value.enabled,
    ...(clientId && { clientId }),
    ...(clientSecret !== undefined && { clientSecret }),
  };
}

function serverUrl(value: unknown): string {
  const raw = text(value, 'url', 2000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CapabilityValidationError('url must be a full address, such as https://…/mcp.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new CapabilityValidationError('url must start with https:// or http://.');
  }
  // Plain http would send tokens in the clear: only for this machine or a Compose service.
  if (url.protocol === 'http:' && !isLocalHost(url.hostname)) {
    throw new CapabilityValidationError(
      'url must use https://, unless the server runs on this machine or in Compose.',
    );
  }
  if (url.username || url.password) {
    throw new CapabilityValidationError('url must not carry credentials.');
  }
  return url.toString();
}

/** This machine, or a single-label name such as a Compose service's. */
function isLocalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname) || !hostname.includes('.');
}

function scopes(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SCOPES) {
    throw new CapabilityValidationError(`scopes must be a list of at most ${MAX_SCOPES} scopes.`);
  }
  const list = value.map((scope) => {
    if (typeof scope !== 'string' || !/^\S{1,500}$/.test(scope.trim())) {
      throw new CapabilityValidationError('Each scope must be text without spaces.');
    }
    return scope.trim();
  });
  return [...new Set(list)];
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, field, max, true) || undefined;
}

function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new CapabilityValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > max) {
    throw new CapabilityValidationError(`${field} must contain 1 to ${max} characters.`);
  }
  return trimmed;
}

/** A Tool as the Capability's server lists it, under the server's own name. */
export interface CapabilityTool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonObjectSchema;
  hints: ToolHints;
}

/** The name Policies and the Engine know a Capability's Tool by. */
export function capabilityToolName(slug: string, tool: string): string {
  return `${slug}${TOOL_NAME_SEPARATOR}${tool}`;
}
