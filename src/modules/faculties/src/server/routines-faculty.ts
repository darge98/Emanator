import { defineTool, MODELS, type ToolOutput } from '@emanator/engine';
import { RoutineValidationError, type Trigger } from '@emanator/routines';
import { RoutineNameTakenError, type RoutineService } from '@emanator/routines/server';
import { z } from 'zod';
import type { Faculty, HarnessFacultyTool } from '../domain/faculty.ts';
import * as say from './messages.ts';

/** What the Routines Faculty needs from the Routines feature. */
export type RoutineKeeper = Pick<
  RoutineService,
  'list' | 'remind' | 'updateReminder' | 'createByAgent' | 'cancelByAgent'
>;

/** One turn as the Routines Faculty sees it. */
export interface RoutinesTurn {
  /** The Conversation a Reminder set now speaks in; undefined for General, e.g. in a Run. */
  conversationId?: string;
  /** A Reminder's Run sets or moves nothing, or a Reminder could keep setting itself again. */
  reminderRun?: boolean;
}

const AT = z
  .string()
  .describe('ISO 8601 date and time with its offset, e.g. 2026-10-22T09:00:00+02:00');

/**
 * Reminders the Agent sets freely, and recurring Routines it creates with the Owner's leave.
 * It changes only what it created.
 */
export function routinesFaculty(
  routines: RoutineKeeper,
  timeZone: string,
  turn: RoutinesTurn = {},
): Faculty {
  const local = localTime(timeZone);
  return {
    kind: 'faculty',
    name: 'routines',
    title: 'Routines',
    description: 'Reminders the Agent sets, and Routines it creates when you allow it.',
    tools: [
      // Moving one counts as setting it: two Reminders could keep moving each other ahead.
      ...(turn.reminderRun ? [] : [remindTool(routines, turn, local)]),
      ...(turn.reminderRun ? [] : [updateReminderTool(routines, local)]),
      cancelTool(routines, 'reminder'),
      ...(turn.reminderRun ? [] : [createRoutineTool(routines, local)]),
      listRoutinesTool(routines, local),
      cancelTool(routines, 'routine'),
    ],
  };
}

type Local = (date: Date) => string;

/** Times as the Owner reads them, so the Agent repeats them right. */
const localTime =
  (timeZone: string): Local =>
  (date) =>
    `${date.toLocaleString('sv-SE', { timeZone }).slice(0, 16)} (${timeZone})`;

function remindTool(
  routines: RoutineKeeper,
  { conversationId }: RoutinesTurn,
  local: Local,
): HarnessFacultyTool {
  return {
    title: 'Set a Reminder',
    defaultPolicy: 'allow',
    ...defineTool({
      name: 'remind',
      description:
        "Sets a Reminder: at the given time you are woken in a fresh session with `prompt` and your answer reaches the Owner in this Conversation. Use it when the Owner asks to be reminded, or for something to do once later (e.g. check whether a train is late). Write `prompt` as your own note, in Italian, with all the context you will need then: you won't remember this Conversation. For something recurring, use create_routine.",
      input: {
        title: z.string().trim().min(1).max(60).describe('A short name, e.g. "Chiama Marco"'),
        at: AT,
        prompt: z.string().trim().min(1).max(4000).describe('What to do or say at that time'),
      },
      hints: { readOnly: false },
      run: ({ title, at, prompt }) =>
        attempt(async () => {
          const reminder = await routines.remind({ title, at, prompt }, conversationId);
          return { text: `Reminder set (id ${reminder.id}), for ${local(new Date(at))}.` };
        }),
    }),
  };
}

function updateReminderTool(routines: RoutineKeeper, local: Local): HarnessFacultyTool {
  return {
    title: 'Change a Reminder',
    defaultPolicy: 'allow',
    ...defineTool({
      name: 'update_reminder',
      description:
        'Moves or rewrites a Reminder you set and that has not fired yet. Find its id with list_routines.',
      input: {
        id: z.string().describe('The Reminder id'),
        title: z.string().trim().min(1).max(60).optional(),
        at: AT.optional(),
        prompt: z.string().trim().min(1).max(4000).optional(),
      },
      hints: { readOnly: false },
      run: ({ id, ...changes }) =>
        attempt(async () => {
          const reminder = await routines.updateReminder(id, definedOnly(changes));
          const when = reminder.nextRunAt ? local(reminder.nextRunAt) : 'no time';
          return { text: `Reminder ${reminder.id} updated, for ${when}.` };
        }),
    }),
  };
}

const TRIGGER = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('cron'),
    expression: z
      .string()
      .max(100)
      .describe("Five fields, minute hour day month weekday, in the Owner's time zone"),
  }),
  z.object({ type: z.literal('interval'), every_minutes: z.number().int().min(1) }),
]);

function createRoutineTool(routines: RoutineKeeper, local: Local): HarnessFacultyTool {
  return {
    title: 'Create a Routine',
    // Recurring work keeps acting long after the turn: the Owner says yes first, unless they
    // chose to allow it, and even then in a turn that read outside content.
    defaultPolicy: 'ask',
    approval: {
      whenTainted: true,
      message: (input) => say.askToCreateRoutine(input),
    },
    ...defineTool({
      name: 'create_routine',
      description:
        'Creates a recurring Routine: its prompt runs in a fresh session at each Trigger, and its answers reach the Owner in a Telegram topic of its own. Only for something the Owner wants repeated; for something that happens once, use remind. Write the prompt as the goal of every run, in Italian, with all the context needed. To change a Routine you created, cancel it and create it again.',
      input: {
        name: z.string().trim().min(1).max(100).describe('Unique name, e.g. "Briefing mattutino"'),
        // Short enough for the whole Routine to fit in the Approval's Telegram message.
        prompt: z.string().trim().min(1).max(3000).describe('The goal of every run'),
        triggers: z.array(TRIGGER).min(1).max(5),
        model: z
          .enum(MODELS.map(({ id }) => id) as [string, ...string[]])
          .optional()
          .describe('Only when the Owner asks for one; the default model otherwise'),
      },
      hints: { readOnly: false },
      run: ({ name, prompt, triggers, model }) =>
        attempt(async () => {
          const routine = await routines.createByAgent({
            name,
            prompt,
            enabled: true,
            triggers: triggers.map(toTrigger),
            ...(model && { model }),
          });
          const next = routine.nextRunAt ? `, first run at ${local(routine.nextRunAt)}` : '';
          return { text: `Routine "${routine.name}" created (id ${routine.id})${next}.` };
        }),
    }),
  };
}

function listRoutinesTool(routines: RoutineKeeper, local: Local): HarnessFacultyTool {
  return {
    title: 'List Routines',
    defaultPolicy: 'allow',
    ...defineTool({
      name: 'list_routines',
      description:
        'Lists the Routines and the Reminders still to fire, with their ids, who created them, their Triggers and their next run.',
      input: {},
      hints: { readOnly: true },
      run: async () => {
        const all = await routines.list();
        if (all.length === 0) return { text: 'There are no Routines nor Reminders.' };
        return {
          text: all
            .map((routine) =>
              [
                `- ${routine.kind === 'reminder' ? 'Reminder' : 'Routine'} "${routine.name}" (id ${routine.id})`,
                `by the ${routine.createdBy === 'agent' ? 'Agent' : 'Owner'}`,
                routine.enabled ? 'active' : 'paused',
                routine.nextRunAt ? `next ${local(routine.nextRunAt)}` : 'no next run',
                routine.triggers.map(describeTrigger).join(', '),
                `prompt: ${clip(routine.prompt)}`,
              ].join(' · '),
            )
            .join('\n'),
        };
      },
    }),
  };
}

function cancelTool(routines: RoutineKeeper, kind: 'reminder' | 'routine'): HarnessFacultyTool {
  const reminder = kind === 'reminder';
  return {
    title: reminder ? 'Cancel a Reminder' : 'Cancel a Routine',
    defaultPolicy: 'allow',
    // A Routine the Owner approved is theirs too: outside content can't take it away unasked.
    ...(!reminder && {
      approval: {
        whenTainted: true,
        message: async ({ id }) => {
          const routine = (await routines.list()).find((r) => r.id === id);
          return say.askToCancelRoutine(routine?.name ?? String(id));
        },
      },
    }),
    ...defineTool({
      name: reminder ? 'cancel_reminder' : 'cancel_routine',
      description: reminder
        ? 'Cancels a Reminder you set that has not fired yet.'
        : "Cancels a recurring Routine you created. The Owner's own Routines can be changed only by them, from the dashboard.",
      input: { id: z.string().describe('Its id, from list_routines') },
      hints: { readOnly: false, destructive: true },
      run: ({ id }) =>
        attempt(async () => {
          const routine = await routines.cancelByAgent(id, kind);
          return { text: `Cancelled "${routine.name}".` };
        }),
    }),
  };
}

type TriggerInput = z.infer<typeof TRIGGER>;

const toTrigger = (trigger: TriggerInput): Trigger =>
  trigger.type === 'cron'
    ? { type: 'cron', expression: trigger.expression }
    : { type: 'interval', everyMinutes: trigger.every_minutes };

export function describeTrigger(trigger: Trigger): string {
  switch (trigger.type) {
    case 'once':
      return `once at ${trigger.at}`;
    case 'interval':
      return `every ${trigger.everyMinutes} minutes`;
    case 'cron':
      return `cron "${trigger.expression}"`;
  }
}

const clip = (text: string, max = 300) =>
  text.length > max ? `${text.slice(0, max).replace(/\s+/g, ' ')}…` : text.replace(/\s+/g, ' ');

/** Zod gives absent optional keys as undefined; the service wants them left out. */
function definedOnly<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** What the Agent got wrong becomes an error it can read and fix. */
async function attempt(write: () => Promise<ToolOutput>): Promise<ToolOutput> {
  try {
    return await write();
  } catch (error) {
    if (error instanceof RoutineValidationError || error instanceof RoutineNameTakenError) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}
