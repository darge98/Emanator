import { type CanUseTool, query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { errorMessage } from '@emanator/shared/server';
import type { Engine, TurnRequest } from '../../domain/engine.ts';
import type { EngineEvent } from '../../domain/events.ts';
import type { PermissionDecider } from '../../domain/permission.ts';
import { CLAUDE_AGENT_SDK_ENGINE_ID, type ClaudeAgentSdkEngineConfig } from './config.ts';
import { buildQueryOptions } from './options.ts';
import { fromSdkToolName } from './tool-names.ts';
import { createHarnessToolServer } from './tool-server.ts';
import { failureFromText, TurnTranslator } from './translate.ts';
import { leavesWorkingDirectory } from './workspace-guard.ts';

/** Engine backed by the Claude Agent SDK, which spawns one Claude Code process per turn. */
export class ClaudeAgentSdkEngine implements Engine {
  readonly id = CLAUDE_AGENT_SDK_ENGINE_ID;

  constructor(private readonly config: ClaudeAgentSdkEngineConfig) {}

  async *runTurn(request: TurnRequest): AsyncIterable<EngineEvent> {
    const abortController = new AbortController();
    const abort = () => abortController.abort();
    request.signal?.addEventListener('abort', abort, { once: true });

    const tools = request.tools ?? [];
    const options = buildQueryOptions({
      request,
      config: this.config,
      canUseTool: bridgePermissions(
        request.decidePermission,
        request.workingDirectory ?? this.config.defaultWorkingDirectory,
      ),
      abortController,
      ...(tools.length > 0 && { toolServer: createHarnessToolServer(tools) }),
    });

    const translator = new TurnTranslator();
    let ended = false;
    try {
      // Streaming input keeps the process's control channel open, which canUseTool and in-process tools rely on.
      for await (const message of query({ prompt: singleMessage(request.prompt), options })) {
        for (const event of translator.translate(message)) {
          ended ||= event.type === 'turn.completed' || event.type === 'turn.failed';
          yield event;
        }
      }
    } catch (error) {
      if (!ended) {
        ended = true;
        const message = errorMessage(error);
        yield { type: 'turn.failed', reason: failureFromText(message), message };
      }
    } finally {
      request.signal?.removeEventListener('abort', abort);
    }

    if (!ended) {
      yield { type: 'turn.failed', reason: 'error', message: 'The turn ended without a result.' };
    }
  }
}

/**
 * Asks the Harness before every tool use. File tools reaching outside the working folder
 * are refused first: that confinement holds whatever the Policies say.
 */
function bridgePermissions(decide: PermissionDecider, workingDirectory: string): CanUseTool {
  return async (toolName, input, { signal, toolUseID }) => {
    if (await leavesWorkingDirectory(workingDirectory, toolName, input)) {
      return { behavior: 'deny', message: 'Only files inside the working folder can be used.' };
    }
    const decision = await decide({
      tool: fromSdkToolName(toolName),
      input,
      ...(toolUseID !== undefined && { toolUseId: toolUseID }),
      signal,
    });
    return decision.behavior === 'allow'
      ? { behavior: 'allow', updatedInput: input }
      : { behavior: 'deny', message: decision.reason };
  };
}

async function* singleMessage(prompt: string): AsyncIterable<SDKUserMessage> {
  yield { type: 'user', message: { role: 'user', content: prompt }, parent_tool_use_id: null };
}
