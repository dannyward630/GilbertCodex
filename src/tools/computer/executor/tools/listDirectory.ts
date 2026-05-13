import { listComputerDirectory } from "../../files";
import { assertReadablePath, firstArg, optionalNumberArg, resolveWorkspacePath, skipNoRoots } from "../argHelpers";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";
import { formatDirectoryListing } from "../workspaceFormatters";

export async function executeListDirectoryHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  const path = resolveWorkspacePath(firstArg(call.args, ["path", "directory_path", "folder_path"]) || context.roots[0], context.roots);
  assertReadablePath(path, context.roots);
  const listing = await listComputerDirectory(path, optionalNumberArg(call.args, ["limit"]));

  return {
    content: formatDirectoryListing(listing),
    executed: true,
  };
}
