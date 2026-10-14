import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrations.ts';
import { openDatabase } from './sqlite.ts';

const tables = (db: ReturnType<typeof openDatabase>) =>
  db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\'",
    )
    .all()
    .map((row) => row.name);

describe('runMigrations', () => {
  it('applies pending migrations once', () => {
    const db = openDatabase(':memory:');
    const migrations = [{ id: '001-notes', sql: 'CREATE TABLE notes (id TEXT)' }];

    runMigrations(db, 'notes', migrations);
    runMigrations(db, 'notes', migrations);

    expect(tables(db)).toEqual(['notes']);
  });

  it('applies only the migrations added since the last run', () => {
    const db = openDatabase(':memory:');
    runMigrations(db, 'notes', [{ id: '001', sql: 'CREATE TABLE notes (id TEXT)' }]);

    runMigrations(db, 'notes', [
      { id: '001', sql: 'CREATE TABLE notes (id TEXT)' },
      { id: '002', sql: 'ALTER TABLE notes ADD COLUMN body TEXT' },
    ]);

    const columns = db.prepare('PRAGMA table_info(notes)').all();
    expect(columns.map((column) => column.name)).toEqual(['id', 'body']);
  });

  it('tracks features separately even when ids collide', () => {
    const db = openDatabase(':memory:');

    runMigrations(db, 'notes', [{ id: '001', sql: 'CREATE TABLE notes (id TEXT)' }]);
    runMigrations(db, 'tasks', [{ id: '001', sql: 'CREATE TABLE tasks (id TEXT)' }]);

    expect(tables(db)).toEqual(['notes', 'tasks']);
  });

  it('rolls back a failing migration and leaves it pending', () => {
    const db = openDatabase(':memory:');
    const broken = {
      id: '001',
      sql: 'CREATE TABLE notes (id TEXT); INSERT INTO missing VALUES (1);',
    };

    expect(() => runMigrations(db, 'notes', [broken])).toThrow();
    expect(tables(db)).toEqual([]);

    runMigrations(db, 'notes', [{ id: '001', sql: 'CREATE TABLE notes (id TEXT)' }]);
    expect(tables(db)).toEqual(['notes']);
  });
});
