export const CLAUDE_AGENT_SDK_ENGINE_ID = 'claude-agent-sdk';

/** Credentials are always brought by the Owner; the Harness never runs a login flow (ADR 0001). */
export type EngineCredentials =
  | { kind: 'subscription-token'; token: string }
  | { kind: 'api-key'; key: string };

export interface ClaudeAgentSdkEngineConfig {
  credentials: EngineCredentials;
  /** Where the SDK keeps session transcripts (CLAUDE_CONFIG_DIR). Must survive restarts. */
  configDir: string;
  defaultModel: string;
  defaultWorkingDirectory: string;
  /**
   * Variables the Engine subprocess inherits on top of credentials and config dir.
   * Defaults to PATH and HOME only: the subprocess never sees the Harness's other secrets.
   */
  baseEnv?: Record<string, string | undefined>;
}
