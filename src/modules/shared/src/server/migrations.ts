import { type Database, transaction } from './database.ts';

/** One schema change owned by a feature. Ids are applied in array order and must never change. */
export interface Migration {
  id: string;
  sql: string;
}

/**
 * Applies a feature's pending migrations, each in its own transaction.
 * Every feature owns its tables (ADR 0005), so migrations are tracked per feature.
 */
export async function runMigrations(
  db: Database,
  feature: string,
  migrations: readonly Migration[],
): Promise<void> {
  for (const migration of migrations) {
    await transaction(db, async (client) => {
      // Serialize creation of the shared ledger and feature migrations per schema.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended(current_schema() || ':emanator:migrations', 0))",
      );
      await client.query(`
        CREATE TABLE IF NOT EXISTS _migrations (
          feature TEXT NOT NULL,
          id TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (feature, id)
        )
      `);
      const current = await client.query(
        'SELECT 1 FROM _migrations WHERE feature = $1 AND id = $2',
        [feature, migration.id],
      );
      if (current.rowCount) return;
      await client.query(migration.sql);
      await client.query('INSERT INTO _migrations (feature, id) VALUES ($1, $2)', [
        feature,
        migration.id,
      ]);
    });
  }
}
