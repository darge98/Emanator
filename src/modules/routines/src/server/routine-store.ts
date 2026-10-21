import { randomUUID } from 'node:crypto';
import type { SessionRef } from '@emanator/engine';
import { type Database, runMigrations } from '@emanator/shared/server';
import {
  type Routine,
  type RoutineAuthor,
  type RoutineInput,
  type RoutineKind,
  routineSlug,
} from '../domain/routine.ts';
import type { RoutineRun, RunOrigin, RunStatus } from '../domain/run.ts';
import type { Trigger } from '../domain/trigger.ts';
import { routineMigrations } from './migrations.ts';

/** Another Routine already has a name with the same slug. */
export class RoutineNameTakenError extends Error {
  override name = 'RoutineNameTakenError';
  constructor(readonly routineName: string) {
    super(`A Routine called "${routineName}" already exists.`);
  }
}

/** How a Routine came to be: by default, one of the Owner's, with its own topic. */
export interface RoutineOrigin {
  kind?: RoutineKind;
  createdBy?: RoutineAuthor;
  /** A Reminder's Conversation. */
  conversationId?: string;
}

export interface RunOutcome {
  status: Exclude<RunStatus, 'running' | 'waiting' | 'approval'>;
  session?: SessionRef;
  tools: string[];
  conversationId?: string;
  error?: string;
}

/** Routines are configuration and Runs are runtime state, both in PostgreSQL (ADR 0007). */
export class RoutineStore {
  constructor(private readonly db: Database) {}

  async init(): Promise<void> {
    await runMigrations(this.db, 'routines', routineMigrations);
  }

  async list(): Promise<Routine[]> {
    const { rows } = await this.db.query('SELECT * FROM routines ORDER BY created_at, id');
    return rows.map(toRoutine);
  }

  async get(id: string): Promise<Routine | undefined> {
    const {
      rows: [row],
    } = await this.db.query('SELECT * FROM routines WHERE id = $1', [id]);
    return row ? toRoutine(row) : undefined;
  }

  async create(input: RoutineInput, origin: RoutineOrigin = {}): Promise<Routine> {
    const now = new Date();
    const id = randomUUID();
    const kind = origin.kind ?? 'routine';
    const createdBy = origin.createdBy ?? 'owner';
    await this.write(input, () =>
      this.db.query(
        `INSERT INTO routines (id, name, slug, prompt, model, enabled, triggers, created_at,
           updated_at, kind, created_by, conversation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11)`,
        [id, ...columns(input), now, kind, createdBy, origin.conversationId ?? null],
      ),
    );
    return {
      id,
      ...input,
      kind,
      createdBy,
      ...(origin.conversationId && { conversationId: origin.conversationId }),
      createdAt: now,
      updatedAt: now,
    };
  }

  /** Returns undefined when the Routine doesn't exist. */
  async update(id: string, input: RoutineInput): Promise<Routine | undefined> {
    const { rows } = await this.write(input, () =>
      this.db.query(
        `UPDATE routines SET name = $2, slug = $3, prompt = $4, model = $5, enabled = $6,
           triggers = $7, updated_at = $8
         WHERE id = $1 RETURNING *`,
        [id, ...columns(input), new Date()],
      ),
    );
    return rows[0] ? toRoutine(rows[0]) : undefined;
  }

  /** Deletes the Routine with its Runs and returns it, or undefined if it didn't exist. */
  async delete(id: string): Promise<Routine | undefined> {
    const {
      rows: [row],
    } = await this.db.query('DELETE FROM routines WHERE id = $1 RETURNING *', [id]);
    return row ? toRoutine(row) : undefined;
  }

  /**
   * Deletes a Reminder that has spoken: unless it was moved ahead after `updatedAt`, when it
   * has yet to fire. One edited otherwise would never fire again, so it goes too.
   */
  async deleteSpokenReminder(id: string, updatedAt: Date): Promise<void> {
    await this.db.query(
      `DELETE FROM routines WHERE id = $1 AND kind = 'reminder'
         AND (updated_at = $2 OR (triggers->0->>'at')::timestamptz <= now())`,
      [id, updatedAt],
    );
  }

  /** Links the Routine's own topic; does not count as an edit. */
  async setConversation(id: string, conversationId: string): Promise<void> {
    await this.db.query('UPDATE routines SET conversation_id = $2 WHERE id = $1', [
      id,
      conversationId,
    ]);
  }

  async startRun(routineId: string, origin: RunOrigin): Promise<RoutineRun> {
    const run: RoutineRun = {
      id: randomUUID(),
      routineId,
      origin,
      status: 'running',
      startedAt: new Date(),
      tools: [],
    };
    await this.db.query(
      `INSERT INTO routine_runs (id, routine_id, origin, status, started_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [run.id, routineId, origin, run.status, run.startedAt],
    );
    return run;
  }

  async setRunStatus(id: string, status: 'running' | 'waiting' | 'approval'): Promise<void> {
    await this.db.query('UPDATE routine_runs SET status = $2 WHERE id = $1', [id, status]);
  }

  async finishRun(id: string, outcome: RunOutcome): Promise<void> {
    await this.db.query(
      `UPDATE routine_runs SET status = $2, finished_at = $3, session_engine = $4, session_id = $5,
         tools = $6, conversation_id = $7, error = $8
       WHERE id = $1`,
      [
        id,
        outcome.status,
        new Date(),
        outcome.session?.engine ?? null,
        outcome.session?.id ?? null,
        JSON.stringify(outcome.tools),
        outcome.conversationId ?? null,
        outcome.error ?? null,
      ],
    );
  }

  /** Runs left unfinished by a Harness that stopped mid-Run can never finish. */
  async failInterruptedRuns(): Promise<void> {
    await this.db.query(
      `UPDATE routine_runs SET status = 'failed', finished_at = $1, error = $2
       WHERE status IN ('running', 'waiting', 'approval')`,
      [new Date(), 'The Harness stopped during the Run.'],
    );
  }

  /** The Routine's most recent Runs, newest first. */
  async runs(routineId: string, limit = 50): Promise<RoutineRun[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM routine_runs WHERE routine_id = $1 ORDER BY started_at DESC, id LIMIT $2',
      [routineId, limit],
    );
    return rows.map(toRun);
  }

  private async write<T>(input: RoutineInput, query: () => Promise<T>): Promise<T> {
    try {
      return await query();
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new RoutineNameTakenError(input.name);
      }
      throw error;
    }
  }
}

function columns(input: RoutineInput): unknown[] {
  return [
    input.name,
    routineSlug(input.name),
    input.prompt,
    input.model ?? null,
    input.enabled,
    JSON.stringify(input.triggers),
  ];
}

const date = (value: unknown) => (value instanceof Date ? value : new Date(String(value)));

function toRoutine(row: Record<string, unknown>): Routine {
  return {
    id: String(row.id),
    name: String(row.name),
    prompt: String(row.prompt),
    ...(row.model !== null && { model: String(row.model) }),
    enabled: Boolean(row.enabled),
    triggers: row.triggers as Trigger[],
    kind: String(row.kind) as RoutineKind,
    createdBy: String(row.created_by) as RoutineAuthor,
    ...(row.conversation_id !== null && { conversationId: String(row.conversation_id) }),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function toRun(row: Record<string, unknown>): RoutineRun {
  return {
    id: String(row.id),
    routineId: String(row.routine_id),
    origin: String(row.origin) as RunOrigin,
    status: String(row.status) as RunStatus,
    startedAt: date(row.started_at),
    ...(row.finished_at !== null && { finishedAt: date(row.finished_at) }),
    ...(row.session_id !== null && {
      session: { engine: String(row.session_engine), id: String(row.session_id) },
    }),
    tools: row.tools as string[],
    ...(row.conversation_id !== null && { conversationId: String(row.conversation_id) }),
    ...(row.error !== null && { error: String(row.error) }),
  };
}
