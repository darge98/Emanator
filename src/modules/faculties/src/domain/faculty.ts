import type { EngineTool, ToolDefinition } from '@emanator/engine';
import type { ToolGroup, ToolInfo } from '@emanator/policies';

/** A Tool the Engine implements; the Faculty only describes it. */
export interface EngineFacultyTool extends ToolInfo {
  name: EngineTool;
  engine: true;
}

/** A Tool the Harness runs itself. */
export type HarnessFacultyTool = ToolInfo & ToolDefinition;

export type FacultyTool = EngineFacultyTool | HarnessFacultyTool;

/**
 * An innate ability of the Agent (see CONTEXT.md) and its Tools. Each Tool carries all
 * there is to know about it: its default Policy, its dashboard title and, for the
 * Harness's own, its implementation.
 */
export type Faculty = ToolGroup<FacultyTool>;
