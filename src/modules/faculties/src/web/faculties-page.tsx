import type { Policy, PolicyGroup } from '@emanator/policies';
import { type PolicyChoices, PolicyLegend, ToolPolicyList } from '@emanator/policies/web';
import { ArrowClockwise, Check, Info, WarningCircle } from '@phosphor-icons/react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';

type State = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

const t = {
  eyebrow: 'Your Agent',
  page: 'Faculties',
  intro: 'Choose what your Agent may do on its own, what it must ask you first, and what never.',
  loading: 'Loading Policies…',
  loadError: 'Could not load the Policies.',
  retry: 'Try again',
  saving: 'Saving…',
  saved: 'Changes saved',
  allSaved: 'All changes saved',
  dirty: 'Unsaved changes',
  saveError: 'Save failed',
  cancel: 'Discard changes',
  save: 'Save Policies',
  nextTurn: 'Changes apply from the next turn. Approval requests arrive on Telegram.',
};

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
  footer: ReactNode;
  /** Told whenever unsaved edits appear or go away, so the app can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
}

type Choices = PolicyChoices;

// Capabilities show their Tools on their own page, and save them from there.
const facultiesOf = (groups: readonly PolicyGroup[]) =>
  groups.filter(({ kind }) => kind === 'faculty');

const choicesOf = (groups: readonly PolicyGroup[]): Choices =>
  Object.fromEntries(groups.flatMap(({ tools }) => tools.map((tool) => [tool.name, tool.policy])));

/** Choices are edited as a draft and saved together, like the Persona. */
export function FacultiesPage({ footer, onDirtyChange }: FacultiesPageProps) {
  const [groups, setGroups] = useState<PolicyGroup[]>([]);
  const [draft, setDraft] = useState<Choices>({});
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  const dirty = groups.some(({ tools }) => tools.some((tool) => draft[tool.name] !== tool.policy));

  useEffect(() => {
    let alive = true;
    request<PolicyGroup[]>('/api/policies')
      .then((all) => {
        if (!alive) return;
        const list = facultiesOf(all);
        setGroups(list);
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
  }, [state, dirty]);

  async function save() {
    setState('saving');
    setError('');
    try {
      const saved = facultiesOf(
        await request<PolicyGroup[]>('/api/policies', {
          method: 'PUT',
          body: JSON.stringify({ policies: draft }),
        }),
      );
      setGroups(saved);
      setDraft(choicesOf(saved));
      setState('saved');
    } catch (failure) {
      setState('ready');
      setError(`${t.saveError}: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }

  function cancel() {
    setDraft(choicesOf(groups));
    setError('');
    setState('ready');
  }

  function choose(tool: string, policy: Policy) {
    setDraft((current) => ({ ...current, [tool]: policy }));
    setError('');
    if (state === 'saved') setState('ready');
  }

  const saving = state === 'saving';

  const tone =
    state === 'error'
      ? 'error'
      : saving
        ? 'saving'
        : dirty
          ? 'dirty'
          : state === 'saved'
            ? 'saved'
            : 'idle';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{t.page}</h1>
          <p>{t.intro}</p>
        </div>
        <div className="page-actions">
          <span className="status" data-tone={tone} aria-live="polite">
            {status}
          </span>
        </div>
      </header>
      {state === 'loading' ? (
        <div className="skeleton-stack" role="status" aria-label={t.loading}>
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ) : state === 'error' ? (
        <div className="state" data-tone="error" role="alert">
          <span className="state-icon">
            <WarningCircle size={22} aria-hidden="true" />
          </span>
          <h2>{t.loadError}</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.location.reload()}
          >
            <ArrowClockwise size={16} aria-hidden="true" />
            {t.retry}
          </button>
        </div>
      ) : (
        <form
          aria-label={t.page}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <PolicyLegend />
          {groups.map((group) => (
            <section key={group.name} className="section" aria-labelledby={`group-${group.name}`}>
              <div className="section-intro">
                <h2 id={`group-${group.name}`}>{group.title}</h2>
                {group.description && <p>{group.description}</p>}
              </div>
              <ToolPolicyList
                tools={group.tools}
                draft={draft}
                disabled={saving}
                onChange={choose}
              />
            </section>
          ))}
          {error && (
            <div className="notice" data-tone="error" role="alert">
              <WarningCircle size={16} aria-hidden="true" />
              {error}
            </div>
          )}
          <div className="save-bar" data-dirty={dirty}>
            <p className="hint">
              <Info size={16} aria-hidden="true" />
              {t.nextTurn}
            </p>
            <div className="save-bar-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={cancel}
                disabled={!dirty || saving}
              >
                {t.cancel}
              </button>
              <button type="submit" className="btn btn-primary" disabled={!dirty || saving}>
                {saving ? (
                  <span className="spinner" aria-hidden="true" />
                ) : (
                  <Check size={16} weight="bold" aria-hidden="true" />
                )}
                {saving ? t.saving : t.save}
              </button>
            </div>
          </div>
        </form>
      )}
      {footer}
    </div>
  );
}
