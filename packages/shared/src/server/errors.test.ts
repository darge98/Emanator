import { describe, expect, it } from 'vitest';
import { errorMessage } from './errors.ts';

describe('errorMessage', () => {
  it('uses the message of an Error', () => {
    expect(errorMessage(new TypeError('bad input'))).toBe('bad input');
  });

  it('stringifies anything else that was thrown', () => {
    expect(errorMessage('plain string')).toBe('plain string');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(undefined)).toBe('undefined');
  });
});
