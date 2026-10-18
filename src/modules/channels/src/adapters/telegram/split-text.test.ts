import { describe, expect, it } from 'vitest';
import { splitText } from './split-text.ts';

describe('splitText', () => {
  it('keeps short text in one chunk', () => {
    expect(splitText('  ciao  ', 10)).toEqual(['ciao']);
  });

  it('prefers paragraph boundaries', () => {
    expect(splitText('primo paragrafo\n\nsecondo', 20)).toEqual(['primo paragrafo', 'secondo']);
  });

  it('falls back to word boundaries', () => {
    expect(splitText('uno due tre quattro', 10)).toEqual(['uno due', 'tre', 'quattro']);
  });

  it('cuts hard when there is no boundary', () => {
    expect(splitText('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('never exceeds the limit', () => {
    const text = Array.from({ length: 500 }, (_, i) => `parola${i}`).join(' ');

    expect(splitText(text, 100).every((chunk) => chunk.length <= 100)).toBe(true);
  });
});
