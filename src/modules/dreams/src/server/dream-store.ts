import { randomUUID } from 'node:crypto';
import { type Database, runMigrations, transaction } from '@emanator/shared/server';
import {
  type AskedFact,
  DEFAULT_DREAM_SETTINGS,
  type DreamRun,
  type DreamSettings,
  type DreamStatus,
} from '../domain/dream.ts';
import type { JournalAuthor, JournalEntry } from '../domain/journal.ts';
import { dreamMigrations } from './migrations.ts';

/** A Journal entry as stored, with the id that marks how far a Dream has read. */
export interface StoredEntry extends JournalEntry {
  id: number;
}

export interface DreamOutcome {
  status: Exclude<DreamStatus, 'running'>;
  noted: number;
  asked: AskedFact[];
  error?: string;
}

/** The Dream's settings, its Runs and the Journal, in PostgreSQL (ADR 0007). */
export class DreamStore {
  constructor(private readonly db: Database) {}

  async init(): Promise<void> {
    await runMigrations(this.db, 'dreams', dreamMigrations);
    await this.db.query(
      'INSERT INTO dream_settings (id, enabled, time) VALUES (1, $1, $2) ON CONFLICT DO NOTHING',
      [DEFAULT_DREAM_SETTINGS.enabled, DEFAULT_DREAM_SETTINGS.time],
    );
    // A Dream the Harness stopped in the middle of won't finish.
    await this.db.query(
      `UPDATE dream_runs SET status = 'failed', finished_at = now(),
         error = 'The Harness stopped during the Dream.'
       WHERE status = 'running'`,
    );
  }

  async settings(): Promise<DreamSettings> {
    const {
      rows: [row],
    } = await this.db.query('SELECT enabled, time FROM dream_settings WHERE id = 1');
    return row ? { enabled: Boolean(row.enabled), time: String(row.time) } : DEFAULT_DREAM_SETTINGS;
  }

  async saveSettings({ enabled, time }: DreamSettings): Promise<void> {
    await this.db.query('UPDATE dream_settings SET enabled = $1, time = $2 WHERE id = 1', [
      enabled,
      time,
    ]);
  }

  async startRun(): Promise<DreamRun> {
    const run: DreamRun = {
      id: randomUUID(),
      startedAt: new Date().toISOString(),
      status: 'running',
      noted: 0,
      asked: [],
    };
    await this.db.query(
      `INSERT INTO dream_runs (id, started_at, status) VALUES ($1, $2, 'running')`,
      [run.id, run.startedAt],
    );
    return run;
  }

  async finishRun(id: string, outcome: DreamOutcome): Promise<void> {
    await this.db.query(
      `UPDATE dream_runs
         SET status = $2, finished_at = now(), noted = $3, asked = $4, error = $5
       WHERE id = $1`,
      [id, outcome.status, outcome.noted, JSON.stringify(outcome.asked), outcome.error ?? null],
    );
  }

  async run(id: string): Promise<DreamRun | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM dream_runs WHERE id = $1', [id]);
    return row ? toRun(row) : undefined;
  }

  async lastRun(): Promise<DreamRun | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM dream_runs ORDER BY started_at DESC LIMIT 1');
    return row ? toRun(row) : undefined;
  }

  /**
   * Records the Owner's answer about the asked Facts at `indexes`, unless already given.
   * Returns the Run as it was before, so the caller knows which answers are new.
   */
  async answer(
    id: string,
    indexes: readonly number[],
    answer: NonNullable<AskedFact['answer']>,
  ): Promise<{ before: DreamRun; after: DreamRun } | undefined> {
    return transaction(this.db, async (client) => {
      const {
        rows: [row],
      } = await client.query('SELECT * FROM dream_runs WHERE id = $1 FOR UPDATE', [id]);
      if (!row) return undefined;
      const before = toRun(row);
      const asked = before.asked.map((fact, index) =>
        indexes.includes(index) && !fact.answer ? { ...fact, answer } : fact,
      );
      await client.query('UPDATE dream_runs SET asked = $2 WHERE id = $1', [
        id,
        JSON.stringify(asked),
      ]);
      return { before, after: { ...before, asked } };
    });
  }

  async record(entry: JournalEntry): Promise<void> {
    await this.db.query(
      'INSERT INTO dream_journal (at, place, author, tool, text) VALUES ($1, $2, $3, $4, $5)',
      [entry.at, entry.place, entry.author, entry.tool ?? null, entry.text],
    );
  }

  /** The whole Journal, oldest first. */
  async journal(): Promise<StoredEntry[]> {
    const { rows } = await this.db.query('SELECT * FROM dream_journal ORDER BY id');
    return rows.map((row) => ({
      id: Number(row.id),
      at: row.at instanceof Date ? row.at : new Date(String(row.at)),
      place: String(row.place),
      author: String(row.author) as JournalAuthor,
      ...(row.tool !== null && { tool: String(row.tool) }),
      text: String(row.text),
    }));
  }

  async waiting(): Promise<number> {
    const {
      rows: [row],
    } = await this.db.query('SELECT count(*) AS n FROM dream_journal');
    return Number(row?.n ?? 0);
  }

  /** Forgets what a Dream has read: entries up to `lastId`. */
  async forgetJournal(lastId: number): Promise<void> {
    await this.db.query('DELETE FROM dream_journal WHERE id <= $1', [lastId]);
  }

  /** Forgets entries older than `before`, or all of them. */
  async sweepJournal(before?: Date): Promise<void> {
    if (before) await this.db.query('DELETE FROM dream_journal WHERE at < $1', [before]);
    else await this.db.query('DELETE FROM dream_journal');
  }
}

function toRun(row: Record<string, unknown>): DreamRun {
  const iso = (value: unknown) =>
    value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
  return {
    id: String(row.id),
    startedAt: iso(row.started_at),
    ...(row.finished_at !== null && { finishedAt: iso(row.finished_at) }),
    status: String(row.status) as DreamStatus,
    noted: Number(row.noted),
    asked: Array.isArray(row.asked) ? (row.asked as AskedFact[]) : [],
    ...(row.error !== null && { error: String(row.error) }),
  };
}
