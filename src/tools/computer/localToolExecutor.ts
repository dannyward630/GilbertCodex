import type { ChatProgressItem, ChatSource, ChatToolCall } from "../../types/chat";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ToolRegistrySettings } from "../../types/tools";
import type {
  ComputerDirectoryListing,
  ComputerSearchResult,
  LocalWorkspaceSettings,
} from "../../types/localWorkspace";
import {
  buildComputerFileIndex,
  listComputerDirectory,
  readComputerTextFile,
  resolveLocalWorkspaceRoots,
  searchComputerFiles,
  writeComputerTextFile,
} from "./files";
import { editComputerTextFile, formatPreciseCodeView } from "./editing";
import { executeWebSearchTool, isWebToolName } from "../web/webToolExecutor";

const LOCAL_TOOL_PROGRESS_ID = "local-computer-tools";
const MAX_LOCAL_TOOL_CALLS_PER_PASS = 8;
const MAX_TOOL_CALL_SCAN_CHARS = 120_000;
const MAX_TOOL_RESULTS_CHARS = 220_000;
const MAX_TOOL_CALL_OUTPUT_CHARS = 12_000;
const DEFAULT_READ_BYTES = 96 * 1024;

type LocalComputerToolName = "build_index" | "edit_file" | "list_directory" | "read_file" | "search_files" | "view_code" | "web_search" | "write_file" | "unknown";

interface ParsedLocalComputerToolCall {
  args: Record<string, string>;
  raw: string;
  tool: LocalComputerToolName;
}

export interface LocalComputerToolRunResult {
  contextMessage: string;
  executedCount: number;
  progress: ChatProgressItem;
  requestedCount: number;
  sources: ChatSource[];
  toolCalls: ChatToolCall[];
}

export function hasLocalComputerToolCalls(content: string) {
  const scanContent = limitToolCallScanContent(content);
  const scanLower = scanContent.toLowerCase();

  if (!scanLower.includes("<tool_call") && !scanLower.includes("```") && !scanLower.includes('"tool"') && !scanLower.includes('"name"')) {
    return false;
  }

  return /<tool_call\b/i.test(scanContent) || /```(?:json|tool_call)?\s*\{[\s\S]*?"(?:tool|name)"\s*:/i.test(scanContent);
}

export function sanitizeLocalToolCallsForDisplay(content: string) {
  if (!hasLocalComputerToolCalls(content)) {
    return content;
  }

  const withoutCompleteCalls = content.replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "").trim();
  const withoutPartialCall = withoutCompleteCalls.replace(/<tool_call\b[\s\S]*$/i, "").trim();
  const withoutJsonCalls = withoutPartialCall
    .replace(/```(?:json|tool_call)?\s*\{[\s\S]*?"(?:tool|name)"\s*:[\s\S]*?\}\s*```/gi, "")
    .trim();

  return withoutJsonCalls || "Using agent tools...";
}

export function createLocalComputerProgress(status: ChatProgressItem["status"], detail?: string): ChatProgressItem {
  return {
    detail,
    id: LOCAL_TOOL_PROGRESS_ID,
    label: "Agent tools",
    status,
  };
}

export function createLocalComputerToolCallPreviews(content: string): ChatToolCall[] {
  return parseLocalComputerToolCalls(content)
    .map((call, index) => ({
      detail: summarizeToolCall(call),
      id: `local-tool-preview-${index + 1}`,
      input: formatToolCallInput(call),
      label: formatToolName(call.tool),
      status: "active",
    }));
}

export async function runLocalComputerToolCalls({
  assistantContent,
  toolSettings,
  webSearchMaxResults,
  settings,
  userPrompt,
}: {
  assistantContent: string;
  settings: LocalWorkspaceSettings;
  toolSettings: ToolRegistrySettings;
  userPrompt: string;
  webSearchMaxResults: number;
}): Promise<LocalComputerToolRunResult> {
  const calls = parseLocalComputerToolCalls(assistantContent);
  const tools = normalizeToolRegistrySettings(toolSettings);
  const roots = await resolveLocalWorkspaceRoots(settings);
  const sections: string[] = [
    "AGENT TOOL RESULTS",
    "The app executed the requested file and web tools. Use these results as real evidence and answer normally. Do not include tool XML or tool JSON in the final answer.",
    `Requested calls: ${calls.length}`,
    `Workspace scope: ${settings.scope}`,
    `Workspace roots: ${roots.length > 0 ? roots.join(" | ") : "none"}`,
    settings.scope === "full-computer"
      ? "Write policy: full computer access is read-only."
      : settings.permissionMode === "ask-first"
        ? "Write policy: Ask first mode requires user confirmation before writes, so automatic writes are denied."
        : "Write policy: writes may run only inside the selected/current workspace roots.",
    tools.webSearch
      ? "Web policy: web_search may run on demand for current facts, docs, debugging, or source-backed answers."
      : "Web policy: web_search is disabled in Toolbox.",
  ];
  let executedCount = 0;
  const sources: ChatSource[] = [];
  const toolCalls: ChatToolCall[] = [];

  if (roots.length === 0) {
    sections.push("No workspace roots are available. Local file tools will be skipped, but web_search can still run.");
  }

  for (const [index, call] of calls.entries()) {
    const callNumber = index + 1;

    try {
      const result = await executeLocalComputerToolCall(call, settings, roots, userPrompt, webSearchMaxResults, tools);
      executedCount += result.executed ? 1 : 0;
      sources.push(...(result.sources ?? []));
      sections.push(`\nTOOL ${callNumber}: ${call.tool}\n${result.content}`);
      toolCalls.push({
        detail: summarizeToolCall(call),
        id: `local-tool-${callNumber}`,
        input: formatToolCallInput(call),
        label: formatToolName(call.tool),
        output: limitToolCallOutput(result.content),
        status: result.executed ? "complete" : "skipped",
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Tool execution failed.";
      sections.push(`\nTOOL ${callNumber}: ${call.tool}\nError: ${detail}`);
      toolCalls.push({
        detail: summarizeToolCall(call),
        id: `local-tool-${callNumber}`,
        input: formatToolCallInput(call),
        label: formatToolName(call.tool),
        output: detail,
        status: "error",
      });
    }
  }

  const deniedCount = Math.max(calls.length - executedCount, 0);
  const detail = deniedCount > 0 ? `${executedCount} ran, ${deniedCount} blocked` : `${executedCount} ran`;

  return {
    contextMessage: limitToolResults(sections.join("\n")),
    executedCount,
    progress: createLocalComputerProgress("complete", detail),
    requestedCount: calls.length,
    sources: dedupeSources(sources),
    toolCalls,
  };
}

async function executeLocalComputerToolCall(
  call: ParsedLocalComputerToolCall,
  settings: LocalWorkspaceSettings,
  roots: string[],
  userPrompt: string,
  webSearchMaxResults: number,
  toolSettings: ToolRegistrySettings,
): Promise<{ content: string; executed: boolean; sources?: ChatSource[] }> {
  const disabledReason = getDisabledToolReason(call.tool, toolSettings);

  if (disabledReason) {
    return {
      content: `${formatToolName(call.tool)} skipped: ${disabledReason}`,
      executed: false,
    };
  }

  switch (call.tool) {
    case "web_search": {
      const result = await executeWebSearchTool(call.args, userPrompt, webSearchMaxResults);
      return {
        content: result.content,
        executed: result.sources.length > 0,
        sources: result.sources,
      };
    }
    case "build_index": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const summary = await buildComputerFileIndex(roots, settings.scope);
      return {
        content: [
          `Indexed entries: ${summary.entryCount}`,
          `Scanned folders: ${summary.scannedDirectories}`,
          `Skipped entries: ${summary.skippedEntries}`,
          `Capped for speed: ${summary.truncated ? "yes" : "no"}`,
          `Roots: ${summary.roots.join(" | ")}`,
        ].join("\n"),
        executed: true,
      };
    }
    case "list_directory": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = firstArg(call.args, ["path", "directory_path", "folder_path"]) || roots[0];
      assertReadablePath(path, roots);
      const listing = await listComputerDirectory(path, numberArg(call.args, ["limit"], 220));
      return {
        content: formatDirectoryListing(listing),
        executed: true,
      };
    }
    case "view_code":
    case "read_file": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = firstArg(call.args, ["path", "file_path", "file"]);

      if (!path) {
        return {
          content: "Skipped because read_file did not include a file path.",
          executed: false,
        };
      }

      assertReadablePath(path, roots);

      const maxBytes = numberArg(call.args, ["max_bytes", "maxBytes", "bytes"], DEFAULT_READ_BYTES);
      const file = await readComputerTextFile(path, maxBytes);
      return {
        content: formatPreciseCodeView(file, call.args),
        executed: true,
      };
    }
    case "search_files": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const query = firstArg(call.args, ["query", "q", "text"]) || userPrompt;
      const limit = numberArg(call.args, ["limit"], 32);
      let results = await searchComputerFiles(query, limit);

      if (results.length === 0) {
        await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);
        results = await searchComputerFiles(query, limit);
      }

      return {
        content: formatSearchResults(query, results),
        executed: true,
      };
    }
    case "edit_file": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = firstArg(call.args, ["path", "file_path", "file"]);

      if (!path) {
        return {
          content: "Skipped because edit_file did not include a file path.",
          executed: false,
        };
      }

      const writeCheck = getWritePolicy(settings, roots, path);

      if (!writeCheck.allowed) {
        return {
          content: `Edit blocked: ${writeCheck.reason}`,
          executed: false,
        };
      }

      const result = await editComputerTextFile({ args: call.args, path, roots });
      const summary = result.changed ? await buildComputerFileIndex(roots, settings.scope).catch(() => undefined) : undefined;

      return {
        content: [
          `Path: ${result.path}`,
          `Operation: ${result.operation}`,
          `Changed: ${result.changed ? "yes" : "no"}`,
          `Replacements: ${result.replacements}`,
          `Bytes written: ${result.bytesWritten}`,
          summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
          "",
          result.preview,
        ].join("\n"),
        executed: result.changed,
      };
    }
    case "write_file": {
      if (roots.length === 0) {
        return skipNoRoots();
      }

      const path = firstArg(call.args, ["path", "file_path", "file"]);
      const content = argValue(call.args, ["content", "text", "body"]);

      if (!path || content === undefined) {
        return {
          content: "Skipped because write_file requires both path and content.",
          executed: false,
        };
      }

      const writeCheck = getWritePolicy(settings, roots, path);

      if (!writeCheck.allowed) {
        return {
          content: `Write blocked: ${writeCheck.reason}`,
          executed: false,
        };
      }

      const result = await writeComputerTextFile(path, content, roots, {
        createParentDirs: booleanArg(call.args, ["create_parent_dirs", "createParentDirs"], false),
        overwrite: booleanArg(call.args, ["overwrite"], true),
      });
      const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);

      return {
        content: [
          `Path: ${result.path}`,
          `Bytes written: ${result.bytesWritten}`,
          `Created: ${result.created ? "yes" : "no"}`,
          summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
        ].join("\n"),
        executed: true,
      };
    }
    default:
      return {
        content: `Unknown local computer tool request was ignored.\nRaw request: ${call.raw.slice(0, 900)}`,
        executed: false,
      };
  }
}

function formatToolName(tool: LocalComputerToolName) {
  const names = {
    build_index: "Build local index",
    edit_file: "Edit file",
    list_directory: "List directory",
    read_file: "Read file",
    search_files: "Search files",
    unknown: "Unknown tool",
    view_code: "View code",
    web_search: "Web search",
    write_file: "Write file",
  } satisfies Record<LocalComputerToolName, string>;

  return names[tool];
}

function summarizeToolCall(call: ParsedLocalComputerToolCall) {
  const path = firstArg(call.args, ["path", "file_path", "directory_path", "folder_path", "file"]);
  const query = firstArg(call.args, ["query", "q", "search", "text"]);

  if (path) {
    return path;
  }

  if (query) {
    return query;
  }

  return call.tool;
}

function formatToolCallInput(call: ParsedLocalComputerToolCall) {
  const args = Object.entries(call.args)
    .map(([key, value]) => `${key}: ${limitInlineValue(value, 1600)}`)
    .join("\n");

  return args || call.raw.slice(0, 900);
}

function limitToolCallOutput(content: string) {
  if (content.length <= MAX_TOOL_CALL_OUTPUT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_TOOL_CALL_OUTPUT_CHARS)}\n[Tool call output truncated.]`;
}

function parseLocalComputerToolCalls(content: string): ParsedLocalComputerToolCall[] {
  const calls: ParsedLocalComputerToolCall[] = [];
  const scanContent = limitToolCallScanContent(content);
  const xmlCallRegex = /<tool_call\b[^>]*>([\s\S]*?)<\/tool_call>/gi;
  let match: RegExpExecArray | null;

  while ((match = xmlCallRegex.exec(scanContent))) {
    calls.push(parseXmlToolCall(match[1]));

    if (calls.length >= MAX_LOCAL_TOOL_CALLS_PER_PASS) {
      break;
    }
  }

  if (calls.length > 0) {
    return calls;
  }

  const jsonBlockRegex = /```(?:json|tool_call)?\s*({[\s\S]*?"(?:tool|name)"\s*:[\s\S]*?})\s*```/gi;

  while ((match = jsonBlockRegex.exec(scanContent))) {
    const parsed = parseJsonToolCall(match[1]);

    if (parsed) {
      calls.push(parsed);
    }

    if (calls.length >= MAX_LOCAL_TOOL_CALLS_PER_PASS) {
      break;
    }
  }

  return calls;
}

function limitToolCallScanContent(content: string) {
  return content.length <= MAX_TOOL_CALL_SCAN_CHARS ? content : content.slice(-MAX_TOOL_CALL_SCAN_CHARS);
}

function parseXmlToolCall(rawBody: string): ParsedLocalComputerToolCall {
  const raw = rawBody.trim();
  const command = raw.match(/^([a-zA-Z0-9_.-]+)/)?.[1] ?? "";
  const args: Record<string, string> = {};
  const argRegex = /<arg_key>\s*([^<]+?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
  let match: RegExpExecArray | null;

  while ((match = argRegex.exec(raw))) {
    const key = normalizeArgName(match[1]);
    args[key] = preserveArgValue(key, match[2]);
  }

  return {
    args,
    raw,
    tool: normalizeToolName(command, args),
  };
}

function parseJsonToolCall(rawJson: string): ParsedLocalComputerToolCall | null {
  try {
    const parsed = JSON.parse(rawJson) as {
      arguments?: Record<string, unknown>;
      args?: Record<string, unknown>;
      name?: string;
      tool?: string;
    };
    const rawArgs = parsed.arguments ?? parsed.args ?? {};
    const args = Object.fromEntries(Object.entries(rawArgs).map(([key, value]) => [normalizeArgName(key), String(value ?? "")]));

    return {
      args,
      raw: rawJson,
      tool: normalizeToolName(parsed.tool ?? parsed.name ?? "", args),
    };
  } catch {
    return null;
  }
}

function normalizeToolName(command: string, args: Record<string, string>): LocalComputerToolName {
  const normalized = command.toLowerCase().replace(/^computer[._-]/, "").replace(/^filesystem[._-]/, "").replace(/^local[._-]/, "");

  if (isWebToolName(normalized)) {
    return "web_search";
  }

  if (["index", "build_index", "build-index", "computer_build_file_index"].includes(normalized)) {
    return "build_index";
  }

  if (["ls", "list", "list_directory", "list-directory", "browse", "directory"].includes(normalized)) {
    return "list_directory";
  }

  if (["view", "view_code", "view-code", "code_view", "code-view", "show_lines", "show-lines"].includes(normalized)) {
    return "view_code";
  }

  if (["edit", "edit_file", "edit-file", "patch", "apply_patch", "apply-patch", "replace_text", "replace-text", "insert_text", "insert-text"].includes(normalized)) {
    return "edit_file";
  }

  if (["read", "read_file", "read-file", "open", "cat"].includes(normalized) || (!normalized && (args.file_path || args.file))) {
    return "read_file";
  }

  if (["search", "search_files", "search-files", "find"].includes(normalized)) {
    return "search_files";
  }

  if (["write", "write_file", "write-file", "save"].includes(normalized)) {
    return "write_file";
  }

  return "unknown";
}

function formatDirectoryListing(listing: ComputerDirectoryListing) {
  const rows = listing.entries.map((entry, index) => {
    const type = entry.kind === "directory" ? "dir" : entry.kind;
    const size = typeof entry.size === "number" ? ` ${entry.size} bytes` : "";
    return `${index + 1}. [${type}] ${entry.path}${size}`;
  });

  return [
    `Path: ${listing.path}`,
    listing.parentPath ? `Parent: ${listing.parentPath}` : "",
    `Entries returned: ${listing.entries.length}${listing.limited ? " (limited)" : ""}`,
    listing.inaccessibleEntries > 0 ? `Inaccessible entries: ${listing.inaccessibleEntries}` : "",
    ...rows,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatSearchResults(query: string, results: ComputerSearchResult[]) {
  if (results.length === 0) {
    return `Query: ${query}\nNo indexed file matches were found.`;
  }

  return [
    `Query: ${query}`,
    `Matches: ${results.length}`,
    ...results.map((result, index) => {
      const preview = result.preview ? `\n   preview: ${result.preview.replace(/\s+/g, " ").slice(0, 360)}` : "";
      return `${index + 1}. [${result.kind}] ${result.path} score=${result.score.toFixed(3)}${preview}`;
    }),
  ].join("\n");
}

function getWritePolicy(settings: LocalWorkspaceSettings, roots: string[], path: string) {
  if (settings.scope === "full-computer") {
    return {
      allowed: false,
      reason: "full computer scope is read-only.",
    };
  }

  if (settings.permissionMode === "ask-first") {
    return {
      allowed: false,
      reason: "Ask first mode needs explicit user confirmation before writing.",
    };
  }

  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    return {
      allowed: false,
      reason: "the target path is outside the selected/current workspace roots.",
    };
  }

  return {
    allowed: true,
  };
}

function getDisabledToolReason(tool: LocalComputerToolName, settings: ToolRegistrySettings) {
  const tools = normalizeToolRegistrySettings(settings);

  if (tool === "web_search" && !tools.webSearch) {
    return "web_search is disabled in Toolbox.";
  }

  if (tool === "search_files" && !tools.fileSearch) {
    return "file search is disabled in Toolbox.";
  }

  if ((tool === "build_index" || tool === "list_directory") && !tools.fileBrowser) {
    return "local file browsing is disabled in Toolbox.";
  }

  if ((tool === "read_file" || tool === "view_code") && !tools.codeView) {
    return "code viewing is disabled in Toolbox.";
  }

  if ((tool === "edit_file" || tool === "write_file") && !tools.codeEdit) {
    return "code editing is disabled in Toolbox.";
  }

  return "";
}

function assertReadablePath(path: string, roots: string[]) {
  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    throw new Error("That path is outside the enabled local workspace roots.");
  }
}

function firstArg(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = argValue(args, [name]);

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

function numberArg(args: Record<string, string>, names: string[], fallback: number) {
  const value = optionalNumberArg(args, names);
  return value === undefined ? fallback : value;
}

function optionalNumberArg(args: Record<string, string>, names: string[]) {
  const rawValue = argValue(args, names);

  if (rawValue === undefined || rawValue === "") {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function booleanArg(args: Record<string, string>, names: string[], fallback: boolean) {
  const value = argValue(args, names);

  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function skipNoRoots() {
  return {
    content: "Skipped because no local workspace roots are selected.",
    executed: false,
  };
}

function argValue(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeArgName(name);

    if (Object.prototype.hasOwnProperty.call(args, normalizedName)) {
      return args[normalizedName];
    }
  }

  return undefined;
}

function preserveArgValue(key: string, value: string) {
  if (["body", "content", "new_text", "old_text", "replacement", "text"].includes(key)) {
    return value.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  }

  return value.trim();
}

function limitInlineValue(value: string, limit: number) {
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}... [truncated]`;
}

function dedupeSources(sources: ChatSource[]) {
  const seenUrls = new Set<string>();
  const deduped: ChatSource[] = [];

  for (const source of sources) {
    if (seenUrls.has(source.url)) {
      continue;
    }

    seenUrls.add(source.url);
    deduped.push(source);
  }

  return deduped;
}

function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function isPathInsideRoot(path: string, root: string) {
  const normalizedPath = normalizeComparablePath(path);
  const normalizedRoot = normalizeComparablePath(root);

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizeComparablePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function limitToolResults(content: string) {
  if (content.length <= MAX_TOOL_RESULTS_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_TOOL_RESULTS_CHARS)}\n\n[Local computer tool results truncated for speed.]`;
}
