import { OWNER_KIND } from './page.ts';

/** A kind of Page, which is also its folder in the vault. */
export interface PageKind {
  name: string;
  description: string;
}

/** Where a subject goes when no kind fits and the turn may not add one. */
export const OTHER_KIND = 'altro';

/** The starting kinds; the Agent adds more as the Owner's life needs them (ADR 0009). */
export const DEFAULT_KINDS: readonly PageKind[] = [
  { name: 'persone', description: "le persone che l'Utente conosce" },
  { name: 'luoghi', description: "case, città, locali e posti che l'Utente frequenta o visita" },
  { name: 'organizzazioni', description: 'aziende, scuole, associazioni, enti' },
  { name: 'progetti', description: "lavori e iniziative dell'Utente" },
  { name: 'interessi', description: 'hobby, passioni, argomenti che lo appassionano' },
  { name: 'possedimenti', description: 'veicoli, case, oggetti, abbonamenti' },
  { name: 'animali', description: "gli animali dell'Utente e delle persone vicine" },
  { name: OTHER_KIND, description: 'quello che non rientra negli altri tipi' },
];

/**
 * Folder names: lowercase letters, digits and dashes, so they work on every filesystem. The
 * Owner's kind is not one: its Page sits at the root, and a Page filed under it would replace it.
 */
export function validKindName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 40 && name !== OWNER_KIND;
}

export function renderKinds(kinds: readonly PageKind[]): string {
  return [
    '# Tipi',
    '',
    'Ogni tipo è una cartella del vault. Puoi aggiungerne o cambiarne la descrizione.',
    '',
    ...kinds.map(({ name, description }) => `- **${name}**: ${description}`),
    '',
  ].join('\n');
}

export function parseKinds(markdown: string): PageKind[] {
  const kinds: PageKind[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const match = /^- \*\*([^*]+)\*\*:\s*(.*)$/.exec(line.trim());
    if (match?.[1] && validKindName(match[1])) {
      kinds.push({ name: match[1], description: match[2] ?? '' });
    }
  }
  return kinds;
}
