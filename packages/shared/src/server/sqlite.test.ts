import { describe, expect, it } from 'vitest';
import { openDatabase, transaction } from './sqlite.ts';

function database() {
  const db = openDatabase(':memory:');
  db.exec('CREATE TABLE notes (body TEXT)');
  return db;
}

const count = (db: ReturnType<typeof database>) =>
  Number(db.prepare('SELECT count(*) AS n FROM notes').get()?.n);

describe('transaction', () => {
  it('commits the work and returns its result', () => {
    const db = database();

    const result = transaction(db, () => {
      db.prepare('INSERT INTO notes VALUES (?)').run('uno');
      return 'done';
    });

    expect(result).toBe('done');
    expect(count(db)).toBe(1);
  });

  it('rolls everything back when the work throws', () => {
    const db = database();

    expect(() =>
      transaction(db, () => {
        db.prepare('INSERT INTO notes VALUES (?)').run('uno');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(count(db)).toBe(0);
  });

  it('refuses async work and rolls back what it wrote before its first await', () => {
    const db = database();

    expect(() =>
      // @ts-expect-error async work is rejected at compile time too
      transaction(db, async () => {
        db.prepare('INSERT INTO notes VALUES (?)').run('prima');
        await Promise.resolve();
      }),
    ).toThrow('transaction work must be synchronous');
    expect(count(db)).toBe(0);
  });
});
