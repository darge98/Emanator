import { createTestDatabase } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ConversationStore, slugify } from './conversation-store.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
async function store() {
  const fixture = await createTestDatabase();
  cleanups.push(fixture.close);
  const store = new ConversationStore(fixture.db);
  await store.init();
  return store;
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('ConversationStore', () => {
  it('finds the General Conversation and preserves session references', async () => {
    const conversations = await store();
    const general = await conversations.create({
      name: 'general',
      title: 'Generale',
      channel: 'telegram',
      openedBy: 'harness',
    });
    expect(await conversations.findByThread('telegram', undefined)).toEqual(general);
    expect(await conversations.findByThread('telegram', '42')).toBeUndefined();

    await conversations.setSession(general.id, { engine: 'claude-agent-sdk', id: 'session-1' });
    expect((await conversations.findByName('general'))?.session).toEqual({
      engine: 'claude-agent-sdk',
      id: 'session-1',
    });
    await conversations.setSession(general.id, undefined);
    expect(await conversations.findByName('general')).not.toHaveProperty('session');
  });

  it('archives a thread while keeping its name reserved', async () => {
    const conversations = await store();
    const old = await conversations.create({
      name: 'trip',
      title: 'Trip',
      channel: 'telegram',
      threadId: '42',
      openedBy: 'owner',
    });
    await conversations.archive(old.id);
    expect(await conversations.findByThread('telegram', '42')).toBeUndefined();
    expect(await conversations.availableName('trip')).toBe('trip-2');
    await expect(
      conversations.create({
        name: 'trip-2',
        title: 'Trip',
        channel: 'telegram',
        threadId: '42',
        openedBy: 'owner',
      }),
    ).resolves.toBeDefined();
  });

  it('enforces one live Conversation per thread', async () => {
    const conversations = await store();
    await conversations.create({
      name: 'a',
      title: 'T',
      channel: 'telegram',
      threadId: '42',
      openedBy: 'owner',
    });
    await expect(
      conversations.create({
        name: 'b',
        title: 'T',
        channel: 'telegram',
        threadId: '42',
        openedBy: 'owner',
      }),
    ).rejects.toThrow();
  });
});

describe('slugify', () => {
  it.each([
    ['Viaggio in Giappone', 'viaggio-in-giappone'],
    ['Città & Perù!', 'citta-peru'],
    ['  ---  ', 'topic'],
  ])('%s -> %s', (title, slug) => expect(slugify(title)).toBe(slug));
});
