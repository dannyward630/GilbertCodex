/**
 * Builds the "adaptation recommendation" block appended to a tool's error
 * output once the same-cause streak crosses the threshold.
 *
 * The text is read by the agent, not the user. Its job is to:
 *   1. Tell the model adaptation is justified (this isn't a one-off blip).
 *   2. Hand it concrete cause-specific next steps so it doesn't have to
 *      re-derive the diagnosis from raw stderr.
 *   3. Point at the `create_tool` mechanism that already exists — the model
 *      knows how to use it, but reminding it here saves a tool round-trip.
 */

import type { ToolFailureCause, ToolFailureRecord } from "./types";

export interface BuildAdaptationRecommendationInput {
  tool: string;
  streak: number;
  cause: ToolFailureCause;
  summary: string;
  recentSummaries: string[];
  /** Workspace root reserved for future workspace-specific adaptation hints. */
  workspaceRoot?: string;
}

/** Builds the recommendation block to append to a failing tool's error text. */
export function buildAdaptationRecommendation(input: BuildAdaptationRecommendationInput): string {
  const hints = CAUSE_HINTS[input.cause] ?? GENERIC_HINTS;
  const recent = input.recentSummaries.slice(0, 3);
  const recentBlock = recent.length > 0 ? `Recent failures: ${recent.join(" | ")}` : "";

  const adaptationOptions = [
    "Adaptation options (pick one):",
    "  - Fix the call, command, or arguments directly and rerun the original tool.",
    "  - For repeat environment-specific setup only, create a helper tool with a new descriptive name. Do not shadow built-in read, edit, write, terminal, Git, web, or MCP tools.",
    "  - Do not adapt for transient network blips or malformed tool arguments.",
  ].join("\n");

  return [
    "",
    "── Adaptation recommendation ──",
    `The tool '${input.tool}' has failed ${input.streak}× in a row with the same cause (${input.cause}).`,
    `Diagnosis: ${input.summary}`,
    recentBlock,
    "",
    "Suggested fixes:",
    ...hints.map((line) => `  - ${line}`),
    "",
    adaptationOptions,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Builds the per-cause hint list. Empty cause uses GENERIC_HINTS as fallback. */
const CAUSE_HINTS: Partial<Record<ToolFailureCause, string[]>> = {
  auth: [
    "Re-check the credential's scope and whether SSO is enforced.",
    "If using gh/git CLI, run the CLI's auth login command manually before retrying.",
  ],
  binary_missing: [
    "The binary on PATH is wrong for this project. Use the project-local one (node_modules/.bin/<tool>, .venv/bin/<tool>, etc).",
    "Or create a helper tool with a new descriptive name that activates the project env before invoking the binary.",
  ],
  network: [
    "Network errors are usually transient — only adapt if a specific host keeps refusing.",
    "If the host is unreachable from this machine, route through a proxy or skip the network call.",
  ],
  package_manager_mismatch: [
    "Detect the project's package manager from lockfile presence (pnpm-lock.yaml, yarn.lock, bun.lockb, package-lock.json).",
    "Create a helper tool with a new descriptive name that picks the right manager and forwards args.",
  ],
  path_outside_roots: [
    "The target path is outside the enabled workspace roots — either enable a wider root or use a path inside the workspace.",
    "Do not adapt if the user explicitly scoped the workspace; ask for permission instead.",
  ],
  permission_denied: [
    "On Windows the file is likely locked or the shell lacks elevation. Avoid sudo/elevation prompts; pick a writable path.",
    "On Unix, prefer chmoding the project file rather than running the tool with sudo.",
  ],
  shell_mismatch: [
    "Detect the active shell (powershell, cmd, bash, zsh) and re-emit the command in that shell's syntax.",
    "Long-term fix: write a cross-shell shadow tool in Python so the command syntax is not shell-dependent.",
  ],
  timeout: [
    "Either raise the timeout for this command class or split it into smaller steps.",
    "If a dev server keeps hitting the timeout, mark it long-running and probe its port instead of waiting for completion.",
  ],
};

const GENERIC_HINTS: string[] = [
  "Read the full stderr/stdout above and pick the most specific signal as the new diagnosis.",
  "If you cannot identify a concrete fix, ask the user one sentence about their environment before adapting.",
];

/** Convenience: extract the most recent same-tool failure summaries from a list. */
export function summariesForTool(records: ToolFailureRecord[], tool: string): string[] {
  return records.filter((record) => record.tool === tool).map((record) => `${formatRelativeTime(record.at)}: ${record.cause} — ${record.summary}`);
}

function formatRelativeTime(at: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
