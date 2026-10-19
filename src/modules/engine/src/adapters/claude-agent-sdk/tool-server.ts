import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { errorMessage } from '@emanator/shared/server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { JsonObjectSchema, ToolDefinition, ToolOutput } from '../../domain/tool.ts';
import { HARNESS_TOOL_SERVER } from './tool-names.ts';

/**
 * Exposes the Harness's Tools to the SDK as an in-process MCP server. It answers the MCP
 * requests itself instead of using the SDK's `tool()`, which only takes zod shapes: Tools a
 * Capability relays come with JSON Schema, and must reach the model unchanged.
 */
export function createHarnessToolServer(
  tools: readonly ToolDefinition[],
): McpSdkServerConfigWithInstance {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const instance = new McpServer(
    { name: HARNESS_TOOL_SERVER, version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  instance.server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(describe),
  }));
  instance.server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
    const tool = byName.get(params.name);
    if (!tool) return errorResult(`There is no Tool called "${params.name}".`);
    return runTool(tool, params.arguments ?? {});
  });
  return { type: 'sdk', name: HARNESS_TOOL_SERVER, instance };
}

function describe(tool: ToolDefinition): Tool {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchemaOf(tool),
    annotations: {
      readOnlyHint: tool.hints?.readOnly ?? false,
      destructiveHint: tool.hints?.destructive ?? false,
    },
  };
}

function inputSchemaOf(tool: ToolDefinition): Tool['inputSchema'] {
  if ('inputSchema' in tool) return tool.inputSchema;
  return z.toJSONSchema(z.object(tool.input)) as JsonObjectSchema;
}

async function runTool(
  tool: ToolDefinition,
  input: Record<string, unknown>,
): Promise<CallToolResult> {
  try {
    return toResult(await run(tool, input));
  } catch (error) {
    // A Tool crash becomes an error result the model can react to, not a failed turn.
    return errorResult(`Tool "${tool.name}" failed: ${errorMessage(error)}`);
  }
}

async function run(tool: ToolDefinition, input: Record<string, unknown>): Promise<ToolOutput> {
  if ('inputSchema' in tool) return tool.run(input);
  const parsed = z.object(tool.input).safeParse(input);
  if (!parsed.success) {
    return {
      text: `Invalid input for "${tool.name}": ${z.prettifyError(parsed.error)}`,
      isError: true,
    };
  }
  return tool.run(parsed.data);
}

function toResult({ text, isError }: ToolOutput): CallToolResult {
  return { content: [{ type: 'text', text }], isError: isError ?? false };
}

function errorResult(text: string): CallToolResult {
  return toResult({ text, isError: true });
}
