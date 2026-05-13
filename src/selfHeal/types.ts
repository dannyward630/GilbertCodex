/**
 * Self-heal substrate shared types.
 *
 * A tool failure is anything the dispatcher classifies as a *tool malfunction*
 * (wrong shell, missing binary, auth refused, etc.) — NOT a real user-code
 * error surfaced through a working tool. The classifier in causeClassifier.ts
 * is responsible for that split; this module only types the records.
 */

/** Coarse failure causes. New causes can be added; consumers must handle "other". */
export type ToolFailureCause =
  | "auth"
  | "binary_missing"
  | "invalid_tool_arguments"
  | "network"
  | "other"
  | "package_manager_mismatch"
  | "path_outside_roots"
  | "permission_denied"
  | "policy_blocked"
  | "shell_mismatch"
  | "syntax_in_user_code"
  | "timeout"
  | "user_code_failure";

/** Causes that should NOT trigger tool adaptation — the tool worked. */
export const NON_ADAPTABLE_CAUSES: ReadonlySet<ToolFailureCause> = new Set<ToolFailureCause>([
  "invalid_tool_arguments",
  "policy_blocked",
  "syntax_in_user_code",
  "user_code_failure",
]);

/** Structured failure record stored in the per-workspace in-memory ledger. */
export interface ToolFailureRecord {
  /** Tool name from the dispatcher (`run_terminal`, `run_tests`, ...). */
  tool: string;
  /** Classified cause. Drives whether adaptation kicks in. */
  cause: ToolFailureCause;
  /** Short, human-friendly summary of the failure — included in recommendations. */
  summary: string;
  /** First-key signature used to dedupe consecutive same-cause failures. */
  signature: string;
  /** Tool args at failure time (sanitized — secret-shaped values are dropped). */
  args: Record<string, string>;
  /** Wall-clock ms timestamp. */
  at: number;
}

/** Result of classifying a tool failure. */
export interface ClassifiedFailure {
  cause: ToolFailureCause;
  /** One-sentence reason — used for both UI and the adaptation prompt. */
  summary: string;
  /**
   * Stable signature of *what made this fail* so two failures from the same
   * root cause collapse into one streak. Built from the cause + minimal
   * cause-specific fragments (e.g. the missing binary name).
   */
  signature: string;
  /** True when adaptation can plausibly help. False for user-code failures. */
  adaptable: boolean;
}

/** Optional adapter overlay stored in `.gilbert/tool-overrides.json`. */
export interface ToolOverlay {
  /** Built-in tool name this overlay shadows. */
  tool: string;
  /** Forced/overridden arg values merged into every call to `tool`. */
  args?: Record<string, string>;
  /** Free-form notes the model should consult when adapting further. */
  notes?: string;
  /** Cause that motivated the overlay — UI uses this for the "Why" badge. */
  motivatingCause?: ToolFailureCause;
  /** Wall-clock ms when the overlay was created or last refreshed. */
  updatedAt: number;
}

/** Manifest persisted at `<workspaceRoot>/.gilbert/tool-overrides.json`. */
export interface ToolOverridesManifest {
  /** Manifest format version. Bump on breaking shape changes. */
  version: 1;
  /** Map of tool name → overlay. One overlay per tool for now. */
  overlays: Record<string, ToolOverlay>;
}

/** Empty starter manifest — used when no file exists yet. */
export function emptyToolOverridesManifest(): ToolOverridesManifest {
  return { version: 1, overlays: {} };
}
