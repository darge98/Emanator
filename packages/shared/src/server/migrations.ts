import { type Database, transaction } from './sqlite.ts';

/** One schema change owned by a feature. Ids are applied in array order and must never change. */
export interface Migration {
  id: string;
  sql: string;
}

/**
 * Applies a feature's pending migrations, each in its own transaction.
 * Every feature owns its tables (ADR 0005), so migrations are tracked per feature.
 */
export function runMigrations(db: Database, feature: string, migrations: readonly Migration[]) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      feature TEXT NOT NULL,
      id TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      PRIMARY KEY (feature, id)
    )
  `);

  const applied = new Set(
    db
      .prepare('SELECT id FROM _migrations WHERE feature = ?')
      .all(feature)
      .map((row) => String(row.id)),
  );
  const record = db.prepare('INSERT INTO _migrations (feature, id, applied_at) VALUES (?, ?, ?)');

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    transaction(db, () => {
      db.exec(migration.sql);
      record.run(feature, migration.id, new Date().toISOString());
    });
  }
}
