/**
 * What the Retrospective proposes to make the Agent more useful (see CONTEXT.md). It never
 * applies one: an instruction becomes the Owner's only with their yes, and an idea is theirs to
 * act on.
 */
export interface Proposal {
  id: string;
  /** The Dream's Run it came with. */
  runId: string;
  kind: ProposalKind;
  /** The instruction, as it would be saved, or the idea. */
  text: string;
  /** Why, with what happened in the Owner's days. */
  reason: string;
  status: ProposalStatus;
  createdAt: string;
  decidedAt?: string;
}

/** `instruction`: how the Agent should behave; `idea`: something to add or connect. */
export type ProposalKind = 'instruction' | 'idea';

export type ProposalStatus = 'open' | 'accepted' | 'rejected';

/** The most Proposals one Retrospective makes. */
export const MAX_PROPOSALS = 3;

/** A rejected Proposal isn't made again for this long. */
export const REJECTED_DAYS = 30;
