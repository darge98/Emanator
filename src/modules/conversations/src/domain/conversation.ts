import type { SessionRef } from '@emanator/engine';

/** A thread inside a Channel with its own continuous context (see CONTEXT.md). */
export interface Conversation {
  id: string;
  /** Stable name that Routines use to address it, e.g. `general` or `trip-to-japan`. */
  name: string;
  title: string;
  channel: string;
  /** Undefined for the Channel's General thread. */
  threadId?: string;
  /** Engine session to resume; undefined until the first turn or after a reset. */
  session?: SessionRef;
  /** Overrides the default model for this Conversation. */
  model?: string;
  openedBy: OpenedBy;
  createdAt: Date;
  archivedAt?: Date;
}

export type OpenedBy = 'owner' | 'agent' | 'harness';

export const GENERAL_CONVERSATION_NAME = 'general';

/** Reserved for Routine topics: `briefing-routine`. Other Conversations never end with it. */
export const ROUTINE_TOPIC_SUFFIX = '-routine';

/** Turns a title into a stable name: `Viaggio in Giappone` -> `viaggio-in-giappone`. */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || 'topic';
}
