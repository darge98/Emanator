/** Name of the in-process MCP server that carries the Harness's own Tools. */
export const HARNESS_TOOL_SERVER = 'emanator';

const harnessPrefix = `mcp__${HARNESS_TOOL_SERVER}__`;

/** Harness Tool name -> name the SDK model sees. */
export function toSdkToolName(tool: string): string {
  return `${harnessPrefix}${tool}`;
}

/** SDK tool name -> Harness Tool name. Names outside the Harness server pass through unchanged. */
export function fromSdkToolName(sdkName: string): string {
  return sdkName.startsWith(harnessPrefix) ? sdkName.slice(harnessPrefix.length) : sdkName;
}
