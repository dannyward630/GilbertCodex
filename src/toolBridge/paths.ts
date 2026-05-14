import type { ToolExecutionContext } from "./types";

// Browser File System Access fallback prefix. Keep in sync with localWorkspace/files.ts.
const BROWSER_WORKSPACE_PREFIX = "browser-folder://";

export type PathResolutionErrorKind =
  | "external-path"
  | "invalid"
  | "no-workspace";

// Thrown by resolveAllowedPath when a requested path cannot be safely resolved
// against the workspace roots in scope. The orchestrator surfaces these as
// structured tool errors rather than as generic "Tool execution failed."
export class PathResolutionError extends Error {
  readonly kind: PathResolutionErrorKind;

  constructor(kind: PathResolutionErrorKind, message: string) {
    super(message);
    this.name = "PathResolutionError";
    this.kind = kind;
  }
}

export interface ResolvedPath {
  // Normalized, case-folded form used for membership comparison.
  comparable: string;
  // The path to hand back to filesystem APIs. Original separator family preserved.
  resolved: string;
  // The workspace root that contains `resolved`.
  root: string;
}

// Resolve a model-supplied path against the caller's workspace roots and
// confirm it falls inside one of them. Use this in every path-touching bridge
// tool so the security check lives in exactly one place.
//
// Relative paths resolve against workspaceRoots[0].
// ".." segments are collapsed before the membership check, so traversal
// attempts like "/root/../../etc/passwd" fail the comparison.
// Browser workspace URLs (browser-folder://...) are compared by exact prefix
// (no case folding) since their segments are URL-encoded.
// Desktop paths are compared case-insensitively to match existing workspace
// conventions and tolerate Windows drive-letter casing.
//
// Symlinks are NOT followed. A symlinked file inside a root resolves as if it
// lives there. Hard-gated tools (terminal, destructive, etc.) still go through
// the approval flow, which mitigates this limitation in practice.
export function resolveAllowedPath(
  context: Pick<ToolExecutionContext, "workspaceRoots">,
  requestedPath: unknown,
): ResolvedPath {
  if (typeof requestedPath !== "string" || !requestedPath.trim()) {
    throw new PathResolutionError("invalid", "A non-empty path is required.");
  }

  const roots = (context.workspaceRoots ?? []).filter((root) => typeof root === "string" && root.trim());
  if (roots.length === 0) {
    throw new PathResolutionError(
      "no-workspace",
      "No workspace roots are configured for the tool bridge — open or drop a folder first.",
    );
  }

  const trimmed = requestedPath.trim();
  const isAbsolute = isAbsoluteLikePath(trimmed);
  const baseRoot = roots[0]!;
  const absolutePath = isAbsolute ? trimmed : joinPath(baseRoot, trimmed);
  const normalized = normalizePathSegments(absolutePath);
  const comparable = toComparable(normalized);

  for (const root of roots) {
    const comparableRoot = toComparable(root);
    if (!comparableRoot) {
      continue;
    }
    if (comparable === comparableRoot || comparable.startsWith(`${comparableRoot}/`)) {
      return {
        comparable,
        resolved: normalized,
        root,
      };
    }
  }

  throw new PathResolutionError(
    "external-path",
    `Path "${requestedPath}" resolves outside the configured workspace roots.`,
  );
}

// Pure form of resolveAllowedPath that returns a discriminated union instead
// of throwing. Useful from tool execute() bodies that want to convert a
// structured failure into a ToolExecutionResult directly.
export function tryResolveAllowedPath(
  context: Pick<ToolExecutionContext, "workspaceRoots">,
  requestedPath: unknown,
):
  | { ok: true; path: ResolvedPath }
  | { error: PathResolutionError; ok: false } {
  try {
    return { ok: true, path: resolveAllowedPath(context, requestedPath) };
  } catch (error) {
    if (error instanceof PathResolutionError) {
      return { error, ok: false };
    }
    throw error;
  }
}

function isAbsoluteLikePath(path: string): boolean {
  if (path.startsWith(BROWSER_WORKSPACE_PREFIX)) {
    return true;
  }
  if (path.startsWith("/")) {
    return true;
  }
  // UNC path: \\server\share\...
  if (path.startsWith("\\\\")) {
    return true;
  }
  // Windows drive letter followed by a separator.
  if (/^[a-zA-Z]:[\\/]/.test(path)) {
    return true;
  }
  return false;
}

function joinPath(base: string, child: string): string {
  const separator = base.includes("\\") ? "\\" : "/";
  const trimmedBase = base.replace(/[\\/]+$/, "");
  const trimmedChild = child.replace(/^[\\/]+/, "");
  return `${trimmedBase}${separator}${trimmedChild}`;
}

function normalizePathSegments(input: string): string {
  if (input.startsWith(BROWSER_WORKSPACE_PREFIX)) {
    const body = input.slice(BROWSER_WORKSPACE_PREFIX.length).replace(/\\/g, "/");
    const collapsed = collapseSegments(body, "/");
    return `${BROWSER_WORKSPACE_PREFIX}${collapsed}`;
  }

  const usesBackslash = input.includes("\\") && !input.includes("/");
  const separator = usesBackslash || /^[a-zA-Z]:/.test(input) || input.startsWith("\\\\") ? "\\" : "/";

  let prefix = "";
  let body = input;

  if (input.startsWith("\\\\")) {
    // UNC: \\server\share\path — keep the leading "\\server\share" intact.
    const rest = input.slice(2);
    const firstSlash = rest.search(/[\\/]/);
    const secondSlash = firstSlash >= 0 ? rest.slice(firstSlash + 1).search(/[\\/]/) : -1;
    if (firstSlash >= 0 && secondSlash >= 0) {
      const cut = firstSlash + 1 + secondSlash;
      prefix = `\\\\${rest.slice(0, cut)}`;
      body = rest.slice(cut);
    } else {
      prefix = input;
      body = "";
    }
  } else if (/^[a-zA-Z]:/.test(input)) {
    prefix = input.slice(0, 2);
    body = input.slice(2);
  } else if (input.startsWith("/")) {
    prefix = "/";
    body = input.slice(1);
  }

  const collapsed = collapseSegments(body, separator);
  if (prefix && collapsed) {
    const joiner = prefix.endsWith(separator) || prefix.endsWith("\\") || prefix.endsWith("/") ? "" : separator;
    return `${prefix}${joiner}${collapsed}`;
  }
  return prefix || collapsed;
}

function collapseSegments(body: string, separator: string): string {
  const segments = body.split(/[\\/]+/).filter(Boolean);
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === ".") {
      continue;
    }
    if (segment === "..") {
      // Going above the prefix is a no-op here; the membership check will
      // still reject paths that escape every configured workspace root.
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }
    stack.push(segment);
  }
  return stack.join(separator);
}

function toComparable(path: string): string {
  const trimmed = path.trim();
  // Browser folder URLs carry URL-encoded segments that ARE case-sensitive.
  // Normalize separators but do not case-fold.
  if (trimmed.startsWith(BROWSER_WORKSPACE_PREFIX)) {
    return trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  }
  return trimmed.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}
