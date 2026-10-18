import { createTestDatabase } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_PERSONA } from '../domain/persona.ts';
import { PERSONA_PRESETS } from '../domain/presets.ts';
import { PersonaStore } from './persona-store.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('PersonaStore', () => {
  it('seeds one default persona and preserves the complete edited pair across reinitialization', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    const firstStore = new PersonaStore(fixture.db);
    await firstStore.init();
    expect(await firstStore.get()).toEqual(DEFAULT_PERSONA);

    const edited = {
      name: 'Ada',
      personality: 'Keep answers concise, and challenge weak assumptions with care.',
    };
    expect(await firstStore.save(edited)).toEqual(edited);

    const restartedStore = new PersonaStore(fixture.db);
    await restartedStore.init();
    expect(await restartedStore.get()).toEqual(edited);
    const count = await fixture.db.query('SELECT count(*)::int AS count FROM persona_config');
    expect(count.rows[0]?.count).toBe(1);
  });

  it('keeps preset definitions unchanged when the saved persona is customized', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    const store = new PersonaStore(fixture.db);
    await store.init();
    const before = structuredClone(PERSONA_PRESETS);
    const chosen = PERSONA_PRESETS.find((preset) => preset.id === 'jarvis');
    if (!chosen) throw new Error('The Jarvis preset must be available.');
    await store.save({ name: 'Alfred', personality: chosen.personality });

    expect(await store.get()).toEqual({ name: 'Alfred', personality: chosen.personality });
    expect(PERSONA_PRESETS).toEqual(before);
    expect(Object.keys(await store.get()).sort()).toEqual(['name', 'personality']);
  });
});
