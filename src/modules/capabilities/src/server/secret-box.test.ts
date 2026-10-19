import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.ts';

describe('SecretBox', () => {
  it('opens what it sealed, with a fresh IV each time', () => {
    const box = SecretBox.fromKey(randomBytes(32));
    const first = box.seal('ya29.token');

    expect(first).not.toContain('ya29');
    expect(box.seal('ya29.token')).not.toBe(first);
    expect(box.open(first)).toBe('ya29.token');
  });

  it('refuses another key and tampered values', () => {
    const sealed = SecretBox.fromKey(randomBytes(32)).seal('secret');
    expect(() => SecretBox.fromKey(randomBytes(32)).open(sealed)).toThrow();

    const box = SecretBox.fromKey(randomBytes(32));
    const [version, iv, tag, data] = box.seal('secret').split(':');
    const flipped = Buffer.from(data ?? '', 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => box.open([version, iv, tag, flipped.toString('base64')].join(':'))).toThrow();
  });

  it('needs a 32-byte key from the environment', () => {
    expect(() => SecretBox.fromEnv({})).toThrow('Set EMANATOR_SECRET_KEY');
    expect(() => SecretBox.fromEnv({ EMANATOR_SECRET_KEY: 'c2hvcnQ=' })).toThrow('32 bytes');
    const key = randomBytes(32).toString('base64');
    expect(SecretBox.fromEnv({ EMANATOR_SECRET_KEY: key })).toBeInstanceOf(SecretBox);
  });
});
