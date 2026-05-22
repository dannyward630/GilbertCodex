import { useEffect, useId, useMemo, useState } from "react";
import { BrainCircuit, ChevronDown, ChevronRight } from "lucide-react";
import { MarkdownMessage } from "./MarkdownMessage";
import type { ChatMessage, ChatProgressItem, ChatThinking, ChatToolCall, ChatToolFileChange, ChatWorkTraceItem, ChatWorkTraceStatus } from "../../types/chat";
import { formatReasoningEffort } from "../../types/settings";

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
  writes: number;
}

type ToolFileRowStatus = NonNullable<ChatToolCall["batchFileResults"]>[number]["status"];

interface ToolFileRowData {
  additions: number;
  deletions: number;
  detail: string;
  diffPreview?: ChatToolFileChange["diffPreview"];
  diffTruncated?: boolean;
  displayPath: string;
  kind: AssistantActivityFileKind;
  path: string;
  status: ToolFileRowStatus;
  statusLabel: string;
}

interface CreateAssistantActivitySnapshotOptions {
  responseStarted?: boolean;
}

interface AssistantWorkTraceProps {
  activitySnapshot: AssistantActivitySnapshot | null;
  createdAt?: string;
  responseStarted?: boolean;
  thinking?: ChatThinking;
  thinkingContent: string;
  thinkingStreaming?: boolean;
  workTrace?: ChatWorkTraceItem[];
}

/**
 * Safe assistant work display. It can show a generic live Thinking state and
 * real tool/progress events, but it never renders provider reasoning text.
 */
export function AssistantWorkTrace({
  activitySnapshot,
  createdAt,
  responseStarted = false,
  thinking,
  thinkingContent,
  thinkingStreaming = false,
  workTrace,
}: AssistantWorkTraceProps) {
  const renderThinkingContent = thinkingContent;
  const renderItems = useMemo(
    () => createAssistantWorkRenderItems({ activitySnapshot, thinkingContent: renderThinkingContent, workTrace }),
    [activitySnapshot, renderThinkingContent, workTrace],
  );
  const live = Boolean(thinkingStreaming || activitySnapshot?.live || renderItems.some(isLiveWorkRenderItem));
  const hasWaitingIndicator = Boolean(thinkingStreaming && !responseStarted && renderItems.length === 0);
  const canRender = renderItems.length > 0 || hasWaitingIndicator;
  const shouldAutoExpand = !responseStarted || live;

  const [expanded, setExpanded] = useState(() => shouldAutoExpand);
  const [manuallyToggled, setManuallyToggled] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const bodyId = useId();

  useEffect(() => {
    if (manuallyToggled) {
      return;
    }

    setExpanded(shouldAutoExpand);
  }, [manuallyToggled, shouldAutoExpand]);

  useEffect(() => {
    if (!live) {
      return;
    }

    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [live]);

  if (!canRender) {
    return null;
  }

  function toggleExpanded() {
    setManuallyToggled(true);
    setExpanded((current) => !current);
  }

  const durationLabel = createThinkingDurationLabel({
    createdAt,
    live,
    nowMs,
    thinking,
  });
  const effortLabel = thinking ? formatReasoningEffort(thinking.effort) : "";
  const headerDetail = [effortLabel, durationLabel].filter(Boolean).join(" · ");
  const headerAria = headerDetail ? `Assistant thinking summary - ${headerDetail}` : "Assistant thinking summary";
  const collapsedInteractionProps = expanded ? {} : ({ inert: "" } as Record<string, string>);

  return (
    <section className="assistant-thinking" data-live={live} data-expanded={expanded} data-effort={thinking?.effort} aria-label="Assistant thinking">
      <button
        className="assistant-thinking-toggle"
        type="button"
        aria-expanded={expanded}
        aria-controls={bodyId}
        aria-label={live ? `Assistant thinking is in progress${headerDetail ? ` - ${headerDetail}` : ""}` : headerAria}
        onClick={toggleExpanded}
      >
        <BrainCircuit className="assistant-thinking-icon" size={15} aria-hidden="true" />
        <span className="assistant-thinking-title">
          <strong>Thinking</strong>
          {headerDetail ? <small>{headerDetail}</small> : null}
        </span>
        <span className="assistant-thinking-chevron" aria-hidden="true">
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
      </button>

      <div
        id={bodyId}
        className="assistant-thinking-body"
        role="region"
        aria-label="Assistant reasoning and tool progress"
        aria-hidden={!expanded}
        {...collapsedInteractionProps}
      >
        <div className="assistant-thinking-body-inner">
          <div className="assistant-thinking-list">
            {renderItems.map((item) => {
              if (item.kind === "thinking") {
                return <AssistantWorkThinkingLine key={item.id} content={item.content} status={item.status} />;
              }

              if (item.kind === "tool") {
                return <AssistantWorkToolLine key={item.id} toolCall={item.toolCall} />;
              }

              return <AssistantWorkProgressLine key={item.id} progress={item.progress} />;
            })}

            {hasWaitingIndicator ? (
              <div className="assistant-thinking-bars" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

type AssistantWorkRenderItem =
  | { id: string; content: string; kind: "thinking"; status?: ChatWorkTraceStatus }
  | { id: string; kind: "tool"; toolCall: ChatToolCall }
  | { id: string; kind: "progress"; progress: ChatProgressItem };

function createThinkingDurationLabel({
  createdAt,
  live,
  nowMs,
  thinking,
}: {
  createdAt?: string;
  live: boolean;
  nowMs: number;
  thinking?: ChatThinking;
}) {
  const startedAt = readTimeMs(thinking?.startedAt ?? createdAt);
  const completedAt = live ? nowMs : readTimeMs(thinking?.completedAt);

  if (!startedAt) {
    return live ? "working" : "";
  }

  if (!completedAt) {
    return "";
  }

  const duration = formatThinkingDuration(Math.max(0, completedAt - startedAt));
  return duration ? `${live ? "working" : "worked"} ${duration}` : "";
}

function readTimeMs(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
}

function formatThinkingDuration(durationMs: number) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  return `${seconds}s`;
}

function createAssistantWorkRenderItems({
  activitySnapshot,
  thinkingContent,
  workTrace,
}: {
  activitySnapshot: AssistantActivitySnapshot | null;
  thinkingContent?: string;
  workTrace?: ChatWorkTraceItem[];
}): AssistantWorkRenderItem[] {
  const items: AssistantWorkRenderItem[] = [];
  const latestTools = new Map((activitySnapshot?.toolCalls ?? []).map((toolCall) => [toolCall.id, toolCall]));
  const latestToolsByIdentity = new Map((activitySnapshot?.toolCalls ?? []).map((toolCall) => [getToolCallIdentity(toolCall), toolCall]));
  const inlineThinking = cleanThinkingContent(thinkingContent);
  const toolNarrationContext = collectToolNarrationContext(activitySnapshot, workTrace);
  const seenToolIdentities = new Set<string>();
  let sawThinking = false;

  if (workTrace?.length) {
    for (const traceItem of workTrace) {
      if (traceItem.kind === "thinking") {
        const content = cleanThinkingContent(traceItem.content);
        sawThinking = true;
        if (!content) {
          continue;
        }

        if (isRedundantToolNarration(content, toolNarrationContext)) {
          continue;
        }

        items.push({
          content,
          id: traceItem.id,
          kind: "thinking",
          status: traceItem.status,
        });
      } else if (traceItem.kind === "tool") {
        const toolCall = latestTools.get(traceItem.toolCall.id) ?? latestToolsByIdentity.get(getToolCallIdentity(traceItem.toolCall)) ?? traceItem.toolCall;
        const identity = getToolCallIdentity(toolCall);

        if (seenToolIdentities.has(identity)) {
          continue;
        }

        seenToolIdentities.add(identity);
        items.push({
          id: traceItem.id,
          kind: "tool",
          toolCall,
        });
      } else if (!isInternalOnlyProgressItem(traceItem.progress)) {
        items.push({
          id: traceItem.id,
          kind: "progress",
          progress: traceItem.progress,
        });
      }
    }
  }

  if (inlineThinking && !sawThinking && !isRedundantToolNarration(inlineThinking, toolNarrationContext)) {
    items.push({
      content: inlineThinking,
      id: "thinking-current",
      kind: "thinking",
      status: "active",
    });
  }

  for (const toolCall of activitySnapshot?.toolCalls ?? []) {
    const identity = getToolCallIdentity(toolCall);

    if (seenToolIdentities.has(identity)) {
      continue;
    }

    seenToolIdentities.add(identity);
    items.push({
      id: `tool-${toolCall.id}`,
      kind: "tool",
      toolCall,
    });
  }

  if (!activitySnapshot?.toolCalls.length) {
    for (const progress of activitySnapshot?.progressItems ?? []) {
      if (isInternalOnlyProgressItem(progress)) {
        continue;
      }

      items.push({
        id: `progress-${progress.id ?? progress.label}`,
        kind: "progress",
        progress,
      });
    }
  }

  return items;
}

function collectToolNarrationContext(
  activitySnapshot: AssistantActivitySnapshot | null,
  workTrace?: ChatWorkTraceItem[],
) {
  return dedupeAssistantToolCalls([
    ...(activitySnapshot?.toolCalls ?? []),
    ...(workTrace ?? []).flatMap((item) => item.kind === "tool" ? [item.toolCall] : []),
  ]);
}

function isRedundantToolNarration(content: string, toolCalls: ChatToolCall[]) {
  if (toolCalls.length === 0) {
    return false;
  }

  const normalized = cleanInlineText(content).replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();

  if (!normalized) {
    return true;
  }

  return toolCalls.some((toolCall) => {
    const label = cleanInlineText(toolCall.label).toLowerCase();

    return Boolean(label)
      && (
        lower === `using ${label}.`
        || lower === `${label} completed.`
        || lower === `${label} did not complete cleanly.`
        || lower.startsWith(`${label} returned:`)
        || lower.startsWith(`${label} reported:`)
      );
  });
}

function dedupeAssistantToolCalls(toolCalls: ChatToolCall[]) {
  const deduped: ChatToolCall[] = [];
  const indexByIdentity = new Map<string, number>();

  for (const toolCall of toolCalls) {
    const identity = getToolCallIdentity(toolCall);
    const existingIndex = indexByIdentity.get(identity);

    if (existingIndex === undefined) {
      indexByIdentity.set(identity, deduped.length);
      deduped.push(toolCall);
      continue;
    }

    deduped[existingIndex] = choosePreferredToolCall(deduped[existingIndex]!, toolCall);
  }

  return deduped;
}

function choosePreferredToolCall(existing: ChatToolCall, next: ChatToolCall) {
  const existingRank = getToolCallStatusRank(existing.status);
  const nextRank = getToolCallStatusRank(next.status);

  if (nextRank !== existingRank) {
    return nextRank > existingRank ? next : existing;
  }

  return getToolCallDetailScore(next) >= getToolCallDetailScore(existing) ? next : existing;
}

function getToolCallStatusRank(status: ChatToolCall["status"]) {
  if (status === "complete" || status === "error" || status === "skipped") {
    return 3;
  }

  if (status === "waiting_approval") {
    return 2;
  }

  return 1;
}

function getToolCallDetailScore(toolCall: ChatToolCall) {
  return (
    (toolCall.batchFileResults?.length ?? 0) * 8 +
    (toolCall.fileChanges?.length ?? 0) * 6 +
    (toolCall.output?.trim() ? 2 : 0) +
    (toolCall.detail?.trim() ? 1 : 0)
  );
}

function getToolCallIdentity(toolCall: ChatToolCall) {
  const input = normalizeToolInputForIdentity(toolCall.input);
  const toolKey = `${toolCall.toolId ?? ""}|${toolCall.label}`.toLowerCase();

  return input ? `${toolKey}|${input}` : toolCall.id;
}

function normalizeToolInputForIdentity(input: string | undefined) {
  const trimmed = input?.trim() ?? "";

  return !trimmed || trimmed === "{}" || trimmed === "[]" ? "" : trimmed;
}

function isLiveWorkRenderItem(item: AssistantWorkRenderItem) {
  if (item.kind === "thinking") {
    return false;
  }

  if (item.kind === "progress") {
    return item.progress.status === "active";
  }

  return item.toolCall.status === "active" || item.toolCall.status === "waiting_approval";
}

function AssistantWorkThinkingLine({ content, status }: { content: string; status?: ChatWorkTraceStatus }) {
  const displayContent = cleanThinkingContent(content);

  if (!displayContent) {
    return null;
  }

  return (
    <article className="assistant-thinking-note" data-status={status ?? "complete"}>
      <MarkdownMessage className="assistant-thinking-markdown" content={displayContent} isStreaming={status === "active"} />
    </article>
  );
}

function cleanThinkingContent(content: string | undefined) {
  return (content ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:analysis|reasoning|thinking|thought|scratchpad|internal(?:\s+monologue)?|private\s+notes?)(?:\*\*)?\s*[:.-]\s*/i, "")
    .replace(/<\/?(?:analysis|reasoning|thinking|thought|scratchpad)\b[^>]*>/gi, "")
    .trim();
}

function AssistantWorkToolLine({ toolCall }: { toolCall: ChatToolCall }) {
  const batchDisplay = createToolBatchDisplay(toolCall);
  const title = batchDisplay?.label ?? toolCall.label;
  const detail = cleanToolActivityDetail(title, batchDisplay?.detail ?? formatToolActivityLine(toolCall));
  const batchFileResults = toolCall.batchFileResults ?? [];
  const fileChanges = toolCall.fileChanges ?? [];
  const estimatedFileItems = batchFileResults.length === 0 && fileChanges.length === 0 && (toolCall.status === "active" || toolCall.status === "waiting_approval")
    ? estimateFileItemsFromToolInput(toolCall)
    : [];
  const inputDetail = getVisibleToolInput(toolCall.input, toolCall);
  const outputDetail = getVisibleToolOutput(toolCall.output, toolCall);
  const hasBatchFiles = batchFileResults.length > 0;
  const hasVisibleFiles = hasBatchFiles || fileChanges.length > 0 || estimatedFileItems.length > 0;
  const hasDetails = Boolean(inputDetail) || Boolean(outputDetail);
  const showToolStatus = shouldShowToolStatus(toolCall.status);
  const summary = (
    <span className="assistant-thinking-tool-summary" data-show-status={showToolStatus ? "true" : "false"}>
      {showToolStatus ? (
        <span className="assistant-thinking-tool-status" data-status={toolCall.status} aria-label={formatToolStatusWord(toolCall.status)} title={formatToolStatusWord(toolCall.status)}>
          <ToolStatusIcon status={toolCall.status} />
          <span aria-hidden="true">{formatToolStatusWord(toolCall.status)}</span>
        </span>
      ) : null}
      <span className="assistant-thinking-tool-copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
    </span>
  );
  const visibleFiles = hasVisibleFiles ? <ToolFileList batchFileResults={batchFileResults} estimatedFileItems={estimatedFileItems} fileChanges={fileChanges} inline /> : null;

  if (!hasDetails) {
    return (
      <div className="assistant-thinking-tool" data-status={toolCall.status}>
        {summary}
        {visibleFiles}
      </div>
    );
  }

  return (
    <details className="assistant-thinking-tool" data-status={toolCall.status} open={toolCall.status === "active" || toolCall.status === "waiting_approval"}>
      <summary>{summary}</summary>
      {visibleFiles}
      <div className="assistant-thinking-tool-details">
        {inputDetail ? <ToolDetailBlock label="Input" value={inputDetail} /> : null}
        {outputDetail ? <ToolDetailBlock label="Output" value={outputDetail} /> : null}
      </div>
    </details>
  );
}

function cleanToolActivityDetail(title: string, detail: string) {
  const cleanedTitle = cleanInlineText(title);
  const cleanedDetail = cleanInlineText(detail);

  if (!cleanedDetail || cleanedDetail === cleanedTitle || isNoiseOnlyActivityText(cleanedDetail)) {
    return "";
  }

  const prefix = `${cleanedTitle}:`;
  const withoutPrefix = cleanedDetail.toLowerCase().startsWith(prefix.toLowerCase()) ? cleanedDetail.slice(prefix.length).trim() : cleanedDetail;

  return isNoiseOnlyActivityText(withoutPrefix) ? "" : withoutPrefix;
}

function ToolFileList({
  batchFileResults,
  estimatedFileItems,
  fileChanges,
  inline,
}: {
  batchFileResults: NonNullable<ChatToolCall["batchFileResults"]>;
  estimatedFileItems: AssistantActivityFileItem[];
  fileChanges: ChatToolFileChange[];
  inline?: boolean;
}) {
  const fileChangesByDisplayPath = new Map(
    fileChanges
      .map((change) => [formatActivityPath(change.path), change] as const)
      .filter(([displayPath]) => displayPath),
  );
  const visibleBatchFileResults = batchFileResults
    .map((result, index) => ({
      detail: cleanToolFileDetail(result.detail),
      displayPath: formatActivityPath(result.path),
      index,
      result,
    }))
    .filter((item) => item.displayPath);
  const visibleFileChanges = fileChanges
    .map((change, index) => ({
      change,
      displayPath: formatActivityPath(change.path),
      index,
    }))
    .filter((item) => item.displayPath);
  const visibleEstimatedFileItems = estimatedFileItems
    .map((item, index) => ({
      displayPath: formatActivityPath(item.path),
      index,
      item,
    }))
    .filter((item) => item.displayPath);
  const rows: ToolFileRowData[] = visibleBatchFileResults.length > 0
    ? visibleBatchFileResults.map(({ detail, displayPath, result }) => {
        const matchingChange = fileChangesByDisplayPath.get(displayPath);
        return {
          additions: result.additions,
          deletions: result.deletions,
          detail,
          diffPreview: matchingChange?.diffPreview,
          diffTruncated: matchingChange?.diffTruncated,
          displayPath,
          kind: result.kind ?? matchingChange?.kind ?? "update",
          path: result.path,
          status: result.status,
          statusLabel: formatBatchFileStatus(result.status),
        };
      })
    : visibleFileChanges.length > 0
      ? visibleFileChanges.map(({ change, displayPath }) => ({
        additions: change.additions,
        deletions: change.deletions,
        detail: "",
        diffPreview: change.diffPreview,
        diffTruncated: change.diffTruncated,
        displayPath,
        kind: change.kind ?? "update",
        path: change.path,
        status: "ok",
        statusLabel: "",
      }))
      : visibleEstimatedFileItems.map(({ displayPath, item }) => ({
        additions: item.additions,
        deletions: item.deletions,
        detail: "",
        displayPath,
        kind: item.kind,
        path: item.path,
        status: "ok",
        statusLabel: "",
      }));

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="assistant-thinking-tool-files" data-inline={inline ? "true" : undefined} aria-label="File changes">
      {rows.map((row, index) => (
        <ToolFileRow key={`${row.path}-${index}`} row={row} />
      ))}
    </div>
  );
}

function ToolFileRow({ row }: { row: ToolFileRowData }) {
  const showStatus = shouldShowFileStatus(row.status);
  const hasPreview = Boolean(row.diffPreview?.length);
  const rowContent = (
    <span className="assistant-thinking-tool-file-row">
      {showStatus ? <ToolFileStatusIcon status={row.status} /> : null}
      <strong>{row.displayPath}</strong>
      <ToolFileDelta
        additions={row.additions}
        deletions={row.deletions}
        status={row.status}
        statusLabel={row.statusLabel}
      />
      {hasPreview ? <ChevronDown className="assistant-thinking-tool-file-chevron" size={13} aria-hidden="true" /> : null}
    </span>
  );

  if (hasPreview) {
    return (
      <details
        className="assistant-thinking-tool-file"
        data-has-preview="true"
        data-kind={row.kind ?? "update"}
        data-show-status={showStatus ? "true" : "false"}
        data-status={row.status}
        title={row.detail || undefined}
      >
        <summary>{rowContent}</summary>
        {row.detail ? <small>{row.detail}</small> : null}
        <ToolFileDiffPreview lines={row.diffPreview ?? []} truncated={row.diffTruncated === true} />
      </details>
    );
  }

  return (
    <div
      className="assistant-thinking-tool-file"
      data-kind={row.kind ?? "update"}
      data-show-status={showStatus ? "true" : "false"}
      data-status={row.status}
      title={row.detail || undefined}
    >
      {rowContent}
      {row.detail ? <small>{row.detail}</small> : null}
    </div>
  );
}

function ToolFileDelta({
  additions,
  deletions,
  status,
  statusLabel,
}: {
  additions: number;
  deletions: number;
  status: ToolFileRowStatus;
  statusLabel: string;
}) {
  const showDelta = additions > 0 || deletions > 0 || !statusLabel;

  return (
    <span
      className="assistant-thinking-tool-file-result"
      data-status={status}
      aria-label={[
        statusLabel,
        showDelta ? `${formatNumber(additions)} additions` : "",
        showDelta ? `${formatNumber(deletions)} deletions` : "",
      ].filter(Boolean).join(", ")}
    >
      {statusLabel ? <span className="assistant-thinking-tool-file-status-label">{statusLabel}</span> : null}
      {showDelta ? (
        <>
          <span className="assistant-thinking-tool-file-additions">+{formatNumber(additions)}</span>
          <span className="assistant-thinking-tool-file-deletions">-{formatNumber(deletions)}</span>
        </>
      ) : null}
    </span>
  );
}

function ToolFileDiffPreview({
  lines,
  truncated,
}: {
  lines: NonNullable<ChatToolFileChange["diffPreview"]>;
  truncated: boolean;
}) {
  if (lines.length === 0) {
    return null;
  }

  return (
    <div className="assistant-thinking-tool-file-diff" aria-label="Diff preview">
      {lines.map((line, index) => (
        <code className="assistant-thinking-tool-file-diff-line" data-kind={line.kind} key={`${line.kind}-${index}-${line.oldLine ?? ""}-${line.newLine ?? ""}`}>
          <span className="assistant-thinking-tool-file-diff-number">{formatDiffLineNumber(line)}</span>
          <span className="assistant-thinking-tool-file-diff-marker" aria-hidden="true">{getDiffLineMarker(line.kind)}</span>
          <span className="assistant-thinking-tool-file-diff-content">{line.content || " "}</span>
        </code>
      ))}
      {truncated ? <span className="assistant-thinking-tool-file-diff-truncated">Diff preview trimmed</span> : null}
    </div>
  );
}

function cleanToolFileDetail(detail: string | undefined) {
  const cleaned = cleanInlineText(detail ?? "");
  return isNoiseOnlyActivityText(cleaned) ? "" : cleaned;
}

function ToolStatusIcon({ status }: { status: ChatToolCall["status"] }) {
  return <span className="assistant-thinking-status-dot" data-status={status} aria-hidden="true" />;
}

function ToolFileStatusIcon({ status }: { status: NonNullable<ChatToolCall["batchFileResults"]>[number]["status"] }) {
  return <span className="assistant-thinking-file-dot" data-status={status} aria-hidden="true" />;
}

function shouldShowToolStatus(status: ChatToolCall["status"]) {
  return status === "active" || status === "waiting_approval" || status === "error";
}

function shouldShowFileStatus(status: NonNullable<ChatToolCall["batchFileResults"]>[number]["status"]) {
  return status === "error";
}

function ToolDetailBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="assistant-thinking-tool-detail">
      <span>{label}</span>
      <MarkdownMessage className="assistant-thinking-tool-markdown" content={formatToolDetailMarkdown(label, value)} />
    </div>
  );
}

function formatToolDetailMarkdown(label: string, value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  const formattedJson = formatJsonDetail(trimmed);

  if (formattedJson) {
    return createMarkdownFence(formattedJson, "json");
  }

  if (label.toLowerCase() === "input") {
    return createMarkdownFence(trimmed, "text");
  }

  return trimmed;
}

function formatJsonDetail(value: string) {
  if (!/^[{\[]/.test(value)) {
    return "";
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return "";
  }
}

function createMarkdownFence(value: string, language: string) {
  return `\`\`\`${language}\n${value.replace(/```/g, "``\\`")}\n\`\`\``;
}

function getVisibleToolInput(input: string | undefined, toolCall?: ChatToolCall) {
  const trimmed = input?.trim() ?? "";

  if (!trimmed || trimmed === "{}" || trimmed === "[]") {
    return "";
  }

  if (toolCall && (toolCall.status === "waiting_approval" || isApprovalDeniedToolCall(toolCall))) {
    return "";
  }

  return trimmed;
}

function getVisibleToolOutput(output: string | undefined, toolCall?: ChatToolCall) {
  const trimmed = output?.trim() ?? "";

  if (!trimmed || /^preparing tool call\.?$/i.test(trimmed)) {
    return "";
  }

  if (toolCall && isApprovalDeniedToolCall(toolCall)) {
    return "";
  }

  if (toolCall && formatConnectedAppActivityDetail(toolCall)) {
    return "";
  }

  return trimmed;
}

function AssistantWorkProgressLine({ progress }: { progress: ChatProgressItem }) {
  return (
    <div className="assistant-thinking-progress" data-status={progress.status}>
      <span>{progress.status === "active" ? "Running" : progress.status === "complete" ? "Done" : "Pending"}</span>
      <strong>{formatProgressDetail(progress)}</strong>
    </div>
  );
}

export function createAssistantActivitySnapshot(
  message: ChatMessage,
  options: CreateAssistantActivitySnapshotOptions = {},
): AssistantActivitySnapshot | null {
  if (message.role !== "assistant") {
    return null;
  }

  const allToolCalls = dedupeAssistantToolCalls(message.toolCalls ?? []);
  const progressItems = getInlineProgressItems(message.progress);
  const allActiveToolCount = allToolCalls.filter((toolCall) => toolCall.status === "active").length;
  const waitingToolCount = allToolCalls.filter((toolCall) => toolCall.status === "waiting_approval").length;
  const hasActiveProgress = progressItems.some((item) => item.status === "active");
  const hasWebSearchActivity = message.webSearch?.status === "active";
  const hasPlanningActivity = Boolean(message.planning && !message.planning.completedAt);
  const live = Boolean(message.isStreaming && (allActiveToolCount > 0 || waitingToolCount > 0 || hasActiveProgress || hasWebSearchActivity || hasPlanningActivity));
  const activityToolCalls = allToolCalls.filter((toolCall) => shouldShowActivityToolCall(toolCall, message, live));
  const toolCalls = live ? activityToolCalls : activityToolCalls.filter((toolCall) => toolCall.status !== "active");
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
    toolCalls,
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

function shouldShowActivityToolCall(toolCall: ChatToolCall, message: ChatMessage, live: boolean) {
  if (toolCall.toolId !== "image_generate") {
    return true;
  }

  if (live && (toolCall.status === "active" || toolCall.status === "waiting_approval")) {
    return true;
  }

  return !hasGeneratedImageArtifact(message);
}

function hasGeneratedImageArtifact(message: ChatMessage) {
  return (message.artifacts ?? []).some((artifact) =>
    artifact.kind === "image"
    || artifact.mimeType?.toLowerCase().startsWith("image/")
    || artifact.url?.toLowerCase().startsWith("data:image/"),
  );
}

function createActivityLabel({
  activeToolCount,
  commandCount,
  fileStats,
  latestProgress,
  latestTool,
  live,
  message,
  toolCalls,
  waitingToolCount,
}: {
  activeToolCount: number;
  commandCount: number;
  fileStats: AssistantActivityFileStats;
  latestProgress?: ChatProgressItem;
  latestTool?: ChatToolCall;
  live: boolean;
  message: ChatMessage;
  toolCalls: ChatToolCall[];
  waitingToolCount: number;
}) {
  if (waitingToolCount > 0) {
    return fileStats.fileCount > 0 ? `Reviewing ${formatFileCount(fileStats.fileCount)}` : "Waiting for approval";
  }

  if (fileStats.fileCount > 0 && live) {
    const batchLabel = createBatchActivityLabel(getLatestBatchToolCall(toolCalls), true);
    if (batchLabel) {
      return batchLabel;
    }

    return formatLiveFileSummary(fileStats, commandCount);
  }

  if (fileStats.fileCount > 0) {
    const batchLabel = createBatchActivityLabel(getLatestBatchToolCall(toolCalls), false);
    if (batchLabel) {
      return batchLabel;
    }

    return formatCompletedFileSummary(fileStats, commandCount);
  }

  const activeToolSummary = createActiveToolSummary(toolCalls);

  if (activeToolSummary) {
    return activeToolSummary;
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
  const batchDetail = createBatchActivityDetail(getLatestBatchToolCall(toolCalls));
  const fileSummary = formatFileStats(fileStats);
  const progressSummary = latestProgress ? formatProgressDetail(latestProgress) : "";
  const toolSummary = latestTool ? formatToolDetail(latestTool) : "";
  const activityCount = toolCalls.length > 0 ? `${toolCalls.length} ${toolCalls.length === 1 ? "activity item" : "activity items"}` : "";

  return [batchDetail, fileSummary, progressSummary, toolSummary, activityCount].filter(Boolean)[0] ?? (live ? (responseStarted ? "Continuing the response" : "Preparing response") : "");
}

function getLatestBatchToolCall(toolCalls: ChatToolCall[]) {
  return [...toolCalls].reverse().find((toolCall) => Boolean(inferBatchOperation(toolCall)));
}

function createBatchActivityLabel(toolCall: ChatToolCall | undefined, live: boolean) {
  return toolCall ? createToolBatchDisplay(toolCall, { live })?.label ?? "" : "";
}

function createBatchActivityDetail(toolCall: ChatToolCall | undefined) {
  return toolCall ? createToolBatchDisplay(toolCall)?.detail ?? "" : "";
}

function createToolBatchDisplay(toolCall: ChatToolCall, options: { live?: boolean } = {}) {
  const operation = inferBatchOperation(toolCall);

  if (!operation) {
    return null;
  }

  const fileResults = toolCall.batchFileResults ?? [];
  const estimatedFileCount = fileResults.length > 0 ? 0 : estimateFileItemsFromToolInput(toolCall).length;
  const fileCount = toolCall.batchSummary?.fileCount || fileResults.length || estimatedFileCount;

  if (fileCount <= 0) {
    return null;
  }

  const live = options.live ?? (toolCall.status === "active" || toolCall.status === "waiting_approval");
  const successCount = toolCall.batchSummary?.successCount ?? fileResults.filter((item) => item.status === "ok").length;
  const failureCount = toolCall.batchSummary?.failureCount ?? fileResults.filter((item) => item.status === "error").length;
  const skippedCount = toolCall.batchSummary?.skippedCount ?? fileResults.filter((item) => item.status === "skipped").length;
  const processedCount = Math.min(fileCount, successCount + failureCount + skippedCount);
  const hasPartialOutcome = !live && (failureCount > 0 || skippedCount > 0);
  const label = live
    ? processedCount > 0
      ? `Batch ${operation === "write" ? "writing" : "editing"} ${formatFileRatio(processedCount, fileCount)}`
      : `Batch ${operation === "write" ? "writing" : "editing"} ${formatFileCount(fileCount)}`
    : hasPartialOutcome
      ? `Batch ${operation === "write" ? "wrote" : "edited"} ${formatFileRatio(successCount, fileCount)}`
      : `Batch ${operation === "write" ? "wrote" : "edited"} ${formatFileCount(successCount || fileCount)}`;

  return {
    detail: formatBatchOutcomeDetail({ failureCount, fileCount, live, skippedCount, status: toolCall.status, successCount }),
    label,
    operation,
  };
}

function formatBatchOutcomeDetail({
  failureCount,
  fileCount,
  live,
  skippedCount,
  status,
  successCount,
}: {
  failureCount: number;
  fileCount: number;
  live: boolean;
  skippedCount: number;
  status: ChatToolCall["status"];
  successCount: number;
}) {
  if (live) {
    if (status === "waiting_approval") {
      return "Waiting for approval";
    }

    const processedCount = Math.min(fileCount, successCount + failureCount + skippedCount);
    const pendingCount = Math.max(0, fileCount - processedCount);

    if (processedCount > 0) {
      return [
        successCount > 0 ? `${successCount} OK` : "",
        failureCount > 0 ? `${failureCount} failed` : "",
        skippedCount > 0 ? `${skippedCount} skipped` : "",
        pendingCount > 0 ? `${pendingCount} pending` : "",
      ].filter(Boolean).join(", ");
    }

    return `Preparing ${formatFileCount(fileCount)}`;
  }

  return [
    successCount > 0 ? `${successCount} OK` : "",
    failureCount > 0 ? `${failureCount} failed` : "",
    skippedCount > 0 ? `${skippedCount} skipped` : "",
  ].filter(Boolean).join(", ");
}

function formatFileRatio(count: number, total: number) {
  return `${count} of ${formatFileCount(total)}`;
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

  // Plan-mode phase items belong to the PlanReviewCard / PlanReviewPanel, not
  // this inline thinking surface. They render the wrong way out here
  // (showing all four phases as a phase list) and don't match the Claude Code
  // UX where the plan card owns its own indicator.
  const isPlanPhase = id === "plan-context" || id === "plan-input" || id === "plan-research" || id === "plan-write";

  return isPlanPhase || id === "provider-payload-guardrail" || id === "final-answer-recovery" || id === "context-compaction" || label === "provider payload guardrail";
}

function getAssistantFileItems(toolCalls: ChatToolCall[], options: { includeEstimated?: boolean } = {}): AssistantActivityFileItem[] {
  return toolCalls.flatMap((toolCall) => {
    if (toolCall.batchFileResults?.length) {
      const batchOperation = inferBatchOperation(toolCall);
      return toolCall.batchFileResults.map((result) => ({
        additions: result.additions,
        deletions: result.deletions,
        estimated: false,
        kind: result.kind ?? (batchOperation === "write" ? "write" : "update"),
        path: result.path,
        status: result.status === "error" ? "error" : result.status === "skipped" ? "skipped" : toolCall.status,
      }));
    }

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

  if (isBatchWriteTool(toolCall)) {
    return estimateBatchWriteFileItems(input, toolCall.status);
  }

  if (isBatchEditTool(toolCall)) {
    return estimateBatchEditFileItems(input, toolCall.status);
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

  if (label.includes("replace file text span") || toolCall.toolId === "files_replace_span") {
    return [createEstimatedFileItem(path, countTextLines(stringValue(input.content)), estimateSpanDeletionCount(input), "update", toolCall.status)];
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

function estimateBatchWriteFileItems(input: Record<string, unknown>, status: ChatToolCall["status"]): AssistantActivityFileItem[] {
  const rawFiles = recordArrayValue(input.files) || parseJsonRecordArray(input.filesJson ?? input.files_json, "files");
  const fallbackFiles: Record<string, unknown>[] = stringArrayValue(input.paths).map((path, index) => {
    const contents = stringArrayValue(input.contents);
    return {
      content: contents[index] ?? stringValue(input.content),
      overwrite: input.overwrite,
      path,
    };
  });
  const files = rawFiles?.length ? rawFiles : fallbackFiles;
  const seenPaths = new Set<string>();

  return files.flatMap((file) => {
    const path = stringValue(file.path);

    if (!path || seenPaths.has(path)) {
      return [];
    }

    seenPaths.add(path);
    return [
      createEstimatedFileItem(
        path,
        countTextLines(stringValue(file.content)),
        0,
        file.overwrite === false ? "create" : "write",
        status,
      ),
    ];
  });
}

function estimateBatchEditFileItems(input: Record<string, unknown>, status: ChatToolCall["status"]): AssistantActivityFileItem[] {
  const rawEdits = recordArrayValue(input.edits) || parseJsonRecordArray(input.editsJson ?? input.edits_json, "edits");
  const fallbackEdits: Record<string, unknown>[] = stringArrayValue(input.paths).map((path, index) => {
    const oldTexts = stringArrayValue(input.oldTexts ?? input.old_texts);
    const newTexts = stringArrayValue(input.newTexts ?? input.new_texts);
    return {
      newText: newTexts[index] ?? stringValue(input.newText ?? input.new_text),
      oldText: oldTexts[index] ?? stringValue(input.oldText ?? input.old_text),
      operation: "exact_replace",
      path,
    };
  });
  const edits = rawEdits?.length ? rawEdits : fallbackEdits;
  const byPath = new Map<string, { additions: number; deletions: number; path: string }>();

  for (const edit of edits) {
    const path = stringValue(edit.path);

    if (!path) {
      continue;
    }

    const current = byPath.get(path) ?? { additions: 0, deletions: 0, path };
    const operation = stringValue(edit.operation ?? edit.type).toLowerCase();

    if (isReplaceSpanEdit(edit, operation)) {
      current.additions += countTextLines(stringValue(edit.content));
      current.deletions += estimateSpanDeletionCount(edit);
    } else if (operation === "replace_range" || edit.startLine !== undefined || edit.start_line !== undefined) {
      const startLine = numberValue(edit.startLine ?? edit.start_line);
      const endLine = numberValue(edit.endLine ?? edit.end_line);
      current.additions += countTextLines(stringValue(edit.content));
      current.deletions += startLine && endLine && endLine >= startLine ? endLine - startLine + 1 : 0;
    } else if (operation === "insert_at_line" || operation === "insert" || edit.line !== undefined) {
      current.additions += countTextLines(stringValue(edit.content));
    } else if (operation === "append" || (edit.content !== undefined && edit.oldText === undefined && edit.old_text === undefined)) {
      current.additions += countTextLines(stringValue(edit.content));
    } else {
      current.additions += countTextLines(stringValue(edit.newText ?? edit.new_text));
      current.deletions += countTextLines(stringValue(edit.oldText ?? edit.old_text));
    }

    byPath.set(path, current);
  }

  return [...byPath.values()].map((item) =>
    createEstimatedFileItem(item.path, item.additions, item.deletions, "update", status),
  );
}

function isReplaceSpanEdit(edit: Record<string, unknown>, operation: string) {
  return operation === "replace_span" || operation === "span_replace" || operation === "line_column_span" || operation === "column_range" || operation === "char_range" || operation === "replace_chars"
    || edit.startColumn !== undefined
    || edit.start_column !== undefined
    || edit.startChar !== undefined
    || edit.start_char !== undefined
    || edit.endColumn !== undefined
    || edit.end_column !== undefined
    || edit.endChar !== undefined
    || edit.end_char !== undefined;
}

function estimateSpanDeletionCount(input: Record<string, unknown>) {
  const startLine = numberValue(input.startLine ?? input.start_line);
  const endLine = numberValue(input.endLine ?? input.end_line) ?? startLine;
  const startColumn = numberValue(input.startColumn ?? input.start_column ?? input.startChar ?? input.start_char);
  const endColumn = numberValue(input.endColumn ?? input.end_column ?? input.endChar ?? input.end_char);

  if (startLine && endLine && endLine > startLine) {
    return endLine - startLine + 1;
  }

  if (startLine && endLine === startLine && startColumn && endColumn && endColumn > startColumn) {
    return 1;
  }

  return 0;
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
      } else if (item.kind === "write") {
        stats.writes += 1;
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
      writes: 0,
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
    stats.writes > 0 ? `${stats.writes} written` : "",
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
    stats.writes > 0 ? `writing ${formatFileCount(stats.writes)}` : "",
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
    stats.writes > 0 ? `wrote ${formatFileCount(stats.writes)}` : "",
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

function createActiveToolSummary(toolCalls: ChatToolCall[]) {
  const activeToolCalls = toolCalls.filter((toolCall) => toolCall.status === "active" || toolCall.status === "waiting_approval");

  if (activeToolCalls.length === 0) {
    return "";
  }

  const actionCounts = activeToolCalls.reduce<Map<string, number>>((counts, toolCall) => {
    const action = getToolCallAction(toolCall);

    if (!action) {
      return counts;
    }

    counts.set(action, (counts.get(action) ?? 0) + 1);
    return counts;
  }, new Map());

  if (actionCounts.size === 0) {
    return "";
  }

  const [action, count] = [...actionCounts.entries()].sort((left, right) => right[1] - left[1])[0] ?? ["", 0];

  if (!action) {
    return "";
  }

  return count <= 1 ? `${action} file` : `${action} ${formatFileCount(count)}`;
}

function getToolCallAction(toolCall: ChatToolCall) {
  const key = `${toolCall.toolId ?? ""} ${toolCall.label}`.toLowerCase();

  if (isBatchWriteTool(toolCall) || /\b(files_write|write workspace file|write file)\b/.test(key)) {
    return "Writing";
  }

  if (isBatchEditTool(toolCall) || /\b(files_apply_patch|files_exact_replace|files_replace_range|files_replace_span|files_insert_at_line|files_append)\b/.test(key) || /\b(apply workspace patch|edit file|replace file|insert text|append to workspace file)\b/.test(key)) {
    return "Editing";
  }

  if (/\b(files_move|move workspace path)\b/.test(key)) {
    return "Moving";
  }

  if (/\b(files_copy|copy workspace path)\b/.test(key)) {
    return "Copying";
  }

  if (/\b(files_read|read workspace file|read file)\b/.test(key)) {
    return "Reading";
  }

  if (/\b(files_search|files_list|files_tree|search workspace|list workspace|scan workspace)\b/.test(key)) {
    return "Searching";
  }

  return "";
}

function inferBatchOperation(toolCall: ChatToolCall): NonNullable<ChatToolCall["batchSummary"]>["operation"] | undefined {
  if (toolCall.batchSummary?.operation) {
    return toolCall.batchSummary.operation;
  }

  if (isBatchWriteTool(toolCall)) {
    return "write";
  }

  if (isBatchEditTool(toolCall)) {
    return "edit";
  }

  return undefined;
}

function isBatchWriteTool(toolCall: ChatToolCall) {
  const key = `${toolCall.toolId ?? ""} ${toolCall.label}`.toLowerCase();
  return key.includes("files_write_many") || key.includes("write many workspace files") || key.includes("batch write");
}

function isBatchEditTool(toolCall: ChatToolCall) {
  const key = `${toolCall.toolId ?? ""} ${toolCall.label}`.toLowerCase();
  return key.includes("files_edit_many") || key.includes("edit many workspace files") || key.includes("batch edit");
}

function formatToolDetail(toolCall: ChatToolCall) {
  const detail = cleanInlineText(toolCall.detail ?? toolCall.output ?? "");

  if (isApprovalDeniedToolCall(toolCall)) {
    return "Canceled before running";
  }

  if (toolCall.status === "active") {
    return detail && detail !== toolCall.label ? `${toolCall.label}: ${detail}` : "";
  }

  if (toolCall.status === "waiting_approval") {
    return detail ? `Needs review: ${detail}` : "Needs review before this action runs";
  }

  return detail && detail !== toolCall.label ? detail : "";
}

function formatProgressDetail(progress: ChatProgressItem) {
  const detail = cleanInlineText(progress.detail ?? "");
  const label = cleanInlineText(progress.label);
  const genericLabels = new Set(["activity", "progress", "thinking", "tool progress"]);

  if (!detail) {
    return label || "Progress";
  }

  return genericLabels.has(label.toLowerCase()) ? detail : `${label}: ${detail}`;
}

function formatToolActivityLine(toolCall: ChatToolCall) {
  const batchDisplay = createToolBatchDisplay(toolCall);
  if (batchDisplay?.detail) {
    return batchDisplay.detail;
  }

  if (isApprovalDeniedToolCall(toolCall)) {
    return "Canceled before running";
  }

  if (toolCall.status === "waiting_approval") {
    return "Needs review before this action runs";
  }

  const connectedAppDetail = formatConnectedAppActivityDetail(toolCall);
  if (connectedAppDetail) {
    return connectedAppDetail;
  }

  const command = toolCall.terminal?.command ?? readCommandFromInput(toolCall.input);
  const target = getToolTargetPath(toolCall);

  if (command) {
    return `${toolCall.status === "active" ? "Running" : "Ran"} ${limitInline(command, 150)}`;
  }

  if (target) {
    return target;
  }

  const detail = cleanInlineText(toolCall.detail ?? "");
  if (!detail || detail === toolCall.label || isNoiseOnlyActivityText(detail)) {
    return "";
  }

  const labelPrefix = `${toolCall.label}:`;
  const withoutPrefix = detail.toLowerCase().startsWith(labelPrefix.toLowerCase()) ? detail.slice(labelPrefix.length).trim() : detail;

  return isNoiseOnlyActivityText(withoutPrefix) ? "" : withoutPrefix;
}

function formatToolStatusWord(status: ChatToolCall["status"]) {
  if (status === "active") {
    return "Running";
  }

  if (status === "waiting_approval") {
    return "Needs review";
  }

  if (status === "error") {
    return "Issue";
  }

  if (status === "skipped") {
    return "Canceled";
  }

  return "Done";
}

function formatFileCount(count: number) {
  return count === 1 ? "1 file" : `${count} files`;
}

function formatDiffLineNumber(line: NonNullable<ChatToolFileChange["diffPreview"]>[number]) {
  if (line.kind === "meta" || line.kind === "hunk") {
    return "";
  }

  const oldLine = line.oldLine ? formatNumber(line.oldLine) : "";
  const newLine = line.newLine ? formatNumber(line.newLine) : "";

  if (oldLine && newLine) {
    return `${oldLine}:${newLine}`;
  }

  return oldLine || newLine;
}

function getDiffLineMarker(kind: NonNullable<ChatToolFileChange["diffPreview"]>[number]["kind"]) {
  if (kind === "add") {
    return "+";
  }

  if (kind === "remove") {
    return "-";
  }

  if (kind === "context") {
    return " ";
  }

  return "";
}

function formatBatchFileStatus(status: NonNullable<ChatToolCall["batchFileResults"]>[number]["status"]) {
  if (status === "error") {
    return "Issue";
  }

  if (status === "skipped") {
    return "Skipped";
  }

  return "OK";
}

function formatConnectedAppActivityDetail(toolCall: ChatToolCall) {
  const key = `${toolCall.toolId ?? ""} ${toolCall.label}`.toLowerCase();
  const output = `${toolCall.detail ?? ""}\n${toolCall.output ?? ""}`;

  if (/\bgmail\b/.test(key)) {
    const activeAccount = output.match(/active account:\s*([^\s|,]+)/i)?.[1] ?? output.match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i)?.[0] ?? "";

    if (/connected accounts?/i.test(output) || /active account/i.test(output)) {
      return activeAccount ? `Active account: ${activeAccount}` : "Account checked";
    }

    if (/draft/i.test(key) && toolCall.status === "complete") {
      return "Draft prepared for review";
    }

    return "";
  }

  if (/\bcalendar\b/.test(key) && toolCall.status === "complete") {
    return "Calendar action finished";
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

function formatActivityPath(path: string) {
  if (isWorkspaceRootActivityPath(path)) {
    return "";
  }

  if (path.includes(" -> ")) {
    return path.split(" -> ").map(formatSingleActivityPath).filter(Boolean).join(" -> ");
  }

  return formatSingleActivityPath(path);
}

function formatSingleActivityPath(path: string) {
  if (isWorkspaceRootActivityPath(path)) {
    return "";
  }

  const normalized = cleanInlineText(path).replace(/\\/g, "/");
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

function isWorkspaceRootActivityPath(path: string) {
  const normalized = cleanInlineText(path).replace(/\\/g, "/").replace(/`/g, "").trim();
  return normalized === "." || normalized === "./" || normalized === "";
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

function recordArrayValue(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const records = value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
  return records.length > 0 ? records : undefined;
}

function parseJsonRecordArray(value: unknown, key: string): Record<string, unknown>[] | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return recordArrayValue(parsed);
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return recordArrayValue((parsed as Record<string, unknown>)[key]);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function stringArrayValue(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
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

  const formattedFromPath = formatActivityPath(fromPath);
  const formattedToPath = formatActivityPath(toPath);

  if (formattedFromPath && formattedToPath) {
    return `${formattedFromPath} -> ${formattedToPath}`;
  }

  return formatActivityPath(path);
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

function isNoiseOnlyActivityText(value: string) {
  const normalized = cleanInlineText(value).replace(/[`'"\[\]{}()]/g, "").trim();
  return !normalized || /^[.\-–—•·]+$/.test(normalized);
}
