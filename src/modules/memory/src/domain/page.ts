/** Only the Owner confirms; anything else the Agent learns is inferred (ADR 0009). */
export type FactTrust = 'confirmed' | 'inferred';

/** Preferences and instructions steer the Agent, so they exist only as confirmed Facts. */
export type FactKind = 'fact' | 'preference' | 'instruction';

/** A single piece of knowledge on a Page, with where it came from. */
export interface Fact {
  /** Obsidian block id, unique within its Page. */
  id: string;
  text: string;
  kind: FactKind;
  trust: FactTrust;
  /** Who or what it came from, in the Owner's words: `tu`, `mail di Marco`… */
  source: string;
  /** `YYYY-MM-DD`. */
  date: string;
}

/** One subject in Memory, identified by its title across the whole vault. */
export interface Page {
  title: string;
  /** The folder it lives in, e.g. `persone`; the Owner's Page has the kind `utente`. */
  kind: string;
  aliases: string[];
  /** One line for the index. */
  summary?: string;
  facts: Fact[];
}

/** The Owner's own Page sits at the vault's root. */
export const OWNER_PAGE = 'Utente';
export const OWNER_KIND = 'utente';

/** The vault is the Owner's to read, so it is in Italian. */
const CONFIRMED_HEADING = '## Confermato';
const INFERRED_HEADING = '## Dedotto';
const KIND_LABELS: Record<Exclude<FactKind, 'fact'>, string> = {
  preference: 'Preferenza',
  instruction: 'Istruzione',
};

/** Characters a file name or an Obsidian link can't hold. */
const UNSAFE_TITLE = /[\\/:*?"<>|#^[\]\n\r\t]/;

export function validTitle(title: string): boolean {
  const trimmed = title.trim();
  return trimmed.length > 0 && trimmed.length <= 100 && !UNSAFE_TITLE.test(trimmed);
}

/** Titles are compared without case or accents: `Città` and `citta` are one Page. */
export function sameTitle(a: string, b: string): boolean {
  return foldTitle(a) === foldTitle(b);
}

function foldTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/** Path of a Page inside the vault, without the `.md` extension. */
export function pagePath(page: Pick<Page, 'title' | 'kind'>): string {
  return page.kind === OWNER_KIND ? OWNER_PAGE : `${page.kind}/${page.title}`;
}

/** Obsidian keys for aliases; the rest are the Owner's language. */
export function renderPage(page: Page): string {
  const front = [
    '---',
    `tipo: ${page.kind}`,
    `aliases: ${JSON.stringify(page.aliases)}`,
    ...(page.summary ? [`riassunto: ${JSON.stringify(page.summary)}`] : []),
    '---',
  ];
  const section = (heading: string, trust: FactTrust) => {
    const facts = page.facts.filter((fact) => fact.trust === trust);
    return facts.length ? ['', heading, ...facts.map(renderFact)] : [];
  };
  return [
    ...front,
    `# ${page.title}`,
    ...section(CONFIRMED_HEADING, 'confirmed'),
    ...section(INFERRED_HEADING, 'inferred'),
    '',
  ].join('\n');
}

function renderFact(fact: Fact): string {
  const label = fact.kind === 'fact' ? '' : `**${KIND_LABELS[fact.kind]}** · `;
  return `- ${label}${oneLine(fact.text)} *(${oneLine(fact.source)}, ${fact.date})* ^${fact.id}`;
}

/** Keeps text on one line, so it can't start a list item or a log entry of its own. */
export const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

const FACT_LINE =
  /^- (?:\*\*(Preferenza|Istruzione)\*\* · )?(.*?)(?: \*\((.+), (\d{4}-\d{2}-\d{2})\)\*)?(?: \^([a-z0-9]+))?$/;

/**
 * Reads a Page back. It is lenient, since the Owner may edit the vault by hand: a list item
 * without a source or an id still counts, and gets an id on the next write.
 */
export function parsePage(title: string, kind: string, markdown: string): Page {
  const page: Page = { title, kind, aliases: [], facts: [] };
  const lines = markdown.split(/\r?\n/);
  let body = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    for (const line of lines.slice(1, end)) readFrontMatter(page, line);
    body = end + 1;
  }
  let trust: FactTrust | undefined;
  for (const line of lines.slice(body)) {
    if (line.startsWith('## ')) {
      trust =
        line === CONFIRMED_HEADING
          ? 'confirmed'
          : line === INFERRED_HEADING
            ? 'inferred'
            : undefined;
      continue;
    }
    const match = trust && FACT_LINE.exec(line.trimEnd());
    if (!trust || !match) continue;
    const [, label, text = '', source, date, id] = match;
    page.facts.push({
      id: id ?? '',
      text,
      kind: label === 'Preferenza' ? 'preference' : label === 'Istruzione' ? 'instruction' : 'fact',
      trust,
      source: source ?? (trust === 'confirmed' ? 'tu' : 'sconosciuta'),
      date: date ?? '',
    });
  }
  return page;
}

function readFrontMatter(page: Page, line: string): void {
  const colon = line.indexOf(':');
  if (colon < 0) return;
  const key = line.slice(0, colon).trim();
  const raw = line.slice(colon + 1).trim();
  const value = parseValue(raw);
  if (key === 'aliases' && Array.isArray(value)) {
    page.aliases = value.filter((alias): alias is string => typeof alias === 'string');
  } else if (key === 'riassunto' && typeof value === 'string' && value) {
    page.summary = value;
  }
}

function parseValue(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
