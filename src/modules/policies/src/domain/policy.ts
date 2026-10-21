import type { ToolHints } from '@emanator/engine';

/** How the Agent may use a Tool (see CONTEXT.md). */
export const POLICIES = ['allow', 'ask', 'deny'] as const;

export type Policy = (typeof POLICIES)[number];

/** A Tool the Owner can set a Policy for, described for the dashboard. */
export interface ToolInfo {
  name: string;
  title: string;
  defaultPolicy: Policy;
  /** The Policies that can be enforced for it; all of them when omitted. */
  choices?: readonly Policy[];
  /** How the Tool's Approvals differ from the default ones. */
  approval?: ToolApproval;
}

export interface ToolApproval {
  /** Markdown to ask with, instead of the Tool's name and its input. */
  message?: (input: Record<string, unknown>) => string | Promise<string>;
  /**
   * Asks even when the Tool is allowed, if the turn holds content the Owner didn't write:
   * for what would keep acting long after the turn, like a recurring Routine.
   */
  whenTainted?: boolean;
}

/** The Tools of one Faculty or Capability, shown together in the dashboard. */
export interface ToolGroup<Tool extends ToolInfo = ToolInfo> {
  /** Which page shows the group: Faculties, or the Capability's own. */
  kind: 'faculty' | 'capability';
  name: string;
  title: string;
  description?: string;
  tools: readonly Tool[];
}

/** A Tool with the Policy in force; `custom` when the Owner chose it. */
export interface ToolPolicy extends ToolInfo {
  policy: Policy;
  custom: boolean;
}

export type PolicyGroup = ToolGroup<ToolPolicy>;

export class PolicyValidationError extends Error {
  override name = 'PolicyValidationError';
}

/** Tools that only read start as allowed; anything that may write or destroy asks first. */
export function defaultPolicy(hints: ToolHints | undefined): Policy {
  return hints?.readOnly && !hints.destructive ? 'allow' : 'ask';
}

/** Reads `{ policies: { [tool]: policy } }`, the Owner's choices from the dashboard. */
export function validatePolicies(input: unknown): Record<string, Policy> {
  const policies = (input as { policies?: unknown } | null)?.policies;
  if (typeof policies !== 'object' || policies === null || Array.isArray(policies)) {
    throw new PolicyValidationError('The request must carry a policies object.');
  }
  for (const [tool, policy] of Object.entries(policies)) {
    if (typeof policy !== 'string' || !(POLICIES as readonly string[]).includes(policy)) {
      throw new PolicyValidationError(
        `The policy of "${tool}" must be one of: ${POLICIES.join(', ')}.`,
      );
    }
  }
  return policies as Record<string, Policy>;
}
