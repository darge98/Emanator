import { createTestDatabase } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { ModelSettings, ModelSettingsError } from './model-settings.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('ModelSettings', () => {
  it('starts from the initial model, then keeps what the Owner saves across restarts', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    const first = new ModelSettings(fixture.db, 'haiku');
    await first.init();
    expect(first.defaultModel()).toBe('haiku');

    expect(await first.setDefaultModel('opus')).toBe('opus');
    expect(first.defaultModel()).toBe('opus');
    await expect(first.setDefaultModel('gpt-5')).rejects.toThrow(ModelSettingsError);

    const restarted = new ModelSettings(fixture.db, 'sonnet');
    await restarted.init();
    expect(restarted.defaultModel()).toBe('opus');
  });
});
