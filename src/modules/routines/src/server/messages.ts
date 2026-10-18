import type { TurnFailureReason } from '@emanator/engine';
import { type Routine, SILENT_REPLY } from '../domain/routine.ts';
import type { RunOrigin } from '../domain/run.ts';

// What the Harness says about Routines. Italian for now, like the Conversation messages.

/** Title of the Routine's own Telegram topic. */
export const topicTitle = (name: string) => `${name} · routine`;

/** Every Routine message starts by naming its Routine, so it makes sense anywhere. */
export const withHeader = (name: string, markdown: string) => `**⏰ ${name}**\n\n${markdown}`;

const FAILURE_LABELS: Record<TurnFailureReason, string> = {
  'usage-limit': 'la quota di utilizzo è esaurita',
  authentication: 'le credenziali del modello non sono valide',
  'model-unavailable': 'il modello scelto non è disponibile',
  'session-not-found': 'la sessione del modello non è stata trovata',
  error: 'si è verificato un errore',
};

export const runFailed = (name: string, reason: TurnFailureReason) =>
  withHeader(
    name,
    `⚠️ Esecuzione non riuscita: ${FAILURE_LABELS[reason]}. I dettagli sono nella cronologia della Routine.`,
  );

/** Appended to the Agent's system prompt for a Run. */
export function runInstructions(routine: Routine, origin: RunOrigin): string {
  const trigger =
    origin === 'manual' ? 'avviata a mano dalla persona' : 'avviata dalla sua pianificazione';
  const where = routine.dedicatedTopic ? 'nel topic dedicato alla Routine' : 'nel topic Generale';
  return [
    `Stai eseguendo la Routine «${routine.name}», ${trigger}. Il messaggio che ricevi è il suo obiettivo.`,
    `La persona non sta scrivendo con te: la tua risposta finale le arriverà come messaggio Telegram ${where}, preceduta dal nome della Routine.`,
    `Se non c'è nulla che valga la pena comunicarle, rispondi esattamente ${SILENT_REPLY} e non le arriverà nulla.`,
  ].join('\n');
}
