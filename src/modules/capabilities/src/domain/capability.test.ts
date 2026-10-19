import { describe, expect, it } from 'vitest';
import {
  CapabilityValidationError,
  suggestSlug,
  validateCapabilityInput,
  validateNewCapability,
} from './capability.ts';

const valid = {
  title: '  Gmail · Work ',
  url: 'https://gmail.example/mcp',
  scopes: ['openid', ' openid ', 'https://www.googleapis.com/auth/gmail.modify'],
  enabled: true,
};

describe('validateNewCapability', () => {
  it('normalizes the fields and suggests a slug from the title', () => {
    expect(validateNewCapability(valid)).toEqual({
      title: 'Gmail · Work',
      url: 'https://gmail.example/mcp',
      scopes: ['openid', 'https://www.googleapis.com/auth/gmail.modify'],
      enabled: true,
      slug: 'gmail-work',
    });
  });

  it('accepts a slug of lowercase words separated by single hyphens only', () => {
    expect(validateNewCapability({ ...valid, slug: 'mail-2' }).slug).toBe('mail-2');
    for (const slug of ['Mail', 'mail--work', 'mail_work', '-mail', 'a'.repeat(41)]) {
      expect(() => validateNewCapability({ ...valid, slug })).toThrow(CapabilityValidationError);
    }
    // Nothing usable in the title leaves no slug to suggest.
    expect(() => validateNewCapability({ ...valid, title: '日本' })).toThrow(
      CapabilityValidationError,
    );
  });
});

describe('validateCapabilityInput', () => {
  it('keeps plain http for servers on the local network but refuses other schemes', () => {
    expect(validateCapabilityInput({ ...valid, url: 'http://workspace-mcp:8000/mcp' }).url).toBe(
      'http://workspace-mcp:8000/mcp',
    );
    expect(validateCapabilityInput({ ...valid, url: 'http://127.0.0.1:8001/mcp' }).url).toBe(
      'http://127.0.0.1:8001/mcp',
    );
    for (const url of [
      'ftp://x/mcp',
      'not a url',
      'https://user:pw@x/mcp',
      'http://mcp.example.com/mcp',
    ]) {
      expect(() => validateCapabilityInput({ ...valid, url })).toThrow(CapabilityValidationError);
    }
  });

  it('treats a missing secret as "keep" and an empty one as "remove"', () => {
    expect(validateCapabilityInput({ ...valid, clientId: 'id' })).not.toHaveProperty(
      'clientSecret',
    );
    expect(validateCapabilityInput({ ...valid, clientId: 'id', clientSecret: '' })).toMatchObject({
      clientSecret: '',
    });
    expect(() => validateCapabilityInput({ ...valid, clientSecret: 's' })).toThrow(
      'A client secret needs a client ID.',
    );
  });

  it('refuses scopes that are not single words', () => {
    expect(validateCapabilityInput({ ...valid, scopes: undefined }).scopes).toEqual([]);
    expect(() => validateCapabilityInput({ ...valid, scopes: ['a b'] })).toThrow(
      CapabilityValidationError,
    );
    expect(() => validateCapabilityInput({ ...valid, scopes: 'openid' })).toThrow(
      CapabilityValidationError,
    );
  });
});

describe('suggestSlug', () => {
  it('drops accents and punctuation', () => {
    expect(suggestSlug('Calendário — Volontariato!')).toBe('calendario-volontariato');
  });
});
