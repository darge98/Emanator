import type { Policy, ToolPolicy } from '@emanator/policies';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Faculty } from '../domain/faculty.ts';
import styles from './faculties-page.module.css';

type Language = 'it' | 'en';
type State = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

const ALL_POLICIES: readonly Policy[] = ['allow', 'ask', 'deny'];

const copy = {
  it: {
    settings: 'Impostazioni',
    crumb: 'Facoltà',
    eyebrow: 'IL TUO AGENT',
    page: 'Facoltà e Policy',
    intro:
      'Scegli cosa può fare il tuo Agent da solo, cosa deve chiederti prima e cosa non deve fare mai.',
    loading: 'Caricamento Policy…',
    loadError: 'Non è stato possibile caricare le Policy.',
    retry: 'Riprova',
    saving: 'Salvataggio…',
    saved: 'Modifiche salvate',
    allSaved: 'Tutto salvato',
    dirty: 'Modifiche non salvate',
    saveError: 'Salvataggio non riuscito',
    byDefault: 'predefinita',
    cancel: 'Annulla modifiche',
    save: 'Salva',
    nextTurn:
      'Le modifiche valgono dal prossimo turno. Le richieste di approvazione arrivano su Telegram.',
    policy: { allow: 'Consenti', ask: 'Chiedi', deny: 'Nega' },
    groups: {
      web: ['Web', 'Ricerca e lettura di pagine web.'],
      files: [
        'File',
        'Solo nella cartella di lavoro. La lettura non può chiedere: o è consentita, o è negata.',
      ],
      conversations: ['Conversazioni', 'Nuovi topic su Telegram aperti dall’Agent.'],
    },
    tools: {
      web_search: 'Cercare sul web',
      web_fetch: 'Leggere una pagina web',
      read_file: 'Leggere un file',
      find_files: 'Trovare file per nome',
      search_files: 'Cercare testo nei file',
      write_file: 'Creare o sovrascrivere un file',
      edit_file: 'Modificare un file',
      open_conversation: 'Aprire una conversazione',
    },
  },
  en: {
    settings: 'Settings',
    crumb: 'Faculties',
    eyebrow: 'YOUR AGENT',
    page: 'Faculties and Policies',
    intro: 'Choose what your Agent may do on its own, what it must ask you first, and what never.',
    loading: 'Loading Policies…',
    loadError: 'Could not load the Policies.',
    retry: 'Try again',
    saving: 'Saving…',
    saved: 'Changes saved',
    allSaved: 'All changes saved',
    dirty: 'Unsaved changes',
    saveError: 'Save failed',
    byDefault: 'default',
    cancel: 'Discard changes',
    save: 'Save',
    nextTurn: 'Changes apply from the next turn. Approval requests arrive on Telegram.',
    policy: { allow: 'Allow', ask: 'Ask', deny: 'Deny' },
    groups: {
      web: ['Web', 'Searching and reading web pages.'],
      files: ['Files', 'Only in the working folder. Reading cannot ask: it is allowed or denied.'],
      conversations: ['Conversations', 'New Telegram topics opened by the Agent.'],
    },
    tools: {
      web_search: 'Search the web',
      web_fetch: 'Read a web page',
      read_file: 'Read a file',
      find_files: 'Find files by name',
      search_files: 'Search text in files',
      write_file: 'Create or overwrite a file',
      edit_file: 'Edit a file',
      open_conversation: 'Open a conversation',
    },
  },
} satisfies Record<
  Language,
  {
    policy: Record<Policy, string>;
    groups: Record<Faculty, [string, string]>;
    tools: Record<string, string>;
    [key: string]: unknown;
  }
>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
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

interface FacultiesPageProps {
  language: Language;
  languageControl: ReactNode;
  footer: ReactNode;
  /** Told whenever unsaved edits appear or go away, so the app can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
}

type Choices = Record<string, Policy>;

const choicesOf = (tools: readonly ToolPolicy[]): Choices =>
  Object.fromEntries(tools.map((tool) => [tool.name, tool.policy]));

/** Choices are edited as a draft and saved together, like the Persona. */
export function FacultiesPage({
  language,
  languageControl,
  footer,
  onDirtyChange,
}: FacultiesPageProps) {
  const [tools, setTools] = useState<ToolPolicy[]>([]);
  const [draft, setDraft] = useState<Choices>({});
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  const t = copy[language];
  const dirty = tools.some((tool) => draft[tool.name] !== tool.policy);

  useEffect(() => {
    let alive = true;
    request<ToolPolicy[]>('/api/policies')
      .then((list) => {
        if (!alive) return;
        setTools(list);
        setDraft(choicesOf(list));
        setState('ready');
      })
      .catch(() => {
        if (alive) setState('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const status = useMemo(() => {
    if (state === 'loading') return t.loading;
    if (state === 'saving') return t.saving;
    if (state === 'error') return t.loadError;
    if (dirty) return t.dirty;
    if (state === 'saved') return t.saved;
    return t.allSaved;
  }, [state, dirty, t]);

  async function save() {
    setState('saving');
    setError('');
    try {
      const saved = await request<ToolPolicy[]>('/api/policies', {
        method: 'PUT',
        body: JSON.stringify({ policies: draft }),
      });
      setTools(saved);
      setDraft(choicesOf(saved));
      setState('saved');
    } catch (failure) {
      setState('ready');
      setError(`${t.saveError}: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }

  function cancel() {
    setDraft(choicesOf(tools));
    setError('');
    setState('ready');
  }

  function choose(tool: string, policy: Policy) {
    setDraft((current) => ({ ...current, [tool]: policy }));
    setError('');
    if (state === 'saved') setState('ready');
  }

  const groups = [...new Set(tools.map((tool) => tool.group))];
  const saving = state === 'saving';

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.breadcrumb}>
          {t.settings}
          <span>/</span>
          <strong>{t.crumb}</strong>
        </div>
        <div className={styles['top-actions']}>
          <span className={`${styles['status-dot']} ${styles[state] ?? ''}`} aria-hidden="true" />
          <span className={styles['status-text']} aria-live="polite">
            {status}
          </span>
          {languageControl}
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles['page-heading']}>
          <div className={styles.eyebrow}>{t.eyebrow}</div>
          <h1>{t.page}</h1>
          <p>{t.intro}</p>
        </div>
        {state === 'loading' ? (
          <div className={styles['loading-card']} role="status">
            <span className={styles.spinner} />
            {t.loading}
          </div>
        ) : state === 'error' ? (
          <div className={styles['error-card']} role="alert">
            <strong>{t.loadError}</strong>
            <button
              type="button"
              className={styles['text-button']}
              onClick={() => window.location.reload()}
            >
              {t.retry}
            </button>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {groups.map((group) => {
              // Groups other than Faculties, e.g. Capabilities later, show their own name.
              const [title, description] = t.groups[group as Faculty] ?? [group, ''];
              return (
                <section key={group} className={styles.panel} aria-labelledby={`group-${group}`}>
                  <h2 id={`group-${group}`}>{title}</h2>
                  {description && <p className={styles['group-hint']}>{description}</p>}
                  <ul className={styles.tools}>
                    {tools
                      .filter((tool) => tool.group === group)
                      .map((tool) => (
                        <ToolRow
                          key={tool.name}
                          tool={tool}
                          value={draft[tool.name] ?? tool.policy}
                          label={t.tools[tool.name as keyof typeof t.tools] ?? tool.name}
                          t={t}
                          disabled={saving}
                          onChange={(policy) => choose(tool.name, policy)}
                        />
                      ))}
                  </ul>
                </section>
              );
            })}
            <div className={styles['form-footer']}>
              <p className={styles.hint}>
                <span aria-hidden="true">ⓘ</span>
                {t.nextTurn}
              </p>
              <div className={styles['form-actions']}>
                <button
                  type="button"
                  className={`${styles.button} ${styles.secondary}`}
                  onClick={cancel}
                  disabled={!dirty || saving}
                >
                  {t.cancel}
                </button>
                <button
                  type="submit"
                  className={`${styles.button} ${styles.primary}`}
                  disabled={!dirty || saving}
                >
                  {saving ? (
                    <>
                      <span className={styles['button-spinner']} />
                      {t.saving}
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true">✓</span>
                      {t.save}
                    </>
                  )}
                </button>
              </div>
            </div>
            {error && (
              <div className={styles['inline-error']} role="alert">
                {error}
              </div>
            )}
          </form>
        )}
        {footer}
      </div>
    </>
  );
}

function ToolRow({
  tool,
  value,
  label,
  t,
  disabled,
  onChange,
}: {
  tool: ToolPolicy;
  value: Policy;
  label: string;
  t: (typeof copy)[Language];
  disabled: boolean;
  onChange: (policy: Policy) => void;
}) {
  const choices = tool.choices ?? ALL_POLICIES;
  return (
    <li className={styles.tool}>
      <div className={styles['tool-copy']}>
        <strong>{label}</strong>
        <code>{tool.name}</code>
      </div>
      <fieldset className={styles.segmented} disabled={disabled}>
        <legend className="visually-hidden">{label}</legend>
        {choices.map((policy) => (
          <button
            type="button"
            key={policy}
            className={`${value === policy ? styles.selected : ''} ${styles[policy]}`}
            aria-pressed={value === policy}
            onClick={() => onChange(policy)}
          >
            {t.policy[policy]}
            {policy === tool.defaultPolicy && (
              <small className={styles['default-mark']}> · {t.byDefault}</small>
            )}
          </button>
        ))}
      </fieldset>
    </li>
  );
}
