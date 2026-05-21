import type { ChatMessage, ChatToolCall } from "../types/chat";

/**
 * Constants governing the plan-mode research phase. These intentionally diverge
 * from the chat-mode tool budgets in `App.tsx`: plan research is allowed to do
 * more grepping and more file reads because the whole point of plan mode is to
 * produce a plan that's grounded in the codebase rather than a vague outline.
 *
 * Kept here (not in App.tsx) so the values are testable in isolation.
 */
export const PLAN_RESEARCH_BUDGET = {
  /** Minimum number of real tool calls before research is allowed to settle. */
  minToolCalls: 4,
  /** Minimum number of file reads (not just listing) before settling. */
  minFilesRead: 3,
  /**
   * Hard cap on follow-up "do more research" re-prompts. Without a cap a sloppy
   * model could ping-pong forever; with a small cap we get two structured
   * retry rounds, which in practice is enough to push a stubborn model into
   * actually grepping the codebase.
   */
  maxFollowupPasses: 2,
} as const;

/** Canonical tool IDs that count as research activity (vs. edits/runs). */
const RESEARCH_READ_TOOL_IDS = new Set([
  "files_read",
  "files_read_range",
]);

const RESEARCH_SEARCH_TOOL_IDS = new Set([
  "files_search",
  "files_list",
]);

const RESEARCH_WEB_TOOL_IDS = new Set([
  "web_search",
  "web_fetch",
]);

const RESEARCH_RUNTIME_TOOL_IDS = new Set([
  "browser_console_read",
  "browser_preview_open",
  "browser_screenshot_capture",
  "terminal_dev_server_status",
  "terminal_list_sessions",
  "terminal_read_session",
  "terminal_run",
]);

/** Aggregate evidence the research phase produced, derived from real tool calls. */
export interface PlanResearchEvidence {
  toolCallCount: number;
  filesRead: string[];
  runtimeChecks?: string[];
  searchQueries: string[];
  webQueries: string[];
}

export interface PlanResearchInstructionContext {
  /** Workspace root paths the agent should grep against. Pass an empty array
   * when no workspace is attached — the instruction will be adjusted to lean
   * on web sources / conversation context instead of inventing fake paths. */
  workspaceRoots?: string[];
}

/**
 * Build the initial research-phase instruction that goes to the agent. Unlike
 * the previous prompt, this one *demands* tool calls and forbids skipping
 * research with a hand-waving summary.
 */
export function createPlanResearchInstruction(
  originalRequest: string,
  context: PlanResearchInstructionContext = {},
): ChatMessage {
  const workspaceRoots = (context.workspaceRoots ?? []).filter((root) => typeof root === "string" && root.trim());
  const hasWorkspace = workspaceRoots.length > 0;

  const workspaceBlock = hasWorkspace
    ? [
        "ACTIVE WORKSPACE ROOTS (use these as the search targets):",
        ...workspaceRoots.map((root) => `- ${root}`),
        "",
        "Start by listing relevant directories under these roots, then grep for the symbols/files the user named, then read the top hits in full.",
      ].join("\n")
    : [
        "No local workspace is attached to this chat. Use the web_search tool when it is attached and any conversation context for research. If the user is asking about a specific repo and you can't fetch it, name that as an open question in the digest rather than inventing files.",
      ].join("\n");

  return createSyntheticMessage(
    "user",
    [
      "RESEARCH PHASE FOR PLAN MODE",
      `Original user request: ${originalRequest}`,
      workspaceBlock,
      [
        "You are doing the research phase of plan mode. Your job is to ground the upcoming plan in the actual codebase, not in assumptions.",
        "",
        "RULES:",
        "1. Use the available file-search (grep), file-list, and file-read tools aggressively. Do not use memory_search as a substitute for codebase research. The drafter that follows you has NO tool access; if you don't surface a fact now, the plan cannot reference it.",
        `2. Before declaring research complete, perform at least ${PLAN_RESEARCH_BUDGET.minToolCalls} real tool calls and read at least ${PLAN_RESEARCH_BUDGET.minFilesRead} distinct files in full or in part. "I already know this codebase" is NOT an acceptable reason to skip tool calls — your training-time knowledge of this repo is stale.`,
        "3. Grep for the symbols, types, file names, and function names the user mentions. Then read the top hits.",
        "4. If the user gives you a vague request, infer 2-3 likely entry-point files, list the workspace root to find them, and read them.",
        "5. If the original request involves running, previewing, screenshots, console errors, browser UI, localhost, or visual verification, use the attached terminal diagnostics, browser preview, browser screenshot, and browser console tools as research evidence. Do not treat static file reads as enough for runtime/browser questions.",
        "6. Do NOT write the plan itself this turn. Do NOT produce a tasks list, step-by-step implementation, or final answer.",
        "7. When you've gathered enough evidence, emit a single Markdown document titled `## Research observations` with these subsections:",
        "   - `### Runtime and browser evidence` - terminal sessions, preview URLs, screenshot observations, and browser console issues when those tools were relevant.",
        "   - `### Files inspected` — every file path you actually read, one per bullet, with a one-line note about what's there.",
        "   - `### Symbols and functions of interest` — bullets of the form `path:line — name — what it does`.",
        "   - `### Relevant code excerpts` — short verbatim snippets (under 20 lines each) with file:line citations.",
        "   - `### Risks observed` — concrete risks tied to specific files or behaviors you saw.",
        "   - `### Open questions` — anything the next phase cannot answer without more input.",
        "",
        "Every bullet that names a file MUST cite a real path that you actually read or grepped. Bullets without a path get dropped.",
      ].join("\n"),
    ].join("\n\n"),
  );
}

/**
 * Build the follow-up nudge sent when research returned without enough tool
 * activity. The nudge tells the agent exactly what's missing.
 */
export function createPlanResearchFollowupInstruction(evidence: PlanResearchEvidence): ChatMessage {
  const missing: string[] = [];

  if (evidence.toolCallCount < PLAN_RESEARCH_BUDGET.minToolCalls) {
    missing.push(
      `You only made ${evidence.toolCallCount} tool call${evidence.toolCallCount === 1 ? "" : "s"}; aim for at least ${PLAN_RESEARCH_BUDGET.minToolCalls}.`,
    );
  }

  if (evidence.filesRead.length < PLAN_RESEARCH_BUDGET.minFilesRead) {
    missing.push(
      `You only read ${evidence.filesRead.length} file${evidence.filesRead.length === 1 ? "" : "s"} in full; aim for at least ${PLAN_RESEARCH_BUDGET.minFilesRead}.`,
    );
  }

  if (missing.length === 0) {
    missing.push("Your research digest didn't cite enough concrete paths. Read more files and re-emit the digest.");
  }

  return createSyntheticMessage(
    "user",
    [
      "RESEARCH IS TOO SHALLOW — DO A SECOND PASS",
      missing.join(" "),
      "Use the file-search and file-read tools now. Then re-emit the full `## Research observations` document.",
      "Do NOT skip the tools. Do NOT write the plan.",
    ].join("\n\n"),
  );
}

/**
 * Summarize the tool-call ledger produced by an agentic research pass into an
 * objective evidence record. The model's self-report ("I read 12 files...") is
 * unreliable; this works off what actually happened.
 */
export function summarizeResearchEvidence(toolCalls: ChatToolCall[] | undefined): PlanResearchEvidence {
  const filesRead = new Set<string>();
  const runtimeChecks = new Set<string>();
  const searchQueries = new Set<string>();
  const webQueries = new Set<string>();
  let toolCallCount = 0;

  for (const toolCall of toolCalls ?? []) {
    if (toolCall.status !== "complete") {
      continue;
    }

    const toolId = toolCall.toolId ?? "";

    if (RESEARCH_READ_TOOL_IDS.has(toolId) || isReadishLabel(toolCall.label)) {
      toolCallCount += 1;
      const path = extractPath(toolCall);
      if (path) filesRead.add(path);
      continue;
    }

    if (RESEARCH_SEARCH_TOOL_IDS.has(toolId) || isSearchishLabel(toolCall.label)) {
      toolCallCount += 1;
      const query = extractQuery(toolCall);
      if (query) searchQueries.add(query);
      continue;
    }

    if (RESEARCH_WEB_TOOL_IDS.has(toolId) || isWebishLabel(toolCall.label)) {
      toolCallCount += 1;
      const query = extractQuery(toolCall);
      if (query) webQueries.add(query);
      continue;
    }

    if (RESEARCH_RUNTIME_TOOL_IDS.has(toolId) || isRuntimeishLabel(toolCall.label)) {
      toolCallCount += 1;
      runtimeChecks.add(formatRuntimeCheck(toolCall));
      continue;
    }
  }

  return {
    toolCallCount,
    filesRead: Array.from(filesRead),
    ...(runtimeChecks.size > 0 ? { runtimeChecks: Array.from(runtimeChecks) } : {}),
    searchQueries: Array.from(searchQueries),
    webQueries: Array.from(webQueries),
  };
}

/** Whether the evidence meets the minimum bar to stop iterating. */
export function isResearchDeepEnough(evidence: PlanResearchEvidence): boolean {
  return (
    evidence.toolCallCount >= PLAN_RESEARCH_BUDGET.minToolCalls &&
    evidence.filesRead.length >= PLAN_RESEARCH_BUDGET.minFilesRead
  );
}

/**
 * Format the research evidence and the model's free-form findings into a single
 * payload the drafter can use as its context. Adds structured headers so the
 * drafter can rely on the section names even if the model's own digest is
 * loosely formatted.
 */
export function formatResearchPayload(findings: string, evidence: PlanResearchEvidence): string {
  const lines: string[] = [];

  lines.push("# Research evidence (verified, from tool-call ledger)");
  lines.push("");
  lines.push(`Tool calls made: ${evidence.toolCallCount}`);
  lines.push(`Files read: ${evidence.filesRead.length}`);

  if (evidence.filesRead.length > 0) {
    lines.push("");
    lines.push("Files inspected:");
    for (const file of evidence.filesRead) {
      lines.push(`- ${file}`);
    }
  }

  if (evidence.searchQueries.length > 0) {
    lines.push("");
    lines.push("Searches performed:");
    for (const query of evidence.searchQueries) {
      lines.push(`- ${query}`);
    }
  }

  const runtimeChecks = evidence.runtimeChecks ?? [];
  if (runtimeChecks.length > 0) {
    lines.push("");
    lines.push("Runtime and browser checks:");
    for (const check of runtimeChecks) {
      lines.push(`- ${check}`);
    }
  }

  if (evidence.webQueries.length > 0) {
    lines.push("");
    lines.push("Web queries:");
    for (const query of evidence.webQueries) {
      lines.push(`- ${query}`);
    }
  }

  const trimmed = findings.trim();
  if (trimmed) {
    lines.push("");
    lines.push("# Model digest");
    lines.push("");
    lines.push(trimmed);
  }

  return lines.join("\n");
}

function createSyntheticMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    content,
    createdAt: new Date().toISOString(),
    id: `synthetic-${role}-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    role,
  };
}

function isReadishLabel(label: string | undefined): boolean {
  if (!label) return false;
  return /read.*(?:workspace\s+)?file/i.test(label);
}

function isSearchishLabel(label: string | undefined): boolean {
  if (!label) return false;
  if (/memory/i.test(label)) return false;
  return /(?:grep|search|list)\b.*(?:file|director|workspace)?/i.test(label);
}

function isWebishLabel(label: string | undefined): boolean {
  if (!label) return false;
  return /web (?:search|fetch)/i.test(label);
}

function isRuntimeishLabel(label: string | undefined): boolean {
  if (!label) return false;
  return /\b(?:browser|console|screenshot|preview|terminal|dev server|command)\b/i.test(label);
}

function formatRuntimeCheck(toolCall: ChatToolCall): string {
  const pieces = [
    toolCall.toolId || toolCall.label || "runtime_tool",
    extractQuery(toolCall),
    toolCall.terminal?.command,
    toolCall.terminal?.workingDirectory,
  ].filter(Boolean);

  return pieces.join(" - ");
}

function extractPath(toolCall: ChatToolCall): string | undefined {
  const input = toolCall.input ?? "";
  const fileChange = toolCall.fileChanges?.[0]?.path;
  if (fileChange) return fileChange;

  // Input may be JSON-y or plain. Try JSON parse, then fall through to a
  // best-effort scan for `path`/`file` keys.
  const parsed = tryParseJson(input);
  if (parsed) {
    const candidate = pickStringField(parsed, ["path", "file", "filePath", "filename"]);
    if (candidate) return candidate;
  }

  const labelMatch = toolCall.label?.match(/`([^`]+)`/);
  if (labelMatch) return labelMatch[1];

  return undefined;
}

function extractQuery(toolCall: ChatToolCall): string | undefined {
  const parsed = tryParseJson(toolCall.input ?? "");
  if (parsed) {
    const candidate = pickStringField(parsed, ["query", "pattern", "q", "text"]);
    if (candidate) return candidate;
  }

  const labelMatch = toolCall.label?.match(/`([^`]+)`/);
  if (labelMatch) return labelMatch[1];

  const detailMatch = toolCall.detail?.match(/`([^`]+)`/);
  if (detailMatch) return detailMatch[1];

  return undefined;
}

function tryParseJson(input: string): Record<string, unknown> | undefined {
  if (!input.trim().startsWith("{")) return undefined;

  try {
    const parsed = JSON.parse(input) as unknown;
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function pickStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}
