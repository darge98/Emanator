import { MODELS } from '@emanator/engine';
import {
  ArrowClockwise,
  Check,
  Compass,
  Lightbulb,
  MoonStars,
  WarningCircle,
  Wrench,
  X,
} from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import type { DreamRun, DreamSettings, DreamView } from '../domain/dream.ts';
import type { Proposal } from '../domain/proposal.ts';
import styles from './dream-panel.module.css';

const t = {
  title: 'Dream',
  intro:
    'Every night it reads what you and your Agent said, and what your accounts returned, and notes what it learns as inferred facts. In the morning it asks you on Telegram about what matters.',
  enabled: 'Dream every night',
  at: 'at',
  model: 'with',
  defaultModel: 'Default model',
  offHint: 'While it is off, nothing of your days is kept.',
  dreamNow: 'Dream now',
  nothingToRead: 'The Journal is empty: talk with your Agent first.',
  dreaming: 'Dreaming…',
  never: 'No Dream yet.',
  last: 'Last Dream',
  next: 'Next',
  waiting: (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'} in the Journal, waiting for it`,
  outcome: (run: DreamRun) =>
    `${run.noted} ${run.noted === 1 ? 'fact' : 'facts'} noted · ${run.asked.length} asked`,
  failed: 'failed',
  loadError: 'Could not load the Dream.',
  retry: 'Try again',
  saveError: 'The change failed.',
  proposals: 'Proposals',
  proposalsHint:
    'After each Dream, the Retrospective proposes how your Agent could serve you better. An instruction you accept becomes one of its rules; ideas are yours to act on.',
  instruction: 'Instruction',
  idea: 'Idea',
  accept: 'Accept',
  reject: 'Reject',
  accepted: 'Accepted',
  rejected: 'Rejected',
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

const when = (iso: string, timeZone?: string) =>
  new Date(iso).toLocaleString('en-GB', {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

interface DreamPanelProps {
  /** The Owner's time zone, in which times are shown; the browser's until known. */
  timeZone?: string;
}

/** The Dream's settings and its last outcome, for the Memory page. Saves as it changes. */
export function DreamPanel({ timeZone }: DreamPanelProps = {}) {
  const [view, setView] = useState<DreamView>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setView(await request<DreamView>('/api/dream'));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const running = view?.lastRun?.status === 'running';
  // A Dream takes a while: check back until it is done.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [running, load]);

  async function change(path: string, init: RequestInit) {
    setBusy(true);
    setError('');
    try {
      setView(await request<DreamView>(path, init));
    } catch (failure) {
      setError(`${t.saveError} ${(failure as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const save = (settings: DreamSettings) =>
    change('/api/dream/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(settings),
    });

  if (loadFailed) {
    return (
      <section className={`panel ${styles.panel}`}>
        <div className={styles.body}>
          <p className={styles.line}>
            <WarningCircle size={16} aria-hidden="true" />
            {t.loadError}
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>
            <ArrowClockwise size={14} aria-hidden="true" />
            {t.retry}
          </button>
        </div>
      </section>
    );
  }
  if (!view) return null;
  const { settings, lastRun, nextAt, waiting } = view;

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="dream-title">
      <header className={styles.header}>
        <h2 id="dream-title">
          <MoonStars size={18} aria-hidden="true" />
          {t.title}
        </h2>
        <p>{t.intro}</p>
      </header>
      <div className={styles.body}>
        <div className={styles.controls}>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              className="switch"
              checked={settings.enabled}
              disabled={busy}
              onChange={(event) => void save({ ...settings, enabled: event.target.checked })}
            />
            {t.enabled}
          </label>
          <label className={styles.time}>
            <span>{t.at}</span>
            <input
              type="time"
              className="input"
              value={settings.time}
              disabled={busy || !settings.enabled}
              onChange={(event) =>
                event.target.value && void save({ ...settings, time: event.target.value })
              }
            />
          </label>
          <label className={styles.time}>
            <span>{t.model}</span>
            <select
              className="select"
              value={settings.model ?? ''}
              disabled={busy || !settings.enabled}
              onChange={(event) => {
                const { model: _previous, ...rest } = settings;
                void save(event.target.value ? { ...rest, model: event.target.value } : rest);
              }}
            >
              <option value="">{t.defaultModel}</option>
              {MODELS.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy || running || !settings.enabled || waiting === 0}
            title={waiting === 0 && !running ? t.nothingToRead : undefined}
            onClick={() => void change('/api/dream/runs', { method: 'POST' })}
          >
            {running ? <span className="spinner" aria-hidden="true" /> : null}
            {running ? t.dreaming : t.dreamNow}
          </button>
        </div>
        {error && (
          <p className={styles.error} role="alert">
            <WarningCircle size={16} aria-hidden="true" />
            {error}
          </p>
        )}
        <dl className={styles.facts}>
          <div>
            <dt>{t.last}</dt>
            <dd>
              {!lastRun
                ? t.never
                : lastRun.status === 'failed'
                  ? `${when(lastRun.startedAt, timeZone)} · ${t.failed}: ${lastRun.error ?? ''}`
                  : `${when(lastRun.startedAt, timeZone)} · ${running ? t.dreaming : t.outcome(lastRun)}`}
            </dd>
          </div>
          {nextAt && (
            <div>
              <dt>{t.next}</dt>
              <dd>{when(nextAt, timeZone)}</dd>
            </div>
          )}
        </dl>
        <p className={styles.hint}>{settings.enabled ? t.waiting(waiting) : t.offHint}</p>
        {view.proposals.length > 0 && (
          <Proposals
            proposals={view.proposals}
            busy={busy}
            onDecide={(id, status) =>
              void change(`/api/dream/proposals/${id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status }),
              })
            }
          />
        )}
      </div>
    </section>
  );
}

interface ProposalsProps {
  proposals: readonly Proposal[];
  busy: boolean;
  onDecide: (id: string, status: 'accepted' | 'rejected') => void;
}

/** What the Retrospective proposed, open ones first to answer here as on Telegram. */
function Proposals({ proposals, busy, onDecide }: ProposalsProps) {
  return (
    <div className={styles.proposals}>
      <h3>
        <Wrench size={16} aria-hidden="true" />
        {t.proposals}
      </h3>
      <p className={styles.hint}>{t.proposalsHint}</p>
      <ol>
        {proposals.map((proposal) => {
          const Icon = proposal.kind === 'instruction' ? Compass : Lightbulb;
          return (
            <li key={proposal.id} className={styles.proposal} data-status={proposal.status}>
              <Icon
                size={16}
                aria-label={proposal.kind === 'instruction' ? t.instruction : t.idea}
              />
              <span className={styles['proposal-copy']}>
                <span>{proposal.text}</span>
                <small>{proposal.reason}</small>
              </span>
              {proposal.status === 'open' ? (
                <span className={styles['proposal-actions']}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy}
                    onClick={() => onDecide(proposal.id, 'accepted')}
                  >
                    <Check size={14} aria-hidden="true" />
                    {t.accept}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={busy}
                    onClick={() => onDecide(proposal.id, 'rejected')}
                  >
                    <X size={14} aria-hidden="true" />
                    {t.reject}
                  </button>
                </span>
              ) : (
                <span
                  className="badge"
                  data-tone={proposal.status === 'accepted' ? 'success' : undefined}
                >
                  {proposal.status === 'accepted' ? t.accepted : t.rejected}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
