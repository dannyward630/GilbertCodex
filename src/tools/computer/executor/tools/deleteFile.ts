import { buildComputerFileIndex, deleteComputerFile } from "../../files";
import { booleanArg, firstArg, readOriginalContentForSyntaxCheck, resolveWorkspacePath, skipNoRoots } from "../argHelpers";
import { createFileChangeSummary } from "../fileChanges";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";
import { getWritePolicy } from "../workspacePolicy";

export async function executeDeleteFileHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  const rawPath = firstArg(call.args, ["path", "file_path", "file"]);

  if (!rawPath) {
    return {
      content: "Skipped because delete_file requires a path.",
      executed: false,
    };
  }

  if (!booleanArg(call.args, ["confirm_delete", "confirmDelete", "confirm"], false)) {
    return {
      content: "Delete blocked: delete_file requires confirm_delete=true so the model cannot remove files accidentally.",
      executed: false,
    };
  }

  const path = resolveWorkspacePath(rawPath, context.roots);
  const writeCheck = getWritePolicy(context.settings, context.roots, path);

  if (!writeCheck.allowed) {
    return {
      content: `Delete blocked: ${writeCheck.reason}`,
      executed: false,
    };
  }

  const beforeContent = await readOriginalContentForSyntaxCheck(path);
  const result = await deleteComputerFile(path, context.roots);
  const fileChange = result.deleted ? createFileChangeSummary(result.path, beforeContent, "", "delete") : undefined;
  const summary = await buildComputerFileIndex(context.roots, context.settings.scope).catch(() => undefined);

  return {
    content: [
      `Path: ${result.path}`,
      `Deleted: ${result.deleted ? "yes" : "no"}`,
      `Bytes deleted: ${result.bytesDeleted}`,
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
    ].join("\n"),
    executed: result.deleted,
    fileChanges: fileChange ? [fileChange] : undefined,
  };
}
