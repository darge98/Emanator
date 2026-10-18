import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Persona } from '@emanator/personas';
import { silentLogger } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { createDashboardServer } from './dashboard-server.ts';

const apps: Array<{ close: () => Promise<void> }> = [];
const tempDirs: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeStore(initial: Persona = { name: 'Emanator', personality: 'Be useful.' }) {
  let current = initial;
  return {
    get: async () => current,
    save: async (persona: Persona) => (current = persona),
  };
}

async function server(personas = makeStore(), webRoot?: string) {
  const app = await createDashboardServer({
    personas,
    logger: silentLogger,
    ...(webRoot && { webRoot }),
  });
  apps.push(app);
  return app;
}

const local = { host: 'localhost' };

describe('dashboard HTTP server', () => {
  it('returns a safe server error when persistence fails', async () => {
    const app = await server({
      get: async () => {
        throw new Error('database password or SQL details');
      },
      save: async () => {
        throw new Error('database password or SQL details');
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/persona', headers: local });
    expect(response.statusCode).toBe(500);
    expect(response.json().error).not.toContain('password');
    expect(response.json().error).toContain('try again');
    const save = await app.inject({
      method: 'PUT',
      url: '/api/persona',
      headers: local,
      payload: { name: 'Ada', personality: 'Be precise.' },
    });
    expect(save.statusCode).toBe(500);
    expect(save.json().error).not.toContain('password');
  });

  it('rejects non-loopback hosts, DNS hostnames and cross-origin requests', async () => {
    const app = await server();
    for (const host of ['example.com', 'emanator.localhost', 'localhost.evil.example']) {
      const response = await app.inject({ method: 'GET', url: '/api/persona', headers: { host } });
      expect(response.statusCode).toBe(403);
    }
    const crossOrigin = await app.inject({
      method: 'PUT',
      url: '/api/persona',
      headers: { host: 'localhost', origin: 'http://attacker.example' },
      payload: { name: 'Changed', personality: 'Prompt' },
    });
    expect(crossOrigin.statusCode).toBe(403);
  });

  it('serves the built index and assets from the configured web root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'emanator-web-'));
    tempDirs.push(root);
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Dashboard</title>');
    await writeFile(join(root, 'assets', 'app.js'), 'window.ready = true;');
    const app = await server(makeStore(), root);

    const index = await app.inject({ method: 'GET', url: '/', headers: local });
    const asset = await app.inject({ method: 'GET', url: '/assets/app.js', headers: local });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('Dashboard');
    expect(index.headers['content-security-policy']).toContain("default-src 'self'");
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain('window.ready');
  });
});
