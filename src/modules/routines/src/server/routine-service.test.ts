import { FakeChannel } from '@emanator/channels/testing';
import { ConversationService, ConversationStore } from '@emanator/conversations/server';
import { type EngineEvent, UsageTracker } from '@emanator/engine';
import { FakeEngine, replyWith, type ScriptedTurn } from '@emanator/engine/testing';
import { createTestDatabase, type Logger, silentLogger } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { RoutineInput } from '../domain/routine.ts';
import { RoutineRunner } from './routine-runner.ts';
import { RoutineService } from './routine-service.ts';
import { RoutineNameTakenError, RoutineStore } from './routine-store.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

interface SetupOptions {
  /** Replaces the quota wait; resolves at once by default. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  logger?: Logger;
  now?: () => Date;
}

/** A turn that waits for `release()` before answering. */
function gatedTurn(text: string) {
  let release = () => {};
  let markStarted = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const turn: ScriptedTurn = async (request) => {
    markStarted();
    await gate;
    return replyWith(text)(request);
  };
  return { turn, release, started };
}

async function setup(engine = new FakeEngine(), options: SetupOptions = {}) {
  const sleeps: number[] = [];
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
    defaultModel: () => 'sonnet',
    timeZone: 'Europe/Rome',
    prepareTurn: async () => ({
      decidePermission: async () => ({ behavior: 'deny', reason: 'No Tools in tests.' }),
    }),
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
    defaultModel: () => 'sonnet',
    timeZone: 'Europe/Rome',
    prepareTurn: async () => ({
      decidePermission: async () => ({ behavior: 'deny', reason: 'No Tools in tests.' }),
    }),
    logger: options.logger ?? silentLogger,
    ...(options.now && { now: options.now }),
    sleep: (ms, signal) => {
      sleeps.push(ms);
      return options.sleep ? options.sleep(ms, signal) : Promise.resolve();
    },
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
  return {
    channel,
    engine,
    conversations,
    conversationStore,
    store,
    routines,
    runner,
    runNow,
    sleeps,
  };
}

const input = (overrides: Partial<RoutineInput> = {}): RoutineInput => ({
  name: 'Briefing',
  prompt: 'Riassumi la giornata.',
  enabled: true,
  triggers: [{ type: 'cron', expression: '0 8 * * *' }],
  ...overrides,
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('RoutineService', () => {
  it('runs in a fresh session and delivers to its own topic under a header', async () => {
    const { channel, engine, routines, runNow } = await setup(
      new FakeEngine(replyWith('Oggi sole.')),
    );
    const routine = await routines.create(input({ model: 'haiku' }));

    await runNow(routine.id);

    expect(engine.requests[0]).toMatchObject({ prompt: 'Riassumi la giornata.', model: 'haiku' });
    expect(engine.requests[0]).not.toHaveProperty('session');
    expect(engine.requests[0]?.systemPrompt).toContain('You are a test agent.');
    expect(engine.requests[0]?.systemPrompt).toContain('«Briefing»');
    expect(channel.opened).toEqual(['Briefing · routine']);
    expect(channel.sent).toEqual([{ threadId: '100', markdown: '**⏰ Briefing**\n\nOggi sole.' }]);
    expect(await routines.runs(routine.id)).toMatchObject([
      { origin: 'manual', status: 'delivered', session: { engine: 'fake', id: 'session-1' } },
    ]);
  });

  it('hands the delivered message to the Conversation’s next turn', async () => {
    const engine = new FakeEngine();
    const { conversations, routines, runNow } = await setup(engine);
    const routine = await routines.create(input());
    await runNow(routine.id);

    // The Owner replies in the Routine's topic.
    conversations.handle({
      type: 'message',
      text: 'E domani?',
      threadId: '100',
      receivedAt: new Date(),
    });
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
    const routine = await routines.create(input({ name: 'Briefing del mattino' }));

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
    const routine = await routines.create(input());
    await runNow(routine.id);
    channel.deletedThreads.add('100');

    await runNow(routine.id);

    expect(channel.opened).toHaveLength(2);
    expect(channel.sent.at(-1)?.threadId).toBe('101');
    expect(await conversationStore.findByName('briefing-routine')).toMatchObject({
      threadId: '101',
    });
  });

  it('delivers nothing, and opens no topic, when the Routine is deleted during the Run', async () => {
    const slow = gatedTurn('Fatto.');
    const { channel, routines, runner, store } = await setup(new FakeEngine().script(slow.turn));
    const routine = await routines.create(input());
    const run = await routines.runNow(routine.id);
    await slow.started;

    await routines.delete(routine.id);
    slow.release();
    await runner.idle();

    expect(channel.opened).toEqual([]);
    expect(channel.sent).toEqual([]);
    expect(await store.runs(routine.id)).toEqual([]);
    expect(run).toBeDefined();
  });

  it('opens the topic under the new name when the Routine is renamed during the Run', async () => {
    const slow = gatedTurn('Fatto.');
    const { channel, routines, runner } = await setup(new FakeEngine().script(slow.turn));
    const routine = await routines.create(input());
    await routines.runNow(routine.id);
    await slow.started;

    await routines.update(routine.id, input({ name: 'Buongiorno' }));
    slow.release();
    await runner.idle();

    expect(channel.opened).toEqual(['Buongiorno · routine']);
    expect(channel.sent[0]?.markdown).toBe('**⏰ Buongiorno**\n\nFatto.');
  });

  it('logs every failed Run, including Engine exceptions', async () => {
    const errors: unknown[] = [];
    const throwing: ScriptedTurn = () => {
      throw new Error('engine exploded');
    };
    const { routines, runNow } = await setup(new FakeEngine(throwing), {
      logger: { ...silentLogger, error: (message, fields) => errors.push({ message, fields }) },
    });
    const routine = await routines.create(input());

    await runNow(routine.id);

    expect((await routines.runs(routine.id))?.[0]).toMatchObject({
      status: 'failed',
      error: 'engine exploded',
    });
    expect(errors).toContainEqual({
      message: 'Routine Run failed',
      fields: expect.objectContaining({ routine: 'Briefing', error: 'engine exploded' }),
    });
  });

  it('records a failed Run and tells the Owner', async () => {
    const failed: ScriptedTurn = () =>
      [{ type: 'turn.failed', reason: 'authentication', message: 'bad token' }] as EngineEvent[];
    const { channel, routines, runNow } = await setup(new FakeEngine(failed));
    const routine = await routines.create(input());

    await runNow(routine.id);

    expect(channel.sent[0]?.markdown).toContain('**⏰ Briefing**');
    expect(channel.sent[0]?.markdown).toContain('credenziali');
    expect((await routines.runs(routine.id))?.[0]).toMatchObject({
      status: 'failed',
      error: 'bad token',
    });
  });

  it('archives the topic Conversation when the Routine is deleted', async () => {
    const { conversationStore, routines, runNow } = await setup();
    const routine = await routines.create(input());
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

  describe('renaming', () => {
    it('renames the topic and its Conversation with the Routine', async () => {
      const { channel, conversationStore, routines, runNow } = await setup();
      const routine = await routines.create(input());
      await runNow(routine.id);

      await routines.update(routine.id, input({ name: 'Buongiorno' }));

      expect(channel.renamed).toEqual([{ threadId: '100', title: 'Buongiorno · routine' }]);
      expect(await conversationStore.findByName('buongiorno-routine')).toMatchObject({
        threadId: '100',
        title: 'Buongiorno · routine',
      });
      expect(await conversationStore.findByName('briefing-routine')).toBeUndefined();
    });

    it('archives a topic deleted meanwhile, so the next Run opens one with the new name', async () => {
      const { channel, conversationStore, routines, runNow } = await setup();
      const routine = await routines.create(input());
      await runNow(routine.id);
      channel.deletedThreads.add('100');

      await routines.update(routine.id, input({ name: 'Buongiorno' }));
      await runNow(routine.id);

      expect(channel.opened).toEqual(['Briefing · routine', 'Buongiorno · routine']);
      expect(await conversationStore.findByName('buongiorno-routine')).toMatchObject({
        threadId: '101',
      });
    });

    it('leaves the topic alone when the name does not change', async () => {
      const { channel, routines, runNow } = await setup();
      const routine = await routines.create(input());
      await runNow(routine.id);

      await routines.update(routine.id, input({ prompt: 'Altro.' }));

      expect(channel.renamed).toEqual([]);
    });
  });

  describe('quota', () => {
    const exhausted =
      (resetsAt: Date): ScriptedTurn =>
      () =>
        [
          { type: 'usage.limit', status: 'exhausted', window: 'five_hour', resetsAt },
          { type: 'turn.failed', reason: 'usage-limit', message: 'limit reached' },
        ] as EngineEvent[];

    it('waits for the reset, retries, and tells the Owner once', async () => {
      const resetsAt = new Date(Date.now() + 2 * 3_600_000);
      const engine = new FakeEngine(replyWith('Fatto.')).script(exhausted(resetsAt));
      const { channel, routines, runNow, sleeps } = await setup(engine);
      const routine = await routines.create(input());

      await runNow(routine.id);

      expect(sleeps).toHaveLength(1);
      expect(sleeps[0]).toBeGreaterThan(2 * 3_600_000 - 5_000);
      expect(sleeps[0]).toBeLessThanOrEqual(2 * 3_600_000 + 60_000);
      expect(channel.sent.map(({ markdown }) => markdown)).toEqual([
        expect.stringContaining('⏳ La quota di utilizzo è esaurita'),
        '**⏰ Briefing**\n\nFatto.',
      ]);
      expect((await routines.runs(routine.id))?.[0]?.status).toBe('delivered');
    });

    it('holds later Runs until the reset without calling the Engine, with no second notice', async () => {
      const resetsAt = new Date(Date.now() + 3_600_000);
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const engine = new FakeEngine(replyWith('Fatto.')).script(exhausted(resetsAt));
      const {
        channel,
        engine: fake,
        routines,
        runner,
        store,
      } = await setup(engine, {
        sleep: () => gate,
      });
      const routine = await routines.create(input());

      await routines.runNow(routine.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
      await routines.runNow(routine.id);
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(fake.requests).toHaveLength(1);
      expect((await store.runs(routine.id)).map(({ status }) => status)).toEqual([
        'waiting',
        'waiting',
      ]);
      release();
      await runner.idle();

      expect(channel.sent.filter(({ markdown }) => markdown.startsWith('⏳'))).toHaveLength(1);
      expect((await store.runs(routine.id)).map(({ status }) => status)).toEqual([
        'delivered',
        'delivered',
      ]);
    });

    it('shares one wait and one notice when Runs fail together and the reset is unknown', async () => {
      let now = Date.parse('2026-10-18T10:00:00Z');
      const releases: Array<() => void> = [];
      let wakeUp = () => {};
      const wake = new Promise<void>((resolve) => {
        wakeUp = resolve;
      });
      // Both Runs are inside the Engine when the quota runs out, a few seconds apart.
      const unknownReset: ScriptedTurn = async () => {
        await new Promise<void>((resolve) => releases.push(resolve));
        return [
          { type: 'turn.failed', reason: 'usage-limit', message: 'limit reached' },
        ] as EngineEvent[];
      };
      const engine = new FakeEngine(replyWith('Fatto.')).script(unknownReset, unknownReset);
      const { channel, routines, runner, sleeps } = await setup(engine, {
        now: () => new Date(now),
        sleep: () => wake,
      });
      const first = await routines.create(input({ name: 'Uno' }));
      const second = await routines.create(input({ name: 'Due' }));

      await routines.runNow(first.id);
      await routines.runNow(second.id);
      await new Promise((resolve) => setTimeout(resolve, 50));
      releases[0]?.();
      await new Promise((resolve) => setTimeout(resolve, 50));
      now += 5_000;
      releases[1]?.();
      await new Promise((resolve) => setTimeout(resolve, 50));
      now += 31 * 60_000;
      wakeUp();
      await runner.idle();

      expect(channel.sent.filter(({ markdown }) => markdown.startsWith('⏳'))).toHaveLength(1);
      expect(sleeps).toHaveLength(2);
      expect((await routines.runs(first.id))?.[0]?.status).toBe('delivered');
      expect((await routines.runs(second.id))?.[0]?.status).toBe('delivered');
    });

    it('fails a waiting Run at once when the Harness stops', async () => {
      const engine = new FakeEngine().script(exhausted(new Date(Date.now() + 3_600_000)));
      const { routines, store } = await setup(engine, {
        sleep: (_ms, signal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener('abort', () => reject(new Error('The Harness stopped.'))),
          ),
      });
      const routine = await routines.create(input());
      await routines.runNow(routine.id);
      await new Promise((resolve) => setTimeout(resolve, 50));

      await routines.stop();

      expect((await store.runs(routine.id))[0]).toMatchObject({
        status: 'failed',
        error: 'The Harness stopped.',
      });
    });

    it('gives up after several resets and reports the failure', async () => {
      const resetsAt = new Date(Date.now() + 60_000);
      const engine = new FakeEngine(exhausted(resetsAt));
      const { channel, routines, runNow, sleeps } = await setup(engine);
      const routine = await routines.create(input());

      await runNow(routine.id);

      expect(sleeps).toHaveLength(3);
      expect(channel.sent.at(-1)?.markdown).toContain('Esecuzione non riuscita');
      expect((await routines.runs(routine.id))?.[0]?.status).toBe('failed');
    });
  });
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('RoutineService and the Agent', () => {
  const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();
  const reminder = (overrides = {}) => ({
    title: 'Chiama Marco',
    at: inAnHour(),
    prompt: 'Ricorda di chiamare Marco per la cena.',
    ...overrides,
  });

  it('speaks a Reminder in the Conversation it was set in, and drops it once delivered', async () => {
    const engine = new FakeEngine().script(replyWith('Ciao'), replyWith('Chiama Marco!'));
    const { channel, conversations, conversationStore, routines, runNow } = await setup(engine);
    conversations.handle({ type: 'message', text: 'Ciao', threadId: '7', receivedAt: new Date() });
    await conversations.idle();
    const topic = await conversationStore.findByThread('fake', '7');

    const set = await routines.remind(reminder(), topic?.id);
    expect(set).toMatchObject({ kind: 'reminder', createdBy: 'agent', name: 'Chiama Marco' });
    expect(set.nextRunAt).toBeInstanceOf(Date);
    await runNow(set.id);

    expect(engine.requests[1]?.systemPrompt).toContain('promemoria «Chiama Marco»');
    expect(channel.opened).toEqual([]);
    expect(channel.sent.at(-1)).toEqual({
      threadId: '7',
      markdown: '**⏰ Chiama Marco**\n\nChiama Marco!',
    });
    expect(await routines.get(set.id)).toBeUndefined();
    expect((await conversationStore.pendingHandoffs(topic?.id ?? ''))[0]?.markdown).toContain(
      'Chiama Marco!',
    );
  });

  it('speaks in General without a Conversation, and keeps a Reminder that failed', async () => {
    const engine = new FakeEngine().script(replyWith('Fatto.'), () => [
      { type: 'turn.failed', reason: 'error', message: 'Boom' },
    ]);
    const { channel, routines, runNow } = await setup(engine);
    const first = await routines.remind(reminder());
    const second = await routines.remind(reminder());

    await runNow(first.id);
    await runNow(second.id);

    expect(channel.sent[0]).toEqual({ markdown: '**⏰ Chiama Marco**\n\nFatto.' });
    expect(await routines.get(first.id)).toBeUndefined();
    expect((await routines.runs(second.id))?.[0]?.status).toBe('failed');
  });

  it('sets Reminders only ahead, within a year, and moves only its own', async () => {
    const { routines } = await setup();
    await expect(routines.remind(reminder({ at: '2020-01-01T08:00:00Z' }))).rejects.toThrow(
      'must be ahead',
    );
    await expect(routines.remind(reminder({ at: '2099-01-01T08:00:00Z' }))).rejects.toThrow(
      'a year ahead',
    );
    const set = await routines.remind(reminder());
    const later = new Date(Date.now() + 7_200_000).toISOString();

    const moved = await routines.updateReminder(set.id, { at: later });

    expect(moved.triggers).toEqual([{ type: 'once', at: later }]);
    expect(moved.prompt).toBe('Ricorda di chiamare Marco per la cena.');
    const owners = await routines.create(input());
    await expect(routines.updateReminder(owners.id, { title: 'Mio' })).rejects.toThrow(
      'only the Owner',
    );
    await expect(routines.cancelByAgent(owners.id, 'routine')).rejects.toThrow('only the Owner');
  });

  it('creates only recurring Routines, which it may cancel', async () => {
    const { routines } = await setup();
    await expect(
      routines.createByAgent(input({ triggers: [{ type: 'once', at: inAnHour() }] })),
    ).rejects.toThrow('set a Reminder');

    const routine = await routines.createByAgent(input({ name: 'Meteo' }));
    expect(routine).toMatchObject({ kind: 'routine', createdBy: 'agent' });

    await expect(routines.cancelByAgent(routine.id, 'reminder')).rejects.toThrow('cancel_routine');
    expect((await routines.cancelByAgent(routine.id, 'routine')).name).toBe('Meteo');
    expect(await routines.get(routine.id)).toBeUndefined();
  });

  it('keeps a Reminder moved while its Run was speaking, and one date per Reminder', async () => {
    const gate = gatedTurn('Chiama Marco!');
    const { routines, runner } = await setup(new FakeEngine().script(gate.turn));
    const set = await routines.remind(reminder());
    await routines.runNow(set.id);
    await gate.started;

    const later = new Date(Date.now() + 7_200_000).toISOString();
    await routines.updateReminder(set.id, { at: later });
    gate.release();
    await runner.idle();

    expect((await routines.get(set.id))?.triggers).toEqual([{ type: 'once', at: later }]);
    await expect(
      routines.update(set.id, {
        ...input(),
        triggers: [{ type: 'cron', expression: '0 8 * * *' }],
      }),
    ).rejects.toThrow('fires once');
  });

  it('drops a spoken Reminder rewritten during its Run, since its time has passed', async () => {
    const gate = gatedTurn('Chiama Marco!');
    const { routines, runner } = await setup(new FakeEngine().script(gate.turn));
    const soon = new Date(Date.now() + 300).toISOString();
    const set = await routines.remind(reminder({ at: soon }));
    await routines.runNow(set.id);
    await gate.started;
    await routines.updateReminder(set.id, { prompt: 'Chiama Marco e Anna.' });
    await new Promise((resolve) => setTimeout(resolve, 400));

    gate.release();
    await runner.idle();

    expect(await routines.get(set.id)).toBeUndefined();
  });

  it('keeps at most 50 Reminders waiting', async () => {
    const { routines } = await setup();
    for (let i = 0; i < 50; i++) await routines.remind(reminder());

    await expect(routines.remind(reminder())).rejects.toThrow('50 Reminders');
  });

  it("leaves the Owner's Conversation alone when a Reminder is deleted", async () => {
    const { conversations, conversationStore, routines } = await setup(
      new FakeEngine(replyWith('Ciao')),
    );
    conversations.handle({ type: 'message', text: 'Ciao', threadId: '7', receivedAt: new Date() });
    await conversations.idle();
    const topic = await conversationStore.findByThread('fake', '7');
    const set = await routines.remind(reminder(), topic?.id);

    await routines.delete(set.id);

    expect(await conversations.findLive(topic?.id ?? '')).toBeDefined();
  });
});
