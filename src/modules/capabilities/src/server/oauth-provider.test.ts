import { describe, expect, it } from 'vitest';
import type { Capability } from '../domain/capability.ts';
import { type BrowserAuthorization, CapabilityOAuthProvider } from './oauth-provider.ts';

const capability: Capability = {
  id: 'cap-1',
  slug: 'gmail',
  title: 'Gmail',
  url: 'https://mcp.example/mcp',
  scopes: ['openid', 'gmail.modify'],
  enabled: true,
  hasClientSecret: false,
  status: 'disconnected',
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const store = {
  credentials: async () => ({}),
  saveClientInformation: async () => {},
  saveTokens: async () => {},
  forgetCredentials: async () => {},
};

describe('CapabilityOAuthProvider', () => {
  it('asks Google for a refresh token, which it only issues on request', () => {
    const browser: BrowserAuthorization = { state: 's' };
    const provider = new CapabilityOAuthProvider(capability, store, 'http://cb', browser);

    provider.redirectToAuthorization(new URL('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
    const google = browser.authorizationUrl;
    expect(google?.searchParams.get('access_type')).toBe('offline');
    expect(google?.searchParams.get('prompt')).toBe('consent');

    provider.redirectToAuthorization(new URL('https://auth.example/authorize'));
    expect(browser.authorizationUrl?.search).toBe('');
  });

  it('refuses an authorization page that is not a web address', () => {
    const provider = new CapabilityOAuthProvider(capability, store, 'http://cb', { state: 's' });

    expect(() => provider.redirectToAuthorization(new URL('javascript:alert(1)'))).toThrow(
      'not a web address',
    );
  });

  it('only notes that authorization is needed when no browser is waiting', () => {
    const provider = new CapabilityOAuthProvider(capability, store, 'http://cb');

    provider.redirectToAuthorization(new URL('https://auth.example/authorize'));

    expect(provider.needsAuthorization).toBe(true);
    expect(provider.scope).toBe('openid gmail.modify');
  });
});
