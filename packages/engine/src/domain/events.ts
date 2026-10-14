import type { SessionRef } from './session.ts';

/** Everything a turn reports back, in order. Every turn ends with `turn.completed` or `turn.failed`. */
export type EngineEvent =
  | TurnStarted
  | TextProduced
  | ToolCalled
  | ToolResulted
  | ToolDenied
  | UsageLimitChanged
  | TurnCompleted
  | TurnFailed;

export interface TurnStarted {
  type: 'turn.started';
  session: SessionRef;
  model: string;
  /** Tool names the model can see, as the Engine reports them. */
  tools: string[];
  credentials: CredentialSource;
}

export interface TextProduced {
  type: 'text';
  text: string;
}

export interface ToolCalled {
  type: 'tool.called';
  toolUseId: string;
  tool: string;
  input: unknown;
}

export interface ToolResulted {
  type: 'tool.result';
  toolUseId: string;
  output: string;
  isError: boolean;
}

export interface ToolDenied {
  type: 'tool.denied';
  toolUseId: string;
  tool: string;
}

export interface UsageLimitChanged {
  type: 'usage.limit';
  status: UsageStatus;
  /** Which limit window this refers to, e.g. `five_hour` or `seven_day`. */
  window?: string;
  /** Share of the window already used, between 0 and 1. */
  utilization?: number;
  resetsAt?: Date;
}

export interface TurnCompleted {
  type: 'turn.completed';
  session: SessionRef;
  text: string;
  costUsd: number;
  durationMs: number;
}

export interface TurnFailed {
  type: 'turn.failed';
  session?: SessionRef;
  reason: TurnFailureReason;
  message: string;
}

export type CredentialSource = 'subscription' | 'api-key' | 'unknown';

export type UsageStatus = 'ok' | 'warning' | 'exhausted';

export type TurnFailureReason = 'usage-limit' | 'authentication' | 'model-unavailable' | 'error';
