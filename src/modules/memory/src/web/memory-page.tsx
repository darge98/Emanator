import {
  ArrowClockwise,
  Brain,
  Check,
  ClockCounterClockwise,
  LinkSimple,
  MagnifyingGlass,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import type { PageKind } from '../domain/kinds.ts';
import type { Fact, Page } from '../domain/page.ts';
import type { MemorySnapshot } from '../domain/snapshot.ts';
import styles from './memory-page.module.css';

const t = {
  eyebrow: 'Your Agent',
  page: 'Memory',
  intro:
    'What your Agent has learned about you and your world. Confirm what it inferred, and remove what is wrong.',
  loading: 'Loading Memory…',
  loadError: 'Could not load Memory.',
  retry: 'Try again',
  emptyTitle: 'Nothing remembered yet',
  empty:
    'Tell your Agent about yourself on Telegram: your name, the people you know, the places you go. It keeps them here.',
  search: 'Search',
  all: 'All',
  toReview: 'To review',
  noMatch: 'No page matches.',
  nothingToReview: 'Nothing to review: every fact is confirmed.',
  owner: 'You',
  confirmed: 'Confirmed',
  confirmedHint: 'Told by you, or confirmed by you.',
  inferred: 'Inferred',
  inferredHint:
    'Learned from mail, the web or other outside content. Confirm what is right; delete the rest.',
  noFacts: 'No facts on this page.',
  preference: 'Preference',
  instruction: 'Instruction',
  you: 'you',
  confirm: 'Confirm',
  delete: 'Delete',
  deletePage: 'Delete page',
  noId: 'Written by hand: it gets an id when the Agent next writes this page.',
  linkedFrom: 'Linked from',
  activity: 'Recent changes',
  noActivity: 'No changes yet.',
  vault: 'Kept as Markdown in data/memory, one git commit per change: open it in Obsidian too.',
  actionError: 'The change failed.',
  summary: (pages: number, review: number) =>
    `${pages} ${pages === 1 ? 'page' : 'pages'} · ${review} to review`,
  confirmDeleteFact: (text: string) => ({
    title: 'Delete this fact?',
    body: `“${text}” will be forgotten. The vault's git history still keeps it.`,
    confirm: 'Delete fact',
    cancel: 'Keep it',
    tone: 'danger' as const,
  }),
  confirmDeletePage: (title: string) => ({
    title: `Delete “${title}”?`,
    body: 'The whole page and its facts will be forgotten. The vault’s git history still keeps them.',
    confirm: 'Delete page',
    cancel: 'Keep it',
    tone: 'danger' as const,
  }),
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      message = body.error || message;
    } catch {
      /* use status */
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

interface MemoryPageProps {
  footer: ReactNode;
  /** Asks the Owner a yes/no question in the dashboard's dialog. */
  confirm: (question: {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    tone?: 'danger' | 'default';
  }) => Promise<boolean>;
}

type Filter = 'all' | 'review';

const OWNER_KIND = 'utente';

const isInferred = (fact: Fact) => fact.trust === 'inferred';

/** Compared without case or accents, like Page titles. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const pageUrl = (page: Page) => `/api/memory/pages/${encodeURIComponent(page.title)}`;

/** Every Page that links to `title` with `[[title]]` or `[[title|label]]`. */
function linksTo(pages: readonly Page[], title: string): Page[] {
  const target = fold(title);
  return pages.filter(
    (page) =>
      fold(page.title) !== target &&
      page.facts.some((fact) =>
        [...fact.text.matchAll(LINK)].some(([, linked = '']) => fold(linked.trim()) === target),
      ),
  );
}

const LINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/** Browse, review and correct Memory; every change is a commit in the vault. */
export function MemoryPage({ footer, confirm }: MemoryPageProps) {
  const [snapshot, setSnapshot] = useState<MemorySnapshot>();
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selected, setSelected] = useState<string>();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  /** The action in flight, e.g. `confirm:abc12`: its buttons wait. */
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setSnapshot(await request<MemorySnapshot>('/api/memory'));
      setLoadState('ready');
    } catch {
      setLoadState((state) => (state === 'loading' ? 'error' : state));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pages = snapshot?.pages ?? [];
  const review = pages.reduce((sum, page) => sum + page.facts.filter(isInferred).length, 0);

  const visible = useMemo(() => {
    const words = fold(query.trim());
    return pages.filter(
      (page) =>
        (filter === 'all' || page.facts.some(isInferred)) &&
        (!words ||
          [page.title, ...page.aliases, ...page.facts.map(({ text }) => text)].some((text) =>
            fold(text).includes(words),
          )),
    );
  }, [pages, query, filter]);

  const current =
    pages.find((page) => page.title === selected) ?? visible[0] ?? pages[0] ?? undefined;

  async function act(key: string, path: string, method: 'POST' | 'DELETE') {
    setBusy(key);
    setError('');
    try {
      setSnapshot(await request<MemorySnapshot>(path, { method }));
    } catch (failure) {
      setError(`${t.actionError} ${(failure as Error).message}`);
    } finally {
      setBusy(undefined);
    }
  }

  async function confirmFact(page: Page, fact: Fact) {
    await act(`confirm:${fact.id}`, `${pageUrl(page)}/facts/${fact.id}/confirm`, 'POST');
  }

  async function deleteFact(page: Page, fact: Fact) {
    if (!(await confirm(t.confirmDeleteFact(fact.text)))) return;
    await act(`delete:${fact.id}`, `${pageUrl(page)}/facts/${fact.id}`, 'DELETE');
  }

  async function deletePage(page: Page) {
    if (!(await confirm(t.confirmDeletePage(page.title)))) return;
    await act('page', pageUrl(page), 'DELETE');
  }

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{t.page}</h1>
          <p>{t.intro}</p>
        </div>
        {loadState === 'ready' && pages.length > 0 && (
          <div className="page-actions">
            <span className="status" data-tone={review ? 'dirty' : 'saved'}>
              {t.summary(pages.length, review)}
            </span>
          </div>
        )}
      </header>

      {error && (
        <div className={`notice ${styles.notice}`} data-tone="error" role="alert">
          <WarningCircle size={16} aria-hidden="true" />
          {error}
        </div>
      )}

      {loadState === 'loading' ? (
        <div className={`skeleton-stack ${styles.top}`} role="status" aria-label={t.loading}>
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ) : loadState === 'error' ? (
        <div className={`state ${styles.top}`} data-tone="error" role="alert">
          <span className="state-icon">
            <WarningCircle size={22} aria-hidden="true" />
          </span>
          <h2>{t.loadError}</h2>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            <ArrowClockwise size={16} aria-hidden="true" />
            {t.retry}
          </button>
        </div>
      ) : pages.length === 0 ? (
        <div className={`state ${styles.top}`}>
          <span className="state-icon">
            <Brain size={22} aria-hidden="true" />
          </span>
          <h2>{t.emptyTitle}</h2>
          <p>{t.empty}</p>
        </div>
      ) : (
        <>
          <div className={styles.layout}>
            <PageBrowser
              pages={visible}
              kinds={snapshot?.kinds ?? []}
              selected={current?.title}
              query={query}
              filter={filter}
              review={review}
              onQuery={setQuery}
              onFilter={setFilter}
              onSelect={setSelected}
            />
            {current && (
              <PageDetail
                key={current.title}
                page={current}
                pages={pages}
                busy={busy}
                onSelect={setSelected}
                onConfirm={(fact) => void confirmFact(current, fact)}
                onDelete={(fact) => void deleteFact(current, fact)}
                onDeletePage={() => void deletePage(current)}
              />
            )}
          </div>
          <Activity
            changes={snapshot?.changes ?? []}
            pages={pages}
            onSelect={(title) => {
              setFilter('all');
              setSelected(title);
            }}
          />
        </>
      )}
      {footer}
    </div>
  );
}

interface PageBrowserProps {
  pages: readonly Page[];
  kinds: readonly PageKind[];
  selected: string | undefined;
  query: string;
  filter: Filter;
  review: number;
  onQuery: (query: string) => void;
  onFilter: (filter: Filter) => void;
  onSelect: (title: string) => void;
}

function PageBrowser({
  pages,
  kinds,
  selected,
  query,
  filter,
  review,
  onQuery,
  onFilter,
  onSelect,
}: PageBrowserProps) {
  // The Owner first, then each kind in the order tipi.md gives them.
  const order = [OWNER_KIND, ...kinds.map(({ name }) => name)];
  const groups = order
    .map((kind) => ({ kind, pages: pages.filter((page) => page.kind === kind) }))
    .filter(({ pages }) => pages.length > 0);
  const description = (kind: string) => kinds.find(({ name }) => name === kind)?.description;

  return (
    <aside className={`panel ${styles.browser}`} aria-label="Pages">
      <div className={styles.tools}>
        <label className={styles.search}>
          <MagnifyingGlass size={16} aria-hidden="true" />
          <span className="visually-hidden">{t.search}</span>
          <input
            className="input"
            type="search"
            value={query}
            placeholder={t.search}
            onChange={(event) => onQuery(event.target.value)}
          />
        </label>
        <fieldset className="segmented">
          <legend className="visually-hidden">Filter</legend>
          <button type="button" aria-pressed={filter === 'all'} onClick={() => onFilter('all')}>
            {t.all}
          </button>
          <button
            type="button"
            aria-pressed={filter === 'review'}
            onClick={() => onFilter('review')}
          >
            {t.toReview}
            {review > 0 && <span className={styles.count}>{review}</span>}
          </button>
        </fieldset>
      </div>
      {groups.length === 0 ? (
        <p className={styles.muted}>{filter === 'review' ? t.nothingToReview : t.noMatch}</p>
      ) : (
        <nav className={styles.groups}>
          {groups.map((group) => (
            <section key={group.kind} className={styles.group}>
              <h2 title={description(group.kind)}>
                {group.kind === OWNER_KIND ? t.owner : group.kind}
              </h2>
              <ul>
                {group.pages.map((page) => {
                  const inferred = page.facts.filter(isInferred).length;
                  return (
                    <li key={page.title}>
                      <button
                        type="button"
                        className={styles.item}
                        aria-current={page.title === selected ? 'page' : undefined}
                        onClick={() => onSelect(page.title)}
                      >
                        <span className={styles['item-title']}>{page.title}</span>
                        {inferred > 0 && (
                          <span className={styles.pending} title={`${inferred} ${t.toReview}`}>
                            {inferred}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </nav>
      )}
    </aside>
  );
}

interface PageDetailProps {
  page: Page;
  pages: readonly Page[];
  busy: string | undefined;
  onSelect: (title: string) => void;
  onConfirm: (fact: Fact) => void;
  onDelete: (fact: Fact) => void;
  onDeletePage: () => void;
}

function PageDetail({
  page,
  pages,
  busy,
  onSelect,
  onConfirm,
  onDelete,
  onDeletePage,
}: PageDetailProps) {
  const confirmed = page.facts.filter((fact) => !isInferred(fact));
  const inferred = page.facts.filter(isInferred);
  const backlinks = linksTo(pages, page.title);

  return (
    <article className={`panel ${styles.detail}`} aria-labelledby="memory-page-title">
      <header className={styles['detail-header']}>
        <div className={styles['detail-heading']}>
          <span className="chip">{page.kind === OWNER_KIND ? t.owner : page.kind}</span>
          <h2 id="memory-page-title">{page.title}</h2>
          {page.aliases.length > 0 && <p className={styles.aliases}>{page.aliases.join(' · ')}</p>}
          {page.summary && <p className={styles.summary}>{page.summary}</p>}
        </div>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          onClick={onDeletePage}
          disabled={busy !== undefined}
        >
          <Trash size={16} aria-hidden="true" />
          {t.deletePage}
        </button>
      </header>

      {page.facts.length === 0 && <p className={styles.muted}>{t.noFacts}</p>}

      {inferred.length > 0 && (
        <FactSection
          tone="inferred"
          title={t.inferred}
          hint={t.inferredHint}
          facts={inferred}
          pages={pages}
          busy={busy}
          onSelect={onSelect}
          onConfirm={onConfirm}
          onDelete={onDelete}
        />
      )}
      {confirmed.length > 0 && (
        <FactSection
          tone="confirmed"
          title={t.confirmed}
          hint={t.confirmedHint}
          facts={confirmed}
          pages={pages}
          busy={busy}
          onSelect={onSelect}
          onDelete={onDelete}
        />
      )}

      {backlinks.length > 0 && (
        <footer className={styles.backlinks}>
          <h3 className={styles['backlinks-title']}>
            <LinkSimple size={14} aria-hidden="true" />
            {t.linkedFrom}
          </h3>
          <div>
            {backlinks.map((other) => (
              <button
                key={other.title}
                type="button"
                className="chip"
                onClick={() => onSelect(other.title)}
              >
                {other.title}
              </button>
            ))}
          </div>
        </footer>
      )}
    </article>
  );
}

interface FactSectionProps {
  tone: 'confirmed' | 'inferred';
  title: string;
  hint: string;
  facts: readonly Fact[];
  pages: readonly Page[];
  busy: string | undefined;
  onSelect: (title: string) => void;
  onConfirm?: (fact: Fact) => void;
  onDelete: (fact: Fact) => void;
}

function FactSection({
  tone,
  title,
  hint,
  facts,
  pages,
  busy,
  onSelect,
  onConfirm,
  onDelete,
}: FactSectionProps) {
  return (
    <section className={styles.facts} data-tone={tone}>
      <div className={styles['facts-heading']}>
        <h3>
          {title} <span>{facts.length}</span>
        </h3>
        <p>{hint}</p>
      </div>
      <ul>
        {facts.map((fact) => (
          <li key={fact.id || fact.text} className={styles.fact}>
            <div className={styles['fact-body']}>
              <p>
                {fact.kind !== 'fact' && (
                  <span className="badge" data-tone="warn">
                    {fact.kind === 'preference' ? t.preference : t.instruction}
                  </span>
                )}{' '}
                <FactText text={fact.text} pages={pages} onSelect={onSelect} />
              </p>
              <span className={styles['fact-meta']}>
                {fact.source === 'tu' ? t.you : fact.source}
                {fact.date && ` · ${fact.date}`}
              </span>
            </div>
            <div className={styles['fact-actions']}>
              {onConfirm && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => onConfirm(fact)}
                  disabled={!fact.id || busy !== undefined}
                  title={fact.id ? undefined : t.noId}
                >
                  {busy === `confirm:${fact.id}` ? (
                    <span className="spinner" aria-hidden="true" />
                  ) : (
                    <Check size={14} weight="bold" aria-hidden="true" />
                  )}
                  {t.confirm}
                </button>
              )}
              <button
                type="button"
                className="icon-button"
                onClick={() => onDelete(fact)}
                disabled={!fact.id || busy !== undefined}
                title={fact.id ? t.delete : t.noId}
                aria-label={t.delete}
              >
                {busy === `delete:${fact.id}` ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Trash size={16} aria-hidden="true" />
                )}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A Fact's text, with `[[links]]` to Pages that exist made clickable. */
function FactText({
  text,
  pages,
  onSelect,
}: {
  text: string;
  pages: readonly Page[];
  onSelect: (title: string) => void;
}) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK)) {
    const [whole, target = '', label] = match;
    const start = match.index ?? 0;
    parts.push(text.slice(last, start));
    const page = pages.find((candidate) => fold(candidate.title) === fold(target.trim()));
    parts.push(
      page ? (
        <button
          key={start}
          type="button"
          className={styles.link}
          onClick={() => onSelect(page.title)}
        >
          {label ?? target}
        </button>
      ) : (
        <span key={start} className={styles['dead-link']} title={whole}>
          {label ?? target}
        </span>
      ),
    );
    last = start + whole.length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function Activity({
  changes,
  pages,
  onSelect,
}: {
  changes: MemorySnapshot['changes'];
  pages: readonly Page[];
  onSelect: (title: string) => void;
}) {
  return (
    <section className={`panel ${styles.activity}`} aria-labelledby="memory-activity">
      <header>
        <h2 id="memory-activity">
          <ClockCounterClockwise size={16} aria-hidden="true" />
          {t.activity}
        </h2>
        <p>{t.vault}</p>
      </header>
      {changes.length === 0 ? (
        <p className={styles.muted}>{t.noActivity}</p>
      ) : (
        <ol>
          {changes.map((change, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log lines have no identity
            <li key={index}>
              <time>{change.at}</time>
              <span>
                <FactText text={change.change} pages={pages} onSelect={onSelect} />
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
