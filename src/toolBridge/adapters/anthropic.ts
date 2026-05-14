import type { ProviderToolBridgeOptions, ToolDefinition, ToolResultMessage } from "../types";
import { formatToolResultContent } from "../results";

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
    // Anthropic does not support a "none" tool_choice when there are no
    // tools attached; the absence of `tools` is itself the disable signal.
    delete body.tools;
    delete body.tool_choice;
  }

  if (options.toolResultMessages?.length) {
    body.messages = appendAnthropicToolResultMessages(body.messages, options.toolResultMessages, {
      maxToolResultContentChars: options.maxToolResultContentChars,
      skipAssistantTurn: Boolean(options.resultsHistoryAlreadyContainsAssistantTurns),
    });
  }

  return body;
}

export function createAnthropicToolSchema(tool: ToolDefinition) {
  return {
    description: tool.description,
    input_schema: tool.inputSchema,
    name: tool.id,
  };
}

function appendAnthropicToolResultMessages(
  currentMessages: unknown,
  results: ToolResultMessage[],
  options: { maxToolResultContentChars?: number | null; skipAssistantTurn: boolean },
) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  let remainingToolResultChars = normalizeRemainingChars(options.maxToolResultContentChars);

  for (const result of results) {
    if (!options.skipAssistantTurn) {
      messages.push({
        content: [
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
    const rawContent = formatToolResultContent(result.result);
    const content = formatToolResultContent(result.result, { maxChars: remainingToolResultChars });
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, rawContent.length);

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

function normalizeRemainingChars(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(Math.floor(value), 0);
}

function decrementRemainingChars(remaining: number | null, rawLength: number) {
  return remaining === null ? null : Math.max(remaining - rawLength, 0);
}
