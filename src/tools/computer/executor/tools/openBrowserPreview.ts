import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeOpenBrowserPreviewHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  return context.executeOpenBrowserPreviewTool
    ? await context.executeOpenBrowserPreviewTool(call)
    : { content: "open_browser_preview is not available in this runtime.", executed: false };
}
