import { DEFAULT_PERSONA, type Persona, personaInstructions } from '@emanator/personas';

export { DEFAULT_PERSONA };

/** Builds the complete prompt for one turn from the current persona, local time and Memory. */
export function systemPrompt(
  now: Date,
  timeZone: string,
  persona: Persona = DEFAULT_PERSONA,
  memory?: string,
): string {
  const date = now.toLocaleString('it-IT', { timeZone, dateStyle: 'full', timeStyle: 'short' });
  return [
    personaInstructions(persona),
    'La persona può scriverti in italiano o in inglese: rispondi nella lingua che usa, a meno che chieda esplicitamente una lingua diversa.',
    'Comunichi via Telegram: usa Markdown semplice (grassetto, elenchi, link, blocchi di codice), mai HTML.',
    `Adesso è ${date} (fuso orario ${timeZone}).`,
    'Usa solo gli strumenti che hai: se una richiesta ne richiede altri, dillo con chiarezza.',
    ...(memory ? ['', memory] : []),
  ].join('\n');
}
