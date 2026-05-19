import type { ProviderToolBridgeOptions, ToolDefinition, ToolResultMessage } from "../types";
import type { ProviderReasoningState } from "../../types/reasoning";
import { finalizeToolResult } from "../resultFinalizer";
import { appendInlineUserToolResultMessages, createProviderVisibleToolSchema, decrementRemainingChars, normalizeRemainingChars } from "./sharedUtils";

export function applyAnthropicToolBridge(body: Record<string, unknown>, options: ProviderToolBridgeOptions) {
  const tools = options.toolChoice === "none" ? [] : options.tools ?? [];

  if (tools.length > 0) {
    body.tools = tools.map(createAnthropicToolSchema);

    if (options.toolChoice === "required") {
      body.tool_choice = { type: "any" };
    } else if (options.toolChoice === "auto") {
      body.tool_choice = { type: "auto" };
    }
  } else if (options.toolChoice === "none") {
    // Anthropic treats absent tools as the disable signal when no tools are attached.
    delete body.tools;
    delete body.tool_choice;
  }

  if (options.toolResultMessages?.length) {
    body.messages = options.toolResultDelivery === "inline-user-message"
      ? appendInlineUserToolResultMessages(body.messages, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
        })
      : appendAnthropicToolResultMessages(body.messages, options.toolResultMessages, {
          maxToolResultContentChars: options.maxToolResultContentChars,
          reasoningState: options.reasoningState,
          skipAssistantTurn: Boolean(options.resultsHistoryAlreadyContainsAssistantTurns),
        });
  }

  return body;
}

export function createAnthropicToolSchema(tool: ToolDefinition) {
  const schema = createProviderVisibleToolSchema(tool);

  return {
    description: schema.description,
    input_schema: schema.inputSchema,
    name: schema.name,
  };
}

function appendAnthropicToolResultMessages(
  currentMessages: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null; reasoningState?: ProviderReasoningState; skipAssistantTurn: boolean },
) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    if (!options.skipAssistantTurn) {
      messages.push({
        content: [
          ...createAnthropicReasoningBlocks(options.reasoningState),
          {
            id: result.callId,
            input: result.arguments ?? {},
            name: result.name,
            type: "tool_use",
          },
        ],
        role: "assistant",
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
      content: [
        {
          content,
          is_error: !result.result.ok,
          tool_use_id: result.callId,
          type: "tool_result",
        },
      ],
      role: "user",
    });
  }

  return messages;
}

function createAnthropicReasoningBlocks(reasoningState: ProviderReasoningState | undefined) {
  if (reasoningState?.format !== "anthropic-thinking") {
    return [];
  }

  return reasoningState.entries
    .filter((entry) => entry.type === "thinking" || entry.type === "redacted_thinking")
    .map((entry) => entry.value)
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)));
}
