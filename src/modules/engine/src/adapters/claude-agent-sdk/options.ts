import type { CanUseTool, McpServerConfig, Options } from '@anthropic-ai/claude-agent-sdk';
import type { TurnRequest } from '../../domain/engine.ts';
import type { ClaudeAgentSdkEngineConfig } from './config.ts';
import { HARNESS_TOOL_SERVER } from './tool-names.ts';

export interface QueryOptionsInput {
  request: TurnRequest;
  config: ClaudeAgentSdkEngineConfig;
  canUseTool: CanUseTool;
  abortController: AbortController;
  /** In-process MCP server with the request's Tools, when it has any. */
  toolServer?: McpServerConfig;
}

/**
 * Translates a turn request into SDK options. The SDK is isolated from the host's
 * Claude Code setup: no filesystem settings, no built-in tools, a minimal environment.
 */
export function buildQueryOptions({
  request,
  config,
  canUseTool,
  abortController,
  toolServer,
}: QueryOptionsInput): Options {
  return {
    // Without this the SDK loads ~/.claude and project settings, i.e. the Owner's personal Claude Code setup.
    settingSources: [],
    // Built-in tools only arrive through Faculties (ADR 0002).
    tools: [],
    mcpServers: toolServer ? { [HARNESS_TOOL_SERVER]: toolServer } : {},
    canUseTool,
    permissionMode: 'default',
    model: request.model ?? config.defaultModel,
    // Persona edits must apply to existing Conversations too, so the prompt is not frozen on first use.
    ...(request.systemPrompt !== undefined && {
      systemPrompt: { type: 'custom', prompt: request.systemPrompt, snapshot: false },
    }),
    ...(request.session && { resume: request.session.id }),
    cwd: request.workingDirectory ?? config.defaultWorkingDirectory,
    env: buildEnv(config),
    abortController,
  };
}

function buildEnv(config: ClaudeAgentSdkEngineConfig): Record<string, string | undefined> {
  const base = config.baseEnv ?? { PATH: process.env.PATH, HOME: process.env.HOME };
  const credential =
    config.credentials.kind === 'subscription-token'
      ? { CLAUDE_CODE_OAUTH_TOKEN: config.credentials.token }
      : { ANTHROPIC_API_KEY: config.credentials.key };
  return {
    ...base,
    ...credential,
    CLAUDE_CONFIG_DIR: config.configDir,
    CLAUDE_AGENT_SDK_CLIENT_APP: 'emanator',
  };
}
