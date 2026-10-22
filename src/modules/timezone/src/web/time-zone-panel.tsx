import { Check, WarningCircle } from '@phosphor-icons/react';
import { useEffect, useMemo, useState } from 'react';
import { canonicalTimeZone, timeZones } from '../domain/time-zone.ts';
import styles from './time-zone-panel.module.css';

const t = {
  title: 'Time zone',
  intro:
    'How your Agent reads “at 6 pm” and “every day at 8”, and the times you see here and on Telegram. Moments already set stay where they are.',
  label: 'Time zone',
  now: (time: string) => `now ${time}`,
  browser: (zone: string) => `Use ${zone}, your browser’s`,
  saved: 'Saved',
  loadError: 'Could not load the time zone.',
  saveError: 'Save failed.',
};

interface TimeZoneView {
  timeZone: string;
}

async function request(init?: RequestInit): Promise<TimeZoneView> {
  const response = await fetch('/api/time-zone', init);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<TimeZoneView>;
}

/** Zones by region, the part before the first slash: Europe, America, … */
function byRegion(zones: readonly string[]): [string, string[]][] {
  const groups = new Map<string, string[]>();
  for (const zone of zones) {
    const region = zone.includes('/') ? (zone.split('/')[0] ?? zone) : 'Other';
    groups.set(region, [...(groups.get(region) ?? []), zone]);
  }
  return [...groups];
}

const clock = (timeZone: string) =>
  new Date().toLocaleTimeString('en-GB', { timeZone, hour: '2-digit', minute: '2-digit' });

interface TimeZonePanelProps {
  /** Told of the zone in force, once loaded and after every save. */
  onChange?: (timeZone: string) => void;
}

/** The Owner's time zone, as a section of the Persona page. Saves as it changes. */
export function TimeZonePanel({ onChange }: TimeZonePanelProps) {
  const [zone, setZone] = useState<string>();
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loadFailed, setLoadFailed] = useState(false);
  // The saved zone is always offered: browsers' lists differ (Europe/Kyiv or Europe/Kiev).
  const groups = useMemo(() => {
    const zones = timeZones();
    return byRegion(zone && !zones.includes(zone) ? [...zones, zone].sort() : zones);
  }, [zone]);
  const browser = canonicalTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);

  useEffect(() => {
    let alive = true;
    request()
      .then(({ timeZone }) => {
        if (!alive) return;
        setZone(timeZone);
        onChange?.(timeZone);
      })
      .catch(() => alive && setLoadFailed(true));
    return () => {
      alive = false;
    };
  }, [onChange]);

  async function save(next: string) {
    const previous = zone;
    setZone(next);
    setState('saving');
    try {
      const { timeZone } = await request({
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ timeZone: next }),
      });
      setZone(timeZone);
      setState('saved');
      onChange?.(timeZone);
    } catch {
      setZone(previous);
      setState('error');
    }
  }

  return (
    <section className="section" aria-labelledby="time-zone-title">
      <div className="section-intro">
        <h2 id="time-zone-title">{t.title}</h2>
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
            <label htmlFor="time-zone">{t.label}</label>
            <select
              id="time-zone"
              className="select"
              value={zone ?? ''}
              disabled={!zone || state === 'saving'}
              onChange={(event) => void save(event.target.value)}
            >
              {groups.map(([region, zones]) => (
                <optgroup key={region} label={region}>
                  {zones.map((name) => (
                    <option key={name} value={name}>
                      {name.replaceAll('_', ' ')}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {zone && <span className={styles.now}>{t.now(clock(zone))}</span>}
            {zone && browser && browser !== zone && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={state === 'saving'}
                onClick={() => void save(browser)}
              >
                {t.browser(browser)}
              </button>
            )}
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
