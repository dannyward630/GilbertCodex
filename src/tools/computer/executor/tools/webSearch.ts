import { executeWebSearchTool } from "../../../web/webToolExecutor";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeWebSearchHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  const result = await executeWebSearchTool(call.args, context.userPrompt, context.webSearchMaxResults, context.webSearchSettings, {
    signal: context.signal,
  });

  return {
    content: result.content,
    executed: !result.isError,
    is_error: result.isError === true,
    errorCode: result.errorCode,
    sources: result.sources,
  };
}
