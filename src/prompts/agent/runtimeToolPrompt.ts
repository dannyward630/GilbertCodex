import type { ProviderSettings } from "../../types/settings";
import type { ProviderToolBridgeOptions, ToolDefinition, ToolBridgePermissionRequirement, ToolBridgeRisk } from "../../toolBridge/types";

export interface RuntimeToolPromptInput {
  hasLocalComputerContext: boolean;
  hasWebContext: boolean;
  latestUserPrompt: string;
  selectedChunkIds: Set<string>;
  settings: ProviderSettings;
  toolBridge?: ProviderToolBridgeOptions;
}

interface RuntimeToolSummary {
  family: string;
  id: string;
  permission: ToolBridgePermissionRequirement;
  risk: ToolBridgeRisk;
}

export function createRuntimeToolPrompt({ hasLocalComputerContext, hasWebContext, latestUserPrompt, toolBridge }: RuntimeToolPromptInput) {
  const attachedTools = getAttachedToolSummaries(toolBridge);
  const attachedToolIds = new Set(attachedTools.map((tool) => tool.id));
  const hasTool = (id: string) => attachedToolIds.has(id);
  const hasAnyToolFamily = (...families: string[]) => attachedTools.some((tool) => families.includes(tool.family));
  const hasExactToolBridge = Boolean(toolBridge);
  const sections = [
    "Use only app-exposed provider tool calls when they are attached to this request. Do not invent text-only tool JSON, XML, local-computer protocols, MCP calls, Git calls, terminal transcripts, or workflow calls in visible Markdown.",
    formatAvailableToolsManifest(attachedTools, toolBridge),
    hasTool("memory_search")
      ? "Use memory_search as the selective path to saved local chat/project memory and tool lessons. Do not assume memory was preloaded into the prompt; query it when prior decisions, earlier chats, project continuity, or previous tool failures could matter."
      : "Saved local memory search is not attached for this request.",
    hasTool("terminal_run")
      ? "Terminal commands are available only through the approval-gated terminal_run tool, which runs inside the selected workspace with a cwd, timeout, captured output, and optional background session for dev servers. Put the target folder in cwd/workingDirectory; do not prefix commands with `cd ... &&`. Match the active shell dialect: on Windows/PowerShell, do not use Unix-only commands such as `mkdir -p`, `ls -la`, or `wc -l`; use files_create_directory/files_list/files_count_lines when attached, or PowerShell-native commands."
      : "Terminal execution is not attached for this request.",
    hasAnyToolFamily("git")
      ? "Local Git tools are attached for this request. For uncommitted/local change reviews, call git_status before git_diff instead of asking the user to attach a diff or relying on chat history."
      : "Local Git tools are not attached for this request.",
    hasTool("browser_preview_open") || hasTool("browser_console_read")
      ? "Browser/app preview is available through browser_preview_open after a local dev server URL exists or a public HTTPS URL is provided, and browser_console_read can read captured browser console errors, warnings, logs, and preview lifecycle issues. When the user asks to preview, inspect, test, debug, or verify a website, localhost app, browser UI, or visual change, open the preview with the tool once a target URL is known, then read the browser console when debugging issues instead of merely saying it could be opened."
      : "Browser/app preview tools are not attached for this request.",
    hasTool("web_search")
      ? formatWebSearchToolGuidance(latestUserPrompt)
      : "Live web search is not attached for this request.",
    hasTool("image_generate")
      ? "Image generation is available through image_generate for this request. When the user asks to create, generate, draw, render, design, or produce an image, call image_generate instead of merely describing the image. Put a strong visual brief in the tool prompt: subject, style or medium, composition/framing, colors, lighting, text requirements, and constraints. If the user asks for multiple options, set n/count from 1 to 4 and ask for distinct variations in the prompt. Omit the model unless the user explicitly asks for a complete cx/* subscription image route. Never pass partial model routes such as cx/ or OpenAI native image ids such as gpt-image-1 in this tool. Mention the attached image artifact after it succeeds; do not paste base64."
      : "Image generation is not attached for this request.",
    hasWebContext
      ? "Live web-search context is present. Treat it as the only current external evidence for this answer and cite only the provided URLs."
      : hasTool("web_search")
        ? "If current web evidence is needed, call web_search with a focused query. If web_search is unavailable or returns no usable sources, say what could not be verified instead of pretending a search ran."
        : "If live web evidence is unavailable, say what could not be verified instead of pretending a search ran.",
    hasLocalComputerContext || hasAnyToolFamily("files", "editing", "git", "terminal", "browser")
      ? "Local workspace context may be attached as bounded metadata. It is not proof that any file was read, edited, tested, committed, or executed during this turn."
      : "",
    formatBatchToolGuidance(attachedToolIds),
    hasAnyToolFamily("editing")
      ? formatEditToolGuidance(attachedToolIds)
      : "",
    hasTool("files_create_directory")
      ? "For folder creation, use files_create_directory when attached instead of terminal mkdir commands. GILBERT.md is curated project memory: write concise notes, decisions, commands, architecture, preferences, and lessons there; do not paste raw tool errors or failure logs into it."
      : "",
    hasTool("web_search")
      ? "For research requests, use focused web_search calls only when source coverage is insufficient. Prefer primary sources, avoid duplicate queries, and synthesize only from cited live sources plus local tool evidence."
      : "",
    hasExactToolBridge && attachedTools.length === 0 ? "No provider tools are attached. Answer from chat, attachments, and already-provided context only." : "",
    "Visible answers should be normal Markdown prose. Do not wrap the whole answer in a fenced code block, and do not use code fences for ordinary summaries, plans, bullets, tables, or explanations. Do not emit JSON envelopes, provider tool_calls, or raw tool-call markup as visible text. Use fenced code blocks only for actual code snippets, diffs, logs, terminal output, or code-only content the user explicitly requested. Never mention hidden tool protocols or unavailable tool syntax unless the user directly asks about tool availability.",
  ];

  return sections.filter(Boolean).join("\n");
}

function getAttachedToolSummaries(toolBridge: ProviderToolBridgeOptions | undefined): RuntimeToolSummary[] {
  if (toolBridge) {
    return (toolBridge.tools ?? []).map(summarizeTool);
  }

  // Provider tools are request-scoped. App settings may enable files, editing,
  // terminal, or web globally, but the model can only call tools that the
  // runtime attached to this exact provider request.
  return [];
}

function summarizeTool(tool: ToolDefinition): RuntimeToolSummary {
  return {
    family: tool.executorMetadata?.family ?? "tool",
    id: tool.id,
    permission: tool.permission,
    risk: tool.risk,
  };
}

function formatWebSearchToolGuidance(latestUserPrompt: string) {
  const promptLooksCurrent = /\b(api docs?|browse|changelog|cite|current|latest|look up|official|online|prices?|pricing|recent|release notes?|research|search(?:\s+the)?\s+(?:internet|online|web)|sources|today|up[- ]to[- ]date|verify|web)\b|(?:\b(?:release|launch)\s+(?:date|daye?|schedule|timing|window)\b)|(?:\b(?:comes?|coming)\s+out\b)|(?:\b(?:scheduled|slated)\s+(?:for|to|release|launch)\b)/i.test(latestUserPrompt);
  const promptHint = promptLooksCurrent
    ? "The latest user prompt appears to ask for current or source-backed external evidence; call web_search before making those claims."
    : "";

  return [
    "When web_search is listed above, it is a callable live-web tool for this exact request. Use it before answering claims that depend on current or changing external facts, official docs/API references, releases/changelogs, pricing, laws/rules/standards, schedules, news, or when the user asks to search, look up, verify, cite, or use sources.",
    "Prefer local workspace tools for repo files, settings, app behavior, source code, and local docs. If both local code and external documentation are needed, use workspace tools for local evidence and web_search for outside evidence.",
    promptHint,
  ].filter(Boolean).join(" ");
}

function formatAvailableToolsManifest(tools: RuntimeToolSummary[], toolBridge: ProviderToolBridgeOptions | undefined) {
  const lines = ["Available provider tools for this request:"];

  if (tools.length === 0) {
    lines.push("- none");
  } else {
    for (const [family, ids] of groupToolIdsByFamily(tools)) {
      lines.push(`- ${family}: ${ids.join(", ")}`);
    }
  }

  const budget = toolBridge?.runtimeBudget;
  const resultChars = budget?.maxToolResultContentChars ?? toolBridge?.maxToolResultContentChars;
  const budgetParts = [
    formatBudgetPart("passes", budget?.remainingPasses, budget?.maxPasses),
    formatBudgetPart("executions", budget?.remainingExecutions, budget?.maxExecutions),
    typeof resultChars === "number" ? `tool-result context ${Math.max(0, Math.floor(resultChars)).toLocaleString()} chars` : "",
  ].filter(Boolean);

  if (budgetParts.length > 0) {
    lines.push(`- budget: ${budgetParts.join("; ")}`);
  }

  return lines.join("\n");
}

function groupToolIdsByFamily(tools: RuntimeToolSummary[]) {
  const grouped = new Map<string, string[]>();

  for (const tool of tools) {
    const ids = grouped.get(tool.family) ?? [];
    ids.push(tool.id);
    grouped.set(tool.family, ids);
  }

  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function formatBudgetPart(label: string, remaining: number | undefined, max: number | undefined) {
  if (remaining === undefined && max === undefined) {
    return "";
  }

  if (remaining !== undefined && max !== undefined) {
    return `${label} ${Math.max(0, remaining)}/${Math.max(0, max)}`;
  }

  return `${label} ${Math.max(0, remaining ?? max ?? 0)}`;
}

function formatBatchToolGuidance(attachedToolIds: Set<string>) {
  const batchTools = [
    attachedToolIds.has("files_read_many") ? "files_read_many for multiple reads" : "",
    attachedToolIds.has("files_write_many") ? "files_write_many for creating or replacing several files" : "",
    attachedToolIds.has("files_edit_many") ? "files_edit_many for one or many precise edits" : "",
  ].filter(Boolean);

  if (batchTools.length === 0) {
    return "";
  }

  const editManyGuidance = attachedToolIds.has("files_edit_many")
    ? " For code edits, put every independent same-pass change into one files_edit_many call, including several changes in a single file."
    : "";

  return `When the task needs several reads, writes, or edits, prefer batch tools by default when attached: ${batchTools.join("; ")}.${editManyGuidance}`;
}

function formatEditToolGuidance(attachedToolIds: Set<string>) {
  const batchEditTool = attachedToolIds.has("files_edit_many")
    ? "Use files_edit_many as the default for existing-file edits; it applies same-file edits in order and writes each file once."
    : "";
  const preciseTools = [
    attachedToolIds.has("files_apply_patch") ? "files_apply_patch for hunks" : "",
    attachedToolIds.has("files_exact_replace") ? "files_exact_replace only for a single tiny exact-text follow-up" : "",
    attachedToolIds.has("files_replace_range") ? "files_replace_range only for a single tiny line-range follow-up" : "",
  ].filter(Boolean);
  const fullRewriteTool = attachedToolIds.has("files_write_many")
    ? " Use files_write_many only for new files or deliberate full-file rewrites."
    : "";
  const lineRangeGuidance = attachedToolIds.has("files_edit_many") || attachedToolIds.has("files_replace_range")
    ? " Use replace_range only with line numbers from a fresh read of the current file; if a range fails as stale or out of bounds, re-read and retry with exact_replace or files_apply_patch anchored to current text."
    : "";

  if (!batchEditTool && preciseTools.length === 0 && !fullRewriteTool) {
    return "";
  }

  return [`For existing-file edits, inspect the target first.`, batchEditTool, preciseTools.length > 0 ? `Other attached precise tools: ${preciseTools.join("; ")}.` : "", fullRewriteTool.trim(), lineRangeGuidance.trim()]
    .filter(Boolean)
    .join(" ");
}
