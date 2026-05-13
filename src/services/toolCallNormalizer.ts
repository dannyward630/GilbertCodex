/**
 * Dormant bridge for provider-native tool calls (Anthropic `tool_use` blocks, OpenAI
 * `tool_calls` array) into the same `<tool_call>` XML shape that the existing
 * `parseLocalComputerToolCalls` parser already understands. Live requests do
 * not send native tools; this remains for the later proper-native path.
 */

export interface AnthropicToolUseBlock {
  id?: string;
  input?: unknown;
  name?: string;
  type?: string;
}

export interface OpenAIToolCall {
  function?: {
    arguments?: string;
    name?: string;
  };
  id?: string;
  index?: number;
  type?: string;
}

/** Build a single synthesized XML block from a tool name + args object. */
export function serializeToolCallToXml(name: string, args: Record<string, unknown> | undefined): string {
  if (!name) {
    return "";
  }

  const pieces: string[] = ["<tool_call>", escapeXmlText(name)];

  if (args && typeof args === "object") {
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined) {
        continue;
      }
      pieces.push(`<arg_key>${escapeXmlText(String(key))}</arg_key><arg_value>${escapeXmlText(stringifyArgValue(value))}</arg_value>`);
    }
  }

  pieces.push("</tool_call>");
  return pieces.join("\n");
}

export function serializeAnthropicToolUses(blocks: AnthropicToolUseBlock[]): string {
  return blocks
    .filter((block) => block && block.type === "tool_use" && typeof block.name === "string" && block.name.length > 0)
    .map((block) => {
      const args = coerceArgsRecord(block.input);
      return serializeToolCallToXml(block.name as string, args);
    })
    .filter((xml) => xml.length > 0)
    .join("\n");
}

export function serializeOpenAIToolCalls(toolCalls: OpenAIToolCall[]): string {
  return toolCalls
    .filter((call) => call && (!call.type || call.type === "function") && typeof call.function?.name === "string")
    .map((call) => {
      const args = parseOpenAIArgumentsString(call.function?.arguments);
      return serializeToolCallToXml(call.function?.name as string, args);
    })
    .filter((xml) => xml.length > 0)
    .join("\n");
}

function parseOpenAIArgumentsString(raw: string | undefined): Record<string, unknown> | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return coerceArgsRecord(parsed);
  } catch {
    // Some models emit args as `key=value` lines or near-JSON. Fall back to
    // a single-arg blob so the downstream parser at least sees the payload.
    return { raw: trimmed };
  }
}

function coerceArgsRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (Array.isArray(value)) {
    return { files_json: value };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      if (Array.isArray(parsed)) {
        return { files_json: parsed };
      }
    } catch {
      // Not JSON — leave as a single-arg blob below.
    }
    return { raw: trimmed };
  }
  return { value: String(value) };
}

function stringifyArgValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function escapeXmlText(value: string): string {
  // Minimal XML escape — the parser already decodes &amp;/&lt;/&gt;/&quot;/&apos;.
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Helper for streaming accumulators. Aggregates OpenAI tool-call deltas. */
export interface OpenAIToolCallAccumulator {
  argumentsText: string;
  id?: string;
  index: number;
  name: string;
}

export function applyOpenAIToolCallDelta(
  accumulators: Map<number, OpenAIToolCallAccumulator>,
  delta: Array<{
    function?: { arguments?: string; name?: string };
    id?: string;
    index?: number;
    type?: string;
  }>,
): void {
  for (const entry of delta) {
    const index = typeof entry.index === "number" ? entry.index : 0;
    const existing = accumulators.get(index);
    if (!existing) {
      accumulators.set(index, {
        argumentsText: entry.function?.arguments ?? "",
        id: entry.id,
        index,
        name: entry.function?.name ?? "",
      });
      continue;
    }
    if (entry.id && !existing.id) {
      existing.id = entry.id;
    }
    if (entry.function?.name) {
      existing.name = existing.name || entry.function.name;
    }
    if (entry.function?.arguments) {
      existing.argumentsText += entry.function.arguments;
    }
  }
}

export function finalizeOpenAIAccumulatedToolCalls(accumulators: Map<number, OpenAIToolCallAccumulator>): OpenAIToolCall[] {
  return [...accumulators.values()]
    .sort((a, b) => a.index - b.index)
    .map((acc) => ({
      function: {
        arguments: acc.argumentsText,
        name: acc.name,
      },
      id: acc.id,
      index: acc.index,
      type: "function",
    }));
}
