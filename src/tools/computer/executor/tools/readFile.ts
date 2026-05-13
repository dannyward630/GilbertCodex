import { readComputerTextFile } from "../../files";
import { formatPreciseCodeView } from "../../editing";
import {
  assertReadablePath,
  firstArg,
  isMissingLocalPathError,
  normalizeToolErrorMessage,
  optionalNumberArg,
  resolveWorkspacePath,
  skipNoRoots,
} from "../argHelpers";
import { recoverableToolFailure } from "../results";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";
import { formatToolName } from "../toolPresentation";

export async function executeReadFileHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  const rawPath = firstArg(call.args, ["path", "file_path", "file"]);

  if (!rawPath) {
    return {
      content: "Skipped because read_file did not include a file path.",
      executed: false,
    };
  }

  const path = resolveWorkspacePath(rawPath, context.roots);
  assertReadablePath(path, context.roots);

  const maxBytes = optionalNumberArg(call.args, ["max_bytes", "maxBytes", "bytes"]);
  const file = await readComputerTextFile(path, maxBytes).catch((error) => {
    const detail = normalizeToolErrorMessage(error);
    if (isMissingLocalPathError(detail)) {
      return null;
    }
    throw error;
  });

  if (!file) {
    const basename = basenameFromPath(path);
    return {
      content: [
        `${formatToolName(call.tool)} skipped: file not found.`,
        `Path: ${path}`,
        "This is not a reader-tool failure.",
        `Do not guess a sibling path or drop subfolders from a previous tool result. Search for ${basename ? `"${basename}"` : "the basename"} or list the nearest known parent directory before reading again.`,
      ].join("\n"),
      executed: false,
      recovery: recoverableToolFailure(
        "read_retry",
        `The read/view path was not found: ${path}. Do not retry a guessed sibling path. Use search_files for ${basename ? `"${basename}"` : "the basename"} or list_directory on the nearest known parent, then retry read_file/view_code with the exact discovered path.`,
      ),
    };
  }

  return {
    content: formatPreciseCodeView(file, call.args),
    executed: true,
  };
}

function basenameFromPath(path: string) {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? "";
}
