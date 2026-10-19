import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { createTestDatabase, silentLogger } from '@emanator/shared/server';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';
import type { Capability } from '../domain/capability.ts';
import type { CatalogEntry } from '../domain/catalog.ts';
import { CapabilityCatalog } from './capability-catalog.ts';
import {
  AuthorizationExpiredError,
  CapabilityConnections,
  type CapabilityConnectionsDeps,
} from './capability-connections.ts';
import { CapabilityService } from './capability-service.ts';
import { CapabilityStore } from './capability-store.ts';
import { type FakeMcpServerOptions, startFakeMcpServer } from './fake-mcp-server.ts';
import { SecretBox } from './secret-box.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

const REDIRECT_URL = 'http://127.0.0.1:3000/api/capabilities/oauth/callback';

async function setup(
  protectedServer: boolean,
  env: Record<string, string | undefined> = {},
  entry: CatalogEntry = fakeEntry,
  serverOptions: Partial<FakeMcpServerOptions> = {},
) {
  const server = await startFakeMcpServer({ protected: protectedServer, ...serverOptions });
  const fixture = await createTestDatabase();
  const store = new CapabilityStore(fixture.db, SecretBox.fromKey(randomBytes(32)));
  await store.init();
  const notices: Capability[] = [];
  const connectionsDeps: CapabilityConnectionsDeps = {
    store,
    redirectUrl: REDIRECT_URL,
    notifyNeedsAuthorization: async (capability) => {
      notices.push(capability);
    },
    logger: silentLogger,
  };
  const connections = new CapabilityConnections(connectionsDeps);
  const forgotten: string[] = [];
  const capabilities = new CapabilityService({
    store,
    connections,
    forgetPolicies: async (tools) => {
      forgotten.push(...tools);
    },
    catalog: new CapabilityCatalog({ FAKE_URL: server.url, ...env }, [entry]),
  });
  await capabilities.init();
  cleanups.push(async () => {
    await connections.close();
    await server.close();
    await fixture.close();
  });
  const add = (fields: Record<string, unknown> = {}) =>
    capabilities.create({ title: 'Mail', url: server.url, enabled: true, ...fields });
  return { server, store, capabilities, notices, forgotten, connectionsDeps, db: fixture.db, add };
}

/** A catalog entry pointing at the fake server, whose address comes from FAKE_URL. */
const fakeEntry: CatalogEntry = {
  id: 'fake',
  slug: 'fake',
  title: 'Fake mail',
  description: 'For tests.',
  icon: 'mail',
  scopes: ['mail.read'],
  url: { variable: 'FAKE_URL', base: 'http://unused', path: '' },
  client: { idVariable: 'FAKE_CLIENT_ID', secretVariable: 'FAKE_CLIENT_SECRET' },
};

const FAKE_CLIENT = { FAKE_CLIENT_ID: 'owner-client', FAKE_CLIENT_SECRET: 'shh' };

/** Connects through the whole browser authorization, as the Owner would. */
async function authorize(
  { capabilities, server }: Awaited<ReturnType<typeof setup>>,
  id: string,
): Promise<URL> {
  const outcome = await capabilities.connect(id);
  if (!outcome?.authorizationUrl) throw new Error('Expected an authorization page.');
  const { state, code } = server.approve(outcome.authorizationUrl);
  expect(await capabilities.finishAuthorization(state, code)).toBe(id);
  return new URL(outcome.authorizationUrl);
}

/** A local port nothing listens on: taken, then let go. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise((resolve) => server.close(resolve));
  return port;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('CapabilityService with an MCP server', () => {
  it('connects to a server that needs no authorization and gives turns its Tools', async () => {
    const env = await setup(false);
    const { id } = await env.add();

    const outcome = await env.capabilities.connect(id);

    expect(outcome?.authorizationUrl).toBeUndefined();
    expect(outcome?.capability.status).toBe('connected');
    const [group] = env.capabilities.groups();
    expect(
      group?.tools.map(({ name, title, defaultPolicy }) => [name, title, defaultPolicy]),
    ).toEqual([
      ['mail__search', 'Search mail', 'allow'],
      ['mail__trash', 'trash', 'ask'],
    ]);
    expect(group?.tools[0]?.description).toBe('[Mail] Searches the mail.');

    const search = env.capabilities.turnTools().find(({ name }) => name === 'mail__search');
    expect(await search?.run({ query: 'invoice' })).toEqual({
      text: 'search {"query":"invoice"}',
      isError: false,
    });
    expect(env.server.calls).toEqual([{ name: 'search', args: { query: 'invoice' } }]);
  });

  it('gives turns no Tools of a disabled Capability, but keeps them for Policies', async () => {
    const env = await setup(false);
    const { id } = await env.add();
    await env.capabilities.connect(id);

    await env.capabilities.update(id, { title: 'Mail', url: env.server.url, enabled: false });

    expect(env.capabilities.turnTools()).toEqual([]);
    expect(env.capabilities.groups()[0]?.tools).toHaveLength(2);
  });

  it('authorizes through the browser with dynamic registration and the chosen scopes', async () => {
    const env = await setup(true);
    const { id } = await env.add({ scopes: ['mail.read'] });

    const page = await authorize(env, id);

    expect(page.searchParams.get('scope')).toBe('mail.read');
    expect(page.searchParams.get('client_id')).toBe('dynamic-1');
    expect(page.searchParams.get('code_challenge_method')).toBe('S256');
    expect(page.searchParams.get('redirect_uri')).toBe(REDIRECT_URL);
    expect((await env.capabilities.get(id))?.status).toBe('connected');
    expect(env.notices).toEqual([]);
    // The tokens never reach the database in the clear.
    const { rows } = await env.db.query('SELECT tokens FROM capabilities');
    expect(String(rows[0]?.tokens)).not.toContain('access-');

    const [search] = env.capabilities.turnTools();
    expect((await search?.run({ query: 'x' }))?.isError).toBe(false);
  });

  it('uses a pre-registered client instead of registering one', async () => {
    const env = await setup(true);
    const { id } = await env.add({ clientId: 'owner-client' });

    const page = await authorize(env, id);

    expect(page.searchParams.get('client_id')).toBe('owner-client');
    expect(env.server.registrations).toEqual([]);
  });

  it('refreshes expired tokens during a call without bothering the Owner', async () => {
    const env = await setup(true);
    const { id } = await env.add();
    await authorize(env, id);
    env.server.expireAccessTokens();

    const [search] = env.capabilities.turnTools();
    expect((await search?.run({ query: 'x' }))?.isError).toBe(false);
    expect(env.notices).toEqual([]);
  });

  it('tells the Owner once when the grant lapses, and the model why the call failed', async () => {
    const env = await setup(true);
    const { id } = await env.add();
    await authorize(env, id);
    env.server.expireAccessTokens();
    env.server.breakRefresh();
    const [search] = env.capabilities.turnTools();

    const first = await search?.run({ query: 'x' });
    await search?.run({ query: 'y' });

    expect(first).toEqual({
      text: '"Mail" must be authorized again from the Harness dashboard; the Owner has been told.',
      isError: true,
    });
    expect((await env.capabilities.get(id))?.status).toBe('needs-auth');
    expect(env.notices.map(({ id: notified }) => notified)).toEqual([id]);
  });

  it('refuses an unknown or replayed authorization state', async () => {
    const env = await setup(true);
    const { id } = await env.add();
    const outcome = await env.capabilities.connect(id);
    const { state, code } = env.server.approve(outcome?.authorizationUrl ?? '');

    await expect(env.capabilities.finishAuthorization('forged', code)).rejects.toBeInstanceOf(
      AuthorizationExpiredError,
    );
    await env.capabilities.finishAuthorization(state, code);
    await expect(env.capabilities.finishAuthorization(state, code)).rejects.toBeInstanceOf(
      AuthorizationExpiredError,
    );
  });

  it('forgets the Policies of a deleted Capability, which takes its Tools along', async () => {
    const env = await setup(false);
    const { id } = await env.add();
    await env.capabilities.connect(id);

    await env.capabilities.delete(id);

    expect(env.forgotten).toEqual(['mail__search', 'mail__trash']);
    expect(env.capabilities.groups()).toEqual([]);
    expect(await env.store.tools()).toEqual(new Map());
  });

  describe('catalog', () => {
    it('says what an entry still needs and refuses to connect it', async () => {
      const env = await setup(true, { FAKE_CLIENT_ID: 'owner-client' });

      expect(await env.capabilities.catalog()).toEqual([
        {
          id: 'fake',
          title: 'Fake mail',
          description: 'For tests.',
          icon: 'mail',
          missing: ['FAKE_CLIENT_SECRET'],
        },
      ]);
      await expect(env.capabilities.connectCatalog('fake')).rejects.toThrow(
        'Set FAKE_CLIENT_SECRET in .env first.',
      );
      expect(await env.capabilities.connectCatalog('other')).toBeUndefined();
    });

    it('makes the Capability once and connects it with the client from .env', async () => {
      const env = await setup(true, FAKE_CLIENT);

      const first = await env.capabilities.connectCatalog('fake');
      const page = new URL(first?.authorizationUrl ?? '');
      expect(page.searchParams.get('client_id')).toBe('owner-client');
      expect(page.searchParams.get('scope')).toBe('mail.read');
      const { state, code } = env.server.approve(page.toString());
      await env.capabilities.finishAuthorization(state, code);

      // Connecting again reuses the same Capability, still authorized.
      expect(await env.capabilities.connectCatalog('fake')).toMatchObject({
        capability: { slug: 'fake', catalogId: 'fake', status: 'connected' },
      });
      expect(await env.capabilities.list()).toHaveLength(1);
      const [item] = await env.capabilities.catalog();
      expect(item?.capability?.status).toBe('connected');
      expect(env.capabilities.turnTools().map(({ name }) => name)).toEqual([
        'fake__search',
        'fake__trash',
      ]);
    });

    it('keeps its settings in .env, but lets the Owner turn it off', async () => {
      const env = await setup(true, FAKE_CLIENT);
      const outcome = await env.capabilities.connectCatalog('fake');
      const id = outcome?.capability.id ?? '';

      await expect(
        env.capabilities.update(id, { title: 'Mine', url: env.server.url, enabled: true }),
      ).rejects.toThrow('settings live in .env');
      expect(await env.capabilities.setEnabled(id, false)).toMatchObject({ enabled: false });
      await expect(env.capabilities.setEnabled(id, 'no')).rejects.toThrow('true or false');
    });

    it('gives an entry only the Tools that match its pattern', async () => {
      const env = await setup(true, FAKE_CLIENT, { ...fakeEntry, toolPattern: 'search' });
      const outcome = await env.capabilities.connectCatalog('fake');
      const { state, code } = env.server.approve(outcome?.authorizationUrl ?? '');
      await env.capabilities.finishAuthorization(state, code);

      expect(env.capabilities.turnTools().map(({ name }) => name)).toEqual(['fake__search']);
      expect(env.capabilities.groups()[0]?.tools).toHaveLength(1);
    });

    it('removes, with its Policies, a Capability whose entry left the catalog', async () => {
      const env = await setup(false);
      await env.store.create(
        { slug: 'google', title: 'Google', url: env.server.url, scopes: [], enabled: true },
        'google',
      );

      await env.capabilities.init();

      expect(await env.capabilities.list()).toEqual([]);
    });

    it('follows .env at start: another client drops the connection', async () => {
      const env = await setup(true, FAKE_CLIENT);
      const outcome = await env.capabilities.connectCatalog('fake');
      const { state, code } = env.server.approve(outcome?.authorizationUrl ?? '');
      await env.capabilities.finishAuthorization(state, code);

      const restarted = new CapabilityService({
        store: env.store,
        connections: { forget: async () => {} } as never,
        forgetPolicies: async () => {},
        catalog: new CapabilityCatalog(
          { FAKE_URL: env.server.url, ...FAKE_CLIENT, FAKE_CLIENT_ID: 'new-client' },
          [fakeEntry],
        ),
      });
      await restarted.init();

      expect(await env.store.get(outcome?.capability.id ?? '')).toMatchObject({
        clientId: 'new-client',
        status: 'disconnected',
      });
    });
  });

  it('keeps the connection when the server refuses one request', async () => {
    const env = await setup(false, {}, fakeEntry, {
      answer: (name) => {
        if (name === 'trash') throw new McpError(ErrorCode.InvalidParams, 'No such thread');
        return { content: [{ type: 'text', text: 'ok' }] };
      },
    });
    const { id } = await env.add();
    await env.capabilities.connect(id);
    const [search, trash] = env.capabilities.turnTools();

    expect((await trash?.run({ id: 'x' }))?.isError).toBe(true);
    expect(await search?.run({})).toEqual({ text: 'ok', isError: false });
    expect((await env.capabilities.get(id))?.status).toBe('connected');
  });

  it('records a server that stops answering during a call', async () => {
    const env = await setup(false);
    const { id } = await env.add();
    await env.capabilities.connect(id);
    const [search] = env.capabilities.turnTools();
    await env.server.close();

    expect((await search?.run({}))?.isError).toBe(true);
    expect(await env.capabilities.get(id)).toMatchObject({ status: 'error' });
  });

  it('sends a catalog client secret only to the hosts where it signs in', async () => {
    const elsewhere = await startFakeMcpServer({ protected: true });
    cleanups.push(elsewhere.close);
    // The same machine under another name, so that it counts as another host.
    const foreign = elsewhere.url.replace('127.0.0.1', 'localhost').replace(/\/mcp$/, '');
    const env = await setup(true, FAKE_CLIENT, fakeEntry, { authorizationServer: foreign });
    env.connectionsDeps.signInHostsOf = () => [];

    await expect(env.capabilities.connectCatalog('fake')).rejects.toThrow('Refused to contact');
  });

  it('records a server that cannot be reached as an error', async () => {
    const env = await setup(false);
    const { id } = await env.add({ url: `http://127.0.0.1:${await closedPort()}/mcp` });

    await expect(env.capabilities.connect(id)).rejects.toThrow('ECONNREFUSED');
    expect(await env.capabilities.get(id)).toMatchObject({
      status: 'error',
      lastError: expect.stringContaining('ECONNREFUSED'),
    });
  });
});
