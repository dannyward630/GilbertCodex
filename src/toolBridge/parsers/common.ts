import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";

let toolCallIdCounter = 0;

export interface ParseToolArgumentsResult {
  error?: string;
  value: unknown;
}

// Back-compat parser that returns raw input on JSON failure; bridge code should use the detailed variant.
export function parseToolCallArguments(value: unknown) {
  const result = parseToolCallArgumentsDetailed(value);
  return result.value;
}

export function parseToolCallArgumentsDetailed(value: unknown): ParseToolArgumentsResult {
  if (typeof value !== "string") {
    return { value: value ?? {} };
  }

  if (!value.trim()) {
    return { value: {} };
  }

  try {
    return { value: JSON.parse(value) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool arguments are not valid JSON.";
    return {
      error: `Could not parse tool arguments as JSON: ${message}`,
      value,
    };
  }
}

export function createToolCallRequest(
  provider: ModelProviderId,
  id: unknown,
  name: unknown,
  args: unknown,
  raw?: unknown,
): ToolCallRequest | null {
  if (typeof name !== "string" || !name.trim()) {
    return null;
  }

  const trimmedName = name.trim();
  const parsed = parseToolCallArgumentsDetailed(args);
  // Trim provider IDs so dedupe, telemetry, and result-message correlation ignore surrounding whitespace.
  const trimmedId = typeof id === "string" ? id.trim() : "";
  const resolvedId = trimmedId ? trimmedId : nextFallbackToolCallId(trimmedName);

  const request: ToolCallRequest = {
    arguments: parsed.error ? {} : parsed.value,
    id: resolvedId,
    name: trimmedName,
    provider,
    raw,
  };

  if (parsed.error) {
    request.argumentsParseError = parsed.error;
  }

  return request;
}

// Monotonic fallback ID for provider tool calls that arrive without IDs.
function nextFallbackToolCallId(name: string): string {
  toolCallIdCounter += 1;
  return `${name}-fallback-${toolCallIdCounter}`;
}

export function __resetToolCallIdCounterForTests() {
  toolCallIdCounter = 0;
}
