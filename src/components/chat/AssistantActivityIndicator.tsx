import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, LoaderCircle } from "lucide-react";
import type { ChatMessage, ChatProgressItem, ChatToolCall, ChatToolFileChange } from "../../types/chat";

const MAX_INLINE_FILE_ROWS = 4;

type AssistantActivityFileKind = NonNullable<ChatToolFileChange["kind"]> | "write" | "unknown";

export interface AssistantActivityFileItem {
  additions: number;
  deletions: number;
  estimated: boolean;
  kind: AssistantActivityFileKind;
  path: string;
  status: ChatToolCall["status"];
}

export interface AssistantActivitySnapshot {
  commandCount: number;
  detail: string;
  fileItems: AssistantActivityFileItem[];
  fileStats: AssistantActivityFileStats;
  label: string;
  live: boolean;
  progressItems: ChatProgressItem[];
  toolCalls: ChatToolCall[];
}

interface AssistantActivityFileStats {
  additions: number;
  creations: number;
  deletions: number;
  fileCount: number;
  moves: number;
  removals: number;
  updates: number;
}

interface AssistantActivityIndicatorProps {
  snapshot: AssistantActivitySnapshot;
}

interface CreateAssistantActivitySnapshotOptions {
  responseStarted?: boolean;
}

interface AssistantWorkTraceProps {
  activitySnapshot: AssistantActivitySnapshot | null;
  responseStarted?: boolean;
  thinkingContent: string;
  thinkingStreaming?: boolean;
}

interface AssistantThinkingNote {
  label?: string;
  text: string;
}

const MAX_THINKING_NOTES = 10;

export function AssistantWorkTrace({
  activitySnapshot,
  responseStarted = false,
  thinkingContent,
  thinkingStreaming = false,
}: AssistantWorkTraceProps) {
  const thinkingNotes = createThinkingNotes(thinkingContent);
  const hasThinking = thinkingNotes.length > 0;
  const hasActivity = Boolean(activitySnapshot);
  const live = Boolean(thinkingStreaming || activitySnapshot?.live);
  const hasWaitingIndicator = Boolean(thinkingStreaming && !responseStarted);
  const canExpand = hasThinking || hasActivity || hasWaitingIndicator;
  const [expanded, setExpanded] = useState(() => !responseStarted || live || hasActivity);
  const [manuallyToggled, setManuallyToggled] = useState(false);
  const detail = live ? "working" : hasThinking ? formatThinkingNoteCount(thinkingNotes.length) : activitySnapshot?.detail ?? "";
  const activityInsertIndex = hasActivity && thinkingNotes.length > 1 ? Math.max(1, thinkingNotes.length - 1) : thinkingNotes.length;
  const leadingThinkingNotes = hasActivity ? thinkingNotes.slice(0, activityInsertIndex) : thinkingNotes;
  const trailingThinkingNotes = hasActivity ? thinkingNotes.slice(activityInsertIndex) : [];

  useEffect(() => {
    if (manuallyToggled) {
      return;
    }

    setExpanded(!responseStarted || live || hasActivity);
  }, [hasActivity, live, manuallyToggled, responseStarted]);

  if (!canExpand) {
    return null;
  }

  function toggleExpanded() {
    setManuallyToggled(true);
    setExpanded((current) => !current);
  }

  return (
    <section className="assistant-work-trace" data-live={live} data-expanded={expanded} aria-label="Assistant work trace">
      <button className="assistant-work-header" type="button" aria-expanded={expanded} onClick={toggleExpanded}>
        <span className="assistant-work-dot" aria-hidden="true" />
        <span className="assistant-work-title">
          <strong>Thinking</strong>
          {detail ? <small>{detail}</small> : null}
        </span>
        <span className="assistant-work-action">
          {expanded ? "Hide" : "Show"}
          {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        </span>
      </button>

      {expanded ? (
        <div className="assistant-work-body">
          <div className="assistant-work-timeline" role="list" aria-label="Assistant thinking and live work">
            {leadingThinkingNotes.map((note, index) => renderThinkingTimelineItem(note, index))}

            {activitySnapshot ? (
              <div className="assistant-work-timeline-item" data-kind="activity" role="listitem">
                <span className="assistant-work-marker" aria-hidden="true" />
                <AssistantActivityIndicator snapshot={activitySnapshot} />
              </div>
            ) : null}

            {trailingThinkingNotes.map((note, index) => renderThinkingTimelineItem(note, index + leadingThinkingNotes.length))}
          </div>

          {live && !activitySnapshot ? (
            <div className="assistant-activity-bars" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function renderThinkingTimelineItem(note: AssistantThinkingNote, index: number) {
  return (
    <div className="assistant-work-timeline-item" data-kind="thinking" key={`${note.label ?? "thinking"}-${index}-${note.text}`} role="listitem">
      <span className="assistant-work-marker" aria-hidden="true" />
      <p className="assistant-work-note">
        {note.label ? <strong>{note.label}</strong> : null}
        <span>{note.text}</span>
      </p>
    </div>
  );
}

export function AssistantActivityIndicator({ snapshot }: AssistantActivityIndicatorProps) {
  const visibleFileItems = snapshot.fileItems.slice(0, MAX_INLINE_FILE_ROWS);
  const hiddenFileCount = Math.max(0, snapshot.fileItems.length - visibleFileItems.length);
  const hasFiles = snapshot.fileItems.length > 0;
  const hasToolDetails = snapshot.toolCalls.length > 0 || snapshot.progressItems.length > 0;
  const canExpand = hasFiles || hasToolDetails;
  const [expanded, setExpanded] = useState(() => hasFiles);
  const [manuallyToggled, setManuallyToggled] = useState(false);

  useEffect(() => {
    if (!manuallyToggled) {
      setExpanded(hasFiles);
    }
  }, [hasFiles, manuallyToggled]);

  function toggleExpanded() {
    if (!canExpand) {
      return;
    }

    setManuallyToggled(true);
    setExpanded((current) => !current);
  }

  return (
    <section
      className="assistant-activity"
      data-expanded={expanded}
      data-has-files={hasFiles}
      data-live={snapshot.live}
      aria-label="Assistant activity"
      aria-live={snapshot.live ? "polite" : undefined}
    >
      <div className="assistant-activity-row">
        <button className="assistant-activity-toggle" type="button" aria-expanded={expanded} disabled={!canExpand} onClick={toggleExpanded}>
          {snapshot.live ? <LoaderCircle className="assistant-activity-spinner" size={14} aria-hidden="true" /> : null}
          <span className="assistant-activity-title">
            <strong>{snapshot.label}</strong>
            {snapshot.detail ? <small>{snapshot.detail}</small> : null}
          </span>
          {canExpand ? (
            <span className="assistant-activity-chevron" aria-hidden="true">
              {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            </span>
          ) : null}
        </button>
      </div>

      {expanded ? (
        <div className="assistant-activity-details">
          {hasFiles ? (
            <div className="assistant-file-activity-list">
              {visibleFileItems.map((item, index) => (
                <div className="assistant-file-activity-row" data-kind={item.kind} data-status={item.status} key={`${item.path}-${index}`}>
                  <span className="assistant-file-path" title={item.path}>
                    <FileCode2 size={13} aria-hidden="true" />
                    <strong>{formatActivityPath(item.path)}</strong>
                  </span>
                  <span className="assistant-file-kind">{formatFileKindLabel(item.kind, item.estimated, item.status)}</span>
                  <span className="assistant-file-diff-count" aria-label={`${item.additions} additions and ${item.deletions} deletions`}>
                    <span data-tone="add">+{formatNumber(item.additions)}</span>
                    <span data-tone="remove">-{formatNumber(item.deletions)}</span>
                  </span>
                </div>
              ))}
              {hiddenFileCount > 0 ? <span className="assistant-file-activity-more">+{hiddenFileCount} more {hiddenFileCount === 1 ? "file" : "files"}</span> : null}
            </div>
          ) : hasToolDetails ? (
            <div className="assistant-tool-activity-list" aria-label="Tool progress details">
              {snapshot.toolCalls.map((toolCall, index) => (
                <div className="assistant-tool-activity-row" data-status={toolCall.status} key={`${toolCall.id}-${index}`}>
                  <span>{formatToolStatusWord(toolCall.status)}</span>
                  <strong>{formatToolActivityLine(toolCall)}</strong>
                </div>
              ))}
              {snapshot.toolCalls.length === 0
                ? snapshot.progressItems.map((item, index) => (
                    <div className="assistant-tool-activity-row" data-status={item.status} key={`${item.id ?? item.label}-${index}`}>
                      <span>{item.status === "active" ? "Running" : item.status === "complete" ? "Done" : "Pending"}</span>
                      <strong>{formatProgressDetail(item)}</strong>
                    </div>
                  ))
                : null}
            </div>
          ) : null}
        </div>
      ) : snapshot.live && !hasFiles ? (
        <div className="assistant-activity-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      ) : null}
    </section>
  );
}

function createThinkingNotes(content: string): AssistantThinkingNote[] {
  const segments = content
    .split(/\n{2,}/)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const notes = segments.map(createThinkingNote).filter((note) => note.text.length > 0);

  if (notes.length > 0) {
    return notes.slice(0, MAX_THINKING_NOTES);
  }

  const fallback = content.replace(/\s+/g, " ").trim();
  return fallback ? [{ text: fallback }] : [];
}

function createThinkingNote(segment: string): AssistantThinkingNote {
  const explicitLabelMatch = /^(Scope|Context|Found|Weighing|Next|Check|Checking|Action|Inspecting|Preparing|Reading|Reviewing|Using|Summary|Note):\s*(.+)$/i.exec(segment);

  if (explicitLabelMatch) {
    const label = normalizeThinkingLabel(explicitLabelMatch[1]);

    return {
      label,
      text: explicitLabelMatch[2].trim(),
    };
  }

  if (/^Earlier thinking was summarized/i.test(segment)) {
    return { label: "Summary", text: segment };
  }

  if (/^(Inspecting|Reviewing|Reading)\b/i.test(segment)) {
    return { label: "Context", text: segment };
  }

  if (/^(Preparing|Using)\b/i.test(segment)) {
    return { label: "Action", text: segment };
  }

  if (/^(Checking|Verifying|Running|Testing)\b/i.test(segment)) {
    return { label: "Check", text: segment };
  }

  return { text: segment };
}

function normalizeThinkingLabel(label: string) {
  const normalized = label.trim().toLowerCase();

  if (normalized === "note") {
    return undefined;
  }

  if (normalized === "checking") {
    return "Check";
  }

  if (normalized === "inspecting" || normalized === "reading" || normalized === "reviewing") {
    return "Context";
  }

  if (normalized === "preparing" || normalized === "using") {
    return "Action";
  }

  return `${normalized.slice(0, 1).toUpperCase()}${normalized.slice(1)}`;
}

function formatThinkingNoteCount(count: number) {
  return count === 1 ? "1 thought" : `${count} thoughts`;
}

export function createAssistantActivitySnapshot(
  message: ChatMessage,
  options: CreateAssistantActivitySnapshotOptions = {},
): AssistantActivitySnapshot | null {
  if (message.role !== "assistant") {
    return null;
  }

  const allToolCalls = message.toolCalls ?? [];
  const progressItems = getInlineProgressItems(message.progress);
  const allActiveToolCount = allToolCalls.filter((toolCall) => toolCall.status === "active").length;
  const waitingToolCount = allToolCalls.filter((toolCall) => toolCall.status === "waiting_approval").length;
  const hasActiveProgress = progressItems.some((item) => item.status === "active");
  const hasWebSearchActivity = message.webSearch?.status === "active";
  const hasPlanningActivity = Boolean(message.planning && !message.planning.completedAt);
  const live = Boolean(message.isStreaming && (allActiveToolCount > 0 || waitingToolCount > 0 || hasActiveProgress || hasWebSearchActivity || hasPlanningActivity || allToolCalls.length > 0 || progressItems.length > 0));
  const toolCalls = live ? allToolCalls : allToolCalls.filter((toolCall) => toolCall.status !== "active");
  const activeToolCount = live ? allActiveToolCount : 0;
  const commandCount = countCommandToolCalls(toolCalls);
  const includeEstimatedFileItems = live || waitingToolCount > 0;
  const fileItems = getAssistantFileItems(toolCalls, { includeEstimated: includeEstimatedFileItems });
  const fileStats = summarizeFileItems(fileItems);
  const hasSurfaceActivity = fileItems.length > 0 || toolCalls.length > 0 || progressItems.length > 0 || hasWebSearchActivity || hasPlanningActivity;
  const responseStarted = Boolean(options.responseStarted);

  if (!hasSurfaceActivity) {
    return null;
  }

  if (responseStarted && fileItems.length === 0 && toolCalls.length === 0 && progressItems.length === 0 && !hasWebSearchActivity && !hasPlanningActivity) {
    return null;
  }

  const latestTool = getLatestPriorityToolCall(toolCalls);
  const latestProgress = getLatestPriorityProgress(progressItems);
  const label = createActivityLabel({
    activeToolCount,
    commandCount,
    fileStats,
    latestProgress,
    latestTool,
    live,
    message,
    waitingToolCount,
  });
  const detail = createActivityDetail({
    fileStats,
    latestProgress,
    latestTool,
    live,
    responseStarted,
    toolCalls,
  });

  return {
    commandCount,
    detail,
    fileItems,
    fileStats,
    label,
    live,
    progressItems,
    toolCalls,
  };
}

function createActivityLabel({
  activeToolCount,
  commandCount,
  fileStats,
  latestProgress,
  latestTool,
  live,
  message,
  waitingToolCount,
}: {
  activeToolCount: number;
  commandCount: number;
  fileStats: AssistantActivityFileStats;
  latestProgress?: ChatProgressItem;
  latestTool?: ChatToolCall;
  live: boolean;
  message: ChatMessage;
  waitingToolCount: number;
}) {
  if (waitingToolCount > 0) {
    return fileStats.fileCount > 0 ? `Reviewing ${formatFileCount(fileStats.fileCount)}` : "Waiting for approval";
  }

  if (fileStats.fileCount > 0 && live) {
    return formatLiveFileSummary(fileStats, commandCount);
  }

  if (fileStats.fileCount > 0) {
    return formatCompletedFileSummary(fileStats, commandCount);
  }

  if (commandCount > 0) {
    return activeToolCount > 0 ? `Running ${formatCommandCount(commandCount)}` : `Ran ${formatCommandCount(commandCount)}`;
  }

  if (activeToolCount > 0) {
    return activeToolCount === 1 ? "Running tool" : `Running ${activeToolCount} tools`;
  }

  if (message.webSearch?.status === "active") {
    return "Searching web";
  }

  if (message.planning && !message.planning.completedAt) {
    return "Planning";
  }

  if (message.status === "error") {
    return "Needs attention";
  }

  if (live) {
    return "Thinking";
  }

  return latestProgress?.label || latestTool?.label || "Activity";
}

function createActivityDetail({
  fileStats,
  latestProgress,
  latestTool,
  live,
  responseStarted,
  toolCalls,
}: {
  fileStats: AssistantActivityFileStats;
  latestProgress?: ChatProgressItem;
  latestTool?: ChatToolCall;
  live: boolean;
  responseStarted: boolean;
  toolCalls: ChatToolCall[];
}) {
  const fileSummary = formatFileStats(fileStats);
  const progressSummary = latestProgress ? formatProgressDetail(latestProgress) : "";
  const toolSummary = latestTool ? formatToolDetail(latestTool) : "";
  const activityCount = toolCalls.length > 0 ? `${toolCalls.length} ${toolCalls.length === 1 ? "activity item" : "activity items"}` : "";

  return [fileSummary, progressSummary, toolSummary, activityCount].filter(Boolean)[0] ?? (live ? (responseStarted ? "Continuing the response" : "Preparing response") : "");
}

function getLatestPriorityToolCall(toolCalls: ChatToolCall[]) {
  return [...toolCalls].reverse().find((toolCall) => toolCall.status === "active" || toolCall.status === "waiting_approval")
    ?? [...toolCalls].reverse().find((toolCall) => toolCall.status === "error" || toolCall.status === "skipped")
    ?? [...toolCalls].reverse()[0];
}

function getLatestPriorityProgress(progressItems: ChatProgressItem[]) {
  return [...progressItems].reverse().find((item) => item.status === "active")
    ?? [...progressItems].reverse().find((item) => item.status === "pending")
    ?? [...progressItems].reverse()[0];
}

function getInlineProgressItems(progress: ChatProgressItem[] | undefined) {
  return (progress ?? []).filter((item) => !isInternalOnlyProgressItem(item));
}

function isInternalOnlyProgressItem(item: ChatProgressItem) {
  const id = item.id ?? "";
  const label = cleanInlineText(item.label).toLowerCase();

  return id === "provider-payload-guardrail" || label === "provider payload guardrail";
}

function getAssistantFileItems(toolCalls: ChatToolCall[], options: { includeEstimated?: boolean } = {}): AssistantActivityFileItem[] {
  return toolCalls.flatMap((toolCall) => {
    if (toolCall.fileChanges?.length) {
      return toolCall.fileChanges.map((change) => ({
        additions: change.additions,
        deletions: change.deletions,
        estimated: false,
        kind: change.kind ?? "update",
        path: change.path,
        status: toolCall.status,
      }));
    }

    if (!options.includeEstimated || (toolCall.status !== "active" && toolCall.status !== "waiting_approval")) {
      return [];
    }

    return estimateFileItemsFromToolInput(toolCall);
  });
}

function estimateFileItemsFromToolInput(toolCall: ChatToolCall): AssistantActivityFileItem[] {
  const input = parseToolInput(toolCall.input);
  const label = toolCall.label.toLowerCase();

  if (!input) {
    return [];
  }

  if (label.includes("apply workspace patch") && typeof input.patch === "string") {
    return estimatePatchFileItems(input.patch, toolCall.status);
  }

  if (label.includes("move workspace path")) {
    const fromPath = stringValue(input.fromPath);
    const toPath = stringValue(input.toPath);
    return fromPath && toPath ? [createEstimatedFileItem(`${fromPath} -> ${toPath}`, 0, 0, "move", toolCall.status)] : [];
  }

  const path = stringValue(input.path);
  if (!path) {
    return [];
  }

  if (label.includes("write workspace file")) {
    return [createEstimatedFileItem(path, countTextLines(stringValue(input.content)), 0, input.overwrite === false ? "create" : "write", toolCall.status)];
  }

  if (label.includes("append to workspace file") || label.includes("insert text at line")) {
    return [createEstimatedFileItem(path, countTextLines(stringValue(input.content)), 0, "update", toolCall.status)];
  }

  if (label.includes("replace file line range")) {
    const additions = countTextLines(stringValue(input.content));
    const startLine = numberValue(input.startLine);
    const endLine = numberValue(input.endLine);
    const deletions = startLine && endLine && endLine >= startLine ? endLine - startLine + 1 : 0;
    return [createEstimatedFileItem(path, additions, deletions, "update", toolCall.status)];
  }

  if (label.includes("edit file by exact replace")) {
    return [createEstimatedFileItem(path, countTextLines(stringValue(input.newText)), countTextLines(stringValue(input.oldText)), "update", toolCall.status)];
  }

  return [];
}

function createEstimatedFileItem(
  path: string,
  additions: number,
  deletions: number,
  kind: AssistantActivityFileKind,
  status: ChatToolCall["status"],
): AssistantActivityFileItem {
  return {
    additions,
    deletions,
    estimated: true,
    kind,
    path,
    status,
  };
}

function estimatePatchFileItems(patch: string, status: ChatToolCall["status"]): AssistantActivityFileItem[] {
  const items: AssistantActivityFileItem[] = [];
  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let current: { additions: number; deletions: number; newPath: string; oldPath: string } | null = null;

  function flushCurrent() {
    if (!current) {
      return;
    }

    const path = current.newPath && current.newPath !== "/dev/null" ? current.newPath : current.oldPath;
    if (path) {
      const kind = current.oldPath === "/dev/null" ? "create" : current.newPath === "/dev/null" ? "delete" : "update";
      items.push(createEstimatedFileItem(path, current.additions, current.deletions, kind, status));
    }

    current = null;
  }

  for (const line of lines) {
    if (line.startsWith("--- ")) {
      flushCurrent();
      current = {
        additions: 0,
        deletions: 0,
        newPath: "",
        oldPath: normalizePatchPath(line.slice(4).trim()),
      };
      continue;
    }

    if (line.startsWith("+++ ")) {
      if (current) {
        current.newPath = normalizePatchPath(line.slice(4).trim());
      }
      continue;
    }

    if (!current) {
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions += 1;
    }
  }

  flushCurrent();

  return items;
}

function summarizeFileItems(items: AssistantActivityFileItem[]): AssistantActivityFileStats {
  return items.reduce<AssistantActivityFileStats>(
    (stats, item) => {
      stats.additions += item.additions;
      stats.deletions += item.deletions;
      stats.fileCount += 1;

      if (item.kind === "create") {
        stats.creations += 1;
      } else if (item.kind === "delete") {
        stats.removals += 1;
      } else if (item.kind === "move") {
        stats.moves += 1;
      } else {
        stats.updates += 1;
      }

      return stats;
    },
    {
      additions: 0,
      creations: 0,
      deletions: 0,
      fileCount: 0,
      moves: 0,
      removals: 0,
      updates: 0,
    },
  );
}

function formatFileStats(stats: AssistantActivityFileStats) {
  if (stats.fileCount === 0) {
    return "";
  }

  return [
    formatFileCount(stats.fileCount),
    stats.creations > 0 ? `${stats.creations} new` : "",
    stats.updates > 0 ? `${stats.updates} edited` : "",
    stats.moves > 0 ? `${stats.moves} moved` : "",
    stats.removals > 0 ? `${stats.removals} deleted` : "",
    `+${formatNumber(stats.additions)}`,
    `-${formatNumber(stats.deletions)}`,
  ].filter(Boolean).join(" | ");
}

function formatLiveFileSummary(stats: AssistantActivityFileStats, commandCount = 0) {
  const parts = [
    stats.creations > 0 ? `creating ${formatFileCount(stats.creations)}` : "",
    stats.updates > 0 ? `editing ${formatFileCount(stats.updates)}` : "",
    stats.moves > 0 ? `moving ${formatFileCount(stats.moves)}` : "",
    stats.removals > 0 ? `deleting ${formatFileCount(stats.removals)}` : "",
    commandCount > 0 ? `running ${formatCommandCount(commandCount)}` : "",
  ].filter(Boolean);

  if (parts.length === 0) {
    return `Changing ${formatFileCount(stats.fileCount)}`;
  }

  return capitalizeFirst(parts.join(", "));
}

function formatCompletedFileSummary(stats: AssistantActivityFileStats, commandCount = 0) {
  const parts = [
    stats.creations > 0 ? `created ${formatFileCount(stats.creations)}` : "",
    stats.updates > 0 ? `edited ${formatFileCount(stats.updates)}` : "",
    stats.moves > 0 ? `moved ${formatFileCount(stats.moves)}` : "",
    stats.removals > 0 ? `deleted ${formatFileCount(stats.removals)}` : "",
    commandCount > 0 ? `ran ${formatCommandCount(commandCount)}` : "",
  ].filter(Boolean);

  if (parts.length === 0) {
    return `Changed ${formatFileCount(stats.fileCount)}`;
  }

  return capitalizeFirst(parts.join(", "));
}

function formatToolDetail(toolCall: ChatToolCall) {
  const detail = cleanInlineText(toolCall.detail ?? toolCall.output ?? "");

  if (toolCall.status === "active") {
    return detail ? `${toolCall.label}: ${detail}` : toolCall.label;
  }

  if (toolCall.status === "waiting_approval") {
    return detail ? `Approval needed: ${detail}` : `Approval needed for ${toolCall.label}`;
  }

  return detail || toolCall.label;
}

function formatProgressDetail(progress: ChatProgressItem) {
  const detail = cleanInlineText(progress.detail ?? "");
  return detail ? `${progress.label}: ${detail}` : progress.label;
}

function formatToolActivityLine(toolCall: ChatToolCall) {
  const command = toolCall.terminal?.command ?? readCommandFromInput(toolCall.input);
  const target = getToolTargetPath(toolCall);

  if (command) {
    return `Ran ${limitInline(command, 150)}`;
  }

  if (target) {
    return `${toolCall.label}: ${target}`;
  }

  return toolCall.detail ? `${toolCall.label}: ${cleanInlineText(toolCall.detail)}` : toolCall.label;
}

function formatToolStatusWord(status: ChatToolCall["status"]) {
  if (status === "active") {
    return "Running";
  }

  if (status === "waiting_approval") {
    return "Waiting";
  }

  if (status === "error") {
    return "Error";
  }

  if (status === "skipped") {
    return "Skipped";
  }

  return "Ran";
}

function formatFileCount(count: number) {
  return count === 1 ? "1 file" : `${count} files`;
}

function formatFileKindLabel(kind: AssistantActivityFileKind, estimated: boolean, status: ChatToolCall["status"]) {
  if (status === "waiting_approval") {
    return "Pending";
  }

  if (estimated && status === "active") {
    return kind === "create" ? "Creating" : kind === "move" ? "Moving" : "Editing";
  }

  if (kind === "create") {
    return "New";
  }

  if (kind === "delete") {
    return "Deleted";
  }

  if (kind === "move") {
    return "Moved";
  }

  if (kind === "write") {
    return estimated ? "Writing" : "Written";
  }

  return "Edited";
}

function formatActivityPath(path: string) {
  if (path.includes(" -> ")) {
    return path.split(" -> ").map(formatSingleActivityPath).join(" -> ");
  }

  return formatSingleActivityPath(path);
}

function formatSingleActivityPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const srcIndex = normalized.lastIndexOf("/src/");

  if (srcIndex >= 0) {
    return normalized.slice(srcIndex + 1);
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 3) {
    return normalized;
  }

  return segments.slice(-3).join("/");
}

function parseToolInput(input: string | undefined): Record<string, unknown> | null {
  if (!input) {
    return null;
  }

  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function countCommandToolCalls(toolCalls: ChatToolCall[]) {
  return toolCalls.filter(isCommandToolCall).length;
}

function isCommandToolCall(toolCall: ChatToolCall) {
  return Boolean(toolCall.terminal) || /\b(command|terminal|shell|powershell|cmd|bash|zsh|npm|node|cargo|git)\b/i.test(`${toolCall.label} ${toolCall.detail ?? ""}`);
}

function readCommandFromInput(input: string | undefined) {
  const parsed = parseToolInput(input);
  const command = stringValue(parsed?.command) || stringValue(parsed?.cmd) || stringValue(parsed?.script);

  return command.trim();
}

function getToolTargetPath(toolCall: ChatToolCall) {
  const parsed = parseToolInput(toolCall.input);
  const path = stringValue(parsed?.path);
  const fromPath = stringValue(parsed?.fromPath);
  const toPath = stringValue(parsed?.toPath);

  if (fromPath && toPath) {
    return `${formatActivityPath(fromPath)} -> ${formatActivityPath(toPath)}`;
  }

  return path ? formatActivityPath(path) : "";
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : undefined;
}

function countTextLines(content: string) {
  if (!content) {
    return 0;
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed ? trimmed.split("\n").length : 0;
}

function normalizePatchPath(path: string) {
  const firstPart = path.split(/\s+/)[0] ?? "";

  if (firstPart === "/dev/null") {
    return firstPart;
  }

  return firstPart.replace(/^[ab]\//, "");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function capitalizeFirst(value: string) {
  return value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1)}` : value;
}

function formatCommandCount(count: number) {
  return count === 1 ? "1 command" : `${count} commands`;
}

function limitInline(value: string, maxChars: number) {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function cleanInlineText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
