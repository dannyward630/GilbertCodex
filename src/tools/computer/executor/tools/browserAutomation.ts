import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeBrowserAutomationHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  return context.executeBrowserAutomationTool
    ? await context.executeBrowserAutomationTool(call)
    : { content: "browser_automation is not available in this runtime.", executed: false };
}
