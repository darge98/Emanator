import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { RoutineInput } from '../domain/routine.ts';
import type { RoutineRun, RunStatus } from '../domain/run.ts';
import type { Trigger } from '../domain/trigger.ts';
import styles from './routines-page.module.css';

type Language = 'it' | 'en';

/** A Routine as the API sends it: dates are ISO strings. */
interface RoutineDto extends RoutineInput {
  id: string;
  conversationId?: string;
  createdAt: string;
  updatedAt: string;
  nextRunAt?: string;
}

type RunDto = Omit<RoutineRun, 'startedAt' | 'finishedAt'> & {
  startedAt: string;
  finishedAt?: string;
};

/** The editor keeps every field as text until saving. */
interface Draft {
  name: string;
  prompt: string;
  model: string;
  dedicatedTopic: boolean;
  enabled: boolean;
  triggers: TriggerDraft[];
}

type TriggerDraft =
  | { type: 'once'; local: string }
  | { type: 'interval'; minutes: string }
  | { type: 'cron'; expression: string };

const copy = {
  it: {
    settings: 'Impostazioni',
    routines: 'Routine',
    eyebrow: 'PROATTIVITÀ',
    intro:
      'Obiettivi che l’Agent persegue da solo, a orari stabiliti. Può anche decidere di non scriverti, se non c’è nulla da dire.',
    add: 'Nuova Routine',
    empty: 'Nessuna Routine, per ora. Creane una: un briefing mattutino o un controllo periodico.',
    loading: 'Caricamento Routine…',
    loadError: 'Non è stato possibile caricare le Routine.',
    retry: 'Riprova',
    ready: 'Pronto',
    saving: 'Salvataggio…',
    saved: 'Modifiche salvate',
    enabled: 'Attiva',
    disabled: 'In pausa',
    general: 'Topic Generale',
    dedicated: 'Topic dedicato',
    next: 'Prossima',
    never: 'nessuna esecuzione in programma',
    runNow: 'Esegui ora',
    started: 'Esecuzione avviata',
    edit: 'Modifica',
    history: 'Cronologia',
    hideHistory: 'Nascondi cronologia',
    noRuns: 'Ancora nessuna esecuzione.',
    newTitle: 'Nuova Routine',
    editTitle: 'Modifica Routine',
    editorHint: 'Le modifiche valgono subito, senza riavviare nulla.',
    name: 'Nome',
    nameHint: 'Es. Briefing del mattino',
    prompt: 'Obiettivo',
    promptHint: 'Cosa deve fare l’Agent, ogni volta che la Routine parte…',
    model: 'Modello',
    modelHint: 'Predefinito',
    modelHelp: 'Vuoto per il modello predefinito. Alias: haiku, sonnet, opus.',
    dedicatedLabel: 'Topic dedicato su Telegram',
    dedicatedHelp:
      'Scrive in un topic tutto suo, con il nome della Routine. Altrimenti scrive nel topic Generale.',
    enabledLabel: 'Attiva',
    enabledHelp: 'In pausa non parte da sola, ma puoi sempre eseguirla a mano.',
    triggers: 'Quando parte',
    addTrigger: 'Aggiungi un orario',
    remove: 'Rimuovi',
    once: 'Una volta',
    interval: 'Ogni',
    cron: 'Cron',
    minutes: 'minuti',
    cronHelp: 'minuto ora giorno mese giorno-settimana, es. 0 8 * * 1-5',
    cancel: 'Annulla',
    save: 'Salva Routine',
    delete: 'Elimina',
    confirmDelete:
      'Eliminare questa Routine e la sua cronologia? Il suo topic su Telegram resta: puoi cancellarlo tu dall’app.',
    confirmDiscard: 'Scartare le modifiche non salvate?',
    saveError: 'Salvataggio non riuscito.',
    actionError: 'Operazione non riuscita.',
    manual: 'a mano',
    schedule: 'pianificata',
    tools: 'Strumenti',
    status: {
      running: 'In corso',
      delivered: 'Inviata',
      silent: 'Silenziosa',
      failed: 'Fallita',
    } satisfies Record<RunStatus, string>,
  },
  en: {
    settings: 'Settings',
    routines: 'Routines',
    eyebrow: 'PROACTIVITY',
    intro:
      'Goals your Agent pursues on its own, on a schedule. It may also decide not to message you when there is nothing to say.',
    add: 'New Routine',
    empty: 'No Routines yet. Create one: a morning briefing or a periodic check.',
    loading: 'Loading Routines…',
    loadError: 'Could not load your Routines.',
    retry: 'Try again',
    ready: 'Ready',
    saving: 'Saving…',
    saved: 'Changes saved',
    enabled: 'Active',
    disabled: 'Paused',
    general: 'General topic',
    dedicated: 'Dedicated topic',
    next: 'Next',
    never: 'nothing scheduled',
    runNow: 'Run now',
    started: 'Run started',
    edit: 'Edit',
    history: 'History',
    hideHistory: 'Hide history',
    noRuns: 'No Runs yet.',
    newTitle: 'New Routine',
    editTitle: 'Edit Routine',
    editorHint: 'Changes apply immediately, with no restart.',
    name: 'Name',
    nameHint: 'E.g. Morning briefing',
    prompt: 'Goal',
    promptHint: 'What the Agent should do each time the Routine starts…',
    model: 'Model',
    modelHint: 'Default',
    modelHelp: 'Leave empty for the default model. Aliases: haiku, sonnet, opus.',
    dedicatedLabel: 'Dedicated Telegram topic',
    dedicatedHelp:
      'Writes in a topic of its own, named after the Routine. Otherwise it writes in the General topic.',
    enabledLabel: 'Active',
    enabledHelp: 'When paused it never starts by itself, but you can still run it by hand.',
    triggers: 'When it runs',
    addTrigger: 'Add a time',
    remove: 'Remove',
    once: 'Once',
    interval: 'Every',
    cron: 'Cron',
    minutes: 'minutes',
    cronHelp: 'minute hour day month weekday, e.g. 0 8 * * 1-5',
    cancel: 'Cancel',
    save: 'Save Routine',
    delete: 'Delete',
    confirmDelete:
      'Delete this Routine and its history? Its Telegram topic stays: you can delete it from the app.',
    confirmDiscard: 'Discard your unsaved changes?',
    saveError: 'Save failed.',
    actionError: 'The action failed.',
    manual: 'by hand',
    schedule: 'scheduled',
    tools: 'Tools',
    status: {
      running: 'Running',
      delivered: 'Delivered',
      silent: 'Silent',
      failed: 'Failed',
    } satisfies Record<RunStatus, string>,
  },
};

type Copy = (typeof copy)[Language];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
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
  return (response.status === 204 ? undefined : response.json()) as Promise<T>;
}

const emptyDraft = (): Draft => ({
  name: '',
  prompt: '',
  model: '',
  dedicatedTopic: false,
  enabled: true,
  triggers: [{ type: 'cron', expression: '0 8 * * *' }],
});

function toDraft(routine: RoutineDto): Draft {
  return {
    name: routine.name,
    prompt: routine.prompt,
    model: routine.model ?? '',
    dedicatedTopic: routine.dedicatedTopic,
    enabled: routine.enabled,
    triggers: routine.triggers.map(triggerToDraft),
  };
}

function triggerToDraft(trigger: Trigger): TriggerDraft {
  switch (trigger.type) {
    case 'once':
      return { type: 'once', local: toLocalInput(new Date(trigger.at)) };
    case 'interval':
      return { type: 'interval', minutes: String(trigger.everyMinutes) };
    case 'cron':
      return { type: 'cron', expression: trigger.expression };
  }
}

/** What the API receives; the server does the real validation. */
function toInput(draft: Draft): unknown {
  return {
    name: draft.name,
    prompt: draft.prompt,
    ...(draft.model.trim() && { model: draft.model.trim() }),
    dedicatedTopic: draft.dedicatedTopic,
    enabled: draft.enabled,
    triggers: draft.triggers.map(draftToTrigger),
  };
}

function draftToTrigger(trigger: TriggerDraft): unknown {
  switch (trigger.type) {
    case 'once': {
      const at = new Date(trigger.local);
      return { type: 'once', at: Number.isNaN(at.getTime()) ? '' : at.toISOString() };
    }
    case 'interval':
      return { type: 'interval', everyMinutes: Number(trigger.minutes) };
    case 'cron':
      return { type: 'cron', expression: trigger.expression };
  }
}

/** `YYYY-MM-DDTHH:mm` in the browser's zone, as `<input type="datetime-local">` wants. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(language === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function describeTrigger(trigger: Trigger, language: Language, t: Copy): string {
  switch (trigger.type) {
    case 'once':
      return `${t.once}: ${formatDate(trigger.at, language)}`;
    case 'interval': {
      const { everyMinutes: m } = trigger;
      if (m % 1440 === 0) return `${t.interval} ${m / 1440} ${language === 'it' ? 'g' : 'd'}`;
      if (m % 60 === 0) return `${t.interval} ${m / 60} h`;
      return `${t.interval} ${m} min`;
    }
    case 'cron':
      return `cron ${trigger.expression}`;
  }
}

interface RoutinesPageProps {
  language: Language;
  languageControl: ReactNode;
  footer: ReactNode;
}

type Editing = { mode: 'new' } | { mode: 'edit'; id: string } | undefined;

/** Routine management: list, edit, run now and Run history. */
export function RoutinesPage({ language, languageControl, footer }: RoutinesPageProps) {
  const t = copy[language];
  const [routines, setRoutines] = useState<RoutineDto[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [editing, setEditing] = useState<Editing>();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [pristine, setPristine] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string }>();
  const [historyOf, setHistoryOf] = useState<string>();
  /** Bumped by "run now" to reload the open history. */
  const [runsVersion, setRunsVersion] = useState(0);
  const dirty = editing !== undefined && JSON.stringify(draft) !== JSON.stringify(pristine);

  const load = useCallback(async () => {
    try {
      setRoutines(await request<RoutineDto[]>('/api/routines'));
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  function open(next: Editing) {
    if (dirty && !window.confirm(t.confirmDiscard)) return;
    const routine = next?.mode === 'edit' ? routines.find(({ id }) => id === next.id) : undefined;
    const value = routine ? toDraft(routine) : emptyDraft();
    setEditing(next);
    setDraft(value);
    setPristine(value);
    setMessage(undefined);
  }

  function close() {
    if (dirty && !window.confirm(t.confirmDiscard)) return;
    setEditing(undefined);
    setMessage(undefined);
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    setMessage(undefined);
    try {
      const body = JSON.stringify(toInput(draft));
      if (editing.mode === 'new') {
        await request('/api/routines', { method: 'POST', body });
      } else {
        await request(`/api/routines/${editing.id}`, { method: 'PUT', body });
      }
      setEditing(undefined);
      setMessage({ kind: 'success', text: t.saved });
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: `${t.saveError} ${(error as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t.confirmDelete)) return;
    try {
      await request(`/api/routines/${id}`, { method: 'DELETE' });
      setEditing(undefined);
      if (historyOf === id) setHistoryOf(undefined);
      await load();
    } catch (error) {
      setMessage({ kind: 'error', text: `${t.actionError} ${(error as Error).message}` });
    }
  }

  async function runNow(id: string) {
    try {
      await request(`/api/routines/${id}/runs`, { method: 'POST' });
      setHistoryOf(id);
      setRunsVersion((version) => version + 1);
      setMessage({ kind: 'success', text: t.started });
    } catch (error) {
      setMessage({ kind: 'error', text: `${t.actionError} ${(error as Error).message}` });
    }
  }

  const status = saving ? t.saving : message?.kind === 'success' ? message.text : t.ready;

  return (
    <>
      <header className={styles.topbar}>
        <div className={styles.breadcrumb}>
          {t.settings}
          <span>/</span>
          <strong>{t.routines}</strong>
        </div>
        <div className={styles['top-actions']}>
          <span className={styles['status-text']} aria-live="polite">
            {status}
          </span>
          {languageControl}
        </div>
      </header>
      <div className={styles.content}>
        <div className={styles['page-heading']}>
          <div>
            <div className={styles.eyebrow}>{t.eyebrow}</div>
            <h1>{t.routines}</h1>
            <p>{t.intro}</p>
          </div>
          {loadState === 'ready' && !editing && (
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              onClick={() => open({ mode: 'new' })}
            >
              <span aria-hidden="true">＋</span>
              {t.add}
            </button>
          )}
        </div>

        {message?.kind === 'error' && !editing && (
          <div className={styles['inline-error']} role="alert">
            {message.text}
          </div>
        )}

        {loadState === 'loading' ? (
          <div className={styles['state-card']} role="status">
            <span className={styles.spinner} />
            {t.loading}
          </div>
        ) : loadState === 'error' ? (
          <div className={`${styles['state-card']} ${styles.error}`} role="alert">
            <strong>{t.loadError}</strong>
            <button type="button" className={styles['text-button']} onClick={() => void load()}>
              {t.retry}
            </button>
          </div>
        ) : (
          <>
            {editing && (
              <RoutineEditor
                t={t}
                title={editing.mode === 'new' ? t.newTitle : t.editTitle}
                draft={draft}
                onChange={setDraft}
                saving={saving}
                dirty={dirty}
                error={message?.kind === 'error' ? message.text : undefined}
                onSave={() => void save()}
                onCancel={close}
                {...(editing.mode === 'edit' && {
                  onDelete: () => void remove(editing.id),
                })}
              />
            )}
            {routines.length === 0 && !editing ? (
              <div className={styles['state-card']}>{t.empty}</div>
            ) : (
              <ul className={styles.list}>
                {routines.map((routine) => (
                  <li key={routine.id} className={styles.panel}>
                    <RoutineRow
                      routine={routine}
                      language={language}
                      t={t}
                      editing={editing?.mode === 'edit' && editing.id === routine.id}
                      historyOpen={historyOf === routine.id}
                      onEdit={() => open({ mode: 'edit', id: routine.id })}
                      onRun={() => void runNow(routine.id)}
                      onToggleHistory={() =>
                        setHistoryOf(historyOf === routine.id ? undefined : routine.id)
                      }
                    />
                    {historyOf === routine.id && (
                      <RunHistory
                        key={runsVersion}
                        routineId={routine.id}
                        language={language}
                        t={t}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {footer}
      </div>
    </>
  );
}

interface RoutineRowProps {
  routine: RoutineDto;
  language: Language;
  t: Copy;
  editing: boolean;
  historyOpen: boolean;
  onEdit: () => void;
  onRun: () => void;
  onToggleHistory: () => void;
}

function RoutineRow({
  routine,
  language,
  t,
  editing,
  historyOpen,
  onEdit,
  onRun,
  onToggleHistory,
}: RoutineRowProps) {
  return (
    <div className={styles.row}>
      <div className={styles['row-main']}>
        <div className={styles['row-title']}>
          <h2>{routine.name}</h2>
          <span className={`${styles.badge} ${routine.enabled ? styles.on : styles.off}`}>
            {routine.enabled ? t.enabled : t.disabled}
          </span>
        </div>
        <p className={styles['row-prompt']}>{routine.prompt}</p>
        <div className={styles.meta}>
          {routine.triggers.map((trigger, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: triggers have no identity
            <span key={index} className={styles.chip}>
              {describeTrigger(trigger, language, t)}
            </span>
          ))}
          <span className={styles.chip}>{routine.dedicatedTopic ? t.dedicated : t.general}</span>
          {routine.model && <span className={styles.chip}>{routine.model}</span>}
        </div>
        <div className={styles.next}>
          {t.next}: {routine.nextRunAt ? formatDate(routine.nextRunAt, language) : t.never}
        </div>
      </div>
      <div className={styles['row-actions']}>
        <button type="button" className={`${styles.button} ${styles.secondary}`} onClick={onRun}>
          <span aria-hidden="true">▶</span>
          {t.runNow}
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.secondary}`}
          onClick={onEdit}
          disabled={editing}
        >
          {t.edit}
        </button>
        <button
          type="button"
          className={styles['text-button']}
          onClick={onToggleHistory}
          aria-expanded={historyOpen}
        >
          {historyOpen ? t.hideHistory : t.history}
        </button>
      </div>
    </div>
  );
}

interface RoutineEditorProps {
  t: Copy;
  title: string;
  draft: Draft;
  onChange: (draft: Draft) => void;
  saving: boolean;
  dirty: boolean;
  error: string | undefined;
  onSave: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function RoutineEditor({
  t,
  title,
  draft,
  onChange,
  saving,
  dirty,
  error,
  onSave,
  onCancel,
  onDelete,
}: RoutineEditorProps) {
  const setTrigger = (index: number, trigger: TriggerDraft) =>
    onChange({
      ...draft,
      triggers: draft.triggers.map((current, i) => (i === index ? trigger : current)),
    });
  const blankTrigger = (type: TriggerDraft['type']): TriggerDraft =>
    type === 'once'
      ? { type, local: toLocalInput(new Date(Date.now() + 3_600_000)) }
      : type === 'interval'
        ? { type, minutes: '60' }
        : { type, expression: '0 8 * * *' };

  return (
    <form
      className={`${styles.panel} ${styles.editor}`}
      aria-labelledby="routine-editor-title"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className={styles['editor-heading']}>
        <h2 id="routine-editor-title">{title}</h2>
        <p>{t.editorHint}</p>
      </div>
      <div className={styles['field-grid']}>
        <div className={styles.field}>
          <label htmlFor="routine-name">{t.name}</label>
          <input
            id="routine-name"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder={t.nameHint}
            maxLength={100}
            disabled={saving}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="routine-model">{t.model}</label>
          <input
            id="routine-model"
            value={draft.model}
            onChange={(e) => onChange({ ...draft, model: e.target.value })}
            placeholder={t.modelHint}
            maxLength={100}
            disabled={saving}
            aria-describedby="routine-model-help"
          />
          <small id="routine-model-help">{t.modelHelp}</small>
        </div>
      </div>
      <div className={styles.field}>
        <div className={styles['label-row']}>
          <label htmlFor="routine-prompt">{t.prompt}</label>
          <span>{draft.prompt.length} / 20000</span>
        </div>
        <textarea
          id="routine-prompt"
          value={draft.prompt}
          onChange={(e) => onChange({ ...draft, prompt: e.target.value })}
          placeholder={t.promptHint}
          maxLength={20000}
          rows={5}
          disabled={saving}
        />
      </div>

      <fieldset className={styles.triggers}>
        <legend>{t.triggers}</legend>
        {draft.triggers.map((trigger, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: triggers have no identity
          <div key={index} className={styles['trigger-row']}>
            <select
              aria-label={t.triggers}
              value={trigger.type}
              onChange={(e) =>
                setTrigger(index, blankTrigger(e.target.value as TriggerDraft['type']))
              }
              disabled={saving}
            >
              <option value="once">{t.once}</option>
              <option value="interval">{t.interval}</option>
              <option value="cron">{t.cron}</option>
            </select>
            {trigger.type === 'once' && (
              <input
                type="datetime-local"
                aria-label={t.once}
                value={trigger.local}
                onChange={(e) => setTrigger(index, { type: 'once', local: e.target.value })}
                disabled={saving}
              />
            )}
            {trigger.type === 'interval' && (
              <span className={styles['interval-input']}>
                <input
                  type="number"
                  min={1}
                  step={1}
                  aria-label={t.minutes}
                  value={trigger.minutes}
                  onChange={(e) => setTrigger(index, { type: 'interval', minutes: e.target.value })}
                  disabled={saving}
                />
                {t.minutes}
              </span>
            )}
            {trigger.type === 'cron' && (
              <span className={styles['cron-input']}>
                <input
                  aria-label={t.cron}
                  value={trigger.expression}
                  onChange={(e) => setTrigger(index, { type: 'cron', expression: e.target.value })}
                  spellCheck={false}
                  disabled={saving}
                />
                <small>{t.cronHelp}</small>
              </span>
            )}
            <button
              type="button"
              className={styles['icon-button']}
              onClick={() =>
                onChange({ ...draft, triggers: draft.triggers.filter((_, i) => i !== index) })
              }
              disabled={saving || draft.triggers.length === 1}
              aria-label={t.remove}
              title={t.remove}
            >
              ×
            </button>
          </div>
        ))}
        {draft.triggers.length < 10 && (
          <button
            type="button"
            className={styles['text-button']}
            onClick={() =>
              onChange({ ...draft, triggers: [...draft.triggers, blankTrigger('cron')] })
            }
            disabled={saving}
          >
            ＋ {t.addTrigger}
          </button>
        )}
      </fieldset>

      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={draft.dedicatedTopic}
          onChange={(e) => onChange({ ...draft, dedicatedTopic: e.target.checked })}
          disabled={saving}
        />
        <span>
          <strong>{t.dedicatedLabel}</strong>
          <small>{t.dedicatedHelp}</small>
        </span>
      </label>
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
          disabled={saving}
        />
        <span>
          <strong>{t.enabledLabel}</strong>
          <small>{t.enabledHelp}</small>
        </span>
      </label>

      <div className={styles['form-footer']}>
        {onDelete ? (
          <button
            type="button"
            className={`${styles.button} ${styles.danger}`}
            onClick={onDelete}
            disabled={saving}
          >
            {t.delete}
          </button>
        ) : (
          <span />
        )}
        <div className={styles['form-actions']}>
          <button
            type="button"
            className={`${styles.button} ${styles.secondary}`}
            onClick={onCancel}
            disabled={saving}
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            className={`${styles.button} ${styles.primary}`}
            disabled={saving || !dirty || !draft.name.trim() || !draft.prompt.trim()}
          >
            {saving ? (
              <span className={styles['button-spinner']} />
            ) : (
              <span aria-hidden="true">✓</span>
            )}
            {saving ? t.saving : t.save}
          </button>
        </div>
      </div>
      {error && (
        <div className={styles['inline-error']} role="alert">
          {error}
        </div>
      )}
    </form>
  );
}

function RunHistory({
  routineId,
  language,
  t,
}: {
  routineId: string;
  language: Language;
  t: Copy;
}) {
  const [runs, setRuns] = useState<RunDto[]>();
  const [failed, setFailed] = useState(false);
  const running = runs?.some(({ status }) => status === 'running') ?? false;

  useEffect(() => {
    let alive = true;
    const fetchRuns = () =>
      request<RunDto[]>(`/api/routines/${routineId}/runs`)
        .then((next) => {
          if (alive) {
            setRuns(next);
            setFailed(false);
          }
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    void fetchRuns();
    // Refresh while a Run is in progress, so its outcome shows up by itself.
    const timer = running ? window.setInterval(() => void fetchRuns(), 3000) : undefined;
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [routineId, running]);

  if (failed) return <div className={styles['inline-error']}>{t.actionError}</div>;
  if (!runs)
    return (
      <div className={styles.history}>
        <span className={styles.spinner} />
      </div>
    );
  if (!runs.length) return <div className={`${styles.history} ${styles.muted}`}>{t.noRuns}</div>;

  return (
    <ol className={styles.history}>
      {runs.map((run) => (
        <li key={run.id} className={styles.run}>
          <span className={`${styles['run-status']} ${styles[run.status]}`}>
            {run.status === 'running' && <span className={styles['button-spinner']} />}
            {t.status[run.status]}
          </span>
          <span className={styles['run-when']}>
            {formatDate(run.startedAt, language)} ·{' '}
            {run.origin === 'manual' ? t.manual : t.schedule}
            {run.finishedAt &&
              ` · ${Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))} s`}
          </span>
          {run.tools.length > 0 && (
            <span className={styles['run-detail']}>
              {t.tools}: {run.tools.join(', ')}
            </span>
          )}
          {run.error && (
            <span className={`${styles['run-detail']} ${styles.failed}`}>{run.error}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
