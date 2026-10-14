import type { InboundEvent } from '@emanator/channels';
import { FakeChannel } from '@emanator/channels/testing';
import { type EngineEvent, UsageTracker } from '@emanator/engine';
import { FakeEngine, replyWith, type ScriptedTurn } from '@emanator/engine/testing';
import { openDatabase, silentLogger } from '@emanator/shared/server';
import { describe, expect, it } from 'vitest';
import { ConversationService } from './conversation-service.ts';
import { ConversationStore } from './conversation-store.ts';

function setup(engine = new FakeEngine()) {
  const channel = new FakeChannel();
  const store = new ConversationStore(openDatabase(':memory:'));
  const service = new ConversationService({
    channel,
    engine,
    store,
    usage: new UsageTracker(),
    systemPrompt: () => 'You are a test agent.',
    defaultModel: 'sonnet',
    timeZone: 'Europe/Rome',
    logger: silentLogger,
  });
  const send = async (...events: InboundEvent[]) => {
    for (const event of events) service.handle(event);
    await service.idle();
  };
  return { channel, engine, store, service, send };
}

const at = new Date('2026-10-14T10:00:00Z');
const message = (text: string, threadId?: string): InboundEvent => ({
  type: 'message',
  text,
  receivedAt: at,
  ...(threadId !== undefined && { threadId }),
});
const command = (name: string, args = '', threadId?: string): InboundEvent => ({
  type: 'command',
  name,
  args,
  receivedAt: at,
  ...(threadId !== undefined && { threadId }),
});

/** A turn that waits for `release()` before answering. */
function gated(text: string): { turn: ScriptedTurn; release: () => void } {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    turn: async (request) => {
      await opened;
      return replyWith(text)(request);
    },
    release,
  };
}

describe('ConversationService', () => {
  it('answers in the General thread and remembers the Engine session', async () => {
    const { channel, engine, store, send } = setup();

    await send(message('Ciao'));

    expect(channel.sent).toEqual([{ threadId: undefined, markdown: 'ok' }]);
    expect(engine.requests[0]).toMatchObject({
      prompt: 'Ciao',
      systemPrompt: 'You are a test agent.',
      model: 'sonnet',
    });
    expect(engine.requests[0]).not.toHaveProperty('session');
    expect(store.findByThread('fake', undefined)).toMatchObject({
      name: 'general',
      title: 'Generale',
      session: { engine: 'fake', id: 'session-1' },
    });
  });

  it('resumes the session on the next message', async () => {
    const { engine, send } = setup();

    await send(message('Ricorda: lampone'), message('Cosa ti ho detto?'));

    expect(engine.requests[1]?.session).toEqual({ engine: 'fake', id: 'session-1' });
  });

  it('gives an unknown topic its own Conversation and answers there', async () => {
    const { channel, store, send } = setup();

    await send(message('Ciao', '42'));

    expect(channel.sent).toEqual([{ threadId: '42', markdown: 'ok' }]);
    expect(store.findByThread('fake', '42')).toMatchObject({ name: 'topic-42' });
  });

  it('handles the messages of one Conversation one at a time', async () => {
    const slow = gated('prima');
    const { channel, engine, service } = setup(new FakeEngine().script(slow.turn));

    service.handle(message('uno'));
    service.handle(message('due'));
    await Promise.resolve();
    await Promise.resolve();
    expect(engine.requests).toHaveLength(1);

    slow.release();
    await service.idle();
    expect(channel.sent.map((m) => m.markdown)).toEqual(['prima', 'ok']);
  });

  it('runs different Conversations in parallel', async () => {
    const slow = gated('generale');
    const { channel, service } = setup(new FakeEngine().script(slow.turn));

    service.handle(message('lento'));
    service.handle(message('veloce', '42'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(channel.sent).toEqual([{ threadId: '42', markdown: 'ok' }]);

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
    const { channel, send } = setup(new FakeEngine().script(withTool));

    await send(message('Che ore sono?'));

    expect(channel.progress.map((p) => p.status)).toEqual(['', '🔧 get_time…', null]);
  });

  it('/new forgets the session of that Conversation only', async () => {
    const { channel, engine, store, send } = setup();
    await send(message('uno'), message('uno', '42'));

    await send(command('new'), message('di nuovo'));

    expect(channel.sent.at(-2)?.markdown).toContain('Contesto azzerato');
    expect(engine.requests.at(-1)).not.toHaveProperty('session');
    expect(store.findByThread('fake', '42')?.session).toBeDefined();
  });

  it('/topic opens a thread with its own Conversation', async () => {
    const { channel, store, send } = setup();

    await send(command('topic', 'Viaggio in Giappone'));

    expect(channel.opened).toEqual(['Viaggio in Giappone']);
    expect(store.findByThread('fake', '100')).toMatchObject({
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
    const { channel, send } = setup();

    await send(command('topic'));

    expect(channel.opened).toEqual([]);
    expect(channel.sent[0]?.markdown).toContain('/topic Viaggio in Giappone');
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
    const { channel, send } = setup(new FakeEngine().script(withUsage));

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
    const { channel, store, send } = setup(engine);
    await send(message('uno'));

    await send(message('due'));

    expect(engine.requests.slice(1).map((r) => r.session?.id)).toEqual(['session-1', undefined]);
    expect(channel.sent.at(-1)?.markdown).toBe(
      '⚠️ Avevo perso il contesto di questa conversazione: riparto da zero.\n\ndi nuovo',
    );
    expect(store.findByThread('fake', undefined)?.session?.id).toBe('session-2');
  });

  it('keeps the session when a turn fails for any other reason', async () => {
    const broken: ScriptedTurn = () => [
      { type: 'turn.failed', reason: 'error', message: 'overloaded' },
    ];
    const { channel, engine, store, send } = setup(
      new FakeEngine().script(replyWith('ok'), broken),
    );
    await send(message('uno'));

    await send(message('due'));

    expect(engine.requests).toHaveLength(2);
    expect(channel.sent.at(-1)?.markdown).toContain('overloaded');
    expect(store.findByThread('fake', undefined)?.session?.id).toBe('session-1');
  });

  it('tells the Owner when the quota is exhausted', async () => {
    const exhausted: ScriptedTurn = () => [
      { type: 'usage.limit', status: 'exhausted', resetsAt: new Date('2026-10-14T20:30:00Z') },
      { type: 'turn.failed', reason: 'usage-limit', message: 'limit' },
    ];
    const { channel, send } = setup(new FakeEngine().script(exhausted));

    await send(message('ciao'));

    expect(channel.sent[0]?.markdown).toMatch(/quota del piano è esaurita fino .*22:30/);
  });

  it('archives a Conversation whose thread was deleted, and starts over next time', async () => {
    const { channel, store, send } = setup();
    await send(message('ciao', '42'));
    const first = store.findByThread('fake', '42');

    channel.deletedThreads.add('42');
    await send(message('ci sei?', '42'));
    expect(store.findByThread('fake', '42')).toBeUndefined();

    channel.deletedThreads.delete('42');
    await send(message('di nuovo', '42'));
    expect(store.findByThread('fake', '42')?.id).not.toBe(first?.id);
  });

  it('explains that only text is understood for now', async () => {
    const { channel, send } = setup();

    await send({ type: 'unsupported', kind: 'voice', receivedAt: at });

    expect(channel.sent[0]?.markdown).toContain('un vocale');
  });

  it('points to /help for unknown commands', async () => {
    const { channel, send } = setup();

    await send(command('boh'));

    expect(channel.sent[0]?.markdown).toContain('/help');
  });
});
