import { executeWorkflowRunTool } from "../../../workflows";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeWorkflowRunHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  return executeWorkflowRunTool(call, context);
}
