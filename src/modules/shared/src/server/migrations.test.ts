import { afterEach, describe, expect, it } from 'vitest';
import type { Database } from './database.ts';
import { transaction } from './database.ts';
import { runMigrations } from './migrations.ts';
import { createTestDatabase } from './testing.ts';

const fixtures: Array<{ db: Database; close: () => Promise<void> }> = [];
async function database() {
  const fixture = await createTestDatabase();
  fixtures.push(fixture);
  return fixture.db;
}
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(({ close }) => close()));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('runMigrations', () => {
  it('applies each migration once and tracks it by feature', async () => {
    const db = await database();
    const migrations = [{ id: '001', sql: 'CREATE TABLE notes (body TEXT)' }];
    await runMigrations(db, 'notes', migrations);
    await runMigrations(db, 'notes', migrations);
    const result = await db.query(
      "SELECT count(*)::int AS n FROM _migrations WHERE feature = 'notes'",
    );
    expect(result.rows[0]?.n).toBe(1);
    await expect(db.query('SELECT * FROM notes')).resolves.toBeDefined();
  });

  it('serializes concurrent migration attempts across features', async () => {
    const db = await database();
    const notes = [{ id: '001', sql: 'CREATE TABLE notes (body TEXT)' }];
    const tasks = [{ id: '001', sql: 'CREATE TABLE tasks (body TEXT)' }];
    await Promise.all([runMigrations(db, 'notes', notes), runMigrations(db, 'tasks', tasks)]);
    const result = await db.query('SELECT count(*)::int AS n FROM _migrations');
    expect(result.rows[0]?.n).toBe(2);
    await expect(db.query('SELECT * FROM notes')).resolves.toBeDefined();
    await expect(db.query('SELECT * FROM tasks')).resolves.toBeDefined();
  });

  it('rolls back a broken migration and leaves it unapplied', async () => {
    const db = await database();
    await expect(
      runMigrations(db, 'notes', [{ id: '001', sql: 'CREATE TABLE notes (id TEXT); INVALID SQL' }]),
    ).rejects.toThrow();
    const result = await db.query("SELECT to_regclass('notes') AS notes");
    expect(result.rows[0]?.notes).toBeNull();
    await runMigrations(db, 'notes', [{ id: '001', sql: 'CREATE TABLE notes (id TEXT)' }]);
    const applied = await db.query(
      "SELECT count(*)::int AS n FROM _migrations WHERE feature = 'notes' AND id = '001'",
    );
    expect(applied.rows[0]?.n).toBe(1);
    await expect(db.query('SELECT * FROM notes')).resolves.toBeDefined();
  });

  it('keeps asynchronous work inside the transaction and rolls it back on rejection', async () => {
    const db = await database();
    await db.query('CREATE TABLE notes (body TEXT)');
    await expect(
      transaction(db, async (client) => {
        await client.query('INSERT INTO notes VALUES ($1)', ['before failure']);
        await Promise.resolve();
        throw new Error('work failed');
      }),
    ).rejects.toThrow('work failed');
    const result = await db.query('SELECT count(*)::int AS n FROM notes');
    expect(result.rows[0]?.n).toBe(0);
  });
});
