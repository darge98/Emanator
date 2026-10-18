export const CLAUDE_AGENT_SDK_ENGINE_ID = 'claude-agent-sdk';

/** Credentials are always brought by the Owner; the Harness never runs a login flow (ADR 0001). */
export type EngineCredentials =
  | { kind: 'subscription-token'; token: string }
  | { kind: 'api-key'; key: string };

/**
 * Reads the Owner's credentials from `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`.
 * Exactly one must be set: with both, Claude Code would silently bill the API key.
 */
export function engineCredentialsFromEnv(
  env: Record<string, string | undefined> = process.env,
): EngineCredentials {
  const token = env.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  const key = env.ANTHROPIC_API_KEY?.trim();
  if (token && key) {
    throw new Error('Set only one of CLAUDE_CODE_OAUTH_TOKEN and ANTHROPIC_API_KEY.');
  }
  if (token) return { kind: 'subscription-token', token };
  if (key) return { kind: 'api-key', key };
  throw new Error(
    'Set CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`) or ANTHROPIC_API_KEY in .env.',
  );
}

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
