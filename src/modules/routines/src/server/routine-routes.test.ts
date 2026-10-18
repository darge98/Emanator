import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { RoutineValidationError } from '../domain/routine.ts';
import type { RoutineRun } from '../domain/run.ts';
import { routineRoutes } from './routine-routes.ts';
import type { RoutineService } from './routine-service.ts';
import { RoutineNameTakenError } from './routine-store.ts';

type Routines = Pick<
  RoutineService,
  'list' | 'get' | 'create' | 'update' | 'delete' | 'runNow' | 'runs'
>;

async function app(overrides: Partial<Routines>) {
  const missing = async () => undefined;
  const routines: Routines = {
    list: async () => [],
    get: missing,
    create: async () => {
      throw new Error('unexpected');
    },
    update: missing,
    delete: async () => false,
    runNow: missing,
    runs: missing,
    ...overrides,
  };
  const server = Fastify();
  await server.register(routineRoutes, { prefix: '/api/routines', routines });
  return server;
}

describe('routineRoutes', () => {
  it('reports validation errors as 400 and name clashes as 409', async () => {
    const invalid = await app({
      create: async () => {
        throw new RoutineValidationError('A Routine needs at least one Trigger.');
      },
    });
    const response = await invalid.inject({ method: 'POST', url: '/api/routines', payload: {} });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'A Routine needs at least one Trigger.' });

    const taken = await app({
      create: async () => {
        throw new RoutineNameTakenError('Briefing');
      },
    });
    expect(
      (await taken.inject({ method: 'POST', url: '/api/routines', payload: {} })).statusCode,
    ).toBe(409);
  });

  it('answers 404 for unknown Routines', async () => {
    const server = await app({});
    for (const [method, url] of [
      ['GET', '/api/routines/x'],
      ['PUT', '/api/routines/x'],
      ['DELETE', '/api/routines/x'],
      ['POST', '/api/routines/x/runs'],
      ['GET', '/api/routines/x/runs'],
    ] as const) {
      const response = await server.inject({
        method,
        url,
        payload: method === 'PUT' ? {} : undefined,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(404);
    }
  });

  it('starts a Run with 202 and deletes with 204', async () => {
    const run: RoutineRun = {
      id: 'run-1',
      routineId: 'x',
      origin: 'manual',
      status: 'running',
      startedAt: new Date('2026-10-18T10:00:00Z'),
      tools: [],
    };
    const server = await app({ runNow: async () => run, delete: async () => true });

    const started = await server.inject({ method: 'POST', url: '/api/routines/x/runs' });
    expect(started.statusCode).toBe(202);
    expect(started.json()).toMatchObject({ id: 'run-1', startedAt: '2026-10-18T10:00:00.000Z' });
    expect((await server.inject({ method: 'DELETE', url: '/api/routines/x' })).statusCode).toBe(
      204,
    );
  });
});
