import { FakeChannel } from '@emanator/channels/testing';
import { ConversationService, ConversationStore } from '@emanator/conversations/server';
import { type EngineEvent, UsageTracker } from '@emanator/engine';
import { FakeEngine, replyWith, type ScriptedTurn } from '@emanator/engine/testing';
import { createTestDatabase, silentLogger } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoutineInput } from '../domain/routine.ts';
import { RoutineRunner } from './routine-runner.ts';
import { RoutineService } from './routine-service.ts';
import { RoutineNameTakenError, RoutineStore } from './routine-store.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function setup(engine = new FakeEngine()) {
  const fixture = await createTestDatabase();
  const channel = new FakeChannel();
  const conversationStore = new ConversationStore(fixture.db);
  await conversationStore.init();
  const usage = new UsageTracker();
  const conversations = new ConversationService({
    channel,
    engine,
    store: conversationStore,
    usage,
    systemPrompt: () => 'You are a test agent.',
    defaultModel: 'sonnet',
    timeZone: 'Europe/Rome',
    logger: silentLogger,
  });
  const store = new RoutineStore(fixture.db);
  await store.init();
  const runner = new RoutineRunner({
    engine,
    conversations,
    store,
    usage,
    systemPrompt: () => 'You are a test agent.',
    defaultModel: 'sonnet',
    logger: silentLogger,
  });
  const routines = new RoutineService({
    store,
    runner,
    conversations,
    timeZone: 'Europe/Rome',
    logger: silentLogger,
  });
  await routines.start();
  cleanups.push(async () => {
    await routines.stop();
    await fixture.close();
  });
  /** Runs the Routine now and waits for the Run to finish. */
  const runNow = async (id: string) => {
    const run = await routines.runNow(id);
    await runner.idle();
    return run;
  };
  return { channel, engine, conversations, conversationStore, store, routines, runner, runNow };
}

const input = (overrides: Partial<RoutineInput> = {}): RoutineInput => ({
  name: 'Briefing',
  prompt: 'Riassumi la giornata.',
  dedicatedTopic: false,
  enabled: true,
  triggers: [{ type: 'cron', expression: '0 8 * * *' }],
  ...overrides,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('RoutineService', () => {
  it('runs in a fresh session and delivers to General under a header', async () => {
    const { channel, engine, routines, runNow } = await setup(
      new FakeEngine(replyWith('Oggi sole.')),
    );
    const routine = await routines.create(input({ model: 'haiku' }));

    await runNow(routine.id);

    expect(engine.requests[0]).toMatchObject({ prompt: 'Riassumi la giornata.', model: 'haiku' });
    expect(engine.requests[0]).not.toHaveProperty('session');
    expect(engine.requests[0]?.systemPrompt).toContain('You are a test agent.');
    expect(engine.requests[0]?.systemPrompt).toContain('«Briefing»');
    expect(channel.sent).toEqual([
      { threadId: undefined, markdown: '**⏰ Briefing**\n\nOggi sole.' },
    ]);
    expect(await routines.runs(routine.id)).toMatchObject([
      { origin: 'manual', status: 'delivered', session: { engine: 'fake', id: 'session-1' } },
    ]);
  });

  it('hands the delivered message to the Conversation’s next turn', async () => {
    const engine = new FakeEngine();
    const { conversations, routines, runNow } = await setup(engine);
    const routine = await routines.create(input());
    await runNow(routine.id);

    // The Owner replies in General.
    conversations.handle({ type: 'message', text: 'E domani?', receivedAt: new Date() });
    await conversations.idle();

    expect(engine.requests[1]?.prompt).toContain('**⏰ Briefing**');
    expect(engine.requests[1]?.prompt).toMatch(/E domani\?$/);
  });

  it('stays silent when the Agent replies [silent]', async () => {
    const { channel, routines, runNow } = await setup(new FakeEngine(replyWith(' [silent]\n')));
    const routine = await routines.create(input());

    await runNow(routine.id);

    expect(channel.sent).toEqual([]);
    expect((await routines.runs(routine.id))?.[0]?.status).toBe('silent');
  });

  it('opens the dedicated topic once, even for parallel Runs, and reuses it', async () => {
    const { channel, conversationStore, routines, runner } = await setup();
    const routine = await routines.create(
      input({ name: 'Briefing del mattino', dedicatedTopic: true }),
    );

    await Promise.all([routines.runNow(routine.id), routines.runNow(routine.id)]);
    await runner.idle();
    await routines.runNow(routine.id);
    await runner.idle();

    expect(channel.opened).toEqual(['Briefing del mattino · routine']);
    expect(channel.sent.map(({ threadId }) => threadId)).toEqual(['100', '100', '100']);
    const topic = await conversationStore.findByName('briefing-del-mattino-routine');
    expect((await routines.get(routine.id))?.conversationId).toBe(topic?.id);
  });

  it('opens a new topic with the same name when the old one was archived', async () => {
    const { channel, conversationStore, routines, runNow } = await setup();
    const routine = await routines.create(input({ dedicatedTopic: true }));
    await runNow(routine.id);
    channel.deletedThreads.add('100');

    await runNow(routine.id);

    expect(channel.opened).toHaveLength(2);
    expect(channel.sent.at(-1)?.threadId).toBe('101');
    expect(await conversationStore.findByName('briefing-routine')).toMatchObject({
      threadId: '101',
    });
  });

  it('keeps the topic when the option is turned off, and delivers to General', async () => {
    const { channel, routines, runNow } = await setup();
    const routine = await routines.create(input({ dedicatedTopic: true }));
    await runNow(routine.id);

    await routines.update(routine.id, input({ dedicatedTopic: false }));
    await runNow(routine.id);

    expect(channel.sent.map(({ threadId }) => threadId)).toEqual(['100', undefined]);
    expect((await routines.get(routine.id))?.conversationId).toBeDefined();
  });

  it('records a failed Run and tells the Owner', async () => {
    const failed: ScriptedTurn = () =>
      [{ type: 'turn.failed', reason: 'usage-limit', message: 'limit reached' }] as EngineEvent[];
    const { channel, routines, runNow } = await setup(new FakeEngine(failed));
    const routine = await routines.create(input());

    await runNow(routine.id);

    expect(channel.sent[0]?.markdown).toContain('**⏰ Briefing**');
    expect(channel.sent[0]?.markdown).toContain('quota');
    expect((await routines.runs(routine.id))?.[0]).toMatchObject({
      status: 'failed',
      error: 'limit reached',
    });
  });

  it('archives the topic Conversation when the Routine is deleted', async () => {
    const { conversationStore, routines, runNow } = await setup();
    const routine = await routines.create(input({ dedicatedTopic: true }));
    await runNow(routine.id);

    expect(await routines.delete(routine.id)).toBe(true);

    expect(await conversationStore.findByName('briefing-routine')).toBeUndefined();
    expect(await routines.get(routine.id)).toBeUndefined();
    expect(await routines.delete(routine.id)).toBe(false);
  });

  it('rejects a name another Routine already has, compared by slug', async () => {
    const { routines } = await setup();
    await routines.create(input({ name: 'Briefing' }));

    await expect(routines.create(input({ name: 'briefing!' }))).rejects.toThrow(
      RoutineNameTakenError,
    );
  });

  it('shows the next Run of enabled Routines only', async () => {
    const { routines } = await setup();
    const on = await routines.create(input());
    const off = await routines.create(input({ name: 'Spenta', enabled: false }));

    expect(on.nextRunAt).toBeInstanceOf(Date);
    expect(off).not.toHaveProperty('nextRunAt');
  });

  it('marks Runs a stopped Harness left unfinished as failed', async () => {
    const { store, routines } = await setup();
    const routine = await routines.create(input());
    await store.startRun(routine.id, 'schedule');

    await routines.start();

    expect((await routines.runs(routine.id))?.[0]).toMatchObject({ status: 'failed' });
  });
});
