import type { ToolOutput } from '@emanator/engine';
import { RoutineValidationError } from '@emanator/routines';
import type { RoutineView } from '@emanator/routines/server';
import { describe, expect, it, vi } from 'vitest';
import type { HarnessFacultyTool } from '../domain/faculty.ts';
import { type RoutinesTurn, routinesFaculty } from './routines-faculty.ts';

const view = (overrides: Partial<RoutineView> = {}): RoutineView => ({
  id: 'r1',
  name: 'Chiama Marco',
  prompt: 'Ricorda di chiamare Marco.',
  enabled: true,
  triggers: [{ type: 'once', at: '2026-10-22T09:00:00+02:00' }],
  kind: 'reminder',
  createdBy: 'agent',
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

function setup(turn: RoutinesTurn = {}) {
  const routines = {
    list: vi.fn(async () => [
      view(),
      view({
        id: 'r2',
        name: 'Briefing',
        kind: 'routine',
        createdBy: 'owner',
        triggers: [{ type: 'cron', expression: '0 8 * * *' }],
      }),
    ]),
    remind: vi.fn(async () => view({ nextRunAt: new Date('2026-10-22T07:00:00Z') })),
    updateReminder: vi.fn(async () => view()),
    createByAgent: vi.fn(async () => {
      throw new RoutineValidationError('A Routine called "Briefing" already exists.');
    }),
    cancelByAgent: vi.fn(async () => view()),
  };
  const faculty = routinesFaculty(routines, () => 'Europe/Rome', turn);
  const run = (name: string, input: Record<string, unknown>) => {
    const tool = faculty.tools.find((t) => t.name === name) as HarnessFacultyTool;
    return (tool.run as (input: Record<string, unknown>) => Promise<ToolOutput>)(input);
  };
  return { routines, faculty, run };
}

describe('Routines Faculty', () => {
  it('sets a Reminder in the turn’s Conversation', async () => {
    const { routines, run } = setup({ conversationId: 'c1' });
    const at = '2026-10-22T09:00:00+02:00';

    const output = await run('remind', { title: 'Chiama Marco', at, prompt: 'Chiama.' });

    expect(routines.remind).toHaveBeenCalledWith(
      { title: 'Chiama Marco', at, prompt: 'Chiama.' },
      'c1',
    );
    expect(output.text).toBe('Reminder set (id r1), for 2026-10-22 09:00 (Europe/Rome).');
  });

  it("gives a Reminder's Run nothing to schedule with, so a Reminder can't set itself again", () => {
    const names = setup({ reminderRun: true }).faculty.tools.map(({ name }) => name);

    expect(names).not.toContain('remind');
    expect(names).not.toContain('update_reminder');
    expect(names).not.toContain('create_routine');
    expect(names).toContain('cancel_reminder');
  });

  it('asks before cancelling a recurring Routine in a tainted turn, naming it', async () => {
    const { faculty, routines, run } = setup();
    const cancel = faculty.tools.find((t) => t.name === 'cancel_routine');

    expect(cancel?.approval?.whenTainted).toBe(true);
    expect(await cancel?.approval?.message?.({ id: 'r2' })).toContain('**Briefing**');
    expect(faculty.tools.find((t) => t.name === 'cancel_reminder')?.approval).toBeUndefined();
    await run('cancel_reminder', { id: 'r1' });
    expect(routines.cancelByAgent).toHaveBeenCalledWith('r1', 'reminder');
  });

  it('turns what the Agent got wrong into an error it can read', async () => {
    const { run } = setup();

    const output = await run('create_routine', {
      name: 'Briefing',
      prompt: 'Riassumi.',
      triggers: [{ type: 'cron', expression: '0 8 * * *' }],
    });

    expect(output).toEqual({ text: 'A Routine called "Briefing" already exists.', isError: true });
  });

  it('lists who created what', async () => {
    const { run } = setup();

    const { text } = await run('list_routines', {});

    expect(text).toContain('Reminder "Chiama Marco" (id r1) · by the Agent');
    expect(text).toContain('Routine "Briefing" (id r2) · by the Owner · active');
    expect(text).toContain('cron "0 8 * * *"');
  });

  it('asks before creating a Routine, also when allowed in a tainted turn, showing all of it', () => {
    const { faculty } = setup();
    const create = faculty.tools.find((t) => t.name === 'create_routine');

    expect(create?.defaultPolicy).toBe('ask');
    expect(create?.approval?.whenTainted).toBe(true);
    const message = create?.approval?.message?.({
      name: 'Briefing',
      prompt: 'Riassumi\nla giornata.',
      triggers: [
        { type: 'cron', expression: '0 8 * * 1-5' },
        { type: 'interval', every_minutes: 30 },
      ],
    });
    expect(message).toContain('**Briefing**');
    expect(message).toContain('> Riassumi la giornata.');
    expect(message).toContain('cron `0 8 * * 1-5`');
    expect(message).toContain('ogni 30 minuti');
  });

  it("fits the largest Routine's Approval in one Telegram message", () => {
    const create = setup().faculty.tools.find((t) => t.name === 'create_routine');
    const message = create?.approval?.message?.({
      name: 'n'.repeat(100),
      prompt: 'p'.repeat(3000),
      triggers: Array(5).fill({ type: 'cron', expression: 'c'.repeat(100) }),
      model: 'sonnet',
    }) as string;

    expect(message.length).toBeLessThan(4096);
  });
});
