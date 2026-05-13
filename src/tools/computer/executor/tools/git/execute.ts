import { skipNoRoots } from "../../argHelpers";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../../types";

export async function executeGitHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  return context.executeGitTool
    ? await context.executeGitTool(call)
    : { content: `${call.tool} is not available in this runtime.`, executed: false };
}
