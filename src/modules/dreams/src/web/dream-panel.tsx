import { ArrowClockwise, MoonStars, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import type { DreamRun, DreamSettings, DreamView } from '../domain/dream.ts';
import styles from './dream-panel.module.css';

const t = {
  title: 'Dream',
  intro:
    'Every night it reads what you and your Agent said, and what your accounts returned, and notes what it learns as inferred facts. In the morning it asks you on Telegram about what matters.',
  enabled: 'Dream every night',
  at: 'at',
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

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

/** The Dream's settings and its last outcome, for the Memory page. Saves as it changes. */
export function DreamPanel() {
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
                  ? `${when(lastRun.startedAt)} · ${t.failed}: ${lastRun.error ?? ''}`
                  : `${when(lastRun.startedAt)} · ${running ? t.dreaming : t.outcome(lastRun)}`}
            </dd>
          </div>
          {nextAt && (
            <div>
              <dt>{t.next}</dt>
              <dd>{when(nextAt)}</dd>
            </div>
          )}
        </dl>
        <p className={styles.hint}>{settings.enabled ? t.waiting(waiting) : t.offHint}</p>
      </div>
    </section>
  );
}
