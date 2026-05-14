import type { ModelProviderId } from "../../types/settings";
import type { ToolCallRequest } from "../types";
import { createToolCallRequest } from "./common";

const MAX_VISIBLE_TEXT_TOOL_CALLS = 8;
const TOOL_NAME_PATTERN = /^(?:files_|git_|terminal_|browser_|web_|github_|bridge_)[\w.-]+$/i;

export function parseVisibleTextToolCalls(content: string, provider: ModelProviderId): ToolCallRequest[] {
  if (!/"tool_calls"\s*:\s*\[/i.test(content)) {
    return [];
  }

  const parsedJsonCalls = parseJsonToolCalls(content, provider);
  if (parsedJsonCalls.length > 0) {
    return parsedJsonCalls;
  }

  return parseLooseToolCalls(content, provider);
}

function parseJsonToolCalls(content: string, provider: ModelProviderId) {
  const objectText = extractFirstJsonObject(content);
  if (!objectText) {
    return [];
  }

  try {
    const parsed = JSON.parse(objectText) as { tool_calls?: unknown };
    if (!Array.isArray(parsed.tool_calls)) {
      return [];
    }

    return parsed.tool_calls.flatMap((call, index) => {
      if (!call || typeof call !== "object" || Array.isArray(call)) {
        return [];
      }

      const record = call as Record<string, unknown>;
      const fn = record.function;
      const name = typeof fn === "string"
        ? fn
        : fn && typeof fn === "object" && !Array.isArray(fn)
          ? (fn as { name?: unknown }).name
          : undefined;
      const args = typeof fn === "object" && fn !== null && !Array.isArray(fn) && "arguments" in fn
        ? (fn as { arguments?: unknown }).arguments
        : record.parameters ?? record.arguments ?? {};
      const request = createToolCallRequest(provider, record.id ?? `visible-tool-call-${index + 1}`, name, args, call);

      return request && isLikelyBridgeToolName(request.name) ? [request] : [];
    }).slice(0, MAX_VISIBLE_TEXT_TOOL_CALLS);
  } catch {
    return [];
  }
}

function parseLooseToolCalls(content: string, provider: ModelProviderId) {
  const calls: ToolCallRequest[] = [];
  const functionPattern = /"function"\s*:\s*(?:"([^"]+)"|\{[\s\S]{0,700}?"name"\s*:\s*"([^"]+)")/gi;
  let match: RegExpExecArray | null;

  while ((match = functionPattern.exec(content)) && calls.length < MAX_VISIBLE_TEXT_TOOL_CALLS) {
    const name = match[1] ?? match[2] ?? "";
    if (!isLikelyBridgeToolName(name)) {
      continue;
    }

    const afterFunction = content.slice(functionPattern.lastIndex);
    const id = findNearestCallId(content.slice(Math.max(0, match.index - 400), match.index));
    const args = extractLooseArguments(afterFunction);
    const request = createToolCallRequest(provider, id ?? `visible-tool-call-${calls.length + 1}`, name, args, {
      recoveredFromVisibleText: true,
    });

    if (request) {
      calls.push(request);
    }
  }

  return calls;
}

function extractFirstJsonObject(content: string) {
  const start = content.indexOf("{");
  if (start < 0) {
    return null;
  }

  const end = findBalancedObjectEnd(content, start);
  return end > start ? content.slice(start, end + 1) : null;
}

function extractLooseArguments(contentAfterFunction: string) {
  const parametersMatch = /"(?:parameters|arguments)"\s*:/i.exec(contentAfterFunction);
  if (!parametersMatch) {
    return {};
  }

  const valueStart = parametersMatch.index + parametersMatch[0].length;
  const rest = contentAfterFunction.slice(valueStart).trimStart();

  if (rest.startsWith("{")) {
    const end = findBalancedObjectEnd(rest, 0);
    const objectText = end >= 0 ? rest.slice(0, end + 1) : "";
    return parseLooseObject(objectText);
  }

  const quoted = /^"((?:\\.|[^"\\])*)"/.exec(rest);
  if (!quoted) {
    return {};
  }

  const argumentText = quoted[1]?.replace(/\\"/g, "\"").replace(/\\\\/g, "\\") ?? "";
  try {
    return JSON.parse(argumentText);
  } catch {
    return parseLooseObject(argumentText);
  }
}

function parseLooseObject(objectText: string) {
  try {
    return JSON.parse(objectText);
  } catch {
    const result: Record<string, unknown> = {};
    const stringPattern = /"([\w.$-]+)"\s*:\s*"([^"]*)"/g;
    const scalarPattern = /"([\w.$-]+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)\b/g;
    let match: RegExpExecArray | null;

    while ((match = stringPattern.exec(objectText))) {
      result[match[1] ?? ""] = match[2] ?? "";
    }

    while ((match = scalarPattern.exec(objectText))) {
      const key = match[1] ?? "";
      const value = match[2] ?? "";
      result[key] = value === "true" ? true : value === "false" ? false : value === "null" ? null : Number(value);
    }

    return result;
  }
}

function findBalancedObjectEnd(content: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];

    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findNearestCallId(prefix: string) {
  const matches = [...prefix.matchAll(/"id"\s*:\s*"([^"]+)"/gi)];
  return matches[matches.length - 1]?.[1];
}

function isLikelyBridgeToolName(name: unknown): name is string {
  return typeof name === "string" && TOOL_NAME_PATTERN.test(name.trim());
}
