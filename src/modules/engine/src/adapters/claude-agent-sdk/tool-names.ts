import type { EngineTool } from '../../domain/engine-tool.ts';

/** Name of the in-process MCP server that carries the Harness's own Tools. */
export const HARNESS_TOOL_SERVER = 'emanator';

const harnessPrefix = `mcp__${HARNESS_TOOL_SERVER}__`;

/** The SDK's built-in tool behind each Engine Tool. */
const sdkTools: Record<EngineTool, string> = {
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
  read_file: 'Read',
  find_files: 'Glob',
  search_files: 'Grep',
  write_file: 'Write',
  edit_file: 'Edit',
};

const engineToolOf = new Map(
  Object.entries(sdkTools).map(([engineTool, sdkName]) => [sdkName, engineTool]),
);

/** Harness Tool name -> name the SDK model sees. */
export function toSdkToolName(tool: string): string {
  return `${harnessPrefix}${tool}`;
}

/** Engine Tool -> the SDK built-in tool that implements it. */
export function sdkToolOf(tool: EngineTool): string {
  return sdkTools[tool];
}

/**
 * SDK tool name -> Harness Tool name, so Policies and Run history never see SDK names.
 * Other names pass through unchanged.
 */
export function fromSdkToolName(sdkName: string): string {
  if (sdkName.startsWith(harnessPrefix)) return sdkName.slice(harnessPrefix.length);
  return engineToolOf.get(sdkName) ?? sdkName;
}
