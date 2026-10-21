import { isModel, MODELS, modelLabel } from '@emanator/engine';
import {
  ArrowClockwise,
  CalendarBlank,
  ChatCircleDots,
  Check,
  ClockCounterClockwise,
  Cpu,
  PencilSimple,
  Play,
  Plus,
  Timer,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { RoutineInput } from '../domain/routine.ts';
import type { RoutineRun, RunStatus } from '../domain/run.ts';
import styles from './routines-page.module.css';
import {
  describeSchedule,
  isComplete,
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
const UNFINISHED: readonly RunStatus[] = ['running', 'waiting', 'approval'];

const t = {
  routines: 'Routines',
  eyebrow: 'Proactivity',
  intro:
    'Goals your Agent pursues on its own, on a schedule. It may also decide not to message you when there is nothing to say.',
  add: 'New Routine',
  emptyTitle: 'No Routines yet',
  empty:
    'A Routine is a goal your Agent pursues on a schedule: a morning briefing, a weekly review, a periodic check.',
  loading: 'Loading Routines…',
  loadError: 'Could not load your Routines.',
  retry: 'Try again',
  ready: 'Ready',
  saving: 'Saving…',
  saved: 'Changes saved',
  enabled: 'Active',
  disabled: 'Paused',
  next: 'Next Run',
  never: 'nothing scheduled',
  runNow: 'Run now',
  started: 'Run started',
  edit: 'Edit',
  history: 'History',
  hideHistory: 'Hide history',
  noRuns: 'No Runs yet.',
  loadingRuns: 'Loading Runs…',
  newTitle: 'New Routine',
  editTitle: 'Edit Routine',
  editorHint: 'Changes apply immediately, with no restart.',
  name: 'Name',
  nameHint: 'E.g. Morning briefing',
  prompt: 'Goal',
  promptHint: 'What the Agent should do each time the Routine starts…',
  model: 'Model',
  modelDefault: 'Default model',
  modelHelp: 'The default is set on the Persona page.',
  topicHint: (name: string) =>
    `Always writes in its own Telegram topic, “${name} · routine”, opened on the first Run.`,
  runningNow: 'Running…',
  enabledLabel: 'Active',
  enabledHelp: 'When paused it never starts by itself, but you can still run it by hand.',
  cancel: 'Cancel',
  save: 'Save Routine',
  delete: 'Delete',
  confirmDelete: (name: string) => ({
    title: `Delete “${name}”?`,
    body: 'Its Run history goes with it. Its Telegram topic stays: you can delete it from the app.',
    confirm: 'Delete Routine',
    cancel: 'Keep it',
    tone: 'danger' as const,
  }),
  confirmDiscard: {
    title: 'Discard your changes?',
    body: 'The edits you made to this Routine have not been saved.',
    confirm: 'Discard changes',
    cancel: 'Keep editing',
    tone: 'danger' as const,
  },
  saveError: 'Save failed.',
  actionError: 'The action failed.',
  manual: 'by hand',
  schedule: 'scheduled',
  tools: 'Tools',
  status: {
    running: 'Running',
    waiting: 'Waiting for quota',
    approval: 'Waiting for approval',
    delivered: 'Delivered',
    silent: 'Silent',
    failed: 'Failed',
  } satisfies Record<RunStatus, string>,
};

type Copy = typeof t;

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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

interface RoutinesPageProps {
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

type Editing = { mode: 'new' } | { mode: 'edit'; id: string } | undefined;

/** Routine management: list, edit, run now and Run history. */
export function RoutinesPage({ footer, onDirtyChange, confirm }: RoutinesPageProps) {
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

  async function open(next: Editing) {
    if (dirty && !(await confirm(t.confirmDiscard))) return;
    const routine = next?.mode === 'edit' ? routines.find(({ id }) => id === next.id) : undefined;
    const value = routine ? toDraft(routine) : emptyDraft();
    setEditing(next);
    setDraft(value);
    setPristine(value);
    setMessage(undefined);
  }

  async function close() {
    if (dirty && !(await confirm(t.confirmDiscard))) return;
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
    const routine = routines.find((candidate) => candidate.id === id);
    if (!(await confirm(t.confirmDelete(routine?.name ?? '')))) return;
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
  const tone = saving ? 'saving' : message?.kind === 'success' ? 'saved' : 'idle';

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">{t.eyebrow}</span>
          <h1>{t.routines}</h1>
          <p>{t.intro}</p>
        </div>
        <div className="page-actions">
          <span className="status" data-tone={tone} aria-live="polite">
            {status}
          </span>
          {loadState === 'ready' && !editing && routines.length > 0 && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void open({ mode: 'new' })}
            >
              <Plus size={16} weight="bold" aria-hidden="true" />
              {t.add}
            </button>
          )}
        </div>
      </header>

      {message?.kind === 'error' && !editing && (
        <div className={`notice ${styles.notice}`} data-tone="error" role="alert">
          <WarningCircle size={16} aria-hidden="true" />
          {message.text}
        </div>
      )}

      {loadState === 'loading' ? (
        <div className="skeleton-stack" role="status" aria-label={t.loading}>
          <span className="skeleton" />
          <span className="skeleton" />
          <span className="skeleton" />
        </div>
      ) : loadState === 'error' ? (
        <div className="state" data-tone="error" role="alert">
          <span className="state-icon">
            <WarningCircle size={22} aria-hidden="true" />
          </span>
          <h2>{t.loadError}</h2>
          <button type="button" className="btn btn-secondary" onClick={() => void load()}>
            <ArrowClockwise size={16} aria-hidden="true" />
            {t.retry}
          </button>
        </div>
      ) : (
        <div className={styles.stack}>
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
              onCancel={() => void close()}
              {...(editing.mode === 'edit' && {
                onDelete: () => void remove(editing.id),
              })}
            />
          )}
          {routines.length === 0 && !editing ? (
            <div className="state">
              <span className="state-icon">
                <Timer size={22} aria-hidden="true" />
              </span>
              <h2>{t.emptyTitle}</h2>
              <p>{t.empty}</p>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void open({ mode: 'new' })}
              >
                <Plus size={16} weight="bold" aria-hidden="true" />
                {t.add}
              </button>
            </div>
          ) : (
            <ul className={styles.list}>
              {routines.map((routine) => (
                <li
                  key={routine.id}
                  className={`panel ${styles.card}`}
                  data-editing={editing?.mode === 'edit' && editing.id === routine.id}
                >
                  <RoutineRow
                    routine={routine}
                    t={t}
                    editing={editing?.mode === 'edit' && editing.id === routine.id}
                    running={activeRuns.has(routine.id)}
                    historyOpen={historyOf === routine.id}
                    onEdit={() => void open({ mode: 'edit', id: routine.id })}
                    onRun={() => void runNow(routine.id)}
                    onToggleHistory={() =>
                      setHistoryOf(historyOf === routine.id ? undefined : routine.id)
                    }
                  />
                  {historyOf === routine.id && (
                    <RunHistory key={runsVersion} routineId={routine.id} t={t} />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {footer}
    </div>
  );
}

interface RoutineRowProps {
  routine: RoutineDto;
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
          <span className="badge" data-tone={routine.enabled ? 'success' : undefined}>
            {routine.enabled ? t.enabled : t.disabled}
          </span>
        </div>
        <p className={styles['row-prompt']}>{routine.prompt}</p>
        <div className={styles.meta}>
          {routine.triggers.map((trigger, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: triggers have no identity
            <span key={index} className="chip">
              <CalendarBlank size={14} aria-hidden="true" />
              {describeSchedule(toSchedule(trigger))}
            </span>
          ))}
          {routine.model && (
            <span className="chip">
              <Cpu size={14} aria-hidden="true" />
              {modelLabel(routine.model)}
            </span>
          )}
        </div>
      </div>
      <div className={styles['row-side']}>
        <div className={styles.next}>
          <span>{t.next}</span>
          <strong>{routine.nextRunAt ? formatDate(routine.nextRunAt) : t.never}</strong>
        </div>
        <div className={styles['row-actions']}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onToggleHistory}
            aria-expanded={historyOpen}
          >
            <ClockCounterClockwise size={16} aria-hidden="true" />
            {historyOpen ? t.hideHistory : t.history}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onEdit}
            disabled={editing}
          >
            <PencilSimple size={16} aria-hidden="true" />
            {t.edit}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onRun}
            disabled={running}
          >
            {running ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <Play size={14} weight="fill" aria-hidden="true" />
            )}
            {running ? t.runningNow : t.runNow}
          </button>
        </div>
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
  return (
    <form
      className={`panel ${styles.editor}`}
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
        <div className="field">
          <label htmlFor="routine-name">{t.name}</label>
          <input
            id="routine-name"
            className="input"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder={t.nameHint}
            maxLength={100}
            disabled={saving}
          />
        </div>
        <div className="field">
          <label htmlFor="routine-model">{t.model}</label>
          <select
            id="routine-model"
            className="select"
            value={draft.model}
            onChange={(e) => onChange({ ...draft, model: e.target.value })}
            disabled={saving}
            aria-describedby="routine-model-help"
          >
            <option value="">{t.modelDefault}</option>
            {MODELS.map(({ id, label }) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
            {/* A model saved before the list, kept until the Owner picks another. */}
            {draft.model && !isModel(draft.model) && (
              <option value={draft.model}>{draft.model}</option>
            )}
          </select>
          <small id="routine-model-help" className="field-hint">
            {t.modelHelp}
          </small>
        </div>
      </div>
      <div className="field">
        <div className="label-row">
          <label className="label" htmlFor="routine-prompt">
            {t.prompt}
          </label>
          <span className="counter">{draft.prompt.length} / 20000</span>
        </div>
        <textarea
          id="routine-prompt"
          className="textarea"
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
        disabled={saving}
      />

      <label className={styles.toggle}>
        <span>
          <strong>{t.enabledLabel}</strong>
          <small>{t.enabledHelp}</small>
        </span>
        <input
          type="checkbox"
          className="switch"
          checked={draft.enabled}
          onChange={(e) => onChange({ ...draft, enabled: e.target.checked })}
          disabled={saving}
        />
      </label>

      <p className="hint">
        <ChatCircleDots size={16} aria-hidden="true" />
        {t.topicHint(draft.name.trim() || t.nameHint)}
      </p>

      {error && (
        <div className="notice" data-tone="error" role="alert">
          <WarningCircle size={16} aria-hidden="true" />
          {error}
        </div>
      )}

      <div className={styles['editor-footer']}>
        {onDelete ? (
          <button type="button" className="btn btn-danger" onClick={onDelete} disabled={saving}>
            <Trash size={16} aria-hidden="true" />
            {t.delete}
          </button>
        ) : (
          <span />
        )}
        <div className="save-bar-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            {t.cancel}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              saving ||
              !dirty ||
              !draft.name.trim() ||
              !draft.prompt.trim() ||
              !draft.schedules.every(isComplete)
            }
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
  );
}

function RunHistory({ routineId, t }: { routineId: string; t: Copy }) {
  const [runs, setRuns] = useState<RunDto[]>();
  const [failed, setFailed] = useState(false);
  const running = runs?.some(({ status }) => UNFINISHED.includes(status)) ?? false;

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

  if (failed)
    return (
      <div className={styles.history}>
        <p className="notice" data-tone="error">
          {t.actionError}
        </p>
      </div>
    );
  if (!runs)
    return (
      <div className={`${styles.history} ${styles.muted}`} role="status">
        <span className="spinner" aria-hidden="true" />
        {t.loadingRuns}
      </div>
    );
  if (!runs.length) return <div className={`${styles.history} ${styles.muted}`}>{t.noRuns}</div>;

  return (
    <ol className={styles.history} aria-label={t.history}>
      {runs.map((run) => (
        <li key={run.id} className={styles.run} data-status={run.status}>
          <span className={styles['run-status']}>
            {UNFINISHED.includes(run.status) ? (
              <span className="spinner" aria-hidden="true" />
            ) : (
              <span className={styles['run-dot']} aria-hidden="true" />
            )}
            {t.status[run.status]}
          </span>
          <span className={styles['run-when']}>
            {formatDate(run.startedAt)} · {run.origin === 'manual' ? t.manual : t.schedule}
            {run.finishedAt &&
              ` · ${Math.max(1, Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000))} s`}
          </span>
          {run.tools.length > 0 && (
            <span className={styles['run-detail']}>
              {t.tools}: <code>{run.tools.join(', ')}</code>
            </span>
          )}
          {run.error && (
            <span className={`${styles['run-detail']} ${styles['run-error']}`}>{run.error}</span>
          )}
        </li>
      ))}
    </ol>
  );
}
