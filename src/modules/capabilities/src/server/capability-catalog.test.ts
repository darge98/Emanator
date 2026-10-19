import { describe, expect, it } from 'vitest';
import { CATALOG } from '../domain/catalog.ts';
import { CapabilityCatalog } from './capability-catalog.ts';

describe('CapabilityCatalog', () => {
  it('says which variables an entry still needs', () => {
    const offers = new CapabilityCatalog({ GOOGLE_CLIENT_ID: 'id' }).offers();

    expect(offers.map(({ entry, missing }) => [entry.id, missing])).toEqual([
      ['gmail', ['GOOGLE_CLIENT_SECRET']],
      ['calendar', ['GOOGLE_CLIENT_SECRET']],
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

  it('splits workspace-mcp between Gmail and Calendar, each with its own scopes', () => {
    const [gmail, calendar] = CATALOG;
    const tools = [
      'search_gmail_messages',
      'get_gmail_thread_content',
      'list_calendars',
      'get_events',
      'query_freebusy',
    ];
    const of = (pattern = '') => tools.filter((name) => new RegExp(pattern).test(name));

    expect(of(gmail?.toolPattern)).toEqual(['search_gmail_messages', 'get_gmail_thread_content']);
    expect(of(calendar?.toolPattern)).toEqual(['list_calendars', 'get_events', 'query_freebusy']);
    expect(gmail?.scopes.some((scope) => scope.includes('calendar'))).toBe(false);
    expect(calendar?.scopes.some((scope) => scope.includes('gmail'))).toBe(false);
  });
});
