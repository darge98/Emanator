import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { silentLogger } from '@emanator/shared/server';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemorySnapshot } from '../domain/snapshot.ts';
import { memoryRoutes } from './memory-routes.ts';
import { MemoryService } from './memory-service.ts';

let dir: string;
let memory: MemoryService;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'emanator-memory-routes-'));
  memory = new MemoryService({ dir, timeZone: 'Europe/Rome', logger: silentLogger });
  await memory.init();
  await memory.remember({
    page: 'Città di Fido',
    kind: 'luoghi',
    fact: 'Ci vive Fido.',
    factKind: 'fact',
    trust: 'inferred',
    source: 'mail',
    mayAddKind: false,
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function server() {
  const app = Fastify();
  app.register(memoryRoutes, { prefix: '/api/memory', memory });
  return app;
}

const page = encodeURIComponent('Città di Fido');

describe('Memory HTTP interface', () => {
  it('reads Pages, kinds and the latest changes in one go', async () => {
    const app = await server();
    const body = (await app.inject({ url: '/api/memory' })).json<MemorySnapshot>();

    expect(body.pages.map(({ title }) => title)).toEqual(['Città di Fido']);
    expect(body.kinds.map(({ name }) => name)).toContain('luoghi');
    expect(body.changes[0]?.change).toMatch(/Ci vive Fido/);
  });

  it('confirms and forgets Facts, and forgets Pages', async () => {
    const app = await server();
    const id = (await memory.page('Città di Fido'))?.facts[0]?.id ?? '';

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/memory/pages/${page}/facts/${id}/confirm`,
    });
    expect(confirmed.json<MemorySnapshot>().pages[0]?.facts[0]?.trust).toBe('confirmed');

    const forgotten = await app.inject({
      method: 'DELETE',
      url: `/api/memory/pages/${page}/facts/${id}`,
    });
    expect(forgotten.json<MemorySnapshot>().pages[0]?.facts).toEqual([]);

    const gone = await app.inject({ method: 'DELETE', url: `/api/memory/pages/${page}` });
    expect(gone.json<MemorySnapshot>().pages).toEqual([]);
    expect(gone.json<MemorySnapshot>().changes[0]?.change).toBe(
      'dimenticata dalla dashboard la pagina Città di Fido',
    );
  });

  it('answers 404 for what is not there', async () => {
    const app = await server();

    const missing = await app.inject({ method: 'DELETE', url: '/api/memory/pages/Nessuno' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'There is no Page called "Nessuno".' });
  });
});
