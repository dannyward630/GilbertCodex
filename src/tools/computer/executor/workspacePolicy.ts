import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import { getIndexableWorkspaceRoots } from "../files";
import {
  buildOutsideWorkspaceMessage,
  firstArg,
  isPathInsideRoot,
  resolveWorkspacePath,
} from "./argHelpers";

export function getWritePolicy(settings: LocalWorkspaceSettings, roots: string[], path: string) {
  const resolvedPath = resolveWorkspacePath(path, roots);

  if (settings.permissionMode === "read-only") {
    return {
      allowed: false,
      reason: "Read-only mode is on. Tell the user: \"I cannot edit files in read-only mode. Switch the workspace permission mode to Auto or Ask first to allow writes.\"",
    };
  }

  if (settings.permissionMode === "ask-first") {
    return {
      allowed: false,
      reason: "Ask-first mode requires the user to confirm each write. Tell the user what you want to write and ask them to approve.",
    };
  }

  if (!roots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    return {
      allowed: false,
      reason: buildOutsideWorkspaceMessage(path, resolvedPath, roots),
    };
  }

  return {
    allowed: true,
  };
}

export function resolveBroadSearchRoots(settings: LocalWorkspaceSettings, roots: string[], args: Record<string, string>) {
  const requestedRoot = firstArg(args, ["root", "roots", "directory_path", "folder_path", "directory", "folder", "cwd"]);

  if (requestedRoot) {
    const resolvedRoot = resolveWorkspacePath(requestedRoot, roots);
    return roots.some((root) => isPathInsideRoot(resolvedRoot, root)) ? [resolvedRoot] : [];
  }

  if (settings.scope === "full-computer") {
    return getIndexableWorkspaceRoots(roots, settings.scope);
  }

  return roots;
}

export function skipFullComputerBroadSearch() {
  return {
    content: [
      "Skipped broad full-computer search.",
      "Full computer access is lazy and does not build or query a whole-drive index automatically.",
      "Provide a specific directory_path/folder_path/root for search_files/recall_context, or use list_directory/read_file with an explicit path.",
    ].join("\n"),
    executed: false,
  };
}
