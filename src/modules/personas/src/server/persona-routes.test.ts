import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Persona } from '../index.ts';
import { personaRoutes } from '../server.ts';

const apps: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function makeStore(initial: Persona = { name: 'Emanator', personality: 'Be useful.' }) {
  let current = initial;
  return {
    get: async () => current,
    save: async (persona: Persona) => (current = persona),
  };
}

async function server(personas = makeStore()) {
  const app = Fastify({ ajv: { customOptions: { removeAdditional: false, coerceTypes: false } } });
  app.register(personaRoutes, { prefix: '/api/persona', personas });
  apps.push(app);
  return app;
}

const local = { host: 'localhost' };

describe('Persona HTTP interface', () => {
  it('reads and saves only the editable persona pair', async () => {
    const store = makeStore();
    const app = await server(store);

    const read = await app.inject({ method: 'GET', url: '/api/persona', headers: local });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ name: 'Emanator', personality: 'Be useful.' });

    const save = await app.inject({
      method: 'PUT',
      url: '/api/persona',
      headers: local,
      payload: { name: 'Ada', personality: 'Be precise.' },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toEqual({ name: 'Ada', personality: 'Be precise.' });
    expect(await store.get()).toEqual({ name: 'Ada', personality: 'Be precise.' });
  });

  it('rejects empty, non-string, oversized and extra preset fields', async () => {
    const app = await server();
    const invalid = [
      {},
      { name: '', personality: 'valid' },
      { name: 'valid', personality: '' },
      { name: '   ', personality: 'valid' },
      { name: 'valid', personality: '   ' },
      { name: 42, personality: 'valid' },
      { name: 'valid', personality: false },
      { name: 'n'.repeat(101), personality: 'valid' },
      { name: 'valid', personality: 'p'.repeat(20_001) },
      { name: 'Jarvis', personality: 'voice', presetId: 'jarvis' },
    ];

    for (const payload of invalid) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/persona',
        headers: local,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload).slice(0, 80)).toBe(400);
    }
  });

  it('exposes preset suggestions separately and never returns a saved preset link', async () => {
    const store = makeStore({ name: 'Jarvis', personality: 'A custom Jarvis prompt.' });
    const app = await server(store);
    const saved = await app.inject({ method: 'GET', url: '/api/persona', headers: local });
    const presets = await app.inject({
      method: 'GET',
      url: '/api/persona/presets',
      headers: local,
    });

    expect(Object.keys(saved.json()).sort()).toEqual(['name', 'personality']);
    expect(presets.json().map((preset: { id: string }) => preset.id)).toEqual([
      'jarvis',
      'cortana',
      'joi',
    ]);
  });
});
