import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { InboundAction } from '@emanator/channels';
import { FakeChannel } from '@emanator/channels/testing';
import { ConversationService, ConversationStore } from '@emanator/conversations/server';
import { type ToolOutput, type TurnRequest, UsageTracker } from '@emanator/engine';
import { FakeEngine, replyWith, type ScriptedTurn } from '@emanator/engine/testing';
import { MemoryService } from '@emanator/memory/server';
import { createTestDatabase, silentLogger } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { DreamService, DreamSettingsError } from './dream-service.ts';
import { DreamStore } from './dream-store.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

/** The Owner's zone, which a test may change. */
const zone = { current: 'Europe/Rome' };

async function setup() {
  zone.current = 'Europe/Rome';
  const fixture = await createTestDatabase();
  const dir = await mkdtemp(join(tmpdir(), 'emanator-dream-'));
  cleanups.push(fixture.close, () => rm(dir, { recursive: true, force: true }));
  const store = new DreamStore(fixture.db);
  await store.init();
  const memory = new MemoryService({ dir, timeZone: () => 'Europe/Rome', logger: silentLogger });
  await memory.init();
  const engine = new FakeEngine();
  const channel = new FakeChannel();
  const conversationStore = new ConversationStore(fixture.db);
  await conversationStore.init();
  const conversations = new ConversationService({
    channel,
    engine,
    store: conversationStore,
    usage: new UsageTracker(),
    systemPrompt: () => '',
    defaultModel: () => 'sonnet',
    timeZone: () => 'Europe/Rome',
    prepareTurn: async () => ({
      decidePermission: async () => ({ behavior: 'deny', reason: 'No Tools in tests.' }),
    }),
    logger: silentLogger,
  });
  const dreams = new DreamService({
    store,
    engine,
    memory,
    conversations,
    channel,
    defaultModel: () => 'sonnet',
    timeZone: () => zone.current,
    logger: silentLogger,
  });
  await dreams.init();
  cleanups.push(async () => dreams.stop());
  /** Records an entry and waits for it to be stored. */
  const record = async (text: string, author: 'owner' | 'agent' | 'tool' = 'owner') => {
    dreams.record({ place: 'Generale', author, text, ...(author === 'tool' && { tool: 'chat' }) });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  const dream = async () => {
    await dreams.dreamNow();
    await dreams.idle();
  };
  return { store, memory, engine, channel, conversationStore, dreams, record, dream };
}

/** A Dream turn that notes these Facts with its `note` Tool, then answers. */
const noting =
  (...facts: Record<string, unknown>[]): ScriptedTurn =>
  async (request: TurnRequest) => {
    const note = request.tools?.find(({ name }) => name === 'note');
    if (!note) throw new Error('The Dream has no note Tool.');
    for (const fact of facts) {
      await (note.run as (input: Record<string, unknown>) => Promise<ToolOutput>)({
        ask: false,
        ...fact,
      });
    }
    return replyWith('Annotato.')(request);
  };

const press = (actionId: string): InboundAction => ({
  type: 'action',
  actionId,
  messageId: '1',
  receivedAt: new Date(),
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('DreamService', () => {
  it('keeps the Journal only while it is on, and forgets it when switched off', async () => {
    const { dreams, store, record } = await setup();
    await record('Mia madre ha la visita il 3 novembre.');
    expect(await store.waiting()).toBe(1);

    await dreams.saveSettings({ enabled: false, time: '07:00' });
    await record('Non tenuto.');

    expect(await store.waiting()).toBe(0);
    await expect(dreams.saveSettings({ enabled: true, time: '7' })).rejects.toThrow(
      DreamSettingsError,
    );
    await expect(
      dreams.saveSettings({ enabled: true, time: '07:00', model: 'gpt-5' }),
    ).rejects.toThrow(DreamSettingsError);
  });

  it('dreams with its own model when the Owner picked one, else with the default', async () => {
    const { dreams, engine, record, dream } = await setup();
    engine.script(replyWith('Niente.'), replyWith('Niente.'));
    await record('Ciao');
    await dream();
    await dreams.saveSettings({ enabled: true, time: '07:00', model: 'haiku' });
    await record('Ancora');
    await dream();

    expect(engine.requests.map(({ model }) => model)).toEqual(['sonnet', 'haiku']);
    expect((await dreams.view()).settings).toEqual({
      enabled: true,
      time: '07:00',
      model: 'haiku',
    });
  });

  it('reads the Journal into inferred Facts, forgets it and asks about what matters', async () => {
    const { engine, memory, channel, store, record, dream } = await setup();
    await record('Cosa mi ha scritto mia madre?');
    await record('Ho la visita dal cardiologo il 3 novembre.', 'tool');
    engine.script(
      noting(
        {
          page: 'Mamma',
          kind: 'persone',
          fact: 'Ha la visita dal cardiologo il 3 novembre.',
          source: 'chat con Mamma',
          ask: true,
        },
        { page: 'Mamma', fact: 'Le piace il giardinaggio.', source: 'chat con Mamma' },
      ),
    );

    await dream();

    expect(engine.requests[0]?.prompt).toContain(
      'Strumento chat: Ho la visita dal cardiologo il 3 novembre.',
    );
    expect((await memory.page('Mamma'))?.facts.map(({ trust }) => trust)).toEqual([
      'inferred',
      'inferred',
    ]);
    expect((await memory.changes(1))[0]?.change).toMatch(/^ricordato dal Sogno in \[\[Mamma\]\]/);
    expect(await store.waiting()).toBe(0);
    expect(await store.lastRun()).toMatchObject({ status: 'done', noted: 2 });
    expect(channel.opened).toEqual(['🌙 Sogno · dream']);
    expect(channel.sent[0]?.threadId).toBe('100');
    expect(channel.sent[0]?.markdown).toContain(
      '1. **Mamma**: Ha la visita dal cardiologo il 3 novembre. (chat con Mamma)',
    );
    expect(channel.sent[0]?.actions?.map(({ label, row }) => [label, row])).toEqual([
      ['✓ 1', 0],
      ['✕ 1', 0],
      ['✓ Tutti', 1],
    ]);
  });

  it('asks in its own topic every morning, reopened if deleted, and hands the question on', async () => {
    const { engine, channel, conversationStore, record, dream } = await setup();
    const asking = () =>
      noting({
        page: 'Mamma',
        kind: 'persone',
        fact: `Fatto ${Math.random()}.`,
        source: 'chat',
        ask: true,
      });
    engine.script(asking(), asking(), asking());

    await record('Uno');
    await dream();
    await record('Due');
    await dream();
    channel.deletedThreads.add('100');
    await record('Tre');
    await dream();

    expect(channel.opened).toEqual(['🌙 Sogno · dream', '🌙 Sogno · dream']);
    expect(channel.sent.map(({ threadId }) => threadId)).toEqual(['100', '100', '101']);
    const topic = await conversationStore.findByName('dream');
    expect(topic).toMatchObject({ threadId: '101', openedBy: 'harness' });
    expect((await conversationStore.pendingHandoffs(topic?.id ?? ''))[0]?.markdown).toContain(
      'Sono giuste?',
    );
  });

  it('keeps the Journal when the Dream fails, and asks nothing', async () => {
    const { engine, channel, store, record, dream } = await setup();
    await record('Ciao');
    engine.script(() => [{ type: 'turn.failed', reason: 'usage-limit', message: 'Quota' }]);

    await dream();

    expect(await store.lastRun()).toMatchObject({ status: 'failed', error: 'usage-limit: Quota' });
    expect(await store.waiting()).toBe(1);
    expect(channel.sent).toEqual([]);
  });

  it('confirms or forgets each Fact the Owner answers, once', async () => {
    const { engine, memory, channel, record, dream, dreams } = await setup();
    await record('Ciao');
    engine.script(
      noting(
        { page: 'Mamma', kind: 'persone', fact: 'Uno.', source: 'chat', ask: true },
        { page: 'Mamma', fact: 'Due.', source: 'chat', ask: true },
        { page: 'Mamma', fact: 'Tre.', source: 'chat', ask: true },
      ),
    );
    await dream();
    const ids = channel.sent[0]?.actions?.map(({ id }) => id) ?? [];

    await dreams.answer(press(ids[1] ?? ''));
    await dreams.answer(press(ids[1] ?? ''));
    await dreams.answer(press(ids[6] ?? ''));

    const facts = (await memory.page('Mamma'))?.facts ?? [];
    expect(facts.map(({ text, trust }) => [text, trust])).toEqual([
      ['Due.', 'confirmed'],
      ['Tre.', 'confirmed'],
    ]);
    expect(channel.actionsSet.at(-1)?.actions.map(({ label }) => label)).toEqual([
      '✕ 1 dimenticato',
      '✓ 2 confermato',
      '✓ 3 confermato',
    ]);
  });

  it('is running once dreamNow resolves, so the dashboard can show it', async () => {
    const { dreams, engine, record } = await setup();
    await record('Ciao');
    let finish = () => {};
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    engine.script(async (request) => {
      await gate;
      return replyWith('Niente.')(request);
    });

    await dreams.dreamNow();

    expect((await dreams.view()).lastRun?.status).toBe('running');
    finish();
    await dreams.idle();
    expect((await dreams.view()).lastRun?.status).toBe('done');
  });

  it('moves its time with a new zone once rescheduled', async () => {
    const { dreams } = await setup();
    const before = (await dreams.view()).nextAt;

    zone.current = 'America/New_York';
    dreams.reschedule();

    const after = (await dreams.view()).nextAt;
    const hour = (iso?: string) =>
      new Date(iso ?? '').toLocaleTimeString('en-GB', { timeZone: zone.current, hour: '2-digit' });
    expect(after).not.toBe(before);
    expect(hour(after)).toBe('07');
  });

  it('does not dream on an empty Journal', async () => {
    const { engine, store, dream } = await setup();

    await dream();

    expect(engine.requests).toEqual([]);
    expect(await store.lastRun()).toBeUndefined();
  });

  it('skips a Fact Memory already has', async () => {
    const { engine, memory, record, dream } = await setup();
    await record('Ciao');
    engine.script(
      noting(
        { page: 'Mamma', kind: 'persone', fact: 'Vive a Parma.', source: 'chat' },
        { page: 'Mamma', fact: 'vive a parma.', source: 'chat' },
      ),
    );

    await dream();

    expect((await memory.page('Mamma'))?.facts).toHaveLength(1);
  });
});
