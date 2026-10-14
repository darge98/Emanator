import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Database = DatabaseSync;

/** Opens the Harness state database (ADR 0003). Pass `:memory:` in tests. */
export function openDatabase(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/**
 * Runs `work` inside a transaction, rolling back if it throws.
 *
 * `work` must be synchronous, like `node:sqlite` itself. An async function would return at
 * its first `await`: the transaction would commit early, and the writes after the `await`
 * would run outside it, with no rollback if they fail. That is refused at compile time and,
 * as a last resort, at run time.
 */
export function transaction<T>(
  db: Database,
  work: () => T extends PromiseLike<unknown> ? never : T,
): T {
  db.exec('BEGIN');
  try {
    const result = work();
    if (isThenable(result)) {
      // The rest of the async work still runs on its own; keep its failure from going unhandled.
      Promise.resolve(result).catch(() => {});
      throw new Error('transaction work must be synchronous');
    }
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}
