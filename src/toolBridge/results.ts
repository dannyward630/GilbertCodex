import type { ChatToolCall } from "../types/chat";
import type { TerminalShellId } from "../types/terminal";
import type { JsonValue, ToolCallRequest, ToolDefinition, ToolExecutionResult } from "./types";
import { createToolResultContent, finalizeToolResult, limitToolResultContentForProvider } from "./resultFinalizer";

// Prefix applied to synthesized ChatToolCall IDs so downstream consumers can correlate bridge calls.
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
      ? finalization.toolRecordContent
      : result.error ?? result.skippedReason ?? finalization.toolRecordContent,
    resultPolicy: finalization.visiblePolicy,
    status,
    terminal: extractTerminalMetadata(result),
    toolId,
  };
}

function extractTerminalMetadata(result: ToolExecutionResult): ChatToolCall["terminal"] {
  const data = result.data;

  if (!data || typeof data !== "object" || Array.isArray(data) || !("terminal" in data)) {
    return undefined;
  }

  const terminal = (data as { terminal?: unknown }).terminal;

  if (!terminal || typeof terminal !== "object" || Array.isArray(terminal)) {
    return undefined;
  }

  const record = terminal as Record<string, unknown>;
  return {
    command: typeof record.command === "string" ? record.command : undefined,
    exitCode: typeof record.exitCode === "number" || record.exitCode === null ? record.exitCode : undefined,
    live: record.live === true ? true : record.live === false ? false : undefined,
    outputTruncated: record.outputTruncated === true ? true : record.outputTruncated === false ? false : undefined,
    sessionId: typeof record.sessionId === "string" ? record.sessionId : undefined,
    shell: normalizeTerminalShell(record.shell),
    timedOut: record.timedOut === true ? true : record.timedOut === false ? false : undefined,
    workingDirectory: typeof record.workingDirectory === "string" ? record.workingDirectory : undefined,
  };
}

function normalizeTerminalShell(value: unknown): TerminalShellId | undefined {
  return value === "powershell" || value === "cmd" || value === "bash" || value === "zsh" || value === "sh"
    ? value
    : undefined;
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

// JSON.stringify wrapper that replaces circular references and falls back to String(value).
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
