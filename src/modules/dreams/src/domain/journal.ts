/** Who an entry of the Journal is from: the Owner, the Agent, or a Capability's Tool. */
export type JournalAuthor = 'owner' | 'agent' | 'tool';

/** One thing said or read during the day, kept for the Dream (see CONTEXT.md). */
export interface JournalEntry {
  at: Date;
  /** Where it happened: a Conversation's title, or a Routine's. */
  place: string;
  author: JournalAuthor;
  /** The Capability Tool that returned it, for `tool` entries. */
  tool?: string;
  text: string;
}
