import { type Database, errorMessage, type Logger, runMigrations } from '@emanator/shared/server';
import { canonicalTimeZone } from '../domain/time-zone.ts';

/** A time zone the dashboard sent that the runtime doesn't know. */
export class TimeZoneError extends Error {
  override readonly name = 'TimeZoneError';
  constructor() {
    super('The time zone must be an IANA name, e.g. Europe/Rome.');
  }
}

/**
 * The Owner's time zone, which they set on the Persona page; `.env` gives only its first
 * value. Kept in memory, so every reader gets it without a query; a change is announced, so
 * what is scheduled by the clock can be scheduled again.
 */
export class TimeZoneSettings {
  private zone: string;
  private readonly listeners = new Set<(timeZone: string) => void>();

  constructor(
    private readonly db: Database,
    initial: string,
    private readonly logger: Logger,
  ) {
    this.zone = initial;
  }

  async init(): Promise<void> {
    await runMigrations(this.db, 'timezone', [
      {
        id: '001-time-zone-settings',
        sql: `
          CREATE TABLE time_zone_settings (
            id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
            time_zone TEXT NOT NULL
          );
        `,
      },
    ]);
    await this.db.query(
      'INSERT INTO time_zone_settings (id, time_zone) VALUES (1, $1) ON CONFLICT DO NOTHING',
      [this.zone],
    );
    const {
      rows: [row],
    } = await this.db.query('SELECT time_zone FROM time_zone_settings WHERE id = 1');
    const saved = canonicalTimeZone(row?.time_zone);
    if (saved) this.zone = saved;
    else
      this.logger.warn('The saved time zone is unknown, so the first one is used', {
        saved: row?.time_zone,
        zone: this.zone,
      });
  }

  timeZone(): string {
    return this.zone;
  }

  /** Saves the zone under the runtime's own name, so the dashboard's list can show it. */
  async setTimeZone(value: unknown): Promise<string> {
    const timeZone = canonicalTimeZone(value);
    if (!timeZone) throw new TimeZoneError();
    await this.db.query('UPDATE time_zone_settings SET time_zone = $1 WHERE id = 1', [timeZone]);
    const changed = timeZone !== this.zone;
    this.zone = timeZone;
    if (changed) {
      for (const listener of this.listeners) {
        try {
          listener(timeZone);
        } catch (error) {
          this.logger.error('Could not follow the new time zone', { error: errorMessage(error) });
        }
      }
    }
    return timeZone;
  }

  /** Told of every new time zone, after it is saved. */
  onTimeZoneChange(listener: (timeZone: string) => void): void {
    this.listeners.add(listener);
  }
}
