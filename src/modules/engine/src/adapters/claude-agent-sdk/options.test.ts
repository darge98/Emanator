import { describe, expect, it } from 'vitest';
import type { TurnRequest } from '../../domain/engine.ts';
import type { ClaudeAgentSdkEngineConfig } from './config.ts';
import { buildQueryOptions } from './options.ts';
import { createHarnessToolServer } from './tool-server.ts';

const config: ClaudeAgentSdkEngineConfig = {
  credentials: { kind: 'subscription-token', token: 'sub-token' },
  configDir: '/data/claude',
  defaultModel: 'sonnet',
  defaultWorkingDirectory: '/data/workspace',
  baseEnv: { PATH: '/usr/bin', HOME: '/home/node' },
};

const request: TurnRequest = {
  prompt: 'hello',
  decidePermission: async () => ({ behavior: 'allow' }),
};

function build(
  overrides: Partial<TurnRequest> = {},
  configOverrides: Partial<ClaudeAgentSdkEngineConfig> = {},
) {
  return buildQueryOptions({
    request: { ...request, ...overrides },
    config: { ...config, ...configOverrides },
    canUseTool: async () => ({ behavior: 'allow' }),
    abortController: new AbortController(),
  });
}

describe('buildQueryOptions', () => {
  it('isolates the SDK from filesystem settings and built-in tools', () => {
    const options = build();

    expect(options.settingSources).toEqual([]);
    expect(options.tools).toEqual([]);
    expect(options.mcpServers).toEqual({});
  });

  it('passes only the base environment, the credential and the config dir', () => {
    expect(build().env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/node',
      CLAUDE_CODE_OAUTH_TOKEN: 'sub-token',
      CLAUDE_CONFIG_DIR: '/data/claude',
      CLAUDE_AGENT_SDK_CLIENT_APP: 'emanator',
    });
  });

  it('passes an API key instead of the subscription token when configured so', () => {
    const env = build({}, { credentials: { kind: 'api-key', key: 'sk-test' } }).env;

    expect(env?.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
  });

  it('falls back to the configured model and working directory', () => {
    const options = build();

    expect(options.model).toBe('sonnet');
    expect(options.cwd).toBe('/data/workspace');
  });

  it('uses the model, working directory and session of the request', () => {
    const options = build({
      model: 'haiku',
      workingDirectory: '/tmp/run',
      session: { engine: 'claude-agent-sdk', id: 'session-1' },
    });

    expect(options.model).toBe('haiku');
    expect(options.cwd).toBe('/tmp/run');
    expect(options.resume).toBe('session-1');
  });

  it('starts a new session when the request has none', () => {
    expect(build()).not.toHaveProperty('resume');
  });

  it('sets a custom system prompt that is not frozen into the session', () => {
    expect(build({ systemPrompt: 'You are Jarvis.' }).systemPrompt).toEqual({
      type: 'custom',
      prompt: 'You are Jarvis.',
      snapshot: false,
    });
  });

  it('mounts the Harness tool server under its fixed name', () => {
    const toolServer = createHarnessToolServer([]);
    const options = buildQueryOptions({
      request,
      config,
      canUseTool: async () => ({ behavior: 'allow' }),
      abortController: new AbortController(),
      toolServer,
    });

    expect(options.mcpServers).toEqual({ emanator: toolServer });
  });
});
