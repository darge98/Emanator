/** Asked by the Engine before every Tool use; this is where Policies and Approvals plug in. */
export type PermissionDecider = (request: PermissionRequest) => Promise<PermissionDecision>;

export interface PermissionRequest {
  /** The Harness-level Tool name, without any Engine-specific prefix. */
  tool: string;
  input: Record<string, unknown>;
  toolUseId?: string;
  /** Aborted when the turn is cancelled while the decision is still pending. */
  signal: AbortSignal;
}

export type PermissionDecision = { behavior: 'allow' } | { behavior: 'deny'; reason: string };
