import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { Database } from './database.ts';

/** Creates a private PostgreSQL schema for an integration test. Requires TEST_DATABASE_URL. */
export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString)
    throw new Error('TEST_DATABASE_URL is required for database integration tests');
  const schema = `test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
  } catch (error) {
    await admin.end();
    throw error;
  }
  const db = new Pool({ connectionString, options: `-c search_path=${schema}` });
  return {
    db,
    close: async () => {
      await db.end();
      try {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    },
  };
}
