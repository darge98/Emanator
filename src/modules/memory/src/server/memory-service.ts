import { randomInt } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Logger } from '@emanator/shared/server';
import {
  DEFAULT_KINDS,
  OTHER_KIND,
  type PageKind,
  parseKinds,
  renderKinds,
  validKindName,
} from '../domain/kinds.ts';
import {
  type Fact,
  type FactKind,
  type FactTrust,
  OWNER_KIND,
  OWNER_PAGE,
  type Page,
  pagePath,
  parsePage,
  renderPage,
  sameTitle,
  validTitle,
} from '../domain/page.ts';
import type { MemoryChange } from '../domain/snapshot.ts';
import { VaultGit } from './vault-git.ts';

const KINDS_FILE = 'tipi.md';
const INDEX_FILE = 'index.md';
const LOG_FILE = 'log.md';

export interface MemoryServiceDeps {
  /** The vault: outside the Engine's working folder, so only this service writes it. */
  dir: string;
  timeZone: string;
  logger: Logger;
  now?: () => Date;
}

export interface RememberInput {
  page: string;
  /** Needed only for a new Page. */
  kind?: string;
  /** Describes `kind` when it is a new one. */
  newKind?: string;
  /** Allowed to add a kind; otherwise a new one falls back to `altro`. */
  mayAddKind: boolean;
  summary?: string;
  aliases?: readonly string[];
  fact: string;
  factKind: FactKind;
  trust: FactTrust;
  source: string;
  /** The id of a Fact this one replaces. */
  replaces?: string;
}

export interface RememberResult {
  page: Page;
  fact: Fact;
  /** Set when the Page was filed under `altro` instead of the new kind it asked for. */
  fellBackFrom?: string;
}

/** A request the model can fix; its message goes back to it. */
export class MemoryError extends Error {
  override readonly name = 'MemoryError';
}

/**
 * Memory's vault of Pages (ADR 0009). Writes are queued one at a time, since turns run in
 * parallel, and each ends in a git commit. Everything is read from disk, so the Owner's own
 * edits count.
 */
export class MemoryService {
  private readonly git: VaultGit;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: MemoryServiceDeps) {
    this.git = new VaultGit(deps.dir, deps.logger);
  }

  async init(): Promise<void> {
    await mkdir(this.deps.dir, { recursive: true });
    await this.git.init();
    if ((await this.readText(KINDS_FILE)) === undefined) {
      await this.exclusive(async () => {
        await writeFile(this.file(KINDS_FILE), renderKinds(DEFAULT_KINDS));
        await this.writeIndex();
        await this.git.commit('Memoria creata');
      });
    }
  }

  async kinds(): Promise<PageKind[]> {
    const text = await this.readText(KINDS_FILE);
    return text === undefined ? [...DEFAULT_KINDS] : parseKinds(text);
  }

  async page(title: string): Promise<Page | undefined> {
    return (await this.pages()).find((page) => matches(page, title));
  }

  /** The Owner's Page first, then the rest by kind and title. */
  async pages(): Promise<Page[]> {
    const pages: Page[] = [];
    const owner = await this.readText(`${OWNER_PAGE}.md`);
    if (owner !== undefined) pages.push(parsePage(OWNER_PAGE, OWNER_KIND, owner));
    for (const kind of await this.kinds()) {
      for (const name of await this.markdownIn(kind.name)) {
        const title = name.slice(0, -'.md'.length);
        const text = await this.readText(`${kind.name}/${name}`);
        if (text !== undefined) pages.push(parsePage(title, kind.name, text));
      }
    }
    return pages;
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    const text = input.fact.trim();
    if (!text) throw new MemoryError('The Fact is empty.');
    return this.exclusive(async () => {
      const found = await this.page(input.page);
      const { page, fellBackFrom } = found
        ? { page: found, fellBackFrom: undefined }
        : await this.newPage(input);
      if (input.summary?.trim()) page.summary = input.summary.trim();
      for (const alias of input.aliases ?? []) {
        if (alias.trim() && !page.aliases.some((known) => sameTitle(known, alias))) {
          page.aliases.push(alias.trim());
        }
      }
      if (input.replaces !== undefined) {
        const index = page.facts.findIndex(({ id }) => id === input.replaces);
        if (index < 0) {
          throw new MemoryError(`"${page.title}" has no Fact ^${input.replaces}.`);
        }
        page.facts.splice(index, 1);
      }
      const fact: Fact = {
        id: newId(page.facts),
        text,
        kind: input.factKind,
        trust: input.trust,
        source: input.trust === 'confirmed' ? 'tu' : input.source.trim() || 'sconosciuta',
        date: this.today(),
      };
      page.facts.push(fact);
      await this.save(page);
      const verb = input.replaces === undefined ? 'ricordato' : 'aggiornato';
      await this.record(`${verb} in [[${page.title}]] (${trustLabel(fact.trust)}): ${text}`);
      return { page, fact, ...(fellBackFrom !== undefined && { fellBackFrom }) };
    });
  }

  /**
   * The Owner confirms an inferred Fact, e.g. from the dashboard: from now on it is theirs, so
   * its source becomes `tu`.
   */
  async confirm(title: string, factId: string, by: string): Promise<Page> {
    return this.exclusive(async () => {
      const page = await this.page(title);
      if (!page) throw new MemoryError(`There is no Page called "${title}".`);
      const fact = page.facts.find(({ id }) => id === factId);
      if (!fact) throw new MemoryError(`"${page.title}" has no Fact ^${factId}.`);
      if (fact.trust === 'confirmed') return page;
      Object.assign(fact, { trust: 'confirmed', source: 'tu', date: this.today() });
      await this.save(page);
      await this.record(`confermato ${by} in [[${page.title}]]: ${fact.text}`);
      return page;
    });
  }

  /** The latest changes first, as `log.md` keeps them. */
  async changes(limit: number): Promise<MemoryChange[]> {
    const log = (await this.readText(LOG_FILE)) ?? '';
    return log
      .split('\n')
      .map((line) => LOG_LINE.exec(line))
      .filter((match) => match !== null)
      .map(([, at = '', change = '']) => ({ at, change }))
      .reverse()
      .slice(0, limit);
  }

  /** Forgets one Fact, or the whole Page when no Fact is named. */
  async forget(title: string, factId?: string, by?: string): Promise<Page> {
    return this.exclusive(async () => {
      const page = await this.page(title);
      if (!page) throw new MemoryError(`There is no Page called "${title}".`);
      if (factId === undefined) {
        await rm(this.file(`${pagePath(page)}.md`), { force: true });
        await this.record(`dimenticata${by ? ` ${by}` : ''} la pagina ${page.title}`);
        return page;
      }
      const fact = page.facts.find(({ id }) => id === factId);
      if (!fact) throw new MemoryError(`"${page.title}" has no Fact ^${factId}.`);
      page.facts = page.facts.filter((other) => other !== fact);
      await this.save(page);
      await this.record(`dimenticato${by ? ` ${by}` : ''} in [[${page.title}]]: ${fact.text}`);
      return page;
    });
  }

  private async newPage(input: RememberInput): Promise<{ page: Page; fellBackFrom?: string }> {
    const title = input.page.trim();
    if (sameTitle(title, OWNER_PAGE)) {
      return { page: { title: OWNER_PAGE, kind: OWNER_KIND, aliases: [], facts: [] } };
    }
    if (!validTitle(title)) {
      throw new MemoryError(
        `"${title}" can't be a Page title: up to 100 characters, none of \\ / : * ? " < > | # ^ [ ].`,
      );
    }
    const kinds = await this.kinds();
    const kind = input.kind?.trim().toLowerCase();
    const known = (name: string) => kinds.some((k) => k.name === name);
    const fresh = (name: string) => ({ title, kind: name, aliases: [], facts: [] });
    if (!kind) {
      throw new MemoryError(`"${title}" is a new Page: give its kind (${names(kinds)}).`);
    }
    if (known(kind)) return { page: fresh(kind) };
    if (!input.newKind?.trim()) {
      throw new MemoryError(
        `There is no kind "${kind}". Use one of ${names(kinds)}, or describe it in newKind to add it.`,
      );
    }
    if (!validKindName(kind)) {
      throw new MemoryError(
        `"${kind}" can't be a kind: lowercase letters, digits and dashes only.`,
      );
    }
    if (!input.mayAddKind) return { page: fresh(OTHER_KIND), fellBackFrom: kind };
    await writeFile(
      this.file(KINDS_FILE),
      renderKinds([...kinds, { name: kind, description: input.newKind.trim() }]),
    );
    return { page: fresh(kind) };
  }

  private async save(page: Page): Promise<void> {
    // Facts the Owner added by hand get what they lack.
    for (const fact of page.facts) {
      if (!fact.id) fact.id = newId(page.facts);
      if (!fact.date) fact.date = this.today();
    }
    const path = this.file(`${pagePath(page)}.md`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, renderPage(page));
  }

  /** Logs the change, rebuilds the index and commits, all with the same line. */
  private async record(change: string): Promise<void> {
    const stamp = this.now().toLocaleString('sv-SE', { timeZone: this.deps.timeZone }).slice(0, 16);
    const log = (await this.readText(LOG_FILE)) ?? '# Registro\n\n';
    await writeFile(this.file(LOG_FILE), `${log}- ${stamp} · ${change}\n`);
    await this.writeIndex();
    await this.git.commit(change);
  }

  private async writeIndex(): Promise<void> {
    await writeFile(this.file(INDEX_FILE), renderIndex(await this.pages()));
  }

  private async markdownIn(folder: string): Promise<string[]> {
    try {
      const entries = await readdir(this.file(folder), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
        .map(({ name }) => name)
        .sort((a, b) => a.localeCompare(b, 'it'));
    } catch {
      return [];
    }
  }

  private async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(this.file(path), 'utf8');
    } catch {
      return undefined;
    }
  }

  private file(path: string): string {
    return join(this.deps.dir, path);
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private today(): string {
    return this.now().toLocaleDateString('sv-SE', { timeZone: this.deps.timeZone });
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

/** One line per Page, grouped by kind: what every turn sees of Memory. */
function renderIndex(pages: readonly Page[]): string {
  const lines = ['# Indice', ''];
  let kind: string | undefined;
  for (const page of pages) {
    if (page.kind !== kind && page.kind !== OWNER_KIND) {
      kind = page.kind;
      lines.push('', `## ${kind}`);
    }
    lines.push(indexLine(page));
  }
  return `${lines.join('\n')}\n`;
}

function indexLine(page: Page): string {
  const aliases = page.aliases.length ? ` (${page.aliases.join(', ')})` : '';
  const summary = page.summary ? `: ${page.summary}` : '';
  return `- [[${page.title}]]${aliases}${summary}`;
}

function matches(page: Page, title: string): boolean {
  return sameTitle(page.title, title) || page.aliases.some((alias) => sameTitle(alias, title));
}

const LOG_LINE = /^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (.+)$/;

const names = (kinds: readonly PageKind[]) => kinds.map(({ name }) => name).join(', ');

const trustLabel = (trust: FactTrust) => (trust === 'confirmed' ? 'confermato' : 'dedotto');

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function newId(facts: readonly Fact[]): string {
  for (;;) {
    const id = Array.from({ length: 5 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join('');
    if (!facts.some((fact) => fact.id === id)) return id;
  }
}
