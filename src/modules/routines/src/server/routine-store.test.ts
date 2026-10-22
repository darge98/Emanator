import { createTestDatabase, runMigrations } from '@emanator/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { routineMigrations } from './migrations.ts';
import { RoutineNameTakenError, RoutineStore } from './routine-store.ts';

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

  it('brings Routines saved before Reminders along, and frees Reminder names', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    await runMigrations(fixture.db, 'routines', routineMigrations.slice(0, 2));
    await fixture.db.query(
      `INSERT INTO routines (id, name, slug, prompt, model, enabled, triggers, created_at, updated_at)
       VALUES ('old', 'Briefing', 'briefing', 'Riassumi.', 'claude-sonnet-4-5', true, '[]', now(), now())`,
    );
    const store = new RoutineStore(fixture.db);
    await store.init();

    const old = await store.get('old');
    expect(old).toMatchObject({ kind: 'routine', createdBy: 'owner' });
    expect(old).not.toHaveProperty('model');
    const input = { name: 'Briefing', prompt: 'Ricorda.', enabled: true, triggers: [] };
    await expect(store.create(input)).rejects.toThrow(RoutineNameTakenError);
    await store.create(input, { kind: 'reminder', createdBy: 'agent' });
    await store.create(input, { kind: 'reminder', createdBy: 'agent' });
    expect(await store.list()).toHaveLength(3);
  });

  it('lists for the Retrospective the Runs that failed, with their Routine', async () => {
    const fixture = await createTestDatabase();
    cleanups.push(fixture.close);
    const store = new RoutineStore(fixture.db);
    await store.init();
    const routine = await store.create({
      name: 'Briefing',
      prompt: 'P.',
      enabled: true,
      triggers: [],
    });
    const failed = await store.startRun(routine.id, 'schedule');
    await store.finishRun(failed.id, { status: 'failed', tools: [], error: 'Quota' });
    const ok = await store.startRun(routine.id, 'schedule');
    await store.finishRun(ok.id, { status: 'delivered', tools: [] });

    expect(await store.failedRuns(new Date(Date.now() - 60_000))).toMatchObject([
      { routineName: 'Briefing', error: 'Quota' },
    ]);
  });
});
