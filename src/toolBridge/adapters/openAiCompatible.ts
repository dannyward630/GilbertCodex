import type { ProviderToolBridgeOptions, ToolDefinition, ToolResultMessage } from "../types";
import { finalizeToolResult } from "../resultFinalizer";
import { decrementRemainingChars, normalizeRemainingChars } from "./sharedUtils";

export function applyOpenAiCompatibleToolBridge(body: Record<string, unknown>, options: ProviderToolBridgeOptions) {
  const tools = options.toolChoice === "none" ? [] : options.tools ?? [];

  if (tools.length > 0) {
    body.tools = tools.map(createOpenAiCompatibleToolSchema);
    body.tool_choice = options.toolChoice ?? "auto";
  } else if (options.toolChoice === "none") {
    // Propagate the explicit disable signal so callers can suppress additional
    // tool calls mid-conversation.
    body.tool_choice = "none";
    delete body.tools;
  }

  if (options.toolResultMessages?.length) {
    body.messages = appendOpenAiCompatibleToolResultMessages(body.messages, options.toolResultMessages, {
      maxToolResultContentChars: options.maxToolResultContentChars,
      skipAssistantTurn: Boolean(options.resultsHistoryAlreadyContainsAssistantTurns),
    });
  }

  return body;
}

export function createOpenAiCompatibleToolSchema(tool: ToolDefinition) {
  return {
    function: {
      description: tool.description,
      name: tool.id,
      parameters: tool.inputSchema,
    },
    type: "function",
  };
}

function appendOpenAiCompatibleToolResultMessages(
  currentMessages: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null; skipAssistantTurn: boolean },
) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    if (!options.skipAssistantTurn) {
      messages.push({
        content: null,
        role: "assistant",
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify(result.arguments ?? {}),
              name: result.name,
            },
            id: result.callId,
            type: "function",
          },
        ],
      });
    }
    const finalization = finalizeToolResult({
      arguments: result.arguments,
      maxProviderChars: remainingToolResultChars,
      result: result.result,
      toolId: result.name,
    });
    const content = finalization.providerContent;
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, finalization.providerRawCharCount);

    messages.push({
      content,
      role: "tool",
      tool_call_id: result.callId,
    });
  }

  return messages;
}
