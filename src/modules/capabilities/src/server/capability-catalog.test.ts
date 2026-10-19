import { describe, expect, it } from 'vitest';
import { CATALOG } from '../domain/catalog.ts';
import { CapabilityCatalog } from './capability-catalog.ts';

describe('CapabilityCatalog', () => {
  it('says which variables an entry still needs', () => {
    const offers = new CapabilityCatalog({ GOOGLE_CLIENT_ID: 'id' }).offers();

    expect(offers.map(({ entry, missing }) => [entry.id, missing])).toEqual([
      ['gmail', ['GOOGLE_CLIENT_SECRET']],
      ['calendar', ['GOOGLE_CLIENT_SECRET']],
      ['drive', ['GOOGLE_CLIENT_SECRET']],
      ['tasks', ['GOOGLE_CLIENT_SECRET']],
    ]);
    expect(offers[0]?.input).toBeUndefined();
  });

  it('makes the Capability from .env, with the Compose address by default', () => {
    const offer = new CapabilityCatalog({
      GOOGLE_CLIENT_ID: ' id ',
      GOOGLE_CLIENT_SECRET: 'secret',
    }).offer('gmail');

    expect(offer?.input).toEqual({
      slug: 'gmail',
      title: 'Gmail',
      url: 'http://workspace-mcp:8000/mcp',
      scopes: CATALOG[0]?.scopes,
      enabled: true,
      clientId: 'id',
      clientSecret: 'secret',
    });
  });

  it('takes the address from .env when the Harness runs outside Compose', () => {
    const offer = new CapabilityCatalog({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      WORKSPACE_MCP_URL: 'http://127.0.0.1:8001/',
    }).offer('calendar');

    expect(offer?.input?.url).toBe('http://127.0.0.1:8001/mcp');
    expect(new CapabilityCatalog({}).offer('missing')).toBeUndefined();
  });

  it('splits workspace-mcp between entries, each with its own Tools and scopes', () => {
    const identity = ['openid', 'https://www.googleapis.com/auth/userinfo.email'];
    const tools = CATALOG.flatMap((entry) => entry.tools ?? []);
    const scopes = CATALOG.flatMap(({ scopes }) => scopes.filter((s) => !identity.includes(s)));

    expect(CATALOG.every((entry) => entry.tools?.length)).toBe(true);
    expect(new Set(tools).size).toBe(tools.length);
    expect(new Set(scopes).size).toBe(scopes.length);
    expect(CATALOG.every(({ scopes }) => identity.every((s) => scopes.includes(s)))).toBe(true);
  });
});
