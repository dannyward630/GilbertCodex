import type { ToolDefinition } from "../../types";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import { createFilesAppendTool } from "./filesAppend";
import { createFilesApplyPatchTool } from "./filesApplyPatch";
import { createFilesExactReplaceTool } from "./filesExactReplace";
import { createFilesInsertAtLineTool } from "./filesInsertAtLine";
import { createFilesMoveTool } from "./filesMove";
import { createFilesReplaceRangeTool } from "./filesReplaceRange";
import { createFilesWriteTool } from "./filesWrite";

export { type EditingBackend, defaultEditingBackend } from "./backend";
export { createFilesAppendTool } from "./filesAppend";
export { createFilesApplyPatchTool } from "./filesApplyPatch";
export { createFilesExactReplaceTool } from "./filesExactReplace";
export { createFilesInsertAtLineTool } from "./filesInsertAtLine";
export { createFilesMoveTool } from "./filesMove";
export { createFilesReplaceRangeTool } from "./filesReplaceRange";
export { createFilesWriteTool } from "./filesWrite";

export function createEditingTools(backend: EditingBackend = defaultEditingBackend): ToolDefinition[] {
  return [
    createFilesExactReplaceTool(backend),
    createFilesInsertAtLineTool(backend),
    createFilesReplaceRangeTool(backend),
    createFilesAppendTool(backend),
    createFilesApplyPatchTool(backend),
    createFilesWriteTool(backend),
    createFilesMoveTool(backend),
  ];
}

export const editingTools: ToolDefinition[] = createEditingTools();
