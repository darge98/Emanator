import { useEffect, useMemo, useState } from 'react';

type Persona = { name: string; personality: string };
type Preset = Persona & { id: string; title?: string; description?: string };
type Language = 'it' | 'en';
type State = 'loading' | 'ready' | 'saving' | 'saved' | 'error';

const copy = {
  it: {
    nav: 'PERSONALE',
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
    nav: 'PERSONAL',
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

export default function App() {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      return localStorage.getItem('emanator-language') === 'en' ? 'en' : 'it';
    } catch {
      return 'it';
    }
  });
  const [saved, setSaved] = useState<Persona>({ name: '', personality: '' });
  const [draft, setDraft] = useState<Persona>({ name: '', personality: '' });
  const [presets, setPresets] = useState<Preset[]>([]);
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState('');
  const [presetMessage, setPresetMessage] = useState('');
  const t = copy[language];
  const dirty = draft.name !== saved.name || draft.personality !== saved.personality;

  useEffect(() => {
    document.documentElement.lang = language;
    try {
      localStorage.setItem('emanator-language', language);
    } catch {
      /* language still works for this session */
    }
  }, [language]);
  useEffect(() => {
    let alive = true;
    Promise.all([request<Persona>('/api/persona'), request<Preset[]>('/api/persona/presets')])
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
  function applyPreset(preset: Preset) {
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
    <div className="app-shell">
      <aside
        className="sidebar"
        aria-label={language === 'it' ? 'Navigazione principale' : 'Main navigation'}
      >
        <a className="brand" href="#persona" aria-label="Emanator">
          <img src="/assets/emanator.svg" alt="" />
          <span>emanator</span>
        </a>
        <div className="nav-label">{t.nav}</div>
        <a className="nav-item active" href="#persona" aria-current="page">
          <span className="nav-icon" aria-hidden="true">
            ◉
          </span>
          {t.persona}
        </a>
        <div className="sidebar-bottom">
          <span className="online-dot" />
          {language === 'it' ? 'Agent personale' : 'Personal Agent'}
          <span className="version">v1</span>
        </div>
      </aside>
      <main id="persona" className="main">
        <header className="topbar">
          <div className="breadcrumb">
            {t.settings}
            <span>/</span>
            <strong>{t.persona}</strong>
          </div>
          <div className="top-actions">
            <span className={`status-dot ${state}`} aria-hidden="true" />
            <span className="status-text" aria-live="polite">
              {status}
            </span>
            <fieldset className="language-switch">
              <legend className="visually-hidden">Language</legend>
              <button
                type="button"
                className={language === 'it' ? 'selected' : ''}
                onClick={() => setLanguage('it')}
                aria-pressed={language === 'it'}
              >
                IT
              </button>
              <button
                type="button"
                className={language === 'en' ? 'selected' : ''}
                onClick={() => setLanguage('en')}
                aria-pressed={language === 'en'}
              >
                EN
              </button>
            </fieldset>
          </div>
        </header>
        <div className="content">
          <div className="page-heading">
            <div className="eyebrow">{language === 'it' ? 'IL TUO AGENT' : 'YOUR AGENT'}</div>
            <h1>{t.page}</h1>
            <p>{t.intro}</p>
          </div>
          {state === 'loading' ? (
            <div className="loading-card" role="status">
              <span className="spinner" />
              {t.loading}
            </div>
          ) : state === 'error' ? (
            <div className="error-card" role="alert">
              <strong>{error || t.error}</strong>
              <button
                type="button"
                className="text-button"
                onClick={() => window.location.reload()}
              >
                {t.loadError}
              </button>
            </div>
          ) : (
            <>
              <section className="panel preset-panel" aria-labelledby="preset-title">
                <div className="panel-title-row">
                  <div>
                    <h2 id="preset-title">{t.presets}</h2>
                    <p>{t.presetsHint}</p>
                  </div>
                  <span className="sparkle" aria-hidden="true">
                    ✳
                  </span>
                </div>
                <div className="preset-grid">
                  {presets.map((preset, index) => (
                    <button
                      type="button"
                      key={preset.id}
                      className="preset"
                      onClick={() => applyPreset(preset)}
                      disabled={state === 'saving'}
                      aria-label={`${language === 'it' ? 'Usa' : 'Use'} ${preset.title || preset.name}`}
                    >
                      <span className={`avatar avatar-${index % 3}`} aria-hidden="true">
                        {(preset.title || preset.name).slice(0, 1)}
                      </span>
                      <span className="preset-copy">
                        <strong>{preset.title || preset.name}</strong>
                        <small>
                          {language === 'en'
                            ? englishPresetDescriptions[preset.id] || preset.description
                            : preset.description}
                        </small>
                      </span>
                      <span className="preset-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  ))}
                </div>
                <div className="or-divider">
                  <span>{t.custom}</span>
                </div>
              </section>
              <form
                className="panel editor-panel"
                aria-labelledby="editor-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <div className="editor-heading">
                  <div>
                    <h2 id="editor-title">{t.persona}</h2>
                    <p>{t.helper}</p>
                  </div>
                  <span className="edit-icon" aria-hidden="true">
                    ✎
                  </span>
                </div>
                <div className="field">
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
                <div className="field">
                  <div className="label-row">
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
                <div className="form-footer">
                  <span className="hint">
                    <span aria-hidden="true">ⓘ</span>
                    {t.nextTurn}
                  </span>
                  <div className="form-actions">
                    <button
                      type="button"
                      className="button secondary"
                      onClick={cancel}
                      disabled={!dirty || state === 'saving'}
                    >
                      {t.cancel}
                    </button>
                    <button
                      type="submit"
                      className="button primary"
                      disabled={
                        !dirty ||
                        state === 'saving' ||
                        !draft.name.trim() ||
                        !draft.personality.trim()
                      }
                    >
                      {state === 'saving' ? (
                        <>
                          <span className="button-spinner" />
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
                  <div className="inline-error" role="alert">
                    {error}
                  </div>
                )}
                {presetMessage && (
                  <div className="inline-success" role="status">
                    {presetMessage}
                  </div>
                )}
              </form>
            </>
          )}
          <footer className="footer">
            <span>emanator</span>
            <span>·</span>
            <span>
              {language === 'it' ? 'Il tuo spazio, le tue regole.' : 'Your space, your rules.'}
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
