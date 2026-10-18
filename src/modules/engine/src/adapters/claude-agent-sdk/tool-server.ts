import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import { errorMessage } from '@emanator/shared/server';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from '../../domain/tool.ts';
import { HARNESS_TOOL_SERVER } from './tool-names.ts';

/** Exposes the Harness's Tools to the SDK as an in-process MCP server. */
export function createHarnessToolServer(
  tools: readonly ToolDefinition[],
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: HARNESS_TOOL_SERVER,
    tools: tools.map((definition) =>
      tool(
        definition.name,
        definition.description,
        definition.input,
        (input) => runTool(definition, input),
        {
          annotations: {
            readOnlyHint: definition.hints?.readOnly ?? false,
            destructiveHint: definition.hints?.destructive ?? false,
          },
        },
      ),
    ),
  });
}

async function runTool(definition: ToolDefinition, input: unknown): Promise<CallToolResult> {
  try {
    const output = await definition.run(input as never);
    return { content: [{ type: 'text', text: output.text }], isError: output.isError ?? false };
  } catch (error) {
    // A Tool crash becomes an error result the model can react to, not a failed turn.
    return {
      content: [{ type: 'text', text: `Tool "${definition.name}" failed: ${errorMessage(error)}` }],
      isError: true,
    };
  }
}
