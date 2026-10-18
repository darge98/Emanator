import { createTestDatabase } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { RoutineStore } from './routine-store.ts';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

describe.skipIf(!process.env.TEST_DATABASE_URL)('RoutineStore', () => {
  it('fails the Runs a stopped Harness left unfinished, whatever they waited for', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    const store = new RoutineStore(fixture.db);
    await store.init();
    const routine = await store.create({
      name: 'briefing',
      prompt: 'Riassumi la giornata.',
      enabled: true,
      triggers: [],
    });
    const running = await store.startRun(routine.id, 'manual');
    const quota = await store.startRun(routine.id, 'manual');
    await store.setRunStatus(quota.id, 'waiting');
    const approval = await store.startRun(routine.id, 'manual');
    await store.setRunStatus(approval.id, 'approval');

    await store.failInterruptedRuns();

    const runs = await store.runs(routine.id);
    expect(runs.map(({ id, status }) => ({ id, status }))).toEqual(
      expect.arrayContaining([
        { id: running.id, status: 'failed' },
        { id: quota.id, status: 'failed' },
        { id: approval.id, status: 'failed' },
      ]),
    );
  });
});
