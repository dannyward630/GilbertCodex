import type { ChatToolCall } from "../types/chat";

interface VisibleToolThinkingOptions {
  final?: boolean;
}

type ToolIntent = "approval" | "browser" | "edit" | "git" | "memory" | "read" | "search" | "terminal" | "web" | "other";

export function createVisibleToolPlanThinking(toolCalls: ChatToolCall[]) {
  const visibleToolCalls = toolCalls.filter(Boolean);

  if (visibleToolCalls.length === 0) {
    return "";
  }

  const action = describePlannedAction(visibleToolCalls);
  const target = describeToolTargets(visibleToolCalls);
  return `${action}${target ? ` ${target}` : ""}.`;
}

export function createVisibleToolApprovalThinking(toolCalls: ChatToolCall[]) {
  const target = describeToolTargets(toolCalls);

  return `This action needs review before it runs${target ? ` ${target}` : ""}.`;
}

export function createVisibleToolResultThinking(toolCalls: ChatToolCall[], options: VisibleToolThinkingOptions = {}) {
  const visibleToolCalls = toolCalls.filter(Boolean);

  if (visibleToolCalls.length === 0) {
    return "";
  }

  const finding = describeToolFinding(visibleToolCalls);
  void options;

  return finding;
}

function describePlannedAction(toolCalls: ChatToolCall[]) {
  if (toolCalls.length > 1) {
    const dominantIntent = getDominantIntent(toolCalls);
    if (dominantIntent === "edit") {
      return `Updating files with ${toolCalls.length} tool calls`;
    }
    if (dominantIntent === "read" || dominantIntent === "search") {
      return `Gathering workspace evidence with ${toolCalls.length} tool calls`;
    }
    return `Running ${toolCalls.length} tool calls`;
  }

  const toolCall = toolCalls[0]!;
  switch (getToolIntent(toolCall)) {
    case "browser":
      return "Checking the app in the browser";
    case "edit":
      return "Applying file changes";
    case "git":
      return "Checking Git state";
    case "memory":
      return "Checking saved project memory";
    case "read":
      return "Reading workspace evidence";
    case "search":
      return "Searching the workspace";
    case "terminal":
      return "Running a command";
    case "web":
      return "Searching the web";
    case "approval":
      return "Preparing an action for review";
    default:
      return `Using ${cleanInlineText(toolCall.label) || "a tool"}`;
  }
}

function describeToolFinding(toolCalls: ChatToolCall[]) {
  const failedTool = toolCalls.find((toolCall) => toolCall.status === "error" || toolCall.status === "skipped");
  if (failedTool) {
    if (isApprovalDeniedToolCall(failedTool)) {
      return "Action canceled before running.";
    }

    const detail = cleanInlineText(failedTool.detail || failedTool.output || "");
    return detail ? `${cleanInlineText(failedTool.label)} needs attention: ${limitInline(detail, 160)}.` : `${cleanInlineText(failedTool.label)} needs attention.`;
  }

  const changedFiles = summarizeChangedFiles(toolCalls);
  if (changedFiles) {
    return changedFiles;
  }

  const terminal = toolCalls.find((toolCall) => toolCall.terminal || getToolIntent(toolCall) === "terminal");
  if (terminal?.terminal) {
    const command = terminal.terminal.command ? `\`${limitInline(terminal.terminal.command, 90)}\`` : "the command";
    const exitCode = terminal.terminal.exitCode;
    return exitCode === undefined || exitCode === null ? `${command} returned runtime output.` : `${command} finished with exit code ${exitCode}.`;
  }

  const targets = describeToolTargets(toolCalls);
  const intent = getDominantIntent(toolCalls);
  if (intent === "read" || intent === "search" || intent === "git" || intent === "memory") {
    return `I have current workspace evidence${targets ? ` ${targets}` : ""}.`;
  }

  if (intent === "web") {
    return `I have web evidence${targets ? ` ${targets}` : ""}.`;
  }

  const outputSummary = summarizeToolOutput(toolCalls);
  if (outputSummary) {
    return outputSummary;
  }

  return `${toolCalls.length === 1 ? cleanInlineText(toolCalls[0]!.label) || "The tool" : `${toolCalls.length} tools`} completed.`;
}

function summarizeChangedFiles(toolCalls: ChatToolCall[]) {
  const changes = toolCalls.flatMap((toolCall) => [
    ...(toolCall.fileChanges ?? []).map((change) => ({
      additions: change.additions,
      deletions: change.deletions,
      path: change.path,
      status: toolCall.status,
    })),
    ...(toolCall.batchFileResults ?? []).map((result) => ({
      additions: result.additions,
      deletions: result.deletions,
      path: result.path,
      status: result.status === "error" ? "error" : result.status === "skipped" ? "skipped" : toolCall.status,
    })),
  ]);

  if (changes.length === 0) {
    return "";
  }

  const okChanges = changes.filter((change) => change.status !== "error" && change.status !== "skipped");
  const failedChanges = changes.length - okChanges.length;
  const additions = okChanges.reduce((sum, change) => sum + Math.max(0, change.additions), 0);
  const deletions = okChanges.reduce((sum, change) => sum + Math.max(0, change.deletions), 0);
  const activitySummary = summarizeToolActivity(toolCalls, okChanges.length || changes.length);
  const diffText = additions || deletions ? ` (+${additions} -${deletions})` : "";
  const failureText = failedChanges > 0 ? `; ${failedChanges} did not complete cleanly` : "";
  const changedCount = okChanges.length || changes.length;

  if (activitySummary) {
    return `${activitySummary}${diffText}${failureText}.`;
  }

  return `Applied file changes to ${changedCount} file${changedCount === 1 ? "" : "s"}${diffText}${failureText}.`;
}

function summarizeToolActivity(toolCalls: ChatToolCall[], changedFileCount: number) {
  const counts = countToolIntents(toolCalls);
  const visibleIntents = (Object.entries(counts) as Array<[ToolIntent, number]>).filter(([, count]) => count > 0);

  if (toolCalls.length <= 1 || visibleIntents.length <= 1) {
    return "";
  }

  const parts = [
    counts.search > 0 ? counts.search === 1 ? "searched workspace" : `${counts.search} workspace searches` : "",
    counts.read > 0 ? counts.read === 1 ? "read workspace evidence" : `${counts.read} workspace reads` : "",
    counts.edit > 0 ? `edited ${changedFileCount} file${changedFileCount === 1 ? "" : "s"}` : "",
    counts.terminal > 0 ? counts.terminal === 1 ? "ran 1 command" : `ran ${counts.terminal} commands` : "",
    counts.git > 0 ? counts.git === 1 ? "checked Git" : `${counts.git} Git checks` : "",
    counts.browser > 0 ? counts.browser === 1 ? "checked browser" : `${counts.browser} browser checks` : "",
    counts.web > 0 ? counts.web === 1 ? "searched web" : `${counts.web} web searches` : "",
    counts.memory > 0 ? counts.memory === 1 ? "checked memory" : `${counts.memory} memory checks` : "",
    counts.approval > 0 ? counts.approval === 1 ? "handled approval" : `${counts.approval} approval steps` : "",
    counts.other > 0 ? counts.other === 1 ? "used another tool" : `used ${counts.other} other tools` : "",
  ].filter(Boolean);

  if (parts.length <= 1) {
    return "";
  }

  return `Used ${toolCalls.length} tools: ${joinReadableList(parts)}`;
}

function countToolIntents(toolCalls: ChatToolCall[]) {
  return toolCalls.reduce<Record<ToolIntent, number>>((counts, toolCall) => {
    const intent = getToolIntent(toolCall);
    counts[intent] += 1;
    return counts;
  }, {
    approval: 0,
    browser: 0,
    edit: 0,
    git: 0,
    memory: 0,
    other: 0,
    read: 0,
    search: 0,
    terminal: 0,
    web: 0,
  });
}

function joinReadableList(parts: string[]) {
  if (parts.length <= 2) {
    return parts.join(" and ");
  }

  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

function summarizeToolOutput(toolCalls: ChatToolCall[]) {
  for (const toolCall of toolCalls) {
    const connectedAppSummary = summarizeConnectedAppOutput(toolCall);
    if (connectedAppSummary) {
      return connectedAppSummary;
    }

    const candidate = cleanOutputLine(toolCall.detail || toolCall.output || "");

    if (candidate) {
      return `${cleanInlineText(toolCall.label) || "Tool"} finished: ${candidate}.`;
    }
  }

  return "";
}

function summarizeConnectedAppOutput(toolCall: ChatToolCall) {
  const key = `${toolCall.toolId ?? ""} ${toolCall.label}`.toLowerCase();
  const output = `${toolCall.detail ?? ""}\n${toolCall.output ?? ""}`;

  if (/\bgmail\b/.test(key)) {
    const activeAccount = output.match(/active account:\s*([^\s|,]+)/i)?.[1] ?? output.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? "";

    if (/connected accounts?/i.test(output) || /active account/i.test(output)) {
      return activeAccount ? `Gmail account checked. Active account: ${activeAccount}.` : "Gmail account checked.";
    }

    if (/draft/i.test(key)) {
      return "Gmail draft prepared for review.";
    }

    return "Gmail action finished.";
  }

  if (/\bcalendar\b/.test(key)) {
    return "Calendar action finished.";
  }

  return "";
}

function isApprovalDeniedToolCall(toolCall: ChatToolCall) {
  if (toolCall.status !== "skipped") {
    return false;
  }

  const text = `${toolCall.detail ?? ""}\n${toolCall.output ?? ""}`;
  return /\bapproval denied\b|\bno tool action ran\b|\bdenied before/i.test(text);
}

function describeToolTargets(toolCalls: ChatToolCall[]) {
  const targets = unique(toolCalls.flatMap(extractToolTargets)).slice(0, 2);

  if (targets.length === 0) {
    return "";
  }

  const suffix = countExtraTargets(toolCalls, targets) > 0 ? ` and ${countExtraTargets(toolCalls, targets)} more` : "";
  return `for ${targets.join(", ")}${suffix}`;
}

function countExtraTargets(toolCalls: ChatToolCall[], visibleTargets: string[]) {
  return Math.max(0, unique(toolCalls.flatMap(extractToolTargets)).length - visibleTargets.length);
}

function extractToolTargets(toolCall: ChatToolCall) {
  const parsed = parseToolInput(toolCall.input);
  const targets = [
    toolCall.terminal?.command ? `\`${limitInline(toolCall.terminal.command, 82)}\`` : "",
    stringValue(parsed?.path),
    stringValue(parsed?.fromPath),
    stringValue(parsed?.toPath),
    stringValue(parsed?.query),
    stringValue(parsed?.searchQuery),
    stringValue(parsed?.q),
    ...stringArrayValue(parsed?.paths),
    ...recordArrayValue(parsed?.files).map((record) => stringValue(record.path)),
    ...recordArrayValue(parsed?.edits).map((record) => stringValue(record.path)),
    ...(toolCall.fileChanges ?? []).map((change) => change.path),
    ...(toolCall.batchFileResults ?? []).map((result) => result.path),
  ];

  return targets.map(formatPath).filter(Boolean);
}

function getDominantIntent(toolCalls: ChatToolCall[]) {
  const counts = new Map<ToolIntent, number>();

  for (const toolCall of toolCalls) {
    const intent = getToolIntent(toolCall);
    counts.set(intent, (counts.get(intent) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? "other";
}

function getToolIntent(toolCall: ChatToolCall): ToolIntent {
  const key = `${toolCall.toolId ?? ""} ${toolCall.label}`.toLowerCase();

  if (toolCall.status === "waiting_approval") {
    return "approval";
  }

  if (/\b(browser|playwright|screenshot|preview|navigate|click)\b/.test(key)) {
    return "browser";
  }

  if (/\b(files_(?:append|apply_patch|create_directory|edit_many|exact_replace|insert_at_line|move|replace_range|replace_span|write|write_many)|write|edit|patch|replace|insert|append|move)\b/.test(key)) {
    return "edit";
  }

  if (/\b(git|diff|status|commit|branch|push|pull)\b/.test(key)) {
    return "git";
  }

  if (/\b(memory|remember|recall)\b/.test(key)) {
    return "memory";
  }

  if (/\b(files_(?:read|tree|list)|read|open file|list workspace|tree)\b/.test(key)) {
    return "read";
  }

  if (/\b(files_(?:search|grep)|search|rg|grep|find)\b/.test(key)) {
    return "search";
  }

  if (toolCall.terminal || /\b(command|terminal|shell|powershell|cmd|bash|zsh|npm|node|cargo|test|build)\b/.test(key)) {
    return "terminal";
  }

  if (/\b(web|duckduckgo|brave|google|http|source|url)\b/.test(key)) {
    return "web";
  }

  return "other";
}

function parseToolInput(input: string | undefined): Record<string, unknown> | undefined {
  if (!input?.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function recordArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))) : [];
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function unique(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    result.push(trimmed);
  }

  return result;
}

function formatPath(value: string) {
  const cleaned = cleanInlineText(value);

  if (!cleaned || isNoiseOnlyTarget(cleaned)) {
    return "";
  }

  if (cleaned.startsWith("`") && cleaned.endsWith("`")) {
    return cleaned;
  }

  if (/^https?:\/\//i.test(cleaned)) {
    try {
      return new URL(cleaned).hostname.replace(/^www\./, "");
    } catch {
      return limitInline(cleaned, 72);
    }
  }

  const normalized = cleaned.replace(/\\/g, "/");
  const srcIndex = normalized.lastIndexOf("/src/");
  const shortPath = srcIndex >= 0 ? normalized.slice(srcIndex + 1) : normalized.split("/").filter(Boolean).slice(-3).join("/");

  return shortPath && !isNoiseOnlyTarget(shortPath) ? `\`${limitInline(shortPath, 88)}\`` : "";
}

function cleanOutputLine(value: string) {
  const cleaned = cleanInlineText(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) =>
      line &&
      !/^(?:tool result evidence|tool:|call id:|output:|provider-visible tool output excerpt|the raw file body)/i.test(line) &&
      !/^[{}[\],:"\d\s.-]+$/.test(line),
    )[0] ?? "";

  return cleaned ? limitInline(cleaned.replace(/[.。]+$/g, ""), 160) : "";
}

function cleanInlineText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isNoiseOnlyTarget(value: string) {
  const normalized = cleanInlineText(value).replace(/[`'"\[\]{}()]/g, "").replace(/\\/g, "/").trim();
  return !normalized || normalized === "." || normalized === "./" || /^[.\-–—•·]+$/.test(normalized);
}

function limitInline(value: string, maxChars: number) {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}
