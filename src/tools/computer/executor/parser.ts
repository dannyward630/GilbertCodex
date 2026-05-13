import { hasReachedToolCallLimit, normalizeArgName, preserveArgValue } from "./argHelpers";
import {
  STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  type LocalComputerToolExecutionPolicy,
} from "./policy";
import { isToolNamePlaceholder, normalizeToolName } from "./toolNames";
import type { ParsedLocalComputerToolCall } from "./types";
export function parseLocalComputerToolCalls(content: string, executionPolicy: LocalComputerToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY): ParsedLocalComputerToolCall[] {
  const calls: ParsedLocalComputerToolCall[] = [];
  const scanContent = limitToolCallScanContent(content, executionPolicy);
  const xmlCallRegex = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = xmlCallRegex.exec(scanContent))) {
    for (const call of parseXmlToolCalls(match[1])) {
      calls.push(call);

      if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
        break;
      }
    }

    if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
      break;
    }
  }

  if (calls.length > 0) {
    return calls;
  }

  const jsonBlockRegex = /```(?:json|tool_call)?\s*([\s\S]*?)```/gi;

  while ((match = jsonBlockRegex.exec(scanContent))) {
    const block = match[1].trim();

    if (!/"(?:tool|name)"\s*:/.test(block)) {
      continue;
    }

    for (const call of parseJsonToolCalls(block)) {
      calls.push(call);

      if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
        break;
      }
    }

    if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
      break;
    }
  }

  if (calls.length > 0) {
    return calls;
  }

  for (const call of parseDirectXmlToolCalls(scanContent)) {
    calls.push(call);

    if (hasReachedToolCallLimit(calls.length, executionPolicy.maxCallsPerPass)) {
      break;
    }
  }

  return calls;
}

export function limitToolCallScanContent(content: string, executionPolicy: LocalComputerToolExecutionPolicy) {
  if (executionPolicy.scanFromEndChars === null || content.length <= executionPolicy.scanFromEndChars) {
    return content;
  }

  return content.slice(-executionPolicy.scanFromEndChars);
}

export function createLocalComputerToolRequestContent(
  content: string,
  reasoning?: string,
  executionPolicy: LocalComputerToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
) {
  if (parseLocalComputerToolCalls(content, executionPolicy).length > 0) {
    return content;
  }

  if (!reasoning || parseLocalComputerToolCalls(reasoning, executionPolicy).length === 0) {
    return content;
  }

  return [content, reasoning].filter((part) => part.trim()).join("\n\n");
}

function parseXmlToolCalls(rawBody: string): ParsedLocalComputerToolCall[] {
  const raw = rawBody.trim();
  const jsonCalls = parseJsonToolCalls(raw);

  if (jsonCalls.length > 0) {
    return jsonCalls;
  }

  // Models sometimes wrap a JSON tool call inside <tool_call> but prefix it
  // with stray text like the literal word "tool_call" or a leading function
  // name. Try to recover a JSON object/array anywhere in the body before
  // falling back to the XML/arg parsing path.
  const embeddedJsonCalls = parseEmbeddedJsonToolCall(raw);

  if (embeddedJsonCalls.length > 0) {
    return embeddedJsonCalls;
  }

  const directXmlCalls = parseDirectXmlToolCalls(raw);
  if (directXmlCalls.length > 0) {
    return directXmlCalls;
  }

  const args = parseXmlToolCallArgs(raw);
  const command = decodeXmlEntities(resolveXmlToolCommand(raw, args));
  if (args.tool && normalizeArgName(args.tool) === normalizeArgName(command)) {
    delete args.tool;
  }

  return [
    {
      args,
      raw,
      tool: normalizeToolName(command, args),
    },
  ];
}

function parseXmlToolCallArgs(raw: string) {
  const args: Record<string, string> = {};
  const argRegex = /<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
  let match: RegExpExecArray | null;

  while ((match = argRegex.exec(raw))) {
    const key = normalizeArgName(decodeXmlEntities(match[1]));
    args[key] = preserveArgValue(key, decodeXmlEntities(match[2]));
  }

  Object.assign(args, parseXmlArgsObject(firstXmlTagValue(raw, ["args", "arguments", "input"])));
  collectDirectXmlArgs(raw, args);
  collectMalformedDirectXmlArgs(raw, args);

  return args;
}

export function parseDirectXmlToolCalls(raw: string): ParsedLocalComputerToolCall[] {
  const calls: ParsedLocalComputerToolCall[] = [...parseInvokeXmlToolCalls(raw)];
  const tagRegex = /<([a-zA-Z][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(raw))) {
    const command = decodeXmlEntities(match[1]);
    const normalizedTag = normalizeArgName(command);

    if (isIgnoredXmlArgTag(normalizedTag)) {
      continue;
    }

    const args = parseXmlToolCallArgs(match[2]);
    const tool = normalizeToolName(command, args);

    if (tool === "unknown") {
      continue;
    }

    if (args.tool && normalizeArgName(args.tool) === normalizeArgName(command)) {
      delete args.tool;
    }

    calls.push({
      args,
      raw: match[0],
      tool,
    });
  }

  return calls;
}

export function stripDirectXmlToolCalls(content: string) {
  const withoutFunctionCalls = content
    .replace(/<function_calls\b[^>]*>[\s\S]*?<\/function_calls>/gi, " ")
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, (fullMatch: string) => parseInvokeXmlToolCalls(fullMatch).length > 0 ? " " : fullMatch);

  return withoutFunctionCalls.replace(/<([a-zA-Z][\w.-]*)\b[^>]*>[\s\S]*?<\/\1>/gi, (fullMatch: string, command: string) => {
    const normalizedTag = normalizeArgName(command);

    if (isIgnoredXmlArgTag(normalizedTag) || normalizeToolName(command, {}) === "unknown") {
      return fullMatch;
    }

    return " ";
  });
}

function parseInvokeXmlToolCalls(raw: string): ParsedLocalComputerToolCall[] {
  const calls: ParsedLocalComputerToolCall[] = [];
  const bodies: string[] = [];
  const wrapperRegex = /<function_calls\b[^>]*>([\s\S]*?)<\/function_calls>/gi;
  let wrapperMatch: RegExpExecArray | null;

  while ((wrapperMatch = wrapperRegex.exec(raw))) {
    bodies.push(wrapperMatch[1]);
  }

  if (bodies.length === 0) {
    bodies.push(raw);
  }

  for (const body of bodies) {
    const invokeRegex = /<invoke\b([^>]*)>([\s\S]*?)<\/invoke>/gi;
    let invokeMatch: RegExpExecArray | null;

    while ((invokeMatch = invokeRegex.exec(body))) {
      const command = decodeXmlEntities(readXmlAttribute(invokeMatch[1], ["name", "tool"]) ?? "");

      if (!command) {
        continue;
      }

      const args = parseInvokeParameters(invokeMatch[2]);
      const tool = normalizeToolName(command, args);

      if (tool === "unknown") {
        continue;
      }

      calls.push({
        args,
        raw: invokeMatch[0],
        tool,
      });
    }
  }

  return calls;
}

function parseInvokeParameters(raw: string) {
  const args: Record<string, string> = {};
  const parameterRegex = /<parameter\b([^>]*)>([\s\S]*?)<\/parameter>/gi;
  let match: RegExpExecArray | null;

  while ((match = parameterRegex.exec(raw))) {
    const key = normalizeArgName(decodeXmlEntities(readXmlAttribute(match[1], ["name", "key"]) ?? ""));

    if (!key) {
      continue;
    }

    args[key] = preserveArgValue(key, decodeXmlEntities(match[2]));
  }

  Object.assign(args, parseXmlArgsObject(firstXmlTagValue(raw, ["args", "arguments", "input"])));
  collectDirectXmlArgs(raw, args);

  return args;
}

function resolveXmlToolCommand(raw: string, args: Record<string, string>) {
  const taggedCommand = firstXmlTagValue(raw, ["tool", "name"]);

  if (taggedCommand) {
    return taggedCommand;
  }

  const leadingCommand = raw.match(/^([a-zA-Z0-9_.-]+)/)?.[1];
  const argCommand = args.tool;

  if (leadingCommand && !isToolNamePlaceholder(leadingCommand.toLowerCase())) {
    return leadingCommand;
  }

  return argCommand || leadingCommand || "";
}

function parseEmbeddedJsonToolCall(raw: string): ParsedLocalComputerToolCall[] {
  // Scan for the first balanced JSON object/array, ignoring any leading
  // tokens the model emitted before it (e.g. "tool_call\n{...}", a function
  // name on its own line, code-fence remnants, etc.).
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];

    if (char !== "{" && char !== "[") {
      continue;
    }

    const slice = sliceBalancedJson(raw, index);

    if (!slice) {
      continue;
    }

    const calls = parseJsonToolCalls(slice);

    if (calls.length > 0) {
      return calls.map((call) => ({ ...call, raw }));
    }
  }

  return [];
}

function sliceBalancedJson(input: string, startIndex: number): string | null {
  const opener = input[startIndex];

  if (opener !== "{" && opener !== "[") {
    return null;
  }

  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = startIndex; index < input.length; index++) {
    const char = input[index];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\") {
      escape = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;

      if (depth === 0) {
        return input.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

export function parseJsonToolCalls(rawJson: string): ParsedLocalComputerToolCall[] {
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items
      .map((item) => parseJsonToolCallValue(item, rawJson))
      .filter((call): call is ParsedLocalComputerToolCall => Boolean(call));
  } catch {
    return [];
  }
}

function parseJsonToolCallValue(value: unknown, raw: string): ParsedLocalComputerToolCall | null {
  if (!isRecord(value)) {
    return null;
  }

  const functionCall = isRecord(value.function) ? value.function : undefined;
  const command = stringifyToolArgValue(value.tool ?? value.name ?? functionCall?.name);
  const explicitArgs = {
    ...parseToolArgsSource(value.arguments),
    ...parseToolArgsSource(value.args),
    ...parseToolArgsSource(value.input),
    ...parseToolArgsSource(functionCall?.arguments),
    ...parseToolArgsSource(functionCall?.args),
    ...parseToolArgsSource(functionCall?.input),
  };
  const args = normalizeToolArgs({
    ...collectTopLevelJsonArgs(value),
    ...explicitArgs,
  });

  return {
    args,
    raw,
    tool: normalizeToolName(command, args),
  };
}

function parseToolArgsSource(source: unknown): Record<string, unknown> {
  if (source === undefined || source === null) {
    return {};
  }

  if (Array.isArray(source)) {
    return { files_json: source };
  }

  if (isRecord(source)) {
    return source;
  }

  if (typeof source !== "string") {
    return {};
  }

  const trimmed = source.trim();

  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;

      if (Array.isArray(parsed)) {
        return { files_json: parsed };
      }

      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      return { content: source };
    }
  }

  return { content: source };
}

function normalizeToolArgs(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).map(([key, value]) => {
      const normalizedKey = normalizeArgName(key);
      return [normalizedKey, preserveArgValue(normalizedKey, stringifyToolArgValue(value))];
    }),
  );
}

function collectTopLevelJsonArgs(value: Record<string, unknown>) {
  const reservedKeys = new Set(["arguments", "args", "function", "id", "input", "name", "tool", "type"]);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !reservedKeys.has(normalizeArgName(key))));
}

function parseXmlArgsObject(rawArgs?: string) {
  if (!rawArgs) {
    return {};
  }

  return normalizeToolArgs(parseToolArgsSource(decodeXmlEntities(rawArgs)));
}

function isIgnoredXmlArgTag(key: string) {
  return [
    "arg_key",
    "arg_value",
    "args",
    "arguments",
    "function_calls",
    "input",
    "invoke",
    "name",
    "parameter",
    "tool",
    "tool_call",
  ].includes(key);
}

function collectDirectXmlArgs(raw: string, args: Record<string, string>) {
  const tagRegex = /<([a-zA-Z][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(raw))) {
    const key = normalizeArgName(match[1]);

    if (isIgnoredXmlArgTag(key) || Object.prototype.hasOwnProperty.call(args, key)) {
      continue;
    }

    args[key] = preserveArgValue(key, decodeXmlEntities(match[2]));
  }
}

function collectMalformedDirectXmlArgs(raw: string, args: Record<string, string>) {
  const tagRegex = /<([a-zA-Z][\w.-]*)\b[^>]*>([\s\S]*?)<\/arg_value>/gi;
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(raw))) {
    const key = normalizeArgName(match[1]);

    if (isIgnoredXmlArgTag(key) || Object.prototype.hasOwnProperty.call(args, key)) {
      continue;
    }

    args[key] = preserveArgValue(key, decodeXmlEntities(match[2]));
  }
}

function firstXmlTagValue(raw: string, names: string[]) {
  for (const name of names) {
    const match = raw.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));

    if (match) {
      return match[1];
    }
  }

  return undefined;
}

function readXmlAttribute(rawAttributes: string, names: string[]) {
  for (const name of names) {
    const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = rawAttributes.match(new RegExp(`\\b${safeName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>/]+))`, "i"));

    if (match) {
      return match[1] ?? match[2] ?? match[3] ?? "";
    }
  }

  return undefined;
}

function stringifyToolArgValue(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 16)))
    .replace(/&#(\d+);/g, (_, codepoint: string) => String.fromCodePoint(Number.parseInt(codepoint, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
