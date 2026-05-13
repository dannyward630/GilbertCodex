import { executeMoveOrRenamePathHandler } from "./movePath";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeRenamePathHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  return executeMoveOrRenamePathHandler(call, context);
}
