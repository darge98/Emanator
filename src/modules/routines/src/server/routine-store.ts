import { randomUUID } from 'node:crypto';
import type { SessionRef } from '@emanator/engine';
import { type Database, runMigrations } from '@emanator/shared/server';
import { type Routine, type RoutineInput, routineSlug } from '../domain/routine.ts';
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

export interface RunOutcome {
  status: Exclude<RunStatus, 'running' | 'waiting'>;
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

  async create(input: RoutineInput): Promise<Routine> {
    const now = new Date();
    const id = randomUUID();
    await this.write(input, () =>
      this.db.query(
        `INSERT INTO routines (id, name, slug, prompt, model, dedicated_topic, enabled, triggers, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
        [id, ...columns(input), now],
      ),
    );
    return { id, ...input, createdAt: now, updatedAt: now };
  }

  /** Returns undefined when the Routine doesn't exist. */
  async update(id: string, input: RoutineInput): Promise<Routine | undefined> {
    const { rows } = await this.write(input, () =>
      this.db.query(
        `UPDATE routines SET name = $2, slug = $3, prompt = $4, model = $5, dedicated_topic = $6,
           enabled = $7, triggers = $8, updated_at = $9
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

  async setRunStatus(id: string, status: 'running' | 'waiting'): Promise<void> {
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
       WHERE status IN ('running', 'waiting')`,
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
    input.dedicatedTopic,
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
    dedicatedTopic: Boolean(row.dedicated_topic),
    enabled: Boolean(row.enabled),
    triggers: row.triggers as Trigger[],
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
