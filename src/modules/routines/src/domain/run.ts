import type { SessionRef } from '@emanator/engine';

/** One execution of a Routine (see CONTEXT.md). */
export interface RoutineRun {
  id: string;
  routineId: string;
  origin: RunOrigin;
  status: RunStatus;
  startedAt: Date;
  finishedAt?: Date;
  /** The Engine session holding the Run's transcript (ADR 0006). */
  session?: SessionRef;
  /** Tools called during the Run, in order. */
  tools: string[];
  /** The Conversation the Run delivered to, or tried to. */
  conversationId?: string;
  /** Why the Run failed, as reported by the Engine or the Harness. */
  error?: string;
}

/** `schedule`: a Trigger fired; `manual`: "run now" from the dashboard. */
export type RunOrigin = 'schedule' | 'manual';

/**
 * `waiting`: the quota is exhausted and the Run resumes after its reset;
 * `approval`: the Run waits for the Owner to answer an Approval;
 * `delivered`: the Owner got a message; `silent`: the Agent chose to say nothing.
 */
export type RunStatus = 'running' | 'waiting' | 'approval' | 'delivered' | 'silent' | 'failed';
