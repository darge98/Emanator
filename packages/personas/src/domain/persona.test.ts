import { describe, expect, it } from 'vitest';
import { validatePersona } from './persona.ts';
import { PERSONA_PRESETS } from './presets.ts';

describe('validatePersona', () => {
  it('trims and returns only the editable pair', () => {
    expect(
      validatePersona({ name: '  Ada  ', personality: '  Be concise.  ', presetId: 'jarvis' }),
    ).toEqual({
      name: 'Ada',
      personality: 'Be concise.',
    });
  });

  it('rejects blank and oversized fields', () => {
    expect(() => validatePersona({ name: ' ', personality: 'x' })).toThrow('name is required');
    expect(() => validatePersona({ name: 'Ada', personality: ' ' })).toThrow(
      'personality is required',
    );
    expect(() => validatePersona({ name: 'a'.repeat(101), personality: 'x' })).toThrow(
      'at most 100',
    );
    expect(() => validatePersona({ name: 'Ada', personality: 'x'.repeat(20_001) })).toThrow(
      'at most 20000',
    );
  });

  it('offers complete preset pairs without implying that ids are persisted', () => {
    expect(PERSONA_PRESETS.map(({ id }) => id)).toEqual(['jarvis', 'cortana', 'joi']);
    for (const { name, personality } of PERSONA_PRESETS) {
      expect(validatePersona({ name, personality })).toEqual({ name, personality });
      expect(personality.toLowerCase()).not.toContain(`sei ${name.toLowerCase()}`);
    }
  });
});
