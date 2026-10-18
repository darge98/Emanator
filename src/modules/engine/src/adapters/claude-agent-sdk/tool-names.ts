import type { EngineFaculty } from '../../domain/faculty.ts';

/** Name of the in-process MCP server that carries the Harness's own Tools. */
export const HARNESS_TOOL_SERVER = 'emanator';

const harnessPrefix = `mcp__${HARNESS_TOOL_SERVER}__`;

/** The SDK's built-in tool behind each Faculty it implements. */
const facultyTools: Record<EngineFaculty, string> = {
  web_search: 'WebSearch',
  web_fetch: 'WebFetch',
};

const facultyOfTool = new Map(
  Object.entries(facultyTools).map(([faculty, sdkName]) => [sdkName, faculty]),
);

/** Harness Tool name -> name the SDK model sees. */
export function toSdkToolName(tool: string): string {
  return `${harnessPrefix}${tool}`;
}

/** Faculty -> the SDK built-in tool that implements it. */
export function sdkToolOfFaculty(faculty: EngineFaculty): string {
  return facultyTools[faculty];
}

/**
 * SDK tool name -> Harness Tool name, so Policies and Run history never see SDK names.
 * Other names pass through unchanged.
 */
export function fromSdkToolName(sdkName: string): string {
  if (sdkName.startsWith(harnessPrefix)) return sdkName.slice(harnessPrefix.length);
  return facultyOfTool.get(sdkName) ?? sdkName;
}
