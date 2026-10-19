import { randomBytes } from 'node:crypto';
import { createTestDatabase } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { NewCapabilityInput } from '../domain/capability.ts';
import { CapabilitySlugTakenError, CapabilityStore } from './capability-store.ts';
import { SecretBox } from './secret-box.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

const gmail: NewCapabilityInput = {
  slug: 'gmail-work',
  title: 'Gmail · Work',
  url: 'https://gmail.example/mcp',
  scopes: ['openid'],
  enabled: true,
  clientId: 'client-1',
  clientSecret: 'shh',
};

async function store() {
  const fixture = await createTestDatabase();
  cleanups.push(fixture.close);
  const capabilities = new CapabilityStore(fixture.db, SecretBox.fromKey(randomBytes(32)));
  await capabilities.init();
  return { capabilities, db: fixture.db };
}

/** Pretends a connection happened, which only step 4 can do for real. */
async function connect(db: Awaited<ReturnType<typeof store>>['db'], id: string) {
  await db.query(
    `UPDATE capabilities SET tokens = 'sealed', client_information = 'sealed',
       status = 'connected' WHERE id = $1`,
    [id],
  );
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('CapabilityStore', () => {
  it('stores the client secret sealed and never returns it', async () => {
    const { capabilities, db } = await store();
    const created = await capabilities.create(gmail);

    expect(created).toMatchObject({
      slug: 'gmail-work',
      clientId: 'client-1',
      hasClientSecret: true,
      status: 'disconnected',
    });
    expect(created).not.toHaveProperty('clientSecret');
    const { rows } = await db.query('SELECT client_secret FROM capabilities');
    expect(String(rows[0]?.client_secret)).not.toContain('shh');
    expect(await capabilities.list()).toEqual([created]);
  });

  it('refuses a slug that is taken', async () => {
    const { capabilities } = await store();
    await capabilities.create(gmail);

    await expect(capabilities.create({ ...gmail, title: 'Other' })).rejects.toBeInstanceOf(
      CapabilitySlugTakenError,
    );
  });

  it('keeps the connection when only the title or the switch change', async () => {
    const { capabilities, db } = await store();
    const { id } = await capabilities.create(gmail);
    await connect(db, id);

    const { clientSecret: _kept, slug: _fixed, ...edit } = gmail;
    const updated = await capabilities.update(id, { ...edit, title: 'Work mail', enabled: false });

    expect(updated).toMatchObject({ title: 'Work mail', enabled: false, status: 'connected' });
    expect(updated?.hasClientSecret).toBe(true);
  });

  it('keeps the connection when the same secret comes again', async () => {
    const { capabilities, db } = await store();
    const { id } = await capabilities.create(gmail);
    await connect(db, id);
    const { slug: _fixed, ...edit } = gmail;

    expect(await capabilities.update(id, edit)).toMatchObject({ status: 'connected' });
  });

  it('remembers the catalog entry a Capability was made from', async () => {
    const { capabilities } = await store();
    const created = await capabilities.create(gmail, 'google');

    expect(created.catalogId).toBe('google');
    expect(await capabilities.getByCatalog('google')).toEqual(created);
    expect(await capabilities.getByCatalog('other')).toBeUndefined();
  });

  it('drops the connection when the server, the client or the scopes change', async () => {
    const { capabilities, db } = await store();
    const { id } = await capabilities.create(gmail);
    const { clientSecret: _kept, slug: _fixed, ...edit } = gmail;

    for (const change of [
      { url: 'https://other.example/mcp' },
      { scopes: ['openid', 'email'] },
      { clientSecret: 'new' },
    ]) {
      await connect(db, id);
      expect(await capabilities.update(id, { ...edit, ...change })).toMatchObject({
        status: 'disconnected',
      });
      const { rows } = await db.query('SELECT tokens, client_information FROM capabilities');
      expect(rows[0]).toEqual({ tokens: null, client_information: null });
    }

    // A new client ID doesn't inherit the old client's secret.
    await connect(db, id);
    expect(await capabilities.update(id, { ...edit, clientId: 'client-2' })).toMatchObject({
      clientId: 'client-2',
      hasClientSecret: false,
      status: 'disconnected',
    });
  });

  it('answers undefined for unknown Capabilities and deletes known ones', async () => {
    const { capabilities } = await store();
    const { id } = await capabilities.create(gmail);
    const { clientSecret: _kept, slug: _fixed, ...edit } = gmail;

    expect(await capabilities.update('missing', edit)).toBeUndefined();
    expect(await capabilities.delete('missing')).toBeUndefined();
    expect((await capabilities.delete(id))?.slug).toBe('gmail-work');
    expect(await capabilities.list()).toEqual([]);
    // The slug is free again.
    await capabilities.create(gmail);
  });

  it('forgets, instead of failing on, secrets sealed under another key', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    const before = new CapabilityStore(fixture.db, SecretBox.fromKey(randomBytes(32)));
    await before.init();
    const { id } = await before.create(gmail);
    await before.saveTokens(id, { access_token: 'old' });

    const after = new CapabilityStore(fixture.db, SecretBox.fromKey(randomBytes(32)));
    expect(await after.credentials(id)).toEqual({});
    expect(await after.get(id)).toMatchObject({ hasClientSecret: false });

    // The same secret again can't be compared with the lost one: it counts as new.
    const { slug: _fixed, ...edit } = gmail;
    await connect(fixture.db, id);
    expect(await after.update(id, edit)).toMatchObject({
      hasClientSecret: true,
      status: 'disconnected',
    });
    expect(await after.credentials(id)).toEqual({ clientSecret: 'shh' });
  });

  it('writes nothing for a connection that began before an edit', async () => {
    const { capabilities, db } = await store();
    const started = await capabilities.create(gmail);
    const { slug: _fixed, ...edit } = gmail;
    await capabilities.update(started.id, { ...edit, title: 'Edited' });

    await capabilities.saveTokens(started.id, { access_token: 'stale' }, started.updatedAt);
    expect(await capabilities.replaceTools(started.id, [], started.updatedAt)).toBe(false);
    expect(
      await capabilities.setStatus(started.id, 'connected', undefined, started.updatedAt),
    ).toBeUndefined();
    const { rows } = await db.query('SELECT tokens, status FROM capabilities');
    expect(rows[0]).toEqual({ tokens: null, status: 'disconnected' });
    expect(await capabilities.replaceTools('gone', [])).toBe(false);
  });

  it('drops authorizations in progress and old Tools when the server changes', async () => {
    const { capabilities, db } = await store();
    const { id } = await capabilities.create(gmail);
    await capabilities.savePendingAuthorization('state-1', id, 'verifier', 60_000);
    await capabilities.replaceTools(id, [
      {
        name: 'search',
        title: 'Search',
        description: '',
        inputSchema: { type: 'object' },
        hints: {},
      },
    ]);
    const { clientSecret: _kept, slug: _fixed, ...edit } = gmail;

    await capabilities.update(id, { ...edit, url: 'https://other.example/mcp' });

    expect(await capabilities.takePendingAuthorization('state-1', 60_000)).toBeUndefined();
    expect(await capabilities.tools()).toEqual(new Map());
    const { rows } = await db.query('SELECT count(*)::int AS n FROM capability_authorizations');
    expect(rows[0]?.n).toBe(0);
  });

  it('purges authorizations the browser abandoned', async () => {
    const { capabilities, db } = await store();
    const { id } = await capabilities.create(gmail);
    await capabilities.savePendingAuthorization('old', id, 'verifier', 60_000);
    await db.query("UPDATE capability_authorizations SET created_at = now() - interval '1 hour'");

    await capabilities.savePendingAuthorization('new', id, 'verifier', 60_000);

    const { rows } = await db.query('SELECT state FROM capability_authorizations');
    expect(rows).toEqual([{ state: 'new' }]);
    expect(await capabilities.takePendingAuthorization('old', 60_000)).toBeUndefined();
  });
});
