import { buildComputerFileIndex } from "../../files";
import { editComputerTextFile } from "../../editing";
import { formatTextQualityWarnings } from "../../textQuality";
import {
  firstArg,
  readOriginalContentForSyntaxCheck,
  resolveWorkspacePath,
  skipNoRoots,
} from "../argHelpers";
import { createFileChangeSummary } from "../fileChanges";
import { recoverableToolFailure } from "../results";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";
import { getWritePolicy } from "../workspacePolicy";

export async function executeEditFileHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  const { roots, settings } = context;

  if (roots.length === 0) {
    return skipNoRoots();
  }

  const rawPath = firstArg(call.args, ["path", "file_path", "file"]);

  if (!rawPath) {
    return {
      content: "Skipped because edit_file did not include a file path.",
      executed: false,
      recovery: recoverableToolFailure(
        "edit_retry",
        "Retry edit_file with a path inside the workspace plus exactly one edit shape; use list_directory/view_code first if the target path is uncertain.",
      ),
    };
  }

  const path = resolveWorkspacePath(rawPath, roots);
  const writeCheck = getWritePolicy(settings, roots, path);

  if (!writeCheck.allowed) {
    return {
      content: `Edit blocked: ${writeCheck.reason}`,
      executed: false,
    };
  }

  context.onTerminalProgress?.({
    output: `Editing file: ${path}`,
  });

  const beforeContent = await readOriginalContentForSyntaxCheck(path);
  try {
    const result = await editComputerTextFile({ args: call.args, path, roots });
    const afterContent = result.changed ? await readOriginalContentForSyntaxCheck(result.path) : beforeContent;
    const fileChange = result.changed ? createFileChangeSummary(result.path, beforeContent, afterContent, "update") : undefined;
    const summary = result.changed ? await buildComputerFileIndex(roots, settings.scope).catch(() => undefined) : undefined;
    const qualityWarnings = result.qualityWarnings;

    return {
      content: [
        `Path: ${result.path}`,
        `Operation: ${result.operation}`,
        `Changed: ${result.changed ? "yes" : "no"}`,
        `Replacements: ${result.replacements}`,
        `Bytes written: ${result.bytesWritten}`,
        summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
        formatTextQualityWarnings(qualityWarnings),
        "",
        result.preview,
      ].join("\n"),
      executed: result.changed,
      fileChanges: fileChange ? [fileChange] : undefined,
      recovery: qualityWarnings.length > 0
        ? recoverableToolFailure(
            "edit_retry",
            "Inspect or edit the changed file and fix the quality warnings before finalizing.",
          )
        : undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        `Path: ${path}`,
        `Edit failed: ${message}`,
        "Retry rule: inspect this exact path before editing again. Do not drop nested folders from the path; if the path is wrong, search for the basename first.",
      ].join("\n"),
      executed: false,
      is_error: true,
      errorCode: "edit_file_failed",
      recovery: recoverableToolFailure(
        "edit_retry",
        `Inspect the current file lines with view_code/read_file using this exact path: ${path}. Then retry edit_file with a narrower exact text, line range, character range, or insert operation. If that path is not found, search_files for ${basenameFromPath(path)} before trying another path.`,
      ),
    };
  }
}

function basenameFromPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}
