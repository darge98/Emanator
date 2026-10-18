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
});
