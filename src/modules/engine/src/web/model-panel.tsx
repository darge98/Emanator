import { Check, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { MODELS, type ModelId } from '../domain/models.ts';
import styles from './model-panel.module.css';

const t = {
  title: 'Model',
  intro:
    'The model your Agent thinks with. Conversations, Routines and the Dream can each pick another one.',
  label: 'Default model',
  saved: 'Saved',
  loadError: 'Could not load the model.',
  saveError: 'Save failed.',
};

interface ModelSettingsView {
  defaultModel: ModelId;
}

async function request(init?: RequestInit): Promise<ModelSettingsView> {
  const response = await fetch('/api/model', init);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<ModelSettingsView>;
}

/** The default model, as a section of the Persona page. Saves as it changes. */
export function ModelPanel() {
  const [model, setModel] = useState<ModelId>();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    request()
      .then(({ defaultModel }) => alive && setModel(defaultModel))
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  async function save(next: ModelId) {
    const previous = model;
    setModel(next);
    setState('saving');
    try {
      const { defaultModel } = await request({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ defaultModel: next }),
      });
      setModel(defaultModel);
      setState('saved');
    } catch {
      setModel(previous);
      setState('error');
    }
  }

  return (
    <section className="section" aria-labelledby="model-title">
      <div className="section-intro">
        <h2 id="model-title">{t.title}</h2>
        <p>{t.intro}</p>
      </div>
      <div className={`panel ${styles.panel}`}>
        {loadFailed ? (
          <span className={styles.status} data-tone="error" role="alert">
            <WarningCircle size={16} aria-hidden="true" />
            {t.loadError}
          </span>
        ) : (
          <>
            <label htmlFor="default-model">{t.label}</label>
            <select
              id="default-model"
              className="select"
              value={model ?? ''}
              disabled={!model || state === 'saving'}
              onChange={(event) => void save(event.target.value as ModelId)}
            >
              {MODELS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {state === 'saving' && <span className="spinner" aria-hidden="true" />}
            {state === 'saved' && (
              <span className={styles.status} aria-live="polite">
                <Check size={14} weight="bold" aria-hidden="true" />
                {t.saved}
              </span>
            )}
            {state === 'error' && (
              <span className={styles.status} data-tone="error" role="alert">
                <WarningCircle size={16} aria-hidden="true" />
                {t.saveError}
              </span>
            )}
          </>
        )}
      </div>
    </section>
  );
}
