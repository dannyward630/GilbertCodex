import type { ProviderToolBridgeOptions, ToolDefinition, ToolResultMessage } from "../types";
import { formatToolResultContent } from "../results";

export function applyResponsesToolBridge(body: Record<string, unknown>, options: ProviderToolBridgeOptions) {
  const tools = options.toolChoice === "none" ? [] : options.tools ?? [];

  if (tools.length > 0) {
    body.tools = tools.map(createResponsesToolSchema);
    body.tool_choice = options.toolChoice ?? "auto";
  } else if (options.toolChoice === "none") {
    body.tool_choice = "none";
    delete body.tools;
  }

  if (options.toolResultMessages?.length) {
    body.input = appendResponsesToolResultItems(body.input, options.toolResultMessages, {
      maxToolResultContentChars: options.maxToolResultContentChars,
      skipAssistantTurn: Boolean(options.resultsHistoryAlreadyContainsAssistantTurns),
    });
  }

  return body;
}

export function createResponsesToolSchema(tool: ToolDefinition) {
  return {
    description: tool.description,
    name: tool.id,
    parameters: tool.inputSchema,
    type: "function",
  };
}

function appendResponsesToolResultItems(
  currentInput: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null; skipAssistantTurn: boolean },
) {
  const input = Array.isArray(currentInput) ? [...currentInput] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    if (!options.skipAssistantTurn) {
      input.push({
        arguments: JSON.stringify(result.arguments ?? {}),
        call_id: result.callId,
        name: result.name,
        type: "function_call",
      });
    }
    const rawContent = formatToolResultContent(result.result);
    const output = formatToolResultContent(result.result, { maxChars: remainingToolResultChars });
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, rawContent.length);

    input.push({
      call_id: result.callId,
      output,
      type: "function_call_output",
    });
  }

  return input;
}

function normalizeRemainingChars(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(Math.floor(value), 0);
}

function decrementRemainingChars(remaining: number | null, rawLength: number) {
  return remaining === null ? null : Math.max(remaining - rawLength, 0);
}
