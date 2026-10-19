/** The request to the Owner before a Tool with an *ask* Policy runs (see CONTEXT.md). */
export interface Approval {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  /** The Channel thread the request was sent to; undefined for General. */
  threadId?: string;
  status: ApprovalStatus;
  /** Every message that asked, the reminder included; their buttons go once it is decided. */
  messageIds: string[];
  requestedAt: Date;
  decidedAt?: Date;
}

/** `expired`: nobody answered in time, the turn ended first or the Harness stopped. Counts as a denial. */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

/** How an Approval ended: anything but `pending`. */
export type ApprovalDecision = Exclude<ApprovalStatus, 'pending'>;
