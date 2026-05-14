import type { ToolDefinition } from "../../types";
import { defaultTerminalBackend, type TerminalBackend } from "./backend";
import { createTerminalRunTool } from "./terminalRun";

export { defaultTerminalBackend, type TerminalBackend } from "./backend";
export { createTerminalRunTool } from "./terminalRun";

export function createTerminalTools(backend: TerminalBackend = defaultTerminalBackend): ToolDefinition[] {
  return [
    createTerminalRunTool(backend),
  ];
}

export const terminalTools: ToolDefinition[] = createTerminalTools();
