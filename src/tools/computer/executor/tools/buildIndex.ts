import { buildComputerFileIndex } from "../../files";
import { skipNoRoots } from "../argHelpers";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeBuildIndexHandler(
  _call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  const summary = await buildComputerFileIndex(context.roots, context.settings.scope);

  return {
    content: [
      `Indexed entries: ${summary.entryCount}`,
      `Scanned folders: ${summary.scannedDirectories}`,
      `Skipped entries: ${summary.skippedEntries}`,
      `Stopped at explicit index limit: ${summary.truncated ? "yes" : "no"}`,
      `Roots: ${summary.roots.join(" | ")}`,
    ].join("\n"),
    executed: true,
  };
}
