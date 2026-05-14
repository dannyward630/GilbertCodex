import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";

let toolCallIdCounter = 0;

export interface ParseToolArgumentsResult {
  error?: string;
  value: unknown;
}

/**
 * Back-compat: returns the parsed value if `value` is a JSON string, or the
 * raw `value` if parsing fails. Prefer {@link parseToolCallArgumentsDetailed}
 * inside the tool bridge so the parse error can be surfaced explicitly.
 */
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
  const resolvedId = typeof id === "string" && id.trim() ? id : nextFallbackToolCallId(trimmedName);

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

/**
 * Monotonic, collision-free fallback id for tool calls whose provider failed
 * to supply one. Deterministic within a process — tests can reset it via
 * {@link __resetToolCallIdCounterForTests}.
 */
function nextFallbackToolCallId(name: string): string {
  toolCallIdCounter += 1;
  return `${name}-fallback-${toolCallIdCounter}`;
}

export function __resetToolCallIdCounterForTests() {
  toolCallIdCounter = 0;
}
