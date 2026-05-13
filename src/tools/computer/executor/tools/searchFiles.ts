import { buildComputerFileIndex, searchComputerFiles } from "../../files";
import { firstArg, optionalNumberArg, skipNoRoots } from "../argHelpers";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";
import { resolveBroadSearchRoots, skipFullComputerBroadSearch } from "../workspacePolicy";
import { formatSearchResults } from "../workspaceFormatters";

export async function executeSearchFilesHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  const query = firstArg(call.args, ["query", "q", "text"]) || context.userPrompt;
  const limit = optionalNumberArg(call.args, ["limit"]);
  const searchRoots = resolveBroadSearchRoots(context.settings, context.roots, call.args);

  if (searchRoots.length === 0) {
    return skipFullComputerBroadSearch();
  }

  let results = await searchComputerFiles(query, limit, searchRoots);

  if (results.length === 0) {
    await buildComputerFileIndex(searchRoots, context.settings.scope).catch(() => undefined);
    results = await searchComputerFiles(query, limit, searchRoots);
  }

  return {
    content: formatSearchResults(query, results),
    executed: true,
  };
}
