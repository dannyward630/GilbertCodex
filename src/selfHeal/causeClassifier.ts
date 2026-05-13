/**
 * Classifies a tool failure into a coarse cause + signature.
 *
 * The classifier must do two jobs:
 *   1. Separate *tool malfunction* (worth adapting) from *user-code failure*
 *      (the tool worked, the user's code is broken — adapting would mask bugs).
 *   2. Produce a stable signature so two failures from the same root cause
 *      collapse into one streak; otherwise N transient hiccups would never
 *      cross the adaptation threshold.
 *
 * Heuristics are intentionally conservative. When in doubt, classify as
 * "other" with adaptable=true — the runtime asks the model for help only
 * once the streak reaches 2, so a single misclassified blip is cheap.
 */

import { NON_ADAPTABLE_CAUSES } from "./types";
import type { ClassifiedFailure, ToolFailureCause } from "./types";

/** Tool names that, on non-zero exit, almost always mean *user code* is broken. */
const USER_CODE_VERIFICATION_TOOLS: ReadonlySet<string> = new Set([
  "run_tests",
  "typescript_check",
]);

/** Tool names where a non-zero exit is best treated as user-code failure when the
 * command obviously runs a project verification step (tsc, vitest, jest, ...). */
const USER_CODE_VERIFICATION_COMMAND_RE = /\b(?:tsc|vitest|jest|playwright|eslint|prettier|cargo\s+(?:check|test|build)|go\s+(?:vet|test|build))\b/i;

const MISSING_BINARY_RE = /(?:command not found|not recognized as an internal|is not recognized as the name|no such file or directory:\s*['"]?([^'"\n]+)['"]?|cannot find executable|cannot find module ['"]([^'"]+)['"]|ENOENT.*['"]?([^'"\s]+\.(?:exe|cmd|sh|bat|js|ts|py))['"]?|spawn\s+([\w.-]+)\s+ENOENT)/i;
const AUTH_RE = /\b(?:401|403|bad credentials|unauthor(?:ized|ised)|forbidden|requires authentication|token (?:expired|invalid)|sso (?:required|enforced)|access denied)\b/i;
const NETWORK_RE = /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|failed to fetch|network (?:error|unreachable)|getaddrinfo|connect\s+(?:timeout|refused))\b/i;
const PERMISSION_RE = /\b(?:EACCES|EPERM|permission denied|access is denied|operation not permitted)\b/i;
const TIMEOUT_RE = /\b(?:timed out|timeout exceeded|deadline exceeded|operation timed out)\b/i;
const PATH_OUTSIDE_RE = /\b(?:path is outside|outside the workspace|outside (?:enabled|allowed) roots|not inside (?:the )?workspace)\b/i;
const PATH_NOT_FOUND_RE = /\b(?:cannot find the (?:file|path) specified|could not find file|file not found|path not found|the system cannot find|no such file or directory)\b/i;
const POLICY_BLOCKED_RE = /\b(?:blocked|denied by policy|approval required|requires approval|not allowed by (?:permission|policy))\b/i;
const INVALID_TOOL_ARGUMENTS_RE = /\b(?:missing required argument|requires both|did not include|needs (?:old_text\/new_text|old_string\/new_string|old_str\/new_str)|must be (?:a|an|one of)|expected .+ argument|invalid (?:argument|args|input)|malformed (?:argument|args|input))\b/i;
const PACKAGE_MANAGER_RE = /\b(?:no such (?:script|command):|missing script|unknown command:|workspaces? (?:not )?supported|use (?:pnpm|yarn|bun|npm) instead|run with (?:pnpm|yarn|bun|npm)|requires (?:pnpm|yarn|bun))\b/i;
const SHELL_MISMATCH_RE = /\b(?:syntax error near|unexpected token|the term ['"][^'"]+['"] is not recognized|ParserError|CommandNotFoundException|bad substitution)\b/i;
const SYNTAX_USER_CODE_RE = /\b(?:SyntaxError|ParseError|TS\d{3,5}:|error\s+TS\d{3,5}|cannot find name|expected\s+\w+\s+but got|unexpected end of (?:input|file))\b/i;

/** Inputs to the classifier. All fields optional except the tool name. */
export interface ClassifyToolFailureInput {
  tool: string;
  /** Args supplied to the tool. Used for signature stability. */
  args?: Record<string, string>;
  /** Thrown error, if the tool threw. */
  error?: unknown;
  /** Exit code, if the tool finished but reported failure. Null = unknown. */
  exitCode?: number | null;
  /** Captured stderr (may be truncated). */
  stderr?: string;
  /** Captured stdout (may be truncated). */
  stdout?: string;
  /** Tool's own "skip" message when executed=false but no exception. */
  skipReason?: string;
}

/** Classifies a failure. Always returns — even unknown shapes get "other". */
export function classifyToolFailure(input: ClassifyToolFailureInput): ClassifiedFailure {
  const haystack = collectHaystack(input);

  if (POLICY_BLOCKED_RE.test(haystack)) {
    return finalize("policy_blocked", "Blocked by workspace policy or approval gate", input);
  }

  if (PATH_OUTSIDE_RE.test(haystack)) {
    return finalize("path_outside_roots", "Path is outside enabled workspace roots", input);
  }

  if (PATH_NOT_FOUND_RE.test(haystack) && isLocalPathTool(input.tool)) {
    return finalize("invalid_tool_arguments", "Target file or path does not exist", input);
  }

  if (INVALID_TOOL_ARGUMENTS_RE.test(haystack)) {
    return finalize("invalid_tool_arguments", "Tool call arguments were incomplete or malformed", input);
  }

  if (AUTH_RE.test(haystack)) {
    return finalize("auth", "Authentication or token rejected", input);
  }

  if (PERMISSION_RE.test(haystack)) {
    return finalize("permission_denied", "OS permission denied", input);
  }

  if (TIMEOUT_RE.test(haystack)) {
    return finalize("timeout", "Tool exceeded its timeout", input);
  }

  if (NETWORK_RE.test(haystack)) {
    return finalize("network", "Network request failed", input);
  }

  const missingBinary = matchMissingBinary(haystack);
  if (missingBinary) {
    return finalize("binary_missing", `Required binary not on PATH: ${missingBinary}`, input, missingBinary);
  }

  if (PACKAGE_MANAGER_RE.test(haystack)) {
    return finalize("package_manager_mismatch", "Project uses a different package manager / script", input);
  }

  if (SHELL_MISMATCH_RE.test(haystack)) {
    return finalize("shell_mismatch", "Command syntax does not match the active shell", input);
  }

  if (isUserCodeFailure(input, haystack)) {
    const cause: ToolFailureCause = SYNTAX_USER_CODE_RE.test(haystack) ? "syntax_in_user_code" : "user_code_failure";
    return finalize(cause, "Tool ran successfully and reported a failure inside the user's code", input);
  }

  return finalize("other", "Tool failed for an unrecognized reason", input);
}

function finalize(cause: ToolFailureCause, summary: string, input: ClassifyToolFailureInput, signatureExtra?: string): ClassifiedFailure {
  return {
    adaptable: !NON_ADAPTABLE_CAUSES.has(cause),
    cause,
    signature: buildSignature(input.tool, cause, signatureExtra),
    summary,
  };
}

function buildSignature(tool: string, cause: ToolFailureCause, extra?: string) {
  const tail = extra ? `:${extra.toLowerCase()}` : "";
  return `${tool}::${cause}${tail}`;
}

function collectHaystack(input: ClassifyToolFailureInput) {
  const errorMessage = input.error instanceof Error ? input.error.message : typeof input.error === "string" ? input.error : "";
  return [errorMessage, input.stderr ?? "", input.stdout ?? "", input.skipReason ?? ""].join("\n");
}

function matchMissingBinary(haystack: string): string | undefined {
  const match = haystack.match(MISSING_BINARY_RE);
  if (!match) return undefined;

  for (let i = 1; i < match.length; i += 1) {
    const candidate = match[i];
    if (candidate && candidate.trim()) {
      return candidate.trim();
    }
  }

  return undefined;
}

function isLocalPathTool(tool: string) {
  return [
    "delete_file",
    "edit_file",
    "move_path",
    "read_file",
    "rename_path",
    "view_code",
    "write_file",
  ].includes(tool);
}

function isUserCodeFailure(input: ClassifyToolFailureInput, haystack: string) {
  if (USER_CODE_VERIFICATION_TOOLS.has(input.tool)) {
    return true;
  }

  if (input.tool === "run_terminal") {
    const command = input.args?.command ?? "";
    if (USER_CODE_VERIFICATION_COMMAND_RE.test(command)) {
      return true;
    }
  }

  return SYNTAX_USER_CODE_RE.test(haystack);
}
