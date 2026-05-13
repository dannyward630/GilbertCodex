import { executeWeatherTool } from "../../../weather";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeWeatherHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  const result = await executeWeatherTool(call.args, context.userPrompt, { signal: context.signal });

  return {
    content: result.content,
    executed: !result.isError,
    is_error: result.isError === true,
    errorCode: result.errorCode,
    sources: result.sources,
  };
}
