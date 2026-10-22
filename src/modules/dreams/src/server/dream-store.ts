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
import type { Proposal, ProposalKind, ProposalStatus } from '../domain/proposal.ts';
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
    } = await this.db.query('SELECT enabled, time, model FROM dream_settings WHERE id = 1');
    if (!row) return DEFAULT_DREAM_SETTINGS;
    return {
      enabled: Boolean(row.enabled),
      time: String(row.time),
      ...(row.model !== null && { model: String(row.model) }),
    };
  }

  async saveSettings({ enabled, time, model }: DreamSettings): Promise<void> {
    await this.db.query(
      'UPDATE dream_settings SET enabled = $1, time = $2, model = $3 WHERE id = 1',
      [enabled, time, model ?? null],
    );
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

  /** All or none: a night's Proposals are asked about together. */
  async addProposals(
    runId: string,
    proposals: readonly { kind: ProposalKind; text: string; reason: string }[],
  ): Promise<Proposal[]> {
    return transaction(this.db, async (client) => {
      const added: Proposal[] = [];
      for (const [position, { kind, text, reason }] of proposals.entries()) {
        const proposal: Proposal = {
          id: randomUUID(),
          runId,
          kind,
          text,
          reason,
          status: 'open',
          createdAt: new Date().toISOString(),
        };
        await client.query(
          `INSERT INTO proposals (id, run_id, kind, text, reason, status, position, created_at)
           VALUES ($1, $2, $3, $4, $5, 'open', $6, $7)`,
          [proposal.id, runId, kind, text, reason, position, proposal.createdAt],
        );
        added.push(proposal);
      }
      return added;
    });
  }

  /** The newest Proposals first. */
  async proposals(limit = 50): Promise<Proposal[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM proposals ORDER BY created_at DESC, position LIMIT $1',
      [limit],
    );
    return rows.map(toProposal);
  }

  /** Those the Retrospective must not make again: all but the rejected ones gone stale. */
  async standingProposals(rejectedSince: Date): Promise<Proposal[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM proposals WHERE status <> 'rejected' OR decided_at >= $1
       ORDER BY created_at DESC LIMIT 100`,
      [rejectedSince],
    );
    return rows.map(toProposal);
  }

  async proposalsOfRun(runId: string): Promise<Proposal[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM proposals WHERE run_id = $1 ORDER BY position',
      [runId],
    );
    return rows.map(toProposal);
  }

  /** Records the Owner's answer once; undefined when it is unknown or answered already. */
  async decideProposal(
    id: string,
    status: Exclude<ProposalStatus, 'open'>,
  ): Promise<Proposal | undefined> {
    const {
      rows: [row],
    } = await this.db.query(
      `UPDATE proposals SET status = $2, decided_at = now()
       WHERE id = $1 AND status = 'open' RETURNING *`,
      [id, status],
    );
    return row ? toProposal(row) : undefined;
  }

  /** Undoes an acceptance that could not be carried out. */
  async reopenProposal(id: string): Promise<void> {
    await this.db.query("UPDATE proposals SET status = 'open', decided_at = NULL WHERE id = $1", [
      id,
    ]);
  }

  async proposal(id: string): Promise<Proposal | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM proposals WHERE id = $1', [id]);
    return row ? toProposal(row) : undefined;
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

function toProposal(row: Record<string, unknown>): Proposal {
  const iso = (value: unknown) =>
    value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
  return {
    id: String(row.id),
    runId: String(row.run_id),
    kind: String(row.kind) as ProposalKind,
    text: String(row.text),
    reason: String(row.reason),
    status: String(row.status) as ProposalStatus,
    createdAt: iso(row.created_at),
    ...(row.decided_at !== null && { decidedAt: iso(row.decided_at) }),
  };
}
