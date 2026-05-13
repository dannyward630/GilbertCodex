import type { ChatSource } from "../../../types/chat";
import { readComputerTextFile } from "../files";

export function firstArg(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const value = argValue(args, [name]);

    if (value !== undefined && value !== "") {
      return value;
    }
  }

  return undefined;
}

export function numberArg(args: Record<string, string>, names: string[], fallback: number) {
  const value = optionalNumberArg(args, names);
  return value === undefined ? fallback : value;
}

export function optionalNumberArg(args: Record<string, string>, names: string[]) {
  const rawValue = argValue(args, names);

  if (rawValue === undefined || rawValue === "") {
    return undefined;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function booleanArg(args: Record<string, string>, names: string[], fallback: boolean) {
  const value = argValue(args, names);

  if (value === undefined) {
    return fallback;
  }

  return ["1", "true", "yes", "y"].includes(value.toLowerCase());
}

export function skipNoRoots() {
  return {
    content: [
      "Skipped because no local workspace roots are selected.",
      "Tell the user: \"I need a workspace folder before I can read or write files. Open one with the folder picker in the sidebar, or drop a folder onto the chat.\"",
      "After the user opens a folder, retry the same tool call.",
    ].join("\n"),
    executed: false,
  };
}

export function argValue(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeArgName(name);

    if (Object.prototype.hasOwnProperty.call(args, normalizedName)) {
      return args[normalizedName];
    }
  }

  return undefined;
}

export function preserveArgValue(key: string, value: string) {
  // Strip CDATA wrappers FIRST. Some models wrap multi-line content with
  // <![CDATA[...]]> to escape XML in tool-call markup, and weak models
  // sometimes double-wrap. Without this strip, an edit_file's old_text
  // arrives as literal "<![CDATA[...]]>" and never matches real file
  // content. Idempotent: any number of openers/closers collapse cleanly.
  const decoded = stripCdataWrappers(value);

  if (["body", "code", "content", "expected_string", "expected_text", "files_json", "items", "manifest", "markdown", "migration", "new_str", "new_string", "new_text", "old_str", "old_string", "old_text", "replacement", "schema", "sql", "test", "text", "tsx"].includes(key)) {
    return decoded.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
  }

  return stripLeakedToolMarkup(decoded).trim();
}

function stripCdataWrappers(value: string): string {
  if (!value.includes("<![CDATA[") && !value.includes("]]>")) {
    return value;
  }
  // Remove every opener and closer token. Models sometimes emit asymmetric
  // wrappers (one opener, no closer; nested openers; etc.) so we don't
  // attempt to match pairs — these tokens never appear legitimately inside
  // a tool argument.
  return value.split("<![CDATA[").join("").split("]]>").join("");
}

export function stripLeakedToolMarkup(value: string) {
  const markerIndex = value.search(/<\/?\s*(?:arg_key|arg_value|tool_call|tool|name|args|arguments|input)\b/i);
  return markerIndex >= 0 ? value.slice(0, markerIndex) : value;
}

export function limitInlineValue(value: string, limit: number | null) {
  if (limit === null || !Number.isFinite(limit) || value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}... [truncated]`;
}

export function dedupeSources(sources: ChatSource[]) {
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

export function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export async function readOriginalContentForSyntaxCheck(path: string): Promise<string | undefined> {
  try {
    const file = await readComputerTextFile(path);
    if (file.truncated) {
      return undefined;
    }
    return file.content;
  } catch {
    return undefined;
  }
}

export function isPathInsideRoot(path: string, root: string) {
  const normalizedPath = normalizeComparablePath(path);
  const normalizedRoot = normalizeComparablePath(root);

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function normalizeComparablePath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function hasReachedToolCallLimit(callCount: number, maxCallsPerPass: number | null) {
  return maxCallsPerPass !== null && callCount >= maxCallsPerPass;
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}

export function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

export function limitToolResults(content: string, maxChars: number | null) {
  if (maxChars === null || !Number.isFinite(maxChars) || content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n\n[Local computer tool results truncated to stay within the model context window. If exact omitted output is needed, rerun the tool for specific paths or ranges.]`;
}

export function limitToolResultBlock(content: string, limit: number | null) {
  if (limit === null || !Number.isFinite(limit) || content.length <= limit) {
    return content;
  }

  return `${content.slice(0, limit)}\n[Output truncated.]`;
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function assertReadablePath(path: string, roots: string[]) {
  let resolved: string;
  try {
    resolved = resolveWorkspacePath(path, roots);
  } catch (error) {
    // resolveWorkspacePath throws on ".." traversal — re-throw with the same
    // recoverable shape so the model gets a clean retry hint.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Path "${path}" was rejected: ${detail}. Workspace roots: ${formatRootList(roots)}. Retry with a path that stays inside one of these roots and does not use "..".`,
    );
  }
  if (roots.some((root) => isPathInsideRoot(resolved, root))) {
    return;
  }
  throw new Error(buildOutsideWorkspaceMessage(path, resolved, roots));
}

/**
 * Builds the standard "path outside workspace" error so it always tells the
 * model: what you asked for, what we resolved it to, what roots ARE enabled,
 * and a concrete suggestion. Without all four pieces the model often gives up
 * instead of retrying with a workspace-relative path.
 */
export function buildOutsideWorkspaceMessage(originalPath: string, resolvedPath: string, roots: string[]): string {
  const suggestion = suggestInWorkspacePath(originalPath, roots);
  const lines = [
    `Path "${originalPath}" resolved to "${resolvedPath}", which is outside the workspace.`,
    `Workspace roots: ${formatRootList(roots)}.`,
  ];
  if (suggestion) {
    lines.push(`Retry with a path inside one of these roots, e.g. "${suggestion}".`);
  } else {
    lines.push("Retry with a workspace-relative path (a name with no leading drive letter or slash) inside one of these roots.");
  }
  return lines.join(" ");
}

function formatRootList(roots: string[]): string {
  if (roots.length === 0) {
    return "(none — no workspace folder is open)";
  }
  return roots.join(" | ");
}

function suggestInWorkspacePath(originalPath: string, roots: string[]): string | undefined {
  if (roots.length === 0) {
    return undefined;
  }
  const trimmed = originalPath.trim();
  if (!trimmed) {
    return undefined;
  }
  // If the model passed an absolute path that happens to share a tail with the
  // workspace root, suggest just the tail. Otherwise suggest a clean relative
  // path under roots[0] using just the basename.
  const base = baseName(trimmed.replace(/\\/g, "/").replace(/\/+$/, ""));
  if (!base) {
    return undefined;
  }
  const root = roots[0];
  const normalizedOriginal = normalizeComparablePath(trimmed);
  const normalizedRoot = normalizeComparablePath(root);

  if (normalizedRoot.startsWith(`${normalizedOriginal}/`)) {
    return root;
  }

  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${base}`;
}

export function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    let timeoutId: number | undefined;
    const abort = () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    timeoutId = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);

    signal?.addEventListener("abort", abort, { once: true });
  });
}

export function directoryName(path: string) {
  const lastBackslash = path.lastIndexOf("\\");
  const lastSlash = path.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);

  return index > 0 ? path.slice(0, index) : ".";
}

export function baseName(path: string) {
  const lastBackslash = path.lastIndexOf("\\");
  const lastSlash = path.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);

  return index >= 0 ? path.slice(index + 1) : path;
}

export function resolveWorkspacePath(path: string, roots: string[]) {
  const trimmed = path.trim();

  if (!trimmed || roots.length === 0 || isAbsoluteLocalPath(trimmed) || trimmed.startsWith("browser-folder://")) {
    return trimmed;
  }

  const parts = trimmed
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((part) => part && part !== ".");

  if (parts.includes("..")) {
    throw new Error("Workspace-relative paths cannot contain '..'.");
  }

  const rootName = baseName(roots[0]);
  if (parts.length >= 1 && pathSegmentMatchesRoot(parts[0], rootName)) {
    parts.shift();
  }

  return parts.length > 0 ? joinLocalPath(roots[0], parts) : roots[0];
}

export function joinLocalPath(root: string, parts: string[]) {
  const separator = root.includes("\\") ? "\\" : "/";
  return [root.replace(/[\\/]+$/, ""), ...parts.map((part) => part.replace(/^[\\/]+|[\\/]+$/g, ""))].join(separator);
}

function isAbsoluteLocalPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("//") || path.startsWith("/");
}

function pathSegmentMatchesRoot(segment: string, rootName: string) {
  const left = comparablePathSegment(segment);
  const right = comparablePathSegment(rootName);
  return left.length > 0 && left === right;
}

function comparablePathSegment(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
