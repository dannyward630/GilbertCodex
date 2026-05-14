// Shared adapter helpers for budgeting model-visible tool output while preserving full tool records.

import type { ToolResultMessage } from "../types";
import { finalizeToolResult } from "../resultFinalizer";

export function normalizeRemainingChars(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(Math.floor(value), 0);
}

export function decrementRemainingChars(remaining: number | null, rawLength: number): number | null {
  if (remaining === null) {
    return null;
  }
  return Math.max(remaining - rawLength, 0);
}

export function createInlineToolResultMessage(result: ToolResultMessage, remainingChars: number | null) {
  const finalization = finalizeToolResult({
    arguments: result.arguments,
    maxProviderChars: remainingChars,
    result: result.result,
    toolId: result.name,
  });
  const content = [
    "TOOL RESULT EVIDENCE",
    `Tool: ${result.name}`,
    `Call id: ${result.callId}`,
    `Status: ${result.result.ok ? "complete" : "error"}`,
    `Arguments: ${safeInlineJson(result.arguments ?? {})}`,
    "Output:",
    finalization.providerContent,
  ].join("\n");

  return {
    content,
    providerRawCharCount: finalization.providerRawCharCount,
  };
}

function safeInlineJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}
