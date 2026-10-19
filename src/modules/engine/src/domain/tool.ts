import type { z } from 'zod';

/**
 * A Tool the Harness implements itself and hands to the Engine, such as the actions of a
 * Faculty or those a Capability relays. The Engine decides how to expose it to its model.
 */
export type ToolDefinition = ZodToolDefinition | JsonSchemaToolDefinition;

/** A Tool whose input is a zod shape, checked before `run` is called. */
export interface ZodToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> extends ToolBasics {
  input: Shape;
  run(input: z.infer<z.ZodObject<Shape>>): Promise<ToolOutput>;
}

/**
 * A Tool whose input is described in JSON Schema, e.g. one relayed from an MCP server. The
 * schema reaches the model as it is; checking the input is left to whoever implements it.
 */
export interface JsonSchemaToolDefinition extends ToolBasics {
  inputSchema: JsonObjectSchema;
  run(input: Record<string, unknown>): Promise<ToolOutput>;
}

/** A JSON Schema whose top level is an object, as MCP requires of Tool inputs. */
export interface JsonObjectSchema {
  type: 'object';
  properties?: Record<string, object>;
  required?: string[];
  [keyword: string]: unknown;
}

interface ToolBasics {
  name: string;
  description: string;
  /** Used to choose a default Policy; they enforce nothing on their own. */
  hints?: ToolHints;
}

export interface ToolHints {
  readOnly?: boolean;
  destructive?: boolean;
}

export interface ToolOutput {
  text: string;
  isError?: boolean;
}

/** Keeps the input type of `run` tied to the declared zod shape. */
export function defineTool<Shape extends z.ZodRawShape>(
  tool: ZodToolDefinition<Shape>,
): ZodToolDefinition<Shape> {
  return tool;
}

/**
 * The longest Harness Tool name an Engine must accept. The Claude Agent SDK drops tools
 * whose full name, `mcp__emanator__` included, exceeds 128 characters, without a word.
 */
export const MAX_TOOL_NAME_LENGTH = 113;
