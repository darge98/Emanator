import { PERSONA_PRESETS } from '@emanator/personas';
import { describe, expect, it } from 'vitest';
import { systemPrompt } from './system-prompt.ts';

describe('systemPrompt', () => {
  it('combines the current persona with time, language flexibility and channel limits', () => {
    const prompt = systemPrompt(new Date('2026-10-14T10:00:00Z'), 'Europe/Rome', {
      name: 'Ada',
      personality: 'Preferisci risposte strutturate.',
    });
    expect(prompt).toContain('Sei Ada');
    expect(prompt).toContain('Preferisci risposte strutturate.');
    expect(prompt).toContain('in italiano o in inglese');
    expect(prompt).toContain('fuso orario Europe/Rome');
    expect(prompt).toContain('mai HTML');
  });

  it('keeps Emanator as the default persona', () => {
    expect(systemPrompt(new Date('2026-10-14T10:00:00Z'), 'Europe/Rome')).toContain('Sei Emanator');
  });

  it.each(PERSONA_PRESETS)(
    'composes $id with an independently chosen agent name and persona-specific address',
    (preset) => {
      const prompt = systemPrompt(new Date('2026-10-14T10:00:00Z'), 'Europe/Rome', {
        name: 'Ada',
        personality: preset.personality,
      });
      expect(prompt.startsWith('Sei Ada, un assistente personale.')).toBe(true);
      expect(prompt).toContain(preset.personality);
      expect(prompt).not.toMatch(/proprietario/i);
      expect(prompt).toContain(
        'Usa il suo nome solo se è stato comunicato nel contesto disponibile',
      );
      expect(prompt).toContain('Il registro e le forme di cortesia dipendono dalla personalità');
      expect(prompt).not.toContain('Rivolgiti alla persona dandole del tu.');
    },
  );
});
