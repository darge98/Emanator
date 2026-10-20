import { FakeChannel } from '@emanator/channels/testing';
import { type EngineEvent, UsageTracker } from '@emanator/engine';
import { FakeEngine, replyWith, type ScriptedTurn } from '@emanator/engine/testing';
import { createTestDatabase, silentLogger } from '@emanator/shared/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ConversationEvent,
  ConversationService,
  type TurnContext,
} from './conversation-service.ts';
import { ConversationStore } from './conversation-store.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

async function setup(engine = new FakeEngine(), channel = new FakeChannel()) {
  const fixture = await createTestDatabase();
  cleanups.push(fixture.close);
  const store = new ConversationStore(fixture.db);
  await store.init();
  let prompt = 'You are a test agent.';
  const contexts: TurnContext[] = [];
  const service = new ConversationService({
    channel,
    engine,
    store,
    usage: new UsageTracker(),
    systemPrompt: () => prompt,
    defaultModel: 'sonnet',
    timeZone: 'Europe/Rome',
    prepareTurn: async (context) => {
      contexts.push(context);
      return {
        decidePermission: async () => ({ behavior: 'deny', reason: 'No Tools in tests.' }),
      };
    },
    logger: silentLogger,
  });
  const send = async (...events: ConversationEvent[]) => {
    for (const event of events) service.handle(event);
    await service.idle();
  };
  return {
    channel,
    engine,
    store,
    service,
    send,
    contexts,
    setPrompt: (next: string) => {
      prompt = next;
    },
  };
}

const at = new Date('2026-10-14T10:00:00Z');
const message = (text: string, threadId?: string): ConversationEvent => ({
  type: 'message',
  text,
  receivedAt: at,
  ...(threadId !== undefined && { threadId }),
});
const command = (name: string, args = '', threadId?: string): ConversationEvent => ({
  type: 'command',
  name,
  args,
  receivedAt: at,
  ...(threadId !== undefined && { threadId }),
});

/** A turn that waits for `release()` before answering. */
function gated(text: string): { turn: ScriptedTurn; release: () => void; started: Promise<void> } {
  let release = () => {};
  let markStarted = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  return {
    turn: async (request) => {
      markStarted();
      await opened;
      return replyWith(text)(request);
    },
    release,
    started,
  };
}

describe.skipIf(!process.env.TEST_DATABASE_URL)('ConversationService', () => {
  it('answers in the General thread and remembers the Engine session', async () => {
    const { channel, engine, store, send } = await setup();

    await send(message('Ciao'));

    expect(channel.sent).toEqual([{ threadId: undefined, markdown: 'ok' }]);
    expect(engine.requests[0]).toMatchObject({
      prompt: 'Ciao',
      systemPrompt: 'You are a test agent.',
      model: 'sonnet',
    });
    expect(engine.requests[0]).not.toHaveProperty('session');
    expect(await store.findByThread('fake', undefined)).toMatchObject({
      name: 'general',
      title: 'Generale',
      session: { engine: 'fake', id: 'session-1' },
    });
  });

  it('resumes the session on the next message', async () => {
    const { engine, send } = await setup();

    await send(message('Ricorda: lampone'), message('Cosa ti ho detto?'));

    expect(engine.requests[1]?.session).toEqual({ engine: 'fake', id: 'session-1' });
  });

  it('keeps the prompt snapshot for an in-flight turn and uses the new prompt on its resumed turn', async () => {
    const slow = gated('prima');
    const { engine, service, setPrompt } = await setup(new FakeEngine().script(slow.turn));

    service.handle(message('uno'));
    await slow.started;
    setPrompt('You are a newly configured agent.');
    slow.release();
    await service.idle();
    service.handle(message('due'));
    await service.idle();

    expect(engine.requests.map((request) => request.systemPrompt)).toEqual([
      'You are a test agent.',
      'You are a newly configured agent.',
    ]);
    expect(engine.requests[1]?.session).toEqual({ engine: 'fake', id: 'session-1' });
  });

  it('gives an unknown topic its own Conversation and answers there', async () => {
    const { channel, store, send } = await setup();

    await send(message('Ciao', '42'));

    expect(channel.sent).toEqual([{ threadId: '42', markdown: 'ok' }]);
    expect(await store.findByThread('fake', '42')).toMatchObject({ name: 'topic-42' });
  });

  it('handles the messages of one Conversation one at a time', async () => {
    const slow = gated('prima');
    const { channel, engine, service } = await setup(new FakeEngine().script(slow.turn));

    service.handle(message('uno'));
    service.handle(message('due'));
    await slow.started;
    expect(engine.requests).toHaveLength(1);

    slow.release();
    await service.idle();
    expect(channel.sent.map((m) => m.markdown)).toEqual(['prima', 'ok']);
  });

  it('runs different Conversations in parallel', async () => {
    const slow = gated('generale');
    class WatchingChannel extends FakeChannel {
      private markFastReply = () => {};
      readonly fastReply = new Promise<void>((resolve) => {
        this.markFastReply = resolve;
      });

      override async send(
        threadId: string | undefined,
        message: { markdown: string },
      ): Promise<string> {
        const id = await super.send(threadId, message);
        if (threadId === '42') this.markFastReply();
        return id;
      }
    }
    const channel = new WatchingChannel();
    const engine = new FakeEngine(async (request) => {
      if (request.prompt === 'lento') return slow.turn(request);
      return replyWith('veloce')(request);
    });
    const { service } = await setup(engine, channel);

    service.handle(message('lento'));
    service.handle(message('veloce', '42'));
    await Promise.all([slow.started, channel.fastReply]);
    expect(channel.sent).toEqual([{ threadId: '42', markdown: 'veloce' }]);

    slow.release();
    await service.idle();
    expect(channel.sent.at(-1)).toEqual({ threadId: undefined, markdown: 'generale' });
  });

  it('shows progress while the Agent works, then clears it', async () => {
    const withTool: ScriptedTurn = (request) => {
      const [started, , completed] = replyWith('fatto')(request) as EngineEvent[];
      return [
        started as EngineEvent,
        { type: 'tool.called', toolUseId: 't1', tool: 'get_time', input: {} },
        completed as EngineEvent,
      ];
    };
    const { channel, send } = await setup(new FakeEngine().script(withTool));

    await send(message('Che ore sono?'));

    expect(channel.progress.map((p) => p.status)).toEqual(['', '🔧 get_time…', null]);
  });

  it('/new forgets the session of that Conversation only', async () => {
    const { channel, engine, store, send } = await setup();
    await send(message('uno'), message('uno', '42'));

    await send(command('new'), message('di nuovo'));

    expect(channel.sent.at(-2)?.markdown).toContain('Contesto azzerato');
    expect(engine.requests.at(-1)).not.toHaveProperty('session');
    expect((await store.findByThread('fake', '42'))?.session).toBeDefined();
  });

  it('/topic opens a thread with its own Conversation', async () => {
    const { channel, store, send } = await setup();

    await send(command('topic', 'Viaggio in Giappone'));

    expect(channel.opened).toEqual(['Viaggio in Giappone']);
    expect(await store.findByThread('fake', '100')).toMatchObject({
      name: 'viaggio-in-giappone',
      title: 'Viaggio in Giappone',
      openedBy: 'owner',
    });
    expect(channel.sent).toEqual([
      { threadId: '100', markdown: expect.stringContaining('Nuova conversazione') },
      { threadId: undefined, markdown: expect.stringContaining('Ho aperto il topic') },
    ]);
  });

  it('/topic without a name explains how to use it', async () => {
    const { channel, send } = await setup();

    await send(command('topic'));

    expect(channel.opened).toEqual([]);
    expect(channel.sent[0]?.markdown).toContain('/topic Viaggio in Giappone');
  });

  it('tracks both topics when different Conversations open the same title concurrently', async () => {
    const { channel, store, send } = await setup();
    await send(command('help', '', 'one'), command('help', '', 'two'));
    channel.sent.length = 0;

    // Both callers reach creation before either can insert, exposing check-then-insert races.
    let release = () => {};
    const bothReady = new Promise<void>((resolve) => {
      release = resolve;
    });
    let waiting = 0;
    const create = store.create.bind(store);
    const creation = vi.spyOn(store, 'create').mockImplementation(async (input) => {
      if (++waiting === 2) release();
      await bothReady;
      return create(input);
    });

    await send(command('topic', 'Trip', 'one'), command('topic', 'Trip', 'two'));
    creation.mockRestore();

    expect(channel.opened).toEqual(['Trip', 'Trip']);
    const topics = await Promise.all([
      store.findByThread('fake', '100'),
      store.findByThread('fake', '101'),
    ]);
    expect(topics.map((topic) => topic?.name).sort()).toEqual(['trip', 'trip-2']);
    expect(channel.sent).toHaveLength(4);
    expect(
      channel.sent.filter((reply) => reply.markdown.includes('Ho aperto il topic')),
    ).toHaveLength(2);
  });

  it('/status reports the Conversation, the model and the quota per window', async () => {
    const withUsage: ScriptedTurn = (request) => [
      {
        type: 'usage.limit',
        status: 'ok',
        windows: [
          { name: 'five_hour', utilization: 0.3 },
          { name: 'seven_day', utilization: 0.51 },
        ],
      },
      ...(replyWith('ok')(request) as EngineEvent[]),
    ];
    const { channel, send } = await setup(new FakeEngine().script(withUsage));

    await send(message('ciao'), command('status'));

    const status = channel.sent.at(-1)?.markdown ?? '';
    expect(status).toContain('**Generale** · contesto attivo');
    expect(status).toContain('`sonnet`');
    expect(status).toContain('Quota 5 ore: 30%');
    expect(status).toContain('Quota 7 giorni: 51%');
  });

  it('starts over, once, when the Engine has lost the session, and says so', async () => {
    const lost: ScriptedTurn = (request) => [
      {
        type: 'turn.failed',
        ...(request.session && { session: request.session }),
        reason: 'session-not-found',
        message: 'No conversation found with session ID: session-1',
      },
    ];
    const engine = new FakeEngine().script(
      replyWith('primo'),
      lost,
      replyWith('di nuovo', 'session-2'),
    );
    const { channel, store, send } = await setup(engine);
    await send(message('uno'));

    await send(message('due'));

    expect(engine.requests.slice(1).map((r) => r.session?.id)).toEqual(['session-1', undefined]);
    expect(channel.sent.at(-1)?.markdown).toBe(
      '⚠️ Avevo perso il contesto di questa conversazione: riparto da zero.\n\ndi nuovo',
    );
    expect((await store.findByThread('fake', undefined))?.session?.id).toBe('session-2');
  });

  it('keeps the session when a turn fails for any other reason', async () => {
    const broken: ScriptedTurn = () => [
      { type: 'turn.failed', reason: 'error', message: 'overloaded' },
    ];
    const { channel, engine, store, send } = await setup(
      new FakeEngine().script(replyWith('ok'), broken),
    );
    await send(message('uno'));

    await send(message('due'));

    expect(engine.requests).toHaveLength(2);
    expect(channel.sent.at(-1)?.markdown).toContain('overloaded');
    expect((await store.findByThread('fake', undefined))?.session?.id).toBe('session-1');
  });

  it('tells the Owner when handling fails outside the Engine', async () => {
    class NoTopics extends FakeChannel {
      override async openThread(): Promise<string> {
        throw new Error('Bad Request: the chat is not a forum');
      }
    }
    const { channel, send } = await setup(new FakeEngine(), new NoTopics());

    await send(command('topic', 'Viaggio'));

    expect(channel.sent).toEqual([
      {
        threadId: undefined,
        markdown: '⚠️ Non sono riuscito a gestire il tuo messaggio, riprova tra poco.',
      },
    ]);
  });

  it('keeps handling messages when even the failure notice cannot be sent', async () => {
    class Offline extends FakeChannel {
      offline = true;
      override async send(threadId: string | undefined, message: { markdown: string }) {
        if (this.offline) throw new Error('network down');
        return super.send(threadId, message);
      }
    }
    const channel = new Offline();
    const { send } = await setup(new FakeEngine(), channel);

    await send(message('uno'));
    channel.offline = false;
    await send(message('due'));

    expect(channel.sent).toEqual([{ threadId: undefined, markdown: 'ok' }]);
  });

  it('tells the Owner when the quota is exhausted', async () => {
    const exhausted: ScriptedTurn = () => [
      { type: 'usage.limit', status: 'exhausted', resetsAt: new Date('2026-10-14T20:30:00Z') },
      { type: 'turn.failed', reason: 'usage-limit', message: 'limit' },
    ];
    const { channel, send } = await setup(new FakeEngine().script(exhausted));

    await send(message('ciao'));

    expect(channel.sent[0]?.markdown).toMatch(/quota del piano è esaurita fino .*22:30/);
  });

  it('archives a Conversation whose thread was deleted, and starts over next time', async () => {
    const { channel, store, send } = await setup();
    await send(message('ciao', '42'));
    const first = await store.findByThread('fake', '42');

    channel.deletedThreads.add('42');
    await send(message('ci sei?', '42'));
    expect(await store.findByThread('fake', '42')).toBeUndefined();

    channel.deletedThreads.delete('42');
    await send(message('di nuovo', '42'));
    expect((await store.findByThread('fake', '42'))?.id).not.toBe(first?.id);
  });

  it('explains that only text is understood for now', async () => {
    const { channel, send } = await setup();

    await send({ type: 'unsupported', kind: 'voice', receivedAt: at });

    expect(channel.sent[0]?.markdown).toContain('un vocale');
  });

  it('points to /help for unknown commands', async () => {
    const { channel, send } = await setup();

    await send(command('boh'));

    expect(channel.sent[0]?.markdown).toContain('/help');
  });

  describe('Routine deliveries', () => {
    it('opens a Routine topic named after the Routine', async () => {
      const { channel, service } = await setup();

      const topic = await service.openRoutineTopic('Briefing del mattino', 'Briefing · routine');

      expect(channel.opened).toEqual(['Briefing · routine']);
      expect(topic).toMatchObject({
        name: 'briefing-del-mattino-routine',
        title: 'Briefing · routine',
        openedBy: 'harness',
      });
    });

    it('hands delivered messages to the next turn of that Conversation only once', async () => {
      const { channel, engine, service, send } = await setup();
      const topic = await service.openRoutineTopic('Briefing', 'Briefing · routine');

      expect(await service.deliver(topic, '**⏰ Briefing**\n\nPioverà.')).toBe(true);
      await send(message('Prendo l’ombrello?', '100'), message('Grazie', '100'));

      expect(channel.sent[0]).toEqual({
        threadId: '100',
        markdown: '**⏰ Briefing**\n\nPioverà.',
      });
      expect(engine.requests[0]?.prompt).toContain('**⏰ Briefing**\n\nPioverà.');
      expect(engine.requests[0]?.prompt).toMatch(/Prendo l’ombrello\?$/);
      expect(engine.requests[1]?.prompt).toBe('Grazie');
    });

    it("marks a turn that starts with a handoff as not the Owner's words alone", async () => {
      const { contexts, service, send } = await setup();
      await service.deliver(await service.openRoutineTopic('B', 'B · routine'), 'Promemoria');

      await send(message('Ok', '100'), message('Grazie', '100'));

      expect(contexts.map(({ origin, tainted }) => ({ origin, tainted }))).toEqual([
        { origin: 'owner', tainted: true },
        { origin: 'owner', tainted: false },
      ]);
    });

    it('keeps handoffs for the next attempt when the Engine does not start the turn', async () => {
      const failed: ScriptedTurn = () => [
        { type: 'turn.failed', reason: 'authentication', message: 'no' },
      ];
      const { engine, service, send } = await setup(new FakeEngine().script(failed));
      await service.deliver(await service.openRoutineTopic('B', 'B · routine'), 'Promemoria');

      await send(message('uno', '100'), message('due', '100'));

      expect(engine.requests[1]?.prompt).toContain('Promemoria');
    });

    it('/new drops pending handoffs with the session', async () => {
      const { engine, service, send } = await setup();
      await service.deliver(await service.openRoutineTopic('B', 'B · routine'), 'Promemoria');

      await send(command('new', '', '100'), message('Ciao', '100'));

      expect(engine.requests[0]?.prompt).toBe('Ciao');
    });

    it('keeps only the newest handoffs, and notices stay out of the context', async () => {
      const { engine, service, send } = await setup();
      const topic = await service.openRoutineTopic('B', 'B · routine');
      for (let n = 1; n <= 12; n++) await service.deliver(topic, `Messaggio ${n}`);
      await service.notify(topic, 'Avviso del Harness');

      await send(message('Ciao', '100'));

      const prompt = engine.requests[0]?.prompt ?? '';
      expect(prompt).not.toContain('Messaggio 2\n');
      expect(prompt).toContain('Messaggio 3');
      expect(prompt).toContain('Messaggio 12');
      expect(prompt).not.toContain('Avviso');
    });

    it('reports a delivery to a deleted thread and archives its Conversation', async () => {
      const { channel, service } = await setup();
      const topic = await service.openRoutineTopic('Briefing', 'Briefing · routine');
      channel.deletedThreads.add(topic.threadId ?? '');

      expect(await service.deliver(topic, 'Ciao')).toBe(false);
      expect(await service.findLive(topic.id)).toBeUndefined();
    });
  });
});
