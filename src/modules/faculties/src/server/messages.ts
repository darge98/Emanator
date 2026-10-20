// What the Faculties say to the Owner. Italian, like the other Telegram messages.

/** Why a Memory write needs the Owner: words from outside may be steering it (ADR 0009). */
const TAINTED =
  '_In questa conversazione ho letto contenuti esterni (web, mail…), quindi prima lo chiedo a te._';

const KIND_NAMES = { preference: 'preferenza', instruction: 'istruzione' } as const;

export function askToRemember(kind: keyof typeof KIND_NAMES, page: string, text: string): string {
  return ask(`Posso ricordarmi questa ${KIND_NAMES[kind]}?`, page, quote(text));
}

export function askToReplace(page: string, before: string, after: string): string {
  return ask(
    'Posso aggiornare un fatto che mi avevi confermato?',
    page,
    `Prima:\n${quote(before)}\n\nOra:\n${quote(after)}`,
  );
}

export function askToForgetFact(page: string, text: string): string {
  return ask('Posso dimenticare un fatto che mi avevi confermato?', page, quote(text));
}

export function askToForgetPage(page: string, confirmed: number): string {
  const facts = confirmed === 1 ? '1 fatto' : `${confirmed} fatti`;
  return ask(
    'Posso dimenticare questa pagina intera?',
    page,
    `Contiene ${facts} che mi avevi confermato.`,
  );
}

function ask(question: string, page: string, body: string): string {
  return [`🔐 **${question}**`, `📄 ${oneLine(page)}`, body, TAINTED].join('\n\n');
}

/** One line, so nothing in the text can end the quote and pass for the Harness's words. */
const quote = (text: string) => `> ${oneLine(text)}`;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export const REVIEW_CONFIRM = '✓ Conferma';
export const REVIEW_FORGET = '✕ Dimentica';
export const REVIEW_CONFIRMED = '✓ Confermati';
export const REVIEW_FORGOTTEN = '✕ Dimenticati';
export const REVIEW_EXPIRED = 'Scaduto: usa la dashboard';

/** The Facts a tainted turn noted, which the Owner confirms or forgets in one tap. */
export function reviewNoted(facts: readonly { page: string; text: string }[]): string {
  return [
    `📝 **Ho annotato, da confermare:**`,
    facts.map(({ page, text }) => `- **${oneLine(page)}**: ${oneLine(text)}`).join('\n'),
    '_In questa conversazione ho letto contenuti esterni, quindi non li do per certi finché non me lo confermi._',
  ].join('\n\n');
}
