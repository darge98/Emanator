import { createTestDatabase, runMigrations } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { telegramMigrations } from './migrations.ts';
import { TelegramPairing } from './pairing.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});
async function pairing() {
  const fixture = await createTestDatabase();
  cleanups.push(fixture.close);
  const db = fixture.db;
  await runMigrations(db, 'channels.telegram', telegramMigrations);
  const instance = new TelegramPairing(db);
  await instance.init();
  return { db, instance };
}
const owner = { userId: 100, chatId: 100 };

describe.skipIf(!process.env.TEST_DATABASE_URL)('TelegramPairing', () => {
  it('offers a one-time code while nobody is paired', async () => {
    const { instance } = await pairing();
    expect(await instance.owner()).toBeUndefined();
    expect(instance.pendingCode()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });
  it('pairs the sender of the right code, ignoring case and spaces', async () => {
    const { instance } = await pairing();
    const code = instance.pendingCode() as string;
    expect(await instance.pair(`  ${code.toLowerCase()} `, owner)).toBe(true);
    expect(await instance.owner()).toEqual(owner);
    expect(instance.pendingCode()).toBeUndefined();
  });
  it('refuses a wrong code and prevents a second pairing', async () => {
    const { instance } = await pairing();
    expect(await instance.pair('WRONG123', owner)).toBe(false);
    const code = instance.pendingCode() as string;
    expect(await instance.pair(code, owner)).toBe(true);
    expect(await instance.pair(code, { userId: 200, chatId: 200 })).toBe(false);
    expect(await instance.owner()).toEqual(owner);
  });
});
