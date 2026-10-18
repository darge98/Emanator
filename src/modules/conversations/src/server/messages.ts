import type { CommandInfo } from '@emanator/channels';
import type { TurnFailed, UsageLimitChanged } from '@emanator/engine';
import type { Conversation } from '../domain/conversation.ts';
import type { Handoff } from './conversation-store.ts';

// What the Harness itself says to the Owner. Italian for now; the UI will bring it/en.

export const COMMANDS: readonly CommandInfo[] = [
  { name: 'new', description: 'Azzera il contesto di questa conversazione' },
  { name: 'topic', description: 'Apre un nuovo topic dedicato: /topic <nome>' },
  { name: 'status', description: 'Quota, modello e conversazione corrente' },
  { name: 'help', description: 'Cosa posso fare' },
];

export const GENERAL_TITLE = 'Generale';

export function help(): string {
  return [
    '**Cosa posso fare**',
    '',
    'Scrivimi pure: nel topic Generale o in un topic dedicato, ognuno con il suo contesto.',
    '',
    ...COMMANDS.map(({ name, description }) => `- /${name} — ${description}`),
  ].join('\n');
}

export const contextReset = '🧹 Contesto azzerato: da qui ripartiamo da zero.';

export const topicUsage = 'Dimmi il nome del topic, per esempio: `/topic Viaggio in Giappone`';

export const topicOpened = (title: string) => `📌 Ho aperto il topic **${title}**.`;

export const topicWelcome = (title: string) =>
  `Nuova conversazione: **${title}**. Scrivimi qui, il contesto è tutto suo.`;

export const unknownCommand = (name: string) =>
  `Non conosco il comando /${name}. Scrivi /help per l'elenco.`;

const KIND_LABELS: Record<string, string> = {
  voice: 'un vocale',
  audio: 'un audio',
  photo: 'una foto',
  video: 'un video',
  video_note: 'un videomessaggio',
  document: 'un file',
  sticker: 'uno sticker',
  animation: 'una GIF',
  location: 'una posizione',
  venue: 'un luogo',
  contact: 'un contatto',
  poll: 'un sondaggio',
};

export const unsupported = (kind: string) =>
  `Per ora capisco solo messaggi di testo (mi hai mandato ${KIND_LABELS[kind] ?? kind}).`;

export const thinking = '';

export const handlingFailed = '⚠️ Non sono riuscito a gestire il tuo messaggio, riprova tra poco.';

export const sessionLost = '⚠️ Avevo perso il contesto di questa conversazione: riparto da zero.';

export const usingTool = (tool: string) => `🔧 ${tool}…`;

export function status(
  conversation: Conversation,
  model: string,
  usage: UsageLimitChanged | undefined,
  timeZone: string,
): string {
  const lines = [
    '**Stato**',
    '',
    `- Conversazione: **${conversation.title}** · ${conversation.session ? 'contesto attivo' : 'contesto nuovo'}`,
    `- Modello: \`${model}\``,
  ];
  if (!usage) {
    lines.push('- Quota: nessun dato finora, arriva con il primo messaggio.');
  } else if (usage.windows?.length) {
    for (const window of usage.windows) {
      const reset = window.resetsAt ? ` · si azzera ${when(window.resetsAt, timeZone)}` : '';
      lines.push(
        `- Quota ${windowLabel(window.name)}: ${Math.round(window.utilization * 100)}%${reset}`,
      );
    }
  } else {
    lines.push(`- Quota: ${usage.status === 'ok' ? 'disponibile' : usage.status}`);
  }
  return lines.join('\n');
}

export function failure(
  event: TurnFailed,
  model: string,
  usage: UsageLimitChanged | undefined,
  timeZone: string,
): string {
  switch (event.reason) {
    case 'usage-limit': {
      const reset = usage?.resetsAt ? ` fino ${when(usage.resetsAt, timeZone)}` : '';
      return `⏳ La quota del piano è esaurita${reset}. Riscrivimi più tardi.`;
    }
    case 'authentication':
      return '🔑 Non riesco ad autenticarmi con il Motore: controlla il token nel file `.env`.';
    case 'model-unavailable':
      return `Il modello \`${model}\` non è disponibile con il tuo piano.`;
    case 'session-not-found':
      return sessionLost;
    case 'error':
      return `⚠️ Qualcosa è andato storto: ${event.message.slice(0, 500)}`;
  }
}

function windowLabel(name: string): string {
  const labels: Record<string, string> = {
    five_hour: '5 ore',
    seven_day: '7 giorni',
    seven_day_opus: '7 giorni (Opus)',
    seven_day_sonnet: '7 giorni (Sonnet)',
  };
  return labels[name] ?? name;
}

/** "alle 22:30" today, "sab 18 ott alle 20:00" otherwise, in the Owner's time zone. */
function when(date: Date, timeZone: string, now = new Date()): string {
  const day = (d: Date) => d.toLocaleDateString('it-IT', { timeZone });
  const time = date.toLocaleTimeString('it-IT', { timeZone, hour: '2-digit', minute: '2-digit' });
  if (day(date) === day(now)) return `alle ${time}`;
  const dayLabel = date.toLocaleDateString('it-IT', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  return `${dayLabel} alle ${time}`;
}

/** The Owner's message, preceded by what Routines sent here since the last turn. */
export function withHandoffs(handoffs: readonly Handoff[], text: string, timeZone: string): string {
  if (!handoffs.length) return text;
  return [
    "[Dall'ultimo turno hai inviato in questa conversazione questi messaggi delle Routine:]",
    ...handoffs.map(
      ({ markdown, createdAt }) => `--- ${when(createdAt, timeZone)} ---\n${markdown}`,
    ),
    '[Messaggio della persona:]',
    text,
  ].join('\n\n');
}
