import { openDatabase, runMigrations } from '@emanator/shared/server';
import { describe, expect, it } from 'vitest';
import { telegramMigrations } from './migrations.ts';
import { TelegramPairing } from './pairing.ts';

function database() {
  const db = openDatabase(':memory:');
  runMigrations(db, 'channels.telegram', telegramMigrations);
  return db;
}

const owner = { userId: 100, chatId: 100 };

describe('TelegramPairing', () => {
  it('offers a one-time code while nobody is paired', () => {
    const pairing = new TelegramPairing(database());

    expect(pairing.owner()).toBeUndefined();
    expect(pairing.pendingCode()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });

  it('pairs the sender of the right code, ignoring case and spaces', () => {
    const pairing = new TelegramPairing(database());
    const code = pairing.pendingCode() as string;

    expect(pairing.pair(`  ${code.toLowerCase()} `, owner)).toBe(true);
    expect(pairing.owner()).toEqual(owner);
    expect(pairing.pendingCode()).toBeUndefined();
  });

  it('refuses a wrong code', () => {
    const pairing = new TelegramPairing(database());

    expect(pairing.pair('WRONG123', owner)).toBe(false);
    expect(pairing.owner()).toBeUndefined();
  });

  it('cannot be paired twice', () => {
    const db = database();
    const pairing = new TelegramPairing(db);
    pairing.pair(pairing.pendingCode() as string, owner);

    expect(pairing.pair('ANYTHING', { userId: 200, chatId: 200 })).toBe(false);
    expect(new TelegramPairing(db).owner()).toEqual(owner);
  });

  it('issues a new code at every start', () => {
    const db = database();

    expect(new TelegramPairing(db).pendingCode()).not.toBe(new TelegramPairing(db).pendingCode());
  });
});
