import { buildComputerFileIndex, moveComputerPath } from "../../files";
import { booleanArg, directoryName, firstArg, joinLocalPath, resolveWorkspacePath, skipNoRoots } from "../argHelpers";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";
import { formatToolName } from "../toolPresentation";
import { getWritePolicy } from "../workspacePolicy";

export async function executeMovePathHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  return executeMoveOrRenamePathHandler(call, context);
}

export async function executeMoveOrRenamePathHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  const rawFromPath = firstArg(call.args, ["from_path", "fromPath", "from", "source_path", "source", "old_path", "oldPath", "current_path", "currentPath", "path"]);
  const rawNewName = firstArg(call.args, ["new_name", "newName", "name", "file_name", "fileName", "folder_name", "folderName"]);
  const rawExplicitToPath = firstArg(call.args, ["to_path", "toPath", "destination_path", "destinationPath", "dest_path", "destPath", "target_path", "targetPath", "new_path", "newPath", "to", "destination"]);

  if (!rawFromPath) {
    return {
      content: `Skipped because ${call.tool} requires from_path or path.`,
      executed: false,
    };
  }

  const fromPath = resolveWorkspacePath(rawFromPath, context.roots);
  const toPath = rawExplicitToPath
    ? resolveWorkspacePath(rawExplicitToPath, context.roots)
    : rawNewName
      ? joinLocalPath(directoryName(fromPath), [rawNewName])
      : "";

  if (!toPath) {
    return {
      content: `Skipped because ${call.tool} requires to_path/new_path or new_name.`,
      executed: false,
    };
  }

  const fromPolicy = getWritePolicy(context.settings, context.roots, fromPath);
  if (!fromPolicy.allowed) {
    return {
      content: `${formatToolName(call.tool)} blocked for source: ${fromPolicy.reason}`,
      executed: false,
    };
  }

  const toPolicy = getWritePolicy(context.settings, context.roots, toPath);
  if (!toPolicy.allowed) {
    return {
      content: `${formatToolName(call.tool)} blocked for destination: ${toPolicy.reason}`,
      executed: false,
    };
  }

  const result = await moveComputerPath(fromPath, toPath, context.roots, {
    createParentDirs: booleanArg(call.args, ["create_parent_dirs", "createParentDirs", "parents"], true),
  });
  const summary = await buildComputerFileIndex(context.roots, context.settings.scope).catch(() => undefined);

  return {
    content: [
      `From: ${result.fromPath}`,
      `To: ${result.toPath}`,
      `Kind: ${result.kind}`,
      `Moved: ${result.moved ? "yes" : "no"}`,
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
    ].join("\n"),
    executed: result.moved,
    fileChanges: result.moved
      ? [
          {
            additions: 0,
            deletions: 0,
            kind: "move" as const,
            path: result.toPath,
          },
        ]
      : undefined,
  };
}
