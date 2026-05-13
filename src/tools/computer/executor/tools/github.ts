import { executeGithubTool } from "../../../github";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";

export async function executeGithubHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  const result = await executeGithubTool(call.tool as Parameters<typeof executeGithubTool>[0], call.args, {
    userPrompt: context.userPrompt,
  });

  return {
    content: result.content,
    directAnswer: result.directAnswer,
    executed: result.executed,
    is_error: result.isError === true,
    errorCode: result.errorCode,
    sources: result.sources,
  };
}
