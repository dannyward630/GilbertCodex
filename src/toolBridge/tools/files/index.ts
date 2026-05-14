import type { ToolDefinition } from "../../types";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import { createFilesListTool } from "./filesList";
import { createFilesReadTool } from "./filesRead";
import { createFilesStatTool } from "./filesStat";

export { type FilesBackend, defaultFilesBackend } from "./backend";
export { createFilesListTool } from "./filesList";
export { createFilesReadTool } from "./filesRead";
export { createFilesStatTool } from "./filesStat";

/**
 * Factory for the read-only files family. Pass a `backend` to inject a mock
 * filesystem (used in tests) or to wrap the production backend with caching,
 * logging, or audit hooks.
 */
export function createFilesTools(backend: FilesBackend = defaultFilesBackend): ToolDefinition[] {
  return [createFilesReadTool(backend), createFilesListTool(backend), createFilesStatTool(backend)];
}

/**
 * Default-backed tool array used by {@link ../../registry.ToolRegistry}.
 */
export const fileTools: ToolDefinition[] = createFilesTools();
