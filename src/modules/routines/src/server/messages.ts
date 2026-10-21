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
  if (routine.kind === 'reminder') {
    return [
      `Stai eseguendo il promemoria «${routine.name}», che hai fissato tu. Il messaggio che ricevi è cosa avevi deciso di fare o di dire a quest'ora.`,
      "La tua risposta finale arriverà alla persona nella conversazione in cui l'aveva chiesto, preceduta dal nome del promemoria: scrivila come un promemoria, breve e diretto.",
      `Se non c'è più nulla da dirle, rispondi esattamente ${SILENT_REPLY} e non le arriverà nulla.`,
    ].join('\n');
  }
  const trigger =
    origin === 'manual' ? 'avviata a mano dalla persona' : 'avviata dalla sua pianificazione';
  return [
    `Stai eseguendo la Routine «${routine.name}», ${trigger}. Il messaggio che ricevi è il suo obiettivo.`,
    'La persona non sta scrivendo con te: la tua risposta finale le arriverà come messaggio Telegram nel topic dedicato alla Routine, preceduta dal suo nome.',
    `Se non c'è nulla che valga la pena comunicarle, rispondi esattamente ${SILENT_REPLY} e non le arriverà nulla.`,
  ].join('\n');
}

/** Sent once per quota exhaustion, whatever the number of Runs waiting. */
export function quotaExhausted(resumesAt: Date, timeZone: string): string {
  const when = resumesAt.toLocaleString('it-IT', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `⏳ La quota di utilizzo è esaurita: le Routine riprendono ${when}.`;
}
