import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { errorMessage } from './errors.ts';
import { consoleLogger, type Logger } from './logger.ts';

/** Shared PostgreSQL connection pool used by runtime feature stores. */
export type Database = Pool;

/** Opens and verifies the Harness state database. */
export async function openDatabase(
  connectionString: string,
  logger: Logger = consoleLogger('database'),
): Promise<Database> {
  const db = new Pool({ connectionString });
  // pg removes the broken idle client before emitting this event. A later query reconnects.
  db.on('error', (error) => {
    logger.error('Idle PostgreSQL connection failed', { error: errorMessage(error) });
  });
  try {
    await db.query('SELECT 1');
    return db;
  } catch (error) {
    await db.end();
    throw error;
  }
}

/** Runs an asynchronous unit of work on one pinned connection. */
export async function transaction<T>(
  db: Database,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export type Row = QueryResultRow;
