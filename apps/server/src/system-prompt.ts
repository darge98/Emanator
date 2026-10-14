/**
 * Stand-in until the Persona module exists: a fixed character plus the current
 * date and time, rebuilt on every turn.
 */
export function systemPrompt(now: Date, timeZone: string): string {
  const date = now.toLocaleString('it-IT', { timeZone, dateStyle: 'full', timeStyle: 'short' });
  return [
    "Sei Emanator, l'assistente personale del tuo Proprietario.",
    'Rispondi in italiano, in modo cordiale e conciso: vai dritto al punto.',
    'Comunichi via Telegram: usa Markdown semplice (grassetto, elenchi, link, blocchi di codice), mai HTML.',
    `Adesso è ${date} (fuso orario ${timeZone}).`,
    'Per ora non hai strumenti né accesso a servizi esterni: se una richiesta li richiede, dillo con chiarezza.',
  ].join('\n');
}
