import {
  ArrowClockwise,
  ArrowUpRight,
  Check,
  Info,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Persona } from '../domain/persona.ts';
import type { PersonaPreset } from '../domain/presets.ts';
import styles from './persona-page.module.css';

type State = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

const t = {
  eyebrow: 'Your Agent',
  page: 'Persona',
  intro: 'Choose a starting point and shape how you want your Agent to speak with you.',
  presets: 'Start with a voice',
  presetsHint: 'Pick one to fill in the fields below. You can edit every detail before saving.',
  character: 'Character',
  name: 'Name',
  personality: 'Personality',
  nameHint: 'What would you like to call your Agent?',
  personalityHint: 'Describe its tone, style and way of thinking…',
  helper: 'These instructions shape your Agent’s character in conversation.',
  cancel: 'Discard changes',
  save: 'Save Persona',
  saved: 'Changes saved',
  saving: 'Saving…',
  loading: 'Loading Persona…',
  error: 'Could not load your Persona.',
  saveError: 'Save failed. Your edits are still here.',
  savedAt: 'All changes saved',
  dirty: 'Unsaved changes',
  nextTurn: 'Changes apply from the next turn. The active response will finish.',
  loadError: 'Try again',
  replace: (name: string) => ({
    title: `Start from ${name}?`,
    body: 'Its name and personality will replace the edits you have not saved.',
    confirm: `Use ${name}`,
    cancel: 'Keep my edits',
    tone: 'danger' as const,
  }),
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

interface PersonaPageProps {
  footer: ReactNode;
  /** Told whenever unsaved edits appear or go away, so the app can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Asks the Owner a yes/no question in the dashboard's dialog. */
  confirm: (question: {
    title: string;
    body: string;
    confirm: string;
    cancel: string;
    tone?: 'danger' | 'default';
  }) => Promise<boolean>;
}

/** Persona configuration owns its loading, editing and persistence behaviour. */
export function PersonaPage({ footer, onDirtyChange, confirm }: PersonaPageProps) {
  const [saved, setSaved] = useState<Persona>({ name: '', personality: '' });
  const [draft, setDraft] = useState<Persona>({ name: '', personality: '' });
  const [presets, setPresets] = useState<PersonaPreset[]>([]);
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  const [presetMessage, setPresetMessage] = useState('');
  const dirty = draft.name !== saved.name || draft.personality !== saved.personality;

  useEffect(() => {
    let alive = true;
    Promise.all([
      request<Persona>('/api/persona'),
      request<PersonaPreset[]>('/api/persona/presets'),
    ])
      .then(([persona, options]) => {
        if (!alive) return;
        setSaved(persona);
        setDraft(persona);
        if (options.length) setPresets(options);
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
    if (state === 'error') return t.error;
    if (dirty) return t.dirty;
    if (state === 'saved') return t.saved;
    return t.savedAt;
  }, [state, dirty]);

  async function save() {
    setState('saving');
    setError('');
    const submitted = { ...draft };
    try {
      const result = await request<Persona>('/api/persona', {
        method: 'PUT',
        body: JSON.stringify(submitted),
      });
      setSaved(result);
      setDraft(result);
      setState('saved');
      setPresetMessage('');
    } catch {
      setState('ready');
      setError(t.saveError);
    }
  }
  async function applyPreset(preset: PersonaPreset) {
    if (state === 'saving') return;
    if (dirty && !(await confirm(t.replace(preset.title || preset.name)))) return;
    setDraft({ name: preset.name, personality: preset.personality });
    setState('ready');
    setError('');
    setPresetMessage(`${preset.name} is ready to customize.`);
  }
  function cancel() {
    setDraft(saved);
    setError('');
    setState('ready');
    setPresetMessage('');
  }
  function updateDraft(next: Persona) {
    setDraft(next);
    setPresetMessage('');
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
          <h2>{error || t.error}</h2>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => window.location.reload()}
          >
            <ArrowClockwise size={16} aria-hidden="true" />
            {t.loadError}
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
          {presets.length > 0 && (
            <section className="section" aria-labelledby="preset-title">
              <div className="section-intro">
                <h2 id="preset-title">{t.presets}</h2>
                <p>{t.presetsHint}</p>
              </div>
              <div className={styles.presets}>
                {presets.map((preset) => {
                  const title = preset.title || preset.name;
                  return (
                    <button
                      type="button"
                      key={preset.id}
                      className={styles.preset}
                      onClick={() => void applyPreset(preset)}
                      disabled={saving}
                      aria-label={`Use ${title}`}
                    >
                      <span className={styles.monogram} aria-hidden="true">
                        {title.slice(0, 1)}
                      </span>
                      <span className={styles['preset-copy']}>
                        <strong>{title}</strong>
                        <small>{preset.description}</small>
                      </span>
                      <ArrowUpRight
                        className={styles['preset-arrow']}
                        size={16}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </section>
          )}
          <section className="section" aria-labelledby="editor-title">
            <div className="section-intro">
              <h2 id="editor-title">{t.character}</h2>
              <p>{t.helper}</p>
            </div>
            <div className={`panel ${styles.editor}`}>
              <div className="field">
                <label htmlFor="persona-name">{t.name}</label>
                <input
                  id="persona-name"
                  className="input"
                  value={draft.name}
                  onChange={(e) => updateDraft({ ...draft, name: e.target.value })}
                  placeholder={t.nameHint}
                  maxLength={100}
                  disabled={saving}
                />
              </div>
              <div className="field">
                <div className="label-row">
                  <label className="label" htmlFor="persona-personality">
                    {t.personality}
                  </label>
                  <span className="counter">{draft.personality.length} / 20000</span>
                </div>
                <textarea
                  id="persona-personality"
                  className="textarea"
                  value={draft.personality}
                  onChange={(e) => updateDraft({ ...draft, personality: e.target.value })}
                  placeholder={t.personalityHint}
                  maxLength={20000}
                  rows={8}
                  disabled={saving}
                />
              </div>
              {presetMessage && (
                <div className="notice" data-tone="success" role="status">
                  <Sparkle size={16} aria-hidden="true" />
                  {presetMessage}
                </div>
              )}
            </div>
          </section>
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
              <button
                type="submit"
                className="btn btn-primary"
                disabled={!dirty || saving || !draft.name.trim() || !draft.personality.trim()}
              >
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
