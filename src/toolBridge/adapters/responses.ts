import type { ProviderToolBridgeOptions, ToolDefinition, ToolResultMessage } from "../types";
import { finalizeToolResult } from "../resultFinalizer";
import { createInlineToolResultMessage, decrementRemainingChars, normalizeRemainingChars } from "./sharedUtils";

export function applyResponsesToolBridge(body: Record<string, unknown>, options: ProviderToolBridgeOptions) {
  const tools = options.toolChoice === "none" ? [] : options.tools ?? [];

  if (tools.length > 0) {
    body.tools = tools.map(createResponsesToolSchema);
    body.tool_choice = options.toolChoice ?? "auto";
  } else if (options.toolChoice === "none" && options.toolResultDelivery !== "inline-user-message") {
    body.tool_choice = "none";
    delete body.tools;
  } else if (options.toolResultDelivery === "inline-user-message") {
    delete body.tool_choice;
    delete body.tools;
  }

  if (options.toolResultMessages?.length) {
    body.input = options.toolResultDelivery === "inline-user-message"
      ? appendInlineUserToolResultItems(body.input, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
        })
      : appendResponsesToolResultItems(body.input, options.toolResultMessages, {
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
    const finalization = finalizeToolResult({
      arguments: result.arguments,
      maxProviderChars: remainingToolResultChars,
      result: result.result,
      toolId: result.name,
    });
    const output = finalization.providerContent;
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, finalization.providerRawCharCount);

    input.push({
      call_id: result.callId,
      output,
      type: "function_call_output",
    });
  }

  return input;
}

function appendInlineUserToolResultItems(
  currentInput: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null },
) {
  const input = Array.isArray(currentInput) ? [...currentInput] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    const inlineResult = createInlineToolResultMessage(result, remainingToolResultChars);
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, inlineResult.providerRawCharCount);
    input.push({
      content: inlineResult.content,
      role: "user",
    });
  }

  return input;
}
