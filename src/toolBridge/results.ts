import type { ChatToolCall } from "../types/chat";
import type { JsonValue, ToolCallRequest, ToolDefinition, ToolExecutionResult } from "./types";
import { createToolResultContent, finalizeToolResult, limitToolResultContentForProvider } from "./resultFinalizer";

// Prefix applied to every ChatToolCall.id we synthesize from a bridge call.
// Exported so downstream consumers can correlate or strip it.
export const BRIDGE_TOOL_CALL_ID_PREFIX = "bridge-";

export interface ToolResultContentFormatOptions {
  maxChars?: number | null;
}

export function formatToolResultContent(result: ToolExecutionResult, options: ToolResultContentFormatOptions = {}) {
  const content = createToolResultContent(result);

  return limitToolResultContentForProvider(content, options.maxChars);
}

export function createBridgeChatToolCall(
  call: ToolCallRequest,
  tool: ToolDefinition | undefined,
  result: ToolExecutionResult,
  status: ChatToolCall["status"],
): ChatToolCall {
  const toolId = tool?.id ?? call.name;
  const finalization = finalizeToolResult({
    arguments: call.arguments,
    label: tool?.title ?? call.name,
    result,
    toolId,
  });

  return {
    detail: result.error || result.skippedReason || undefined,
    fileChanges: extractFileChanges(result),
    id: `${BRIDGE_TOOL_CALL_ID_PREFIX}${call.id}`,
    input: safeStringify(call.arguments ?? {}),
    label: tool?.title ?? call.name,
    output: result.ok
      ? finalization.activityContent
      : result.error ?? result.skippedReason ?? finalization.activityContent,
    resultPolicy: finalization.visiblePolicy,
    status,
    toolId,
  };
}

function extractFileChanges(result: ToolExecutionResult): ChatToolCall["fileChanges"] {
  const data = result.data;

  if (!data || typeof data !== "object" || Array.isArray(data) || !("fileChanges" in data)) {
    return undefined;
  }

  const fileChanges = (data as { fileChanges?: unknown }).fileChanges;

  if (!Array.isArray(fileChanges)) {
    return undefined;
  }

  return fileChanges.flatMap((change) => {
    if (!change || typeof change !== "object" || Array.isArray(change)) {
      return [];
    }

    const record = change as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path : "";
    const additions = typeof record.additions === "number" ? record.additions : 0;
    const deletions = typeof record.deletions === "number" ? record.deletions : 0;

    if (!path) {
      return [];
    }

    return [{
      additions,
      deletions,
      diffPreview: normalizeDiffPreview(record.diffPreview),
      diffTruncated: record.diffTruncated === true,
      kind: normalizeFileChangeKind(record.kind),
      path,
    }];
  });
}

function normalizeDiffPreview(value: unknown): NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      return [];
    }

    const record = line as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content : "";
    const kind = record.kind === "add" || record.kind === "context" || record.kind === "hunk" || record.kind === "meta" || record.kind === "remove"
      ? record.kind
      : undefined;

    if (!kind) {
      return [];
    }

    return [{
      content,
      kind,
      newLine: typeof record.newLine === "number" ? record.newLine : undefined,
      oldLine: typeof record.oldLine === "number" ? record.oldLine : undefined,
    }];
  });
}

function normalizeFileChangeKind(value: unknown): NonNullable<ChatToolCall["fileChanges"]>[number]["kind"] {
  return value === "create" || value === "delete" || value === "move" || value === "update" ? value : undefined;
}

// JSON.stringify wrapper that replaces circular references with "[Circular]"
// instead of throwing. Falls back to String(value) if stringification still
// throws (e.g. unserializable BigInt with no `toJSON`).
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
