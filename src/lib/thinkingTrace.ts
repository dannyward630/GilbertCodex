import type { ChatToolCall } from "../types/chat";

interface VisibleToolThinkingOptions {
  final?: boolean;
}

type ToolIntent = "approval" | "browser" | "edit" | "git" | "memory" | "read" | "search" | "terminal" | "web" | "other";

export function createVisibleToolPlanThinking(toolCalls: ChatToolCall[]) {
  const visibleToolCalls = toolCalls.filter(isVisibleTraceToolCall);

  if (visibleToolCalls.length === 0) {
    return "";
  }

  return describePlannedAction(visibleToolCalls);
}

export function createVisibleToolApprovalThinking(toolCalls: ChatToolCall[]) {
  const visibleToolCalls = toolCalls.filter(isVisibleTraceToolCall);

  if (visibleToolCalls.length === 0) {
    return "";
  }

  const target = describeToolTargets(visibleToolCalls);

  return `This action needs review before it runs${target ? ` ${target}` : ""}.`;
}

export function createVisibleToolResultThinking(toolCalls: ChatToolCall[], options: VisibleToolThinkingOptions = {}) {
  const visibleToolCalls = toolCalls.filter(isVisibleTraceToolCall);

  if (visibleToolCalls.length === 0) {
    return "";
  }

  const finding = describeToolFinding(visibleToolCalls);
  void options;

  return finding;
}

function describePlannedAction(toolCalls: ChatToolCall[]) {
  const target = describeThoughtTargetContext(toolCalls);

  if (toolCalls.length > 1) {
    const dominantIntent = getDominantIntent(toolCalls);
    if (dominantIntent === "edit") {
      return `Applying file changes${target ? ` in ${target}` : ""}.`;
    }
    if (dominantIntent === "read") {
      return `Reading relevant files${target ? `: ${target}` : ""}.`;
    }
    if (dominantIntent === "search") {
      return describeSearchPlan(toolCalls) || `Searching the workspace${target ? ` for ${target}` : ""}.`;
    }
    if (dominantIntent === "terminal") {
      return `Running commands${target ? ` for ${target}` : ""}.`;
    }
    return `Working through concrete actions${target ? ` for ${target}` : ""}.`;
  }

  const toolCall = toolCalls[0]!;
  switch (getToolIntent(toolCall)) {
    case "browser":
      return "Checking the app in the browser.";
    case "edit":
      return `Applying file changes${target ? ` in ${target}` : ""}.`;
    case "git":
      return "Checking Git state.";
    case "memory":
      return "Checking saved project memory.";
    case "read":
      return target ? `Reading workspace files: ${target}.` : "Reading workspace files.";
    case "search":
      return describeSearchPlan(toolCalls) || `Searching${target ? ` for ${target}` : " the workspace"}.`;
    case "terminal":
      return `Running ${target || "a command"}.`;
    case "web":
      return `Checking current web sources${target ? ` for ${target}` : ""}.`;
    case "approval":
      return "Waiting for approval.";
    default:
      return `Using ${cleanInlineText(toolCall.label) || "the next action"}.`;
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

  const intent = getDominantIntent(toolCalls);
  const terminal = toolCalls.find((toolCall) => toolCall.terminal || getToolIntent(toolCall) === "terminal");
  if (terminal?.terminal) {
    const command = terminal.terminal.command ? `\`${limitInline(terminal.terminal.command, 90)}\`` : "the command";
    const exitCode = terminal.terminal.exitCode;
    return exitCode === undefined || exitCode === null ? `${command} returned runtime output.` : `${command} finished with exit code ${exitCode}.`;
  }

  const targets = describeToolTargets(toolCalls);
  if (intent === "read") {
    return summarizeEvidenceResult(toolCalls, "read") || `Read workspace files${targets ? ` ${targets}` : ""}.`;
  }

  if (intent === "search") {
    return summarizeEvidenceResult(toolCalls, "search") || `Searched the workspace${targets ? ` ${targets}` : ""}.`;
  }

  if (intent === "git" || intent === "memory") {
    return `Checked project context${targets ? ` ${targets}` : ""}.`;
  }

  if (intent === "web") {
    return `Checked current sources${targets ? ` ${targets}` : ""}.`;
  }

  const outputSummary = summarizeToolOutput(toolCalls);
  if (outputSummary) {
    return outputSummary;
  }

  return `${toolCalls.length === 1 ? cleanInlineText(toolCalls[0]!.label) || "The tool" : `${toolCalls.length} tools`} completed.`;
}

function summarizeEvidenceResult(toolCalls: ChatToolCall[], intent: "read" | "search") {
  const searchTerms = intent === "search" ? collectSearchTerms(toolCalls) : [];
  const fileTargets = unique(toolCalls.flatMap(extractToolEvidencePaths)).filter(isUsefulEvidenceTarget);
  const targetText = intent === "read"
    ? formatEvidenceReadTargets(fileTargets)
    : formatEvidenceSearchTargets(fileTargets, searchTerms);
  const focusText = inferEvidenceFocus([...fileTargets, ...searchTerms]);

  if (!targetText && !focusText) {
    return "";
  }

  const verb = intent === "read" ? "Read" : "Searched";
  const fallbackTarget = intent === "read" ? "workspace files" : "the workspace";
  const subject = targetText || fallbackTarget;

  return `${verb} ${subject}${focusText ? `; ${focusText}` : ""}.`;
}

function describeSearchPlan(toolCalls: ChatToolCall[]) {
  const terms = collectSearchTerms(toolCalls);
  const scopes = unique(toolCalls.flatMap(extractToolEvidencePaths)).filter(isUsefulEvidenceTarget);
  const focus = inferEvidenceFocus([...scopes, ...terms]);
  const termText = formatEvidenceTargets(terms);
  const scopeText = formatEvidenceTargets(scopes);

  if (!termText && !scopeText && !focus) {
    return "";
  }

  if (termText && scopeText) {
    return `Searching ${scopeText} for ${termText}${focus ? ` (${focus})` : ""}.`;
  }

  if (termText) {
    return `Searching the workspace for ${termText}${focus ? ` (${focus})` : ""}.`;
  }

  return `Searching ${scopeText || "the workspace"}${focus ? ` (${focus})` : ""}.`;
}

function formatEvidenceReadTargets(targets: string[]) {
  if (targets.length === 0) {
    return "";
  }

  const commonDirectory = findCommonEvidenceDirectory(targets.map(stripTargetFormatting));
  if (targets.length > 3 && commonDirectory) {
    const fileNames = targets.map(formatEvidenceBasename).filter(Boolean);
    const preview = formatEvidenceTargets(fileNames);
    return `${targets.length} files in \`${commonDirectory}\`${preview ? ` (${preview})` : ""}`;
  }

  return formatEvidenceTargets(targets);
}

function formatEvidenceSearchTargets(targets: string[], terms: string[]) {
  const termText = formatEvidenceTargets(terms);
  const targetText = formatEvidenceTargets(targets);

  if (termText && targetText) {
    return `${targetText} for ${termText}`;
  }

  if (termText) {
    return `workspace for ${termText}`;
  }

  return targetText;
}

function formatEvidenceTargets(targets: string[]) {
  if (targets.length === 0) {
    return "";
  }

  const visibleTargets = targets.slice(0, 3);
  const remaining = targets.length - visibleTargets.length;
  const targetText = remaining > 0 ? visibleTargets.join(", ") : joinReadableList(visibleTargets);

  return remaining > 0 ? `${targetText}, and ${remaining} more` : targetText;
}

function formatEvidenceBasename(target: string) {
  const cleaned = stripTargetFormatting(target);
  const basename = cleaned.split("/").filter(Boolean).pop() ?? "";
  return basename ? `\`${basename}\`` : "";
}

function isUsefulEvidenceTarget(target: string) {
  const cleaned = stripTargetFormatting(target);

  if (!cleaned) {
    return false;
  }

  if (isWorkspaceRootLikePath(cleaned)) {
    return false;
  }

  if (/^(?:gilbertcodex|src|app|workspace)$/i.test(cleaned)) {
    return false;
  }

  return true;
}

function inferEvidenceFocus(targets: string[]) {
  const normalizedTargets = targets.map(stripTargetFormatting).map((target) => target.toLowerCase());
  const joined = normalizedTargets.join("\n");
  const focusLabels = [
    /\bsrc\/toolbridge\/tools\/terminal\b|\bterminal(?:run|diagnostics|session|backend)?\b/.test(joined) ? "terminal session lifecycle" : "",
    /\bsrc\/toolbridge\/(?:registry|selection|capabilityplan|adapters|tools)\b/.test(joined) ? "tool bridge registration/selection" : "",
    /\b(?:src\/app\/)?workspace\/tools\/localtoolstreaming\.tsx\b/.test(joined) ? "local tool streaming" : "",
    /\bsrc\/app\/tauriclient\.ts\b/.test(joined) ? "desktop bridge calls" : "",
    /\b(?:assistantactivityindicator|assistantruncard|chatthread)\.(?:tsx|ts)\b/.test(joined) ? "assistant work-trace rendering" : "",
    /\b(?:thinkingtrace|worktracecontent)\.(?:tsx|ts)\b/.test(joined) ? "visible trace generation/filtering" : "",
    /\b(?:conversation|chat)\.css\b/.test(joined) ? "thinking surface styling" : "",
    /\bruntimetoolprompt\.ts\b/.test(joined) ? "runtime tool prompt guidance" : "",
    /\bsrc\/toolbridge\b/.test(joined) ? "the tool bridge" : "",
  ].filter(Boolean);
  const uniqueFocusLabels = unique(focusLabels).slice(0, 2);

  if (uniqueFocusLabels.length > 0) {
    return `focus: ${joinReadableList(uniqueFocusLabels)}`;
  }

  const commonDirectory = findCommonEvidenceDirectory(normalizedTargets);
  return commonDirectory ? `focus: files clustered in \`${commonDirectory}\`` : "";
}

function findCommonEvidenceDirectory(targets: string[]) {
  const pathParts = targets
    .filter((target) => target.includes("/"))
    .map((target) => target.split("/").filter(Boolean).slice(0, -1))
    .filter((parts) => parts.length > 0);

  if (pathParts.length < 2) {
    return "";
  }

  const commonParts: string[] = [];
  const [firstParts] = pathParts;

  for (let index = 0; index < firstParts.length; index += 1) {
    const candidate = firstParts[index];
    if (!candidate || pathParts.some((parts) => parts[index] !== candidate)) {
      break;
    }
    commonParts.push(candidate);
  }

  return commonParts.length >= 2 ? commonParts.join("/") : "";
}

function summarizeChangedFiles(toolCalls: ChatToolCall[]) {
  const fileRecords = toolCalls.flatMap((toolCall) => [
    ...(toolCall.fileChanges ?? []).map((change) => ({
      additions: change.additions,
      deletions: change.deletions,
      kind: "update",
      path: change.path,
      status: toolCall.status,
    })),
    ...(toolCall.batchFileResults ?? []).map((result) => ({
      additions: result.additions,
      deletions: result.deletions,
      kind: result.kind,
      path: result.path,
      status: result.status === "error" ? "error" : result.status === "skipped" ? "skipped" : toolCall.status,
    })),
  ]);
  const changes = fileRecords.filter((record) => isMutatingFileRecord(record));

  if (changes.length === 0) {
    if (fileRecords.length > 0 && toolCalls.some((toolCall) => getToolIntent(toolCall) === "edit")) {
      return "Checked file changes; no file contents changed.";
    }
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

function isMutatingFileRecord(record: { additions?: number; deletions?: number; kind?: string; path: string; status?: string }) {
  const additions = typeof record.additions === "number" && Number.isFinite(record.additions) ? record.additions : 0;
  const deletions = typeof record.deletions === "number" && Number.isFinite(record.deletions) ? record.deletions : 0;
  return additions > 0 || deletions > 0 || record.kind === "create" || record.kind === "delete" || record.kind === "move";
}

function summarizeToolActivity(toolCalls: ChatToolCall[], changedFileCount: number) {
  const counts = countToolIntents(toolCalls);
  const visibleIntents = (Object.entries(counts) as Array<[ToolIntent, number]>).filter(([, count]) => count > 0);

  if (toolCalls.length <= 1 || visibleIntents.length <= 1) {
    return "";
  }

  const parts = [
    counts.search > 0 ? counts.search === 1 ? "searched workspace" : `${counts.search} workspace searches` : "",
    counts.read > 0 ? counts.read === 1 ? "read files" : `${counts.read} file reads` : "",
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

function describeThoughtTargetContext(toolCalls: ChatToolCall[]) {
  const targets = unique(toolCalls.flatMap(extractToolTargets)).filter(isUsefulThoughtTarget).slice(0, 2);

  if (targets.length === 0) {
    return "";
  }

  const extraCount = countExtraTargets(toolCalls, targets);
  const label = joinReadableList(targets);
  return extraCount > 0 ? `${label} and ${extraCount} more` : label;
}

function isUsefulThoughtTarget(target: string) {
  const cleaned = stripTargetFormatting(target);

  if (!cleaned) {
    return false;
  }

  if (isWorkspaceRootLikePath(cleaned)) {
    return false;
  }

  if (cleaned.includes("|") || /[*+?()[\]{}]/.test(cleaned)) {
    return false;
  }

  if (cleaned.length > 88) {
    return false;
  }

  return true;
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

function extractToolEvidencePaths(toolCall: ChatToolCall) {
  const parsed = parseToolInput(toolCall.input);
  const targets = [
    toolCall.terminal?.command ? `\`${limitInline(toolCall.terminal.command, 82)}\`` : "",
    stringValue(parsed?.path),
    stringValue(parsed?.fromPath),
    stringValue(parsed?.toPath),
    ...stringArrayValue(parsed?.paths),
    ...recordArrayValue(parsed?.files).map((record) => stringValue(record.path)),
    ...recordArrayValue(parsed?.edits).map((record) => stringValue(record.path)),
    ...(toolCall.fileChanges ?? []).map((change) => change.path),
    ...(toolCall.batchFileResults ?? []).map((result) => result.path),
  ];

  return targets.map(formatPath).filter(Boolean);
}

function collectSearchTerms(toolCalls: ChatToolCall[]) {
  const terms = toolCalls.flatMap((toolCall) => {
    const parsed = parseToolInput(toolCall.input);
    return [
      stringValue(parsed?.query),
      stringValue(parsed?.searchQuery),
      stringValue(parsed?.q),
    ];
  });

  return unique(terms.map(formatSearchTerm).filter(Boolean)).slice(0, 4);
}

function formatSearchTerm(value: string) {
  const cleaned = cleanInlineText(value)
    .replace(/\b(?:users[\\/])?kobe work[\\/]documents[\\/]gilbertcodex\b/ig, "")
    .replace(/\b(?:users[\\/][^\\/]+[\\/])?documents[\\/]gilbertcodex\b/ig, "")
    .replace(/\bgilbertcodex\b/ig, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || isWorkspaceRootLikePath(cleaned) || cleaned.length > 90) {
    return "";
  }

  return `\`${limitInline(cleaned, 72)}\``;
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

  if (/\b(web_search|web|duckduckgo|brave|google|http|source|url)\b/.test(key)) {
    return "web";
  }

  if (/\b(files_(?:search|grep)|search|rg|grep|find)\b/.test(key)) {
    return "search";
  }

  if (toolCall.terminal || /\b(command|terminal|shell|powershell|cmd|bash|zsh|npm|node|cargo|test|build)\b/.test(key)) {
    return "terminal";
  }

  return "other";
}

function isVisibleTraceToolCall(toolCall: ChatToolCall | undefined): toolCall is ChatToolCall {
  if (!toolCall) {
    return false;
  }

  return !isTerminalSessionDiagnosticToolCall(toolCall);
}

function isTerminalSessionDiagnosticToolCall(toolCall: ChatToolCall) {
  const key = `${toolCall.toolId ?? ""} ${toolCall.label} ${toolCall.detail ?? ""}`.toLowerCase();

  return (
    /\bterminal_(?:list_sessions|read_session|dev_server_status)\b/.test(key) ||
    /\b(?:list|read) terminal sessions?\b/.test(key) ||
    /\bterminal dev server status\b/.test(key) ||
    /\bcould not read that terminal session\b/.test(key)
  );
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
  if (isWorkspaceRootLikePath(normalized)) {
    return "";
  }

  const srcIndex = normalized.lastIndexOf("/src/");
  const workspaceMatch =
    normalized.match(/(?:^|\/)Users\/[^/]+\/(?:Documents|StudioProjects|AndroidStudioProjects)\/[^/]+\/(.+)$/i) ??
    normalized.match(/(?:^|\/)[^/]+\/(?:Documents|StudioProjects|AndroidStudioProjects)\/[^/]+\/(.+)$/i) ??
    normalized.match(/(?:^|\/)(?:Documents|StudioProjects|AndroidStudioProjects)\/[^/]+\/(.+)$/i);
  const shortPath = /^src\//i.test(normalized)
    ? normalized
    : srcIndex >= 0
    ? normalized.slice(srcIndex + 1)
    : workspaceMatch?.[1] || normalized.split("/").filter(Boolean).slice(-3).join("/");

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

function stripTargetFormatting(value: string) {
  return cleanInlineText(value)
    .replace(/^`|`$/g, "")
    .replace(/\\/g, "/")
    .trim();
}

function isNoiseOnlyTarget(value: string) {
  const normalized = cleanInlineText(value).replace(/[`'"\[\]{}()]/g, "").replace(/\\/g, "/").trim();
  return !normalized || normalized === "." || normalized === "./" || /^[.\-–—•·]+$/.test(normalized);
}

function isWorkspaceRootLikePath(value: string) {
  const normalized = cleanInlineText(value)
    .replace(/[`'"]/g, "")
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .trim();

  if (!normalized || normalized === "." || normalized === "./") {
    return true;
  }

  return (
    /^(?:users\/[^/]+\/)?(?:documents|studioprojects|androidstudioprojects)\/[^/]+$/i.test(normalized) ||
    /^[^/]+\/(?:documents|studioprojects|androidstudioprojects)\/[^/]+$/i.test(normalized) ||
    /(?:^|\/)(?:documents|studioprojects|androidstudioprojects)\/gilbertcodex$/i.test(normalized) ||
    /(?:^|\/)gilbertcodex$/i.test(normalized)
  );
}

function limitInline(value: string, maxChars: number) {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}
