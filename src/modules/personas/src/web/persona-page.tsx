import { type ReactNode, useEffect, useMemo, useState } from 'react';
import type { Persona } from '../domain/persona.ts';
import type { PersonaPreset } from '../domain/presets.ts';
import styles from './persona-page.module.css';

type Language = 'it' | 'en';
type State = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

const copy = {
  it: {
    persona: 'Persona',
    settings: 'Impostazioni',
    page: 'La tua Persona',
    intro: 'Scegli una base e adattala al modo in cui vuoi che il tuo Agent ti parli.',
    presets: 'Inizia da una voce',
    presetsHint: 'Puoi modificare ogni dettaglio prima di salvare.',
    custom: 'oppure scrivi la tua',
    name: 'Nome',
    personality: 'Personalità',
    nameHint: 'Come vuoi chiamare il tuo Agent?',
    personalityHint: 'Descrivi tono, stile e modo di ragionare…',
    helper: 'Queste istruzioni definiscono il carattere dell’Agent nelle conversazioni.',
    cancel: 'Annulla modifiche',
    save: 'Salva Persona',
    saved: 'Modifiche salvate',
    saving: 'Salvataggio…',
    loading: 'Caricamento Persona…',
    error: 'Non è stato possibile caricare la Persona.',
    saveError: 'Salvataggio non riuscito. Le tue modifiche sono ancora qui.',
    savedAt: 'Tutto salvato',
    dirty: 'Modifiche non salvate',
    idle: 'Pronto',
    nextTurn: 'Le modifiche si applicano dal prossimo turno. La risposta attiva verrà completata.',
    loadError: 'Riprova',
  },
  en: {
    persona: 'Persona',
    settings: 'Settings',
    page: 'Your Persona',
    intro: 'Choose a starting point and shape how you want your Agent to speak with you.',
    presets: 'Start with a voice',
    presetsHint: 'You can edit every detail before saving.',
    custom: 'or write your own',
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
    idle: 'Ready',
    nextTurn: 'Changes apply from the next turn. The active response will finish.',
    loadError: 'Try again',
  },
} satisfies Record<Language, Record<string, string>>;

const englishPresetDescriptions: Record<string, string> = {
  jarvis: 'British precision and dry wit',
  cortana: 'Tactical intelligence and sharp wit',
  joi: 'Affectionate warmth and imagination',
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
  language: Language;
  languageControl: ReactNode;
  footer: ReactNode;
}

/** Persona configuration owns its loading, editing and persistence behaviour. */
export function PersonaPage({ language, languageControl, footer }: PersonaPageProps) {
  const [saved, setSaved] = useState<Persona>({ name: '', personality: '' });
  const [draft, setDraft] = useState<Persona>({ name: '', personality: '' });
  const [presets, setPresets] = useState<PersonaPreset[]>([]);
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  const [presetMessage, setPresetMessage] = useState('');
  const t = copy[language];
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
  }, [state, dirty, t]);

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
  function applyPreset(preset: PersonaPreset) {
    if (state === 'saving') return;
    if (
      dirty &&
      !window.confirm(
        language === 'it'
          ? 'Sostituire le modifiche non salvate con questa Persona?'
          : 'Replace your unsaved edits with this Persona?',
      )
    )
      return;
    setDraft({ name: preset.name, personality: preset.personality });
    setState('ready');
    setError('');
    setPresetMessage(
      language === 'it'
        ? `${preset.name} è pronto per essere personalizzato.`
        : `${preset.name} is ready to customize.`,
    );
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

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.breadcrumb}>
          {t.settings}
          <span>/</span>
          <strong>{t.persona}</strong>
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
          <div className={styles.eyebrow}>{language === 'it' ? 'IL TUO AGENT' : 'YOUR AGENT'}</div>
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
            <strong>{error || t.error}</strong>
            <button
              type="button"
              className={styles['text-button']}
              onClick={() => window.location.reload()}
            >
              {t.loadError}
            </button>
          </div>
        ) : (
          <>
            <section
              className={`${styles.panel} ${styles['preset-panel']}`}
              aria-labelledby="preset-title"
            >
              <div className={styles['panel-title-row']}>
                <div>
                  <h2 id="preset-title">{t.presets}</h2>
                  <p>{t.presetsHint}</p>
                </div>
                <span className={styles.sparkle} aria-hidden="true">
                  ✳
                </span>
              </div>
              <div className={styles['preset-grid']}>
                {presets.map((preset, index) => (
                  <button
                    type="button"
                    key={preset.id}
                    className={styles.preset}
                    onClick={() => applyPreset(preset)}
                    disabled={state === 'saving'}
                    aria-label={`${language === 'it' ? 'Usa' : 'Use'} ${preset.title || preset.name}`}
                  >
                    <span
                      className={`${styles.avatar} ${styles[`avatar-${index % 3}`]}`}
                      aria-hidden="true"
                    >
                      {(preset.title || preset.name).slice(0, 1)}
                    </span>
                    <span className={styles['preset-copy']}>
                      <strong>{preset.title || preset.name}</strong>
                      <small>
                        {language === 'en'
                          ? englishPresetDescriptions[preset.id] || preset.description
                          : preset.description}
                      </small>
                    </span>
                    <span className={styles['preset-arrow']} aria-hidden="true">
                      ↗
                    </span>
                  </button>
                ))}
              </div>
              <div className={styles['or-divider']}>
                <span>{t.custom}</span>
              </div>
            </section>
            <form
              className={`${styles.panel} ${styles['editor-panel']}`}
              aria-labelledby="editor-title"
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <div className={styles['editor-heading']}>
                <div>
                  <h2 id="editor-title">{t.persona}</h2>
                  <p>{t.helper}</p>
                </div>
                <span className={styles['edit-icon']} aria-hidden="true">
                  ✎
                </span>
              </div>
              <div className={styles.field}>
                <label htmlFor="persona-name">{t.name}</label>
                <input
                  id="persona-name"
                  value={draft.name}
                  onChange={(e) => updateDraft({ ...draft, name: e.target.value })}
                  placeholder={t.nameHint}
                  maxLength={100}
                  disabled={state === 'saving'}
                />
              </div>
              <div className={styles.field}>
                <div className={styles['label-row']}>
                  <label htmlFor="persona-personality">{t.personality}</label>
                  <span>{draft.personality.length} / 20000</span>
                </div>
                <textarea
                  id="persona-personality"
                  value={draft.personality}
                  onChange={(e) => updateDraft({ ...draft, personality: e.target.value })}
                  placeholder={t.personalityHint}
                  maxLength={20000}
                  rows={6}
                  disabled={state === 'saving'}
                />
              </div>
              <div className={styles['form-footer']}>
                <span className={styles.hint}>
                  <span aria-hidden="true">ⓘ</span>
                  {t.nextTurn}
                </span>
                <div className={styles['form-actions']}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.secondary}`}
                    onClick={cancel}
                    disabled={!dirty || state === 'saving'}
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={
                      !dirty ||
                      state === 'saving' ||
                      !draft.name.trim() ||
                      !draft.personality.trim()
                    }
                  >
                    {state === 'saving' ? (
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
              {presetMessage && (
                <div className={styles['inline-success']} role="status">
                  {presetMessage}
                </div>
              )}
            </form>
          </>
        )}
        {footer}
      </div>
    </>
  );
}
