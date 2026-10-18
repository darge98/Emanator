import type { ToolHints } from '@emanator/engine';

/** How the Agent may use a Tool (see CONTEXT.md). */
export const POLICIES = ['allow', 'ask', 'deny'] as const;

export type Policy = (typeof POLICIES)[number];

/** A Tool the Owner can set a Policy for. */
export interface ToolInfo {
  name: string;
  /** The Faculty or Capability that exposes the Tool. */
  group: string;
  defaultPolicy: Policy;
}

/** A Tool with the Policy in force; `custom` when the Owner chose it. */
export interface ToolPolicy extends ToolInfo {
  policy: Policy;
  custom: boolean;
}

export class PolicyValidationError extends Error {
  override name = 'PolicyValidationError';
}

/** Tools that only read start as allowed; anything that may write or destroy asks first. */
export function defaultPolicy(hints: ToolHints | undefined): Policy {
  return hints?.readOnly && !hints.destructive ? 'allow' : 'ask';
}

export function validatePolicy(input: unknown): Policy {
  const policy = (input as { policy?: unknown } | null)?.policy;
  if (typeof policy === 'string' && (POLICIES as readonly string[]).includes(policy)) {
    return policy as Policy;
  }
  throw new PolicyValidationError(`The policy must be one of: ${POLICIES.join(', ')}.`);
}
