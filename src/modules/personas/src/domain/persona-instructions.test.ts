import { describe, expect, it } from 'vitest';
import { PERSONA_PRESETS, personaInstructions } from '../index.ts';

describe('Persona instructions', () => {
  it.each(PERSONA_PRESETS)(
    'composes $id with an independently chosen agent name and persona-specific address',
    (preset) => {
      const prompt = personaInstructions({
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
