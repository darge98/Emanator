import type { z } from 'zod';

/**
 * A Tool the Harness implements itself and hands to the Engine, such as the
 * actions of a Faculty. The Engine decides how to expose it to its model.
 */
export interface ToolDefinition<Shape extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  input: Shape;
  /** Used to choose a default Policy; they enforce nothing on their own. */
  hints?: ToolHints;
  run(input: z.infer<z.ZodObject<Shape>>): Promise<ToolOutput>;
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
  tool: ToolDefinition<Shape>,
): ToolDefinition<Shape> {
  return tool;
}
