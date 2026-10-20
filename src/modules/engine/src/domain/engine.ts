import type { EngineTool } from './engine-tool.ts';
import type { EngineEvent } from './events.ts';
import type { PermissionDecider } from './permission.ts';
import type { SessionRef } from './session.ts';
import type { ToolDefinition } from './tool.ts';

/**
 * The swappable component that lets the Agent reason with a model (ADR 0001).
 * Each call runs one turn and ends; continuity comes from resuming a SessionRef (ADR 0006).
 */
export interface Engine {
  readonly id: string;
  runTurn(request: TurnRequest): AsyncIterable<EngineEvent>;
}

export interface TurnRequest {
  prompt: string;
  systemPrompt?: string;
  /** Engine-specific model name or alias; the Engine's default when omitted. */
  model?: string;
  /** Resume this session; a new one starts when omitted. */
  session?: SessionRef;
  tools?: readonly ToolDefinition[];
  /** Tools the Engine implements itself; none when omitted. */
  engineTools?: readonly EngineTool[];
  decidePermission: PermissionDecider;
  /**
   * Told the Harness name of every Tool the model is about to use, before it runs, including
   * those that need no PermissionDecider, such as reading inside the working folder.
   */
  onToolUse?: (tool: string) => void;
  workingDirectory?: string;
  signal?: AbortSignal;
}
