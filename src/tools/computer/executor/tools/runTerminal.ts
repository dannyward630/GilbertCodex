import { skipNoRoots } from "../argHelpers";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeRunTerminalHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  return context.executeTerminalTool
    ? await context.executeTerminalTool(call)
    : { content: "run_terminal is not available in this runtime.", executed: false };
}
