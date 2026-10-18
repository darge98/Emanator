import { FakeChannel } from '@emanator/channels/testing';
import { ConversationService, ConversationStore } from '@emanator/conversations/server';
import { UsageTracker } from '@emanator/engine';
import { FakeEngine, replyWith, type ScriptedTurn } from '@emanator/engine/testing';
import { PersonaStore } from '@emanator/personas/server';
import { createTestDatabase, silentLogger } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createDashboardServer } from './dashboard-server.ts';
import { systemPrompt } from './system-prompt.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('persona flow', () => {
  it('applies HTTP persona edits to the next resumed turn while preserving the active turn snapshot', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    const personas = new PersonaStore(fixture.db);
    await personas.init();
    const store = new ConversationStore(fixture.db);
    await store.init();
    const dashboard = await createDashboardServer({ personas, logger: silentLogger });
    cleanups.push(() => dashboard.close());

    let release = () => {};
    let markStarted = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const firstTurn: ScriptedTurn = async (request) => {
      markStarted();
      await gate;
      return replyWith('first answer')(request);
    };
    const engine = new FakeEngine().script(firstTurn);
    const channel = new FakeChannel();
    const service = new ConversationService({
      channel,
      engine,
      store,
      usage: new UsageTracker(),
      systemPrompt: async () =>
        systemPrompt(new Date('2026-10-18T10:00:00Z'), 'Europe/Rome', await personas.get()),
      defaultModel: 'sonnet',
      timeZone: 'Europe/Rome',
      permissions: () => async () => ({ behavior: 'deny', reason: 'No Tools in tests.' }),
      logger: silentLogger,
    });
    const message = (text: string) => ({
      type: 'message' as const,
      text,
      receivedAt: new Date('2026-10-18T10:00:00Z'),
    });

    service.handle(message('first'));
    await started;
    const updated = await dashboard.inject({
      method: 'PUT',
      url: '/api/persona',
      headers: { host: 'localhost' },
      payload: {
        name: 'Ada',
        personality: 'Ask sharp questions and explain your reasoning clearly.',
      },
    });
    expect(updated.statusCode).toBe(200);
    release();
    await service.idle();

    service.handle(message('second'));
    await service.idle();
    expect(engine.requests).toHaveLength(2);
    expect(engine.requests[0]?.systemPrompt).toContain('Sei Emanator');
    expect(engine.requests[0]?.systemPrompt).toContain('cordiale, lucido e concreto');
    expect(engine.requests[1]?.systemPrompt).toContain('Sei Ada');
    expect(engine.requests[1]?.systemPrompt).toContain('Ask sharp questions');
    expect(engine.requests[0]).not.toHaveProperty('session');
    expect(engine.requests[1]?.session).toEqual({ engine: 'fake', id: 'session-1' });

    const restartedPersonas = new PersonaStore(fixture.db);
    await restartedPersonas.init();
    expect(await restartedPersonas.get()).toEqual({
      name: 'Ada',
      personality: 'Ask sharp questions and explain your reasoning clearly.',
    });
  });
});
