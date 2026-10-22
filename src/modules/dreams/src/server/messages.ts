import type { AskedFact } from '../domain/dream.ts';
import type { Proposal } from '../domain/proposal.ts';

// What the Dream says to the Owner. Italian, like the other Telegram messages.

/** The Dream's own topic, named like a Routine's: the Harness opened it, not the Owner. */
export const TOPIC_TITLE = '🌙 Sogno · dream';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The morning question: the Facts worth asking about, numbered for their buttons. */
export function question(asked: readonly AskedFact[], noted: number): string {
  const others = noted - asked.length;
  return [
    '🌙 **Stanotte ho annotato alcune cose. Sono giuste?**',
    asked
      .map(
        ({ page, text, source }, index) =>
          `${index + 1}. **${oneLine(page)}**: ${oneLine(text)} (${oneLine(source)})`,
      )
      .join('\n'),
    ...(others > 0
      ? [
          `_Altre ${others === 1 ? 'una cosa la trovi' : `${others} cose le trovi`} nella dashboard._`,
        ]
      : []),
    '_Confermi o dimentichi?_',
  ].join('\n\n');
}

export const yes = (n: number) => `✓ ${n}`;
export const no = (n: number) => `✕ ${n}`;
export const confirmed = (n: number) => `✓ ${n} confermato`;
export const forgotten = (n: number) => `✕ ${n} dimenticato`;
export const ALL = '✓ Tutti';
export const EXPIRED = 'Non trovo più questa domanda';

/** The Retrospective's question, one numbered row per Proposal, each with its reason. */
export function proposals(list: readonly Proposal[]): string {
  return [
    '🔧 **Come posso migliorare?**',
    list
      .map(
        ({ kind, text, reason }, index) =>
          `${index + 1}. ${kind === 'instruction' ? '🧭 **Istruzione**' : '💡 **Idea**'}: ${oneLine(text)}\n   _Perché: ${oneLine(reason)}_`,
      )
      .join('\n'),
    "_Un'istruzione che accetti diventa una mia regola, con le parole esatte che leggi qui. Il perché l'ho scritto io: valutalo tu. Le idee restano nella pagina Memory della dashboard._",
  ].join('\n\n');
}

export const accepted = (n: number) => `✓ ${n} accettata`;
export const rejected = (n: number) => `✕ ${n} rifiutata`;

/** Where an accepted instruction says it came from, in Memory. */
export const PROPOSAL_SOURCE = 'proposta della Retrospettiva';
