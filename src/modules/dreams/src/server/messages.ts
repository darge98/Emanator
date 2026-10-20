import type { AskedFact } from '../domain/dream.ts';

// What the Dream says to the Owner. Italian, like the other Telegram messages.

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
  ].join('\n\n');
}

export const yes = (n: number) => `✓ ${n}`;
export const no = (n: number) => `✕ ${n}`;
export const confirmed = (n: number) => `✓ ${n} confermato`;
export const forgotten = (n: number) => `✕ ${n} dimenticato`;
export const ALL = '✓ Tutti';
export const EXPIRED = 'Non trovo più questa domanda';
