import type { Capability } from './capability.ts';

/**
 * A Capability the Harness knows how to set up: its server, scopes and OAuth client come
 * from `.env` and Compose, so the Owner only connects it.
 */
export interface CatalogEntry {
  id: string;
  /** Also the Capability's slug, so its Tool names are known in advance. */
  slug: string;
  title: string;
  description: string;
  /** Which icon the dashboard shows; a generic plug when it doesn't know it. */
  icon: string;
  /** What has to be running for the entry to work, said to the Owner as is. */
  requires?: string;
  scopes: readonly string[];
  /** The server's address: a variable that overrides it, else the default. */
  url: { variable: string; base: string; path: string };
  /** Variables holding the pre-registered OAuth client. */
  client?: { idVariable: string; secretVariable: string };
  /** Hosts its sign-in may reach besides the server; its client secret reaches no one else. */
  signInHosts?: readonly string[];
  /**
   * A regular expression the server's Tool names match to belong to this entry; all of them
   * when omitted. It lets one server, such as workspace-mcp, serve several entries.
   */
  toolPattern?: string;
}

/** A catalog entry as the dashboard shows it. */
export interface CatalogItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  requires?: string;
  /** Variables missing from `.env`: until they are set the entry can't connect. */
  missing: string[];
  /** The Capability made from the entry, once the Owner connected it. */
  capability?: Capability;
}

/** workspace-mcp serves Gmail and Calendar from one container, for both entries below. */
const WORKSPACE_MCP = {
  requires:
    'Needs the workspace-mcp service, which `docker compose up -d` starts with the Harness.',
  url: { variable: 'WORKSPACE_MCP_URL', base: 'http://workspace-mcp:8000', path: '/mcp' },
  client: { idVariable: 'GOOGLE_CLIENT_ID', secretVariable: 'GOOGLE_CLIENT_SECRET' },
  // Google's authorization server and its token endpoint.
  signInHosts: ['accounts.google.com', 'oauth2.googleapis.com'],
} as const;

// workspace-mcp checks each token through Google's userinfo, which needs these two.
const GOOGLE_IDENTITY = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'gmail',
    slug: 'gmail',
    title: 'Gmail',
    icon: 'gmail',
    description: 'Search and read your mail',
    ...WORKSPACE_MCP,
    // Read-only until write Tools exist: then the Owner connects it again to grant more.
    scopes: [...GOOGLE_IDENTITY, 'https://www.googleapis.com/auth/gmail.readonly'],
    // Every Gmail Tool of workspace-mcp has "gmail" in its name.
    toolPattern: 'gmail',
  },
  {
    id: 'calendar',
    slug: 'calendar',
    title: 'Google Calendar',
    icon: 'calendar',
    description: 'Read your calendars and events',
    ...WORKSPACE_MCP,
    scopes: [...GOOGLE_IDENTITY, 'https://www.googleapis.com/auth/calendar.readonly'],
    // None of Gmail's, so that no Tool can belong to both.
    toolPattern: '^(?!.*gmail).*(calendar|event|freebusy|focus_time|out_of_office)',
  },
];
