import { skipNoRoots } from "../argHelpers";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeCreateToolHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  return context.executeCreateTool
    ? await context.executeCreateTool(call)
    : { content: "create_tool is not available in this runtime.", executed: false };
}
