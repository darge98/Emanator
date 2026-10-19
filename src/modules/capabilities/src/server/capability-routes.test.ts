import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { CapabilityValidationError } from '../domain/capability.ts';
import { AuthorizationExpiredError } from './capability-connections.ts';
import { capabilityRoutes } from './capability-routes.ts';
import type { CapabilityService } from './capability-service.ts';
import { CapabilitySlugTakenError } from './capability-store.ts';

type Capabilities = Pick<
  CapabilityService,
  | 'list'
  | 'get'
  | 'create'
  | 'update'
  | 'delete'
  | 'connect'
  | 'finishAuthorization'
  | 'refreshTools'
  | 'toolsOf'
  | 'setEnabled'
  | 'catalog'
  | 'connectCatalog'
>;

async function app(overrides: Partial<Capabilities>) {
  const missing = async () => undefined;
  const capabilities: Capabilities = {
    list: async () => [],
    get: missing,
    create: async () => {
      throw new Error('unexpected');
    },
    update: missing,
    delete: missing,
    connect: missing,
    finishAuthorization: async () => {
      throw new AuthorizationExpiredError();
    },
    refreshTools: missing,
    toolsOf: missing,
    setEnabled: missing,
    catalog: async () => [],
    connectCatalog: missing,
    ...overrides,
  };
  const server = Fastify();
  await server.register(capabilityRoutes, {
    prefix: '/api/capabilities',
    capabilities,
    pageUrl: '/#capabilities',
  });
  return server;
}

describe('capabilityRoutes', () => {
  it('reports validation errors as 400 and slug clashes as 409', async () => {
    const invalid = await app({
      create: async () => {
        throw new CapabilityValidationError('title must be text.');
      },
    });
    const response = await invalid.inject({
      method: 'POST',
      url: '/api/capabilities',
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'title must be text.' });

    const taken = await app({
      create: async () => {
        throw new CapabilitySlugTakenError('gmail');
      },
    });
    expect(
      (await taken.inject({ method: 'POST', url: '/api/capabilities', payload: {} })).statusCode,
    ).toBe(409);
  });

  it('answers 404 for unknown Capabilities', async () => {
    const server = await app({});
    for (const [method, url] of [
      ['GET', '/api/capabilities/x'],
      ['PUT', '/api/capabilities/x'],
      ['DELETE', '/api/capabilities/x'],
      ['POST', '/api/capabilities/x/connect'],
      ['PUT', '/api/capabilities/x/enabled'],
      ['POST', '/api/capabilities/catalog/x/connect'],
      ['GET', '/api/capabilities/x/tools'],
      ['POST', '/api/capabilities/x/tools'],
    ] as const) {
      expect((await server.inject({ method, url, payload: {} })).statusCode).toBe(404);
    }
  });

  it('reports a failed connection as 502', async () => {
    const server = await app({
      connect: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    const response = await server.inject({ method: 'POST', url: '/api/capabilities/x/connect' });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'Could not connect: ECONNREFUSED' });
  });

  it('sends the browser back to the dashboard page after an authorization', async () => {
    const callback = '/api/capabilities/oauth/callback';
    const done = await app({ finishAuthorization: async () => 'cap-1' });
    const ok = await done.inject({ method: 'GET', url: `${callback}?state=s&code=c` });
    expect(ok.statusCode).toBe(303);
    expect(ok.headers.location).toBe('/?authorized=cap-1#capabilities');

    const expired = await app({});
    const stale = await expired.inject({ method: 'GET', url: `${callback}?state=s&code=c` });
    expect(stale.headers.location).toBe(
      `/?${new URLSearchParams({ authorization_error: new AuthorizationExpiredError().message })}#capabilities`,
    );

    const refused = await expired.inject({ method: 'GET', url: `${callback}?error=access_denied` });
    expect(refused.headers.location).toBe('/?authorization_error=access_denied#capabilities');
  });

  it('says what a catalog entry still needs as a 400', async () => {
    const server = await app({
      connectCatalog: async () => {
        throw new CapabilityValidationError('Set GOOGLE_CLIENT_ID in .env first.');
      },
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/capabilities/catalog/google/connect',
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: 'Set GOOGLE_CLIENT_ID in .env first.' });
  });
});
