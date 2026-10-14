import type {
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKMessage,
  SDKRateLimitInfo,
  SDKResultMessage,
  SDKSystemMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  CredentialSource,
  EngineEvent,
  TurnFailureReason,
  UsageStatus,
} from '../../domain/events.ts';
import type { SessionRef } from '../../domain/session.ts';
import { CLAUDE_AGENT_SDK_ENGINE_ID } from './config.ts';
import { fromSdkToolName } from './tool-names.ts';

/** Turns the SDK's message stream for one turn into Engine events. One instance per turn. */
export class TurnTranslator {
  private session: SessionRef | undefined;
  private failure: TurnFailureReason | undefined;

  translate(message: SDKMessage): EngineEvent[] {
    switch (message.type) {
      case 'system':
        return message.subtype === 'init' ? [this.started(message)] : [];
      case 'assistant':
        return this.assistant(message);
      case 'user':
        return this.toolResults(message);
      case 'rate_limit_event':
        return [usageLimit(message.rate_limit_info)];
      case 'result':
        return this.finished(message);
      default:
        return [];
    }
  }

  private started(message: SDKSystemMessage): EngineEvent {
    this.session = { engine: CLAUDE_AGENT_SDK_ENGINE_ID, id: message.session_id };
    return {
      type: 'turn.started',
      session: this.session,
      model: message.model,
      tools: message.tools.map(fromSdkToolName),
      credentials: credentialSource(message.apiKeySource),
    };
  }

  private assistant(message: SDKAssistantMessage): EngineEvent[] {
    // Frames from sub-agents carry a parent; the Harness never starts sub-agents.
    if (message.parent_tool_use_id !== null) return [];
    if (message.error) this.failure = failureReason(message.error);

    const events: EngineEvent[] = [];
    for (const block of message.message.content) {
      if (block.type === 'text' && block.text.length > 0) {
        events.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        events.push({
          type: 'tool.called',
          toolUseId: block.id,
          tool: fromSdkToolName(block.name),
          input: block.input,
        });
      }
    }
    return events;
  }

  private toolResults(message: SDKUserMessage): EngineEvent[] {
    if (message.parent_tool_use_id !== null) return [];
    const content = message.message.content;
    if (typeof content === 'string') return [];

    const events: EngineEvent[] = [];
    for (const block of content) {
      if (block.type !== 'tool_result') continue;
      events.push({
        type: 'tool.result',
        toolUseId: block.tool_use_id,
        output: toolResultText(block.content),
        isError: block.is_error ?? false,
      });
    }
    return events;
  }

  private finished(message: SDKResultMessage): EngineEvent[] {
    const session = this.session ?? { engine: CLAUDE_AGENT_SDK_ENGINE_ID, id: message.session_id };
    const events: EngineEvent[] = message.permission_denials.map((denial) => ({
      type: 'tool.denied',
      toolUseId: denial.tool_use_id,
      tool: fromSdkToolName(denial.tool_name),
    }));

    if (message.subtype === 'success' && !message.is_error) {
      events.push({
        type: 'turn.completed',
        session,
        text: message.result,
        costUsd: message.total_cost_usd,
        durationMs: message.duration_ms,
      });
    } else {
      events.push({
        type: 'turn.failed',
        session,
        reason: this.failure ?? 'error',
        message: message.subtype === 'success' ? message.result : message.errors.join('\n'),
      });
    }
    return events;
  }
}

function credentialSource(apiKeySource: string): CredentialSource {
  switch (apiKeySource) {
    // The SDK reports 'none' for OAuth; the only OAuth credential this adapter passes is the subscription token.
    case 'none':
      return 'subscription';
    case 'ANTHROPIC_API_KEY':
    case 'apiKeyHelper':
    case '/login managed key':
      return 'api-key';
    default:
      return 'unknown';
  }
}

function failureReason(error: SDKAssistantMessageError): TurnFailureReason {
  switch (error) {
    case 'rate_limit':
      return 'usage-limit';
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
    case 'verification_required':
    case 'billing_error':
      return 'authentication';
    case 'model_not_found':
      return 'model-unavailable';
    default:
      return 'error';
  }
}

function usageLimit(info: SDKRateLimitInfo): EngineEvent {
  return {
    type: 'usage.limit',
    status: usageStatus(info.status),
    ...(info.rateLimitType !== undefined && { window: info.rateLimitType }),
    ...(info.utilization !== undefined && { utilization: asFraction(info.utilization) }),
    ...(info.resetsAt !== undefined && { resetsAt: asDate(info.resetsAt) }),
  };
}

function usageStatus(status: SDKRateLimitInfo['status']): UsageStatus {
  switch (status) {
    case 'allowed':
      return 'ok';
    case 'allowed_warning':
      return 'warning';
    case 'rejected':
      return 'exhausted';
  }
}

// A real subscription event (smoke, 2026-10-14) reported window utilization as a 0–1 fraction;
// the usage API documents 0–100, so both are accepted.
function asFraction(utilization: number): number {
  return utilization > 1 ? utilization / 100 : utilization;
}

// Confirmed by the smoke run: epoch seconds.
function asDate(epochSeconds: number): Date {
  return new Date(epochSeconds * 1000);
}

type ToolResultContent = Extract<
  Exclude<SDKUserMessage['message']['content'], string>[number],
  { type: 'tool_result' }
>['content'];

function toolResultText(content: ToolResultContent): string {
  if (content === undefined) return '';
  if (typeof content === 'string') return content;
  return content
    .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
    .join('\n');
}
