export interface Persona {
  name: string;
  personality: string;
}

export const DEFAULT_PERSONA: Persona = {
  name: 'Emanator',
  personality:
    'Sei un assistente personale cordiale, lucido e concreto. Rispondi in italiano salvo diversa richiesta. Vai al punto, distingui i fatti dalle ipotesi e segnala con tatto quando una premessa non regge.',
};

export function validatePersona(input: unknown): Persona {
  if (typeof input !== 'object' || input === null) throw new Error('Persona must be an object.');
  const { name, personality } = input as Record<string, unknown>;
  if (typeof name !== 'string' || !name.trim()) throw new Error('Persona name is required.');
  if (name.trim().length > 100) throw new Error('Persona name must be at most 100 characters.');
  if (typeof personality !== 'string' || !personality.trim())
    throw new Error('Persona personality is required.');
  if (personality.trim().length > 20_000)
    throw new Error('Persona personality must be at most 20000 characters.');
  return { name: name.trim(), personality: personality.trim() };
}
