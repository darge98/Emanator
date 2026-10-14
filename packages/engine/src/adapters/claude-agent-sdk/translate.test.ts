import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { TurnTranslator } from './translate.ts';

// Fixtures carry only the fields the translator reads.
const sdk = (message: Record<string, unknown>) => message as unknown as SDKMessage;

const init = (overrides: Record<string, unknown> = {}) =>
  sdk({
    type: 'system',
    subtype: 'init',
    session_id: 'session-1',
    model: 'claude-haiku-5-5',
    tools: ['mcp__emanator__get_time', 'mcp__gmail_work__search'],
    apiKeySource: 'none',
    ...overrides,
  });

const assistant = (content: unknown[], overrides: Record<string, unknown> = {}) =>
  sdk({ type: 'assistant', parent_tool_use_id: null, message: { content }, ...overrides });

const result = (overrides: Record<string, unknown> = {}) =>
  sdk({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: 'session-1',
    result: 'Done.',
    total_cost_usd: 0.002,
    duration_ms: 1500,
    permission_denials: [],
    ...overrides,
  });

describe('TurnTranslator', () => {
  it('reports the turn start with Harness tool names and the credential source', () => {
    expect(new TurnTranslator().translate(init())).toEqual([
      {
        type: 'turn.started',
        session: { engine: 'claude-agent-sdk', id: 'session-1' },
        model: 'claude-haiku-5-5',
        tools: ['get_time', 'mcp__gmail_work__search'],
        credentials: 'subscription',
      },
    ]);
  });

  it.each([
    ['ANTHROPIC_API_KEY', 'api-key'],
    ['apiKeyHelper', 'api-key'],
    ['user', 'unknown'],
  ])('maps apiKeySource %s to %s', (apiKeySource, credentials) => {
    const [event] = new TurnTranslator().translate(init({ apiKeySource }));

    expect(event).toMatchObject({ credentials });
  });

  it('turns assistant text and tool calls into events', () => {
    const events = new TurnTranslator().translate(
      assistant([
        { type: 'thinking', thinking: '…' },
        { type: 'text', text: 'Let me check.' },
        { type: 'tool_use', id: 'tool-1', name: 'mcp__emanator__get_time', input: {} },
      ]),
    );

    expect(events).toEqual([
      { type: 'text', text: 'Let me check.' },
      { type: 'tool.called', toolUseId: 'tool-1', tool: 'get_time', input: {} },
    ]);
  });

  it('ignores frames from sub-agents', () => {
    const frame = assistant([{ type: 'text', text: 'nested' }], { parent_tool_use_id: 'tool-9' });

    expect(new TurnTranslator().translate(frame)).toEqual([]);
  });

  it('turns tool results into events', () => {
    const events = new TurnTranslator().translate(
      sdk({
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tool-1', content: '10:42' },
            {
              type: 'tool_result',
              tool_use_id: 'tool-2',
              is_error: true,
              content: [{ type: 'text', text: 'Denied by the Owner' }],
            },
          ],
        },
      }),
    );

    expect(events).toEqual([
      { type: 'tool.result', toolUseId: 'tool-1', output: '10:42', isError: false },
      { type: 'tool.result', toolUseId: 'tool-2', output: 'Denied by the Owner', isError: true },
    ]);
  });

  it('reports usage limits as a fraction with a reset date', () => {
    const events = new TurnTranslator().translate(
      sdk({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed_warning',
          rateLimitType: 'five_hour',
          utilization: 82,
          resetsAt: 1_760_457_600,
        },
      }),
    );

    expect(events).toEqual([
      {
        type: 'usage.limit',
        status: 'warning',
        window: 'five_hour',
        utilization: 0.82,
        resetsAt: new Date(1_760_457_600_000),
      },
    ]);
  });

  it('reads per-window utilization from the undocumented unifiedWindows field', () => {
    // Payload as received from a Pro subscription during the smoke run.
    const [event] = new TurnTranslator().translate(
      sdk({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          resetsAt: 1792017000,
          rateLimitType: 'five_hour',
          overageStatus: 'rejected',
          overageDisabledReason: 'out_of_credits',
          isUsingOverage: false,
          unifiedWindows: {
            five_hour: { utilization: 0.27, resetsAt: 1792017000 },
            seven_day: { utilization: 0.51, resetsAt: 1792353600 },
          },
        },
      }),
    );

    expect(event).toEqual({
      type: 'usage.limit',
      status: 'ok',
      window: 'five_hour',
      resetsAt: new Date(1792017000_000),
      windows: [
        { name: 'five_hour', utilization: 0.27, resetsAt: new Date(1792017000_000) },
        { name: 'seven_day', utilization: 0.51, resetsAt: new Date(1792353600_000) },
      ],
    });
  });

  it('skips malformed windows instead of failing', () => {
    const [event] = new TurnTranslator().translate(
      sdk({
        type: 'rate_limit_event',
        rate_limit_info: {
          status: 'allowed',
          unifiedWindows: {
            five_hour: { utilization: '27%' },
            seven_day: { utilization: 0.51 },
            weird: null,
          },
        },
      }),
    );

    expect(event).toEqual({
      type: 'usage.limit',
      status: 'ok',
      windows: [{ name: 'seven_day', utilization: 0.51 }],
    });
  });

  it('omits windows when the field is missing or not an object', () => {
    for (const unifiedWindows of [undefined, 'five_hour', 42]) {
      const [event] = new TurnTranslator().translate(
        sdk({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', unifiedWindows } }),
      );

      expect(event).toEqual({ type: 'usage.limit', status: 'exhausted' });
    }
  });

  it('completes the turn with the denials collected along the way', () => {
    const translator = new TurnTranslator();
    translator.translate(init());

    const events = translator.translate(
      result({
        permission_denials: [
          { tool_name: 'mcp__emanator__send_note', tool_use_id: 'tool-2', tool_input: {} },
        ],
      }),
    );

    expect(events).toEqual([
      { type: 'tool.denied', toolUseId: 'tool-2', tool: 'send_note' },
      {
        type: 'turn.completed',
        session: { engine: 'claude-agent-sdk', id: 'session-1' },
        text: 'Done.',
        costUsd: 0.002,
        durationMs: 1500,
      },
    ]);
  });

  it('fails the turn with the reason the assistant reported', () => {
    const translator = new TurnTranslator();
    translator.translate(init());
    translator.translate(
      assistant([{ type: 'text', text: 'Limit reached' }], { error: 'rate_limit' }),
    );

    const [event] = translator.translate(result({ is_error: true, result: 'Usage limit reached' }));

    expect(event).toEqual({
      type: 'turn.failed',
      session: { engine: 'claude-agent-sdk', id: 'session-1' },
      reason: 'usage-limit',
      message: 'Usage limit reached',
    });
  });

  it('fails the turn with the SDK errors when execution breaks', () => {
    const [event] = new TurnTranslator().translate(
      result({ subtype: 'error_during_execution', is_error: true, errors: ['boom', 'again'] }),
    );

    expect(event).toMatchObject({ type: 'turn.failed', reason: 'error', message: 'boom\nagain' });
  });

  it('recognises a session the Engine no longer has', () => {
    // As returned by the SDK when resuming an unknown session id (smoke probe, 2026-10-15).
    const [event] = new TurnTranslator().translate(
      result({
        subtype: 'error_during_execution',
        is_error: true,
        session_id: '00000000-0000-4000-8000-000000000000',
        errors: ['No conversation found with session ID: 00000000-0000-4000-8000-000000000000'],
      }),
    );

    expect(event).toMatchObject({ type: 'turn.failed', reason: 'session-not-found' });
  });
});
