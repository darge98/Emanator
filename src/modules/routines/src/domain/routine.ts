import { slugify } from '@emanator/conversations';
import { isModel, MODELS } from '@emanator/engine';
import { RoutineValidationError } from './errors.ts';
import { type Trigger, validateTrigger } from './trigger.ts';

export { RoutineValidationError };

/** A prompt run whenever one of its Triggers fires (see CONTEXT.md). */
export interface Routine extends RoutineInput {
  id: string;
  /** A Reminder fires once, in the Conversation it was asked for, and goes once delivered. */
  kind: RoutineKind;
  /** The Agent may change or cancel only what it created; the Owner, anything. */
  createdBy: RoutineAuthor;
  /**
   * Where Runs deliver. A Routine's own topic, once the first Run has opened it; a Reminder's
   * Conversation, or none for General.
   */
  conversationId?: string;
  createdAt: Date;
  /** Also the anchor of interval Triggers, so editing a Routine restarts its intervals. */
  updatedAt: Date;
}

export type RoutineKind = 'routine' | 'reminder';
export type RoutineAuthor = 'owner' | 'agent';

/** How far ahead the Agent may set a Reminder. */
export const MAX_REMINDER_DAYS = 366;

/** Reminders waiting to fire at once, so a turn gone wrong can't set them by the hundred. */
export const MAX_PENDING_REMINDERS = 50;

/** What the Owner edits. */
export interface RoutineInput {
  /** Unique, compared by its slug: `Briefing` and `briefing!` are the same name. */
  name: string;
  prompt: string;
  /** Overrides the default model for this Routine's Runs. */
  model?: string;
  enabled: boolean;
  triggers: Trigger[];
}

/** A Run that ends with exactly this reply sends nothing to the Owner. */
export const SILENT_REPLY = '[silent]';

export const MAX_TRIGGERS = 10;

/** Names compare by slug, which also names the Routine's topic. */
export function routineSlug(name: string): string {
  return slugify(name);
}

/** Checks and normalizes what the dashboard sends; throws RoutineValidationError. */
export function validateRoutineInput(input: unknown): RoutineInput {
  if (!input || typeof input !== 'object') throw new RoutineValidationError('Invalid Routine.');
  const value = input as Record<string, unknown>;
  const name = text(value.name, 'name', 100);
  if (!/[\p{L}\p{N}]/u.test(name)) {
    throw new RoutineValidationError('The name must contain at least one letter or digit.');
  }
  const prompt = text(value.prompt, 'prompt', 20_000);
  const model = typeof value.model === 'string' ? value.model.trim() : (value.model ?? '');
  if (model !== '' && !isModel(model)) {
    throw new RoutineValidationError(
      `model must be one of: ${MODELS.map(({ id }) => id).join(', ')}.`,
    );
  }
  if (typeof value.enabled !== 'boolean') {
    throw new RoutineValidationError('enabled must be true or false.');
  }
  if (!Array.isArray(value.triggers) || value.triggers.length === 0) {
    throw new RoutineValidationError('A Routine needs at least one Trigger.');
  }
  if (value.triggers.length > MAX_TRIGGERS) {
    throw new RoutineValidationError(`A Routine has at most ${MAX_TRIGGERS} Triggers.`);
  }
  return {
    name,
    prompt,
    ...(model && { model }),
    enabled: value.enabled,
    triggers: value.triggers.map(validateTrigger),
  };
}

function text(value: unknown, field: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string') throw new RoutineValidationError(`${field} must be text.`);
  const trimmed = value.trim();
  if ((!allowEmpty && !trimmed) || trimmed.length > max) {
    throw new RoutineValidationError(`${field} must contain 1 to ${max} characters.`);
  }
  return trimmed;
}
