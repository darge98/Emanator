import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { RoutineInput } from '../domain/routine.ts';
import type { RoutineRun, RunStatus } from '../domain/run.ts';
import styles from './routines-page.module.css';
import {
  describeSchedule,
  isComplete,
  type Language,
  type ScheduleDraft,
  toSchedule,
  toTrigger,
} from './schedule.ts';
import { ScheduleEditor } from './schedule-editor.tsx';

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
  enabled: boolean;
  schedules: ScheduleDraft[];
}

/** Statuses of a Run that hasn't finished yet. */
const UNFINISHED: readonly RunStatus[] = ['running', 'waiting'];

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
    topicHint: (name: string) =>
      `Scrive sempre nel suo topic su Telegram, «${name} · routine», che si apre alla prima esecuzione.`,
    runningNow: 'In esecuzione…',
    enabledLabel: 'Attiva',
    enabledHelp: 'In pausa non parte da sola, ma puoi sempre eseguirla a mano.',
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
      waiting: 'In attesa della quota',
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
    topicHint: (name: string) =>
      `Always writes in its own Telegram topic, “${name} · routine”, opened on the first Run.`,
    runningNow: 'Running…',
    enabledLabel: 'Active',
    enabledHelp: 'When paused it never starts by itself, but you can still run it by hand.',
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
      waiting: 'Waiting for quota',
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
  enabled: true,
  schedules: [{ kind: 'weekly', days: [1, 2, 3, 4, 5], time: '08:00' }],
});

function toDraft(routine: RoutineDto): Draft {
  return {
    name: routine.name,
    prompt: routine.prompt,
    model: routine.model ?? '',
    enabled: routine.enabled,
    schedules: routine.triggers.map(toSchedule),
  };
}

/** What the API receives; the server does the real validation. */
function toInput(draft: Draft): unknown {
  return {
    name: draft.name,
    prompt: draft.prompt,
    ...(draft.model.trim() && { model: draft.model.trim() }),
    enabled: draft.enabled,
    triggers: draft.schedules.map(toTrigger),
  };
}

function formatDate(iso: string, language: Language): string {
  return new Date(iso).toLocaleString(language === 'it' ? 'it-IT' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface RoutinesPageProps {
  language: Language;
  languageControl: ReactNode;
  footer: ReactNode;
  /** Told whenever unsaved edits appear or go away, so the app can guard navigation. */
  onDirtyChange?: (dirty: boolean) => void;
}

type Editing = { mode: 'new' } | { mode: 'edit'; id: string } | undefined;

/** Routine management: list, edit, run now and Run history. */
export function RoutinesPage({
  language,
  languageControl,
  footer,
  onDirtyChange,
}: RoutinesPageProps) {
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
  /** Routines whose "run now" hasn't finished: their button stays disabled. */
  const [activeRuns, setActiveRuns] = useState<ReadonlySet<string>>(new Set());
  const dirty = editing !== undefined && JSON.stringify(draft) !== JSON.stringify(pristine);

  const load = useCallback(async () => {
    try {
      setRoutines(await request<RoutineDto[]>('/api/routines'));
      setLoadState('ready');
    } catch {
      // A failed refresh keeps the list already shown.
      setLoadState((state) => (state === 'loading' ? 'error' : state));
    }
  }, []);

  useEffect(() => {
    void load();
    // Keeps "next Run" current while the page stays open.
    const timer = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  // Follows the Runs started here until they finish, then re-enables "run now" and
  // refreshes the list, whose next Run may have changed.
  useEffect(() => {
    if (!activeRuns.size) return;
    const timer = window.setInterval(async () => {
      const finished: string[] = [];
      for (const id of activeRuns) {
        try {
          const [latest] = await request<RunDto[]>(`/api/routines/${id}/runs`);
          if (!latest || !UNFINISHED.includes(latest.status)) finished.push(id);
        } catch {
          finished.push(id);
        }
      }
      if (!finished.length) return;
      setActiveRuns((current) => new Set([...current].filter((id) => !finished.includes(id))));
      void load();
    }, 3000);
    return () => window.clearInterval(timer);
  }, [activeRuns, load]);

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
    setActiveRuns((current) => new Set(current).add(id));
    try {
      await request(`/api/routines/${id}/runs`, { method: 'POST' });
      setHistoryOf(id);
      setRunsVersion((version) => version + 1);
      setMessage({ kind: 'success', text: t.started });
    } catch (error) {
      setActiveRuns((current) => new Set([...current].filter((active) => active !== id)));
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
                language={language}
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
                      running={activeRuns.has(routine.id)}
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
  running: boolean;
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
  running,
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
              {describeSchedule(toSchedule(trigger), language)}
            </span>
          ))}
          {routine.model && <span className={styles.chip}>{routine.model}</span>}
        </div>
        <div className={styles.next}>
          {t.next}: {routine.nextRunAt ? formatDate(routine.nextRunAt, language) : t.never}
        </div>
      </div>
      <div className={styles['row-actions']}>
        <button
          type="button"
          className={`${styles.button} ${styles.secondary}`}
          onClick={onRun}
          disabled={running}
        >
          {running ? (
            <span className={`${styles['button-spinner']} ${styles.dark}`} />
          ) : (
            <span aria-hidden="true">▶</span>
          )}
          {running ? t.runningNow : t.runNow}
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
  language: Language;
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
  language,
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

      <ScheduleEditor
        schedules={draft.schedules}
        onChange={(schedules) => onChange({ ...draft, schedules })}
        language={language}
        disabled={saving}
      />

      <p className={styles['topic-hint']}>
        <span aria-hidden="true">ⓘ</span>
        {t.topicHint(draft.name.trim() || t.nameHint)}
      </p>
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
            disabled={
              saving ||
              !dirty ||
              !draft.name.trim() ||
              !draft.prompt.trim() ||
              !draft.schedules.every(isComplete)
            }
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
  const running = runs?.some(({ status }) => status === 'running' || status === 'waiting') ?? false;

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
            {(run.status === 'running' || run.status === 'waiting') && (
              <span className={styles['button-spinner']} />
            )}
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
