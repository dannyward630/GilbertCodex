import type { ChatToolCall } from "../types/chat";
import type { JsonValue, ToolCallRequest, ToolDefinition, ToolExecutionResult } from "./types";

/**
 * Prefix applied to every `ChatToolCall.id` we synthesize from a bridge call.
 * Exported so consumers downstream can correlate or strip it.
 */
export const BRIDGE_TOOL_CALL_ID_PREFIX = "bridge-";

export interface ToolResultContentFormatOptions {
  maxChars?: number | null;
}

export function formatToolResultContent(result: ToolExecutionResult, options: ToolResultContentFormatOptions = {}) {
  const content = createToolResultContent(result);

  return limitToolResultContentForProvider(content, options.maxChars);
}

function createToolResultContent(result: ToolExecutionResult) {
  if (result.content.trim()) {
    return result.content.trim();
  }

  if (result.error) {
    return result.error;
  }

  if (result.data !== undefined) {
    return safeStringify(result.data);
  }

  return result.ok ? "Tool completed." : "Tool did not complete.";
}

function limitToolResultContentForProvider(content: string, maxChars: number | null | undefined) {
  if (maxChars === null || maxChars === undefined || !Number.isFinite(maxChars)) {
    return content;
  }

  const limit = Math.floor(maxChars);

  if (limit <= 0) {
    return [
      "[Tool output omitted from provider context because the model-visible tool-result budget was already used.]",
      "The full result is saved in Activity. Use files_search or a narrower files_read/files_read_many call if exact content is still needed.",
    ].join("\n");
  }

  if (content.length <= limit) {
    return content;
  }

  const marker = [
    "",
    `[Tool output truncated for provider context after ${limit.toLocaleString("en-US")} characters.]`,
    "The full result is saved in Activity. Use files_search or a narrower files_read/files_read_many call if exact omitted content is still needed.",
  ].join("\n");
  const sliceLength = Math.max(0, limit - marker.length);

  return `${content.slice(0, sliceLength).trimEnd()}${marker}`;
}

export function createBridgeChatToolCall(
  call: ToolCallRequest,
  tool: ToolDefinition | undefined,
  result: ToolExecutionResult,
  status: ChatToolCall["status"],
): ChatToolCall {
  return {
    detail: result.error || result.skippedReason || undefined,
    id: `${BRIDGE_TOOL_CALL_ID_PREFIX}${call.id}`,
    input: safeStringify(call.arguments ?? {}),
    label: tool?.title ?? call.name,
    output: result.ok
      ? formatToolResultContent(result)
      : result.error ?? result.skippedReason ?? formatToolResultContent(result),
    status,
  };
}

/**
 * JSON.stringify that swaps circular references with the string
 * "[Circular]" instead of throwing. Falls back to `String(value)` if
 * stringification still throws (e.g. unserializable BigInt with no
 * `toJSON`).
 */
export function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  try {
    return JSON.stringify(value, (_key, current: unknown) => {
      if (typeof current === "bigint") {
        return current.toString();
      }

      if (current !== null && typeof current === "object") {
        if (seen.has(current as object)) {
          return "[Circular]";
        }
        seen.add(current as object);
      }

      return current as JsonValue;
    }) ?? "";
  } catch {
    try {
      return String(value);
    } catch {
      return "";
    }
  }
}
