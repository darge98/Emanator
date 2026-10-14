import { openDatabase } from '@emanator/shared/server';
import { describe, expect, it } from 'vitest';
import { ConversationStore, slugify } from './conversation-store.ts';

const store = () => new ConversationStore(openDatabase(':memory:'));

describe('ConversationStore', () => {
  it('finds the General Conversation by its missing thread id', () => {
    const conversations = store();
    const general = conversations.create({
      name: 'general',
      title: 'Generale',
      channel: 'telegram',
      openedBy: 'harness',
    });

    expect(conversations.findByThread('telegram', undefined)).toEqual(general);
    expect(conversations.findByThread('telegram', '42')).toBeUndefined();
  });

  it('stores and clears the Engine session', () => {
    const conversations = store();
    const { id } = conversations.create({
      name: 'trip',
      title: 'Trip',
      channel: 'telegram',
      threadId: '42',
      openedBy: 'owner',
    });

    conversations.setSession(id, { engine: 'claude-agent-sdk', id: 'session-1' });
    expect(conversations.findByName('trip')?.session).toEqual({
      engine: 'claude-agent-sdk',
      id: 'session-1',
    });

    conversations.setSession(id, undefined);
    expect(conversations.findByName('trip')).not.toHaveProperty('session');
  });

  it('frees the thread when a Conversation is archived, but keeps its name taken', () => {
    const conversations = store();
    const old = conversations.create({
      name: 'trip',
      title: 'Trip',
      channel: 'telegram',
      threadId: '42',
      openedBy: 'owner',
    });

    conversations.archive(old.id);

    expect(conversations.findByThread('telegram', '42')).toBeUndefined();
    expect(conversations.availableName('trip')).toBe('trip-2');
    expect(() =>
      conversations.create({
        name: 'trip-2',
        title: 'Trip',
        channel: 'telegram',
        threadId: '42',
        openedBy: 'owner',
      }),
    ).not.toThrow();
  });

  it('refuses two live Conversations on the same thread', () => {
    const conversations = store();
    const topic = { title: 'T', channel: 'telegram', threadId: '42', openedBy: 'owner' } as const;
    conversations.create({ name: 'a', ...topic });

    expect(() => conversations.create({ name: 'b', ...topic })).toThrow();
  });
});

describe('slugify', () => {
  it.each([
    ['Viaggio in Giappone', 'viaggio-in-giappone'],
    ['Città & Perù!', 'citta-peru'],
    ['  ---  ', 'topic'],
  ])('%s -> %s', (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });
});
