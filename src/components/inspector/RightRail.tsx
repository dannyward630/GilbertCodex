import { Ban, Check, ChevronDown, ChevronRight, Circle, CircleCheck, FileCode2, FileText, Globe2, Image, LoaderCircle, Pin, SendHorizontal, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { terminalShellLabel } from "../../lib/terminalShells";
import { formatThinkingDuration } from "../../lib/thinkingActivity";
import { formatWebSearchProviderLabel } from "../../services/webSearchClient";
import { formatReasoningEffort } from "../../types/settings";
import type { AgentApproval, AgentApprovalDecision } from "../../types/agentRun";
import type {
  ChatArtifactKind,
  ChatMessage,
  ChatPlanningInputAnswer,
  ChatPlanningInputRequest,
  ChatPlanningQuestion,
  ChatProgressStatus,
  ChatSummary,
  ChatToolCall,
} from "../../types/chat";

const MAX_RAIL_ITEMS = Number.POSITIVE_INFINITY;
const MAX_PROGRESS_ITEMS = Number.POSITIVE_INFINITY;
// Activity panel deliberately renders full tool output. The user has said no
// context can be silently dropped in the UI. The panel is already scrollable,
// so even multi-MB outputs stay usable. If this becomes a real perf hit on a
// pathological output, switch to a virtualized renderer rather than a
// hidden cap.
const MAX_ACTIVITY_TOOL_TEXT_CHARS: number | null = null;
const MAX_TASK_SCAN_CHARS: number | null = null;

interface RailItem {
  detail: string;
  download?: string;
  icon: LucideIcon;
  label: string;
  url?: string;
}

interface ProgressRailItem {
  detail?: string;
  id: string;
  label: string;
  status: ChatProgressStatus;
}

interface RightRailProps {
  chat: ChatSummary;
  hasActivity?: boolean;
  onClose?: () => void;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onSubmitPlanningInput?: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
}

export function RightRail({ chat, hasActivity = false, onClose, onResolveToolApproval, onSubmitPlanningInput }: RightRailProps) {
  const { activityMessage, artifactItems, progressItems } = useMemo(() => getRightRailContent(chat), [chat]);
  const visibleProgressItems = activityMessage ? [] : progressItems;
  const isActivityTimerLive = Boolean(activityMessage && isActivityMessageLive(activityMessage));
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isActivityTimerLive) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isActivityTimerLive]);

  return (
    <aside className="right-rail" data-active={hasActivity} data-mode={activityMessage ? "activity" : "inspector"} aria-label="Conversation details">
      {activityMessage ? <ActivityCard message={activityMessage} now={now} onClose={onClose} onResolveToolApproval={onResolveToolApproval} onSubmitPlanningInput={onSubmitPlanningInput} /> : null}
      {visibleProgressItems.length > 0 ? <ProgressSection items={visibleProgressItems} /> : null}
      <RailSection items={artifactItems} title="Artifacts" />
    </aside>
  );
}

function isActivityMessageLive(message: ChatMessage) {
  const hasPendingPlanningInput = getPlanningInputRequests(message).some((request) => !request.answeredAt);
  const hasPendingApproval = message.approvals?.some((approval) => approval.status === "pending");
  const hasActiveTool = message.toolCalls?.some((toolCall) => toolCall.status === "active" || toolCall.status === "waiting_approval");

  return Boolean(
    hasPendingPlanningInput ||
      hasPendingApproval ||
      hasActiveTool ||
      (message.planning && !message.planning.completedAt) ||
      message.webSearch?.status === "active" ||
      message.isStreaming,
  );
}

export function chatHasRightRailContent(chat: ChatSummary) {
  const { activityMessage, artifactItems, progressItems } = getRightRailContent(chat);

  return Boolean(activityMessage || artifactItems.length > 0 || progressItems.length > 0);
}

export function chatHasLiveRightRailActivity(chat: ChatSummary) {
  return chat.messages.some(
    (message) => {
      const hasPendingPlanningInput = getPlanningInputRequests(message).some((request) => !request.answeredAt);
      const hasPendingApproval = message.approvals?.some((approval) => approval.status === "pending");
      const hasVisibleActivity = Boolean(
        hasPendingPlanningInput ||
          hasPendingApproval ||
          message.toolCalls?.length ||
          message.planning?.startedAt ||
          message.webSearch?.status === "active" ||
          message.webSearch?.status === "error",
      );

      return (
        message.role === "assistant" &&
        Boolean((message.isStreaming || hasPendingPlanningInput || hasPendingApproval) && hasVisibleActivity)
      );
    },
  );
}

interface ActivityCardProps {
  message: ChatMessage;
  now: number;
  onClose?: () => void;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onSubmitPlanningInput?: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
}

function ActivityCard({ message, now, onClose, onResolveToolApproval, onSubmitPlanningInput }: ActivityCardProps) {
  const sectionRef = useRef<HTMLDivElement | null>(null);
  const activityStickToBottomRef = useRef(true);
  const isPlanning = message.mode === "plan" || Boolean(message.planning);
  const isWebSearch = !isPlanning && Boolean(message.webSearch?.enabled);
  const hasPendingApproval = message.approvals?.some((approval) => approval.status === "pending");
  const isActivityLive = Boolean(
    hasPendingApproval ||
      (message.planning
      ? !message.planning.completedAt
      : message.thinking
        ? !message.thinking.completedAt
        : message.webSearch?.status === "active"
          ? true
          : message.isStreaming),
  );
  const isWritingResponse = Boolean(message.isStreaming && !isActivityLive);
  const startedAt = message.planning?.startedAt ?? message.thinking?.startedAt ?? message.createdAt;
  const completedAt = isActivityLive ? undefined : message.planning?.completedAt ?? message.thinking?.completedAt ?? message.createdAt;
  const duration = formatThinkingDuration(startedAt, completedAt, now);
  const toolCalls = message.toolCalls ?? [];
  const hasToolCalls = toolCalls.length > 0;
  const activityName = hasPendingApproval ? "Approval needed" : hasToolCalls ? "Tool calls" : isPlanning ? "Planning" : isWebSearch ? "Web search" : "Working";
  const statusLabel = hasPendingApproval ? "Waiting for your decision" : hasToolCalls ? getToolActivityStatusLabel(toolCalls) : isActivityLive ? "Working" : isPlanning ? `Planned for ${duration}` : isWebSearch ? `Searched web in ${duration}` : `Finished in ${duration}`;
  const detailLabel = hasToolCalls ? getToolActivityDetailLabel(toolCalls) : getActivityDetailLabel(message, isActivityLive, isWritingResponse, isPlanning);
  const inputRequests = getPlanningInputRequests(message);
  const inputRequest = inputRequests.find((request) => !request.answeredAt);
  const answeredInputRequests = inputRequests.filter((request) => request.answeredAt);
  const inputPending = Boolean(inputRequest && !inputRequest.answeredAt);
  const pendingApprovals = (message.approvals ?? []).filter((approval) => approval.status === "pending");
  const activityScrollKey = createActivityScrollKey(message, pendingApprovals.length, inputPending);

  useEffect(() => {
    if (!isActivityLive || !activityStickToBottomRef.current) {
      return;
    }

    const section = sectionRef.current;
    if (!section) {
      return;
    }

    const animationFrameId = window.requestAnimationFrame(() => {
      section.scrollTop = section.scrollHeight;
    });

    return () => window.cancelAnimationFrame(animationFrameId);
  }, [activityScrollKey, isActivityLive]);

  function handleActivityScroll() {
    const section = sectionRef.current;

    if (!section) {
      return;
    }

    const distanceFromBottom = section.scrollHeight - section.scrollTop - section.clientHeight;
    activityStickToBottomRef.current = distanceFromBottom < 36;
  }

  return (
    <section className="activity-card" aria-labelledby="activity-panel-title">
      <div className="activity-header">
        <h2 id="activity-panel-title">
          Activity <span>{isActivityLive ? `- ${duration}` : "- Done"}</span>
        </h2>
        <button className="rail-close" type="button" aria-label="Close activity" onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="activity-section" ref={sectionRef} onScroll={handleActivityScroll}>
        <h3>{activityName}</h3>
        <div className="activity-status-row" data-live={isActivityLive}>
          <span className="activity-status-icon" aria-hidden="true">
            {isActivityLive ? <LoaderCircle size={16} /> : <CircleCheck size={16} />}
          </span>
          <span>
            <strong>{statusLabel}</strong>
            <small>{detailLabel}</small>
          </span>
        </div>

        {isActivityLive && !hasToolCalls ? (
          <div className="activity-live-lines" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {inputRequest && inputPending && onSubmitPlanningInput ? (
          <PlanningInputPanel request={inputRequest} onSubmit={(answers) => onSubmitPlanningInput(message.id, answers)} />
        ) : null}

        {answeredInputRequests.map((answeredRequest) => (
          <PlanningInputSummary key={answeredRequest.id} request={answeredRequest} />
        ))}

        {hasToolCalls ? <ToolCallList toolCalls={toolCalls} /> : null}

        {pendingApprovals.length > 0 && onResolveToolApproval ? (
          <ApprovalPanel
            approvals={pendingApprovals}
            onResolve={(approvalId, decision) => onResolveToolApproval(message.id, approvalId, decision)}
          />
        ) : null}
      </div>

      <div className="activity-footer">
        <Sparkles size={14} aria-hidden="true" />
        <span>{isPlanning ? formatPlanningFooter(message) : message.webSearch?.enabled ? formatWebSearchFooter(message) : message.thinking ? `${formatEffort(message.thinking.effort)} depth` : "Reasoning capture"}</span>
      </div>
    </section>
  );
}

function createActivityScrollKey(message: ChatMessage, pendingApprovalCount: number, inputPending: boolean) {
  const toolState = (message.toolCalls ?? []).map((toolCall) => {
    const changeState = (toolCall.fileChanges ?? [])
      .map((change) => `${change.path}:${change.additions}:${change.deletions}:${change.diffPreview?.length ?? 0}:${change.diffTruncated ? "1" : "0"}`)
      .join(",");

    return `${toolCall.id}:${toolCall.status}:${toolCall.output?.length ?? 0}:${changeState}`;
  });

  return [
    message.reasoning?.length ?? 0,
    message.content.length,
    toolState.join("|"),
    pendingApprovalCount,
    inputPending ? "input" : "",
  ].join(";");
}

function ApprovalPanel({
  approvals,
  onResolve,
}: {
  approvals: AgentApproval[];
  onResolve: (approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
}) {
  return (
    <div className="approval-list" aria-label="Pending approvals">
      <h4>
        <span>Approvals</span>
        <small>{approvals.length} pending</small>
      </h4>
      {approvals.map((approval) => (
        <article className="approval-card" data-risk={approval.risk} key={approval.id}>
          <div className="approval-card-header">
            <span>
              <strong>{approval.title}</strong>
              <small>{approval.detail ?? approval.kind}</small>
            </span>
            <b>{approval.risk}</b>
          </div>
          {approval.preview ? <pre>{limitActivityText(approval.preview, 1600)}</pre> : null}
          <div className="approval-actions">
            <button type="button" onClick={() => onResolve(approval.id, { status: "approved" })}>
              <Check size={14} aria-hidden="true" />
              <span>Allow</span>
            </button>
            {approval.tool !== "planning_handoff" ? (
              <button
                type="button"
                data-variant="session"
                title="Allow this tool for this workspace session"
                onClick={() => onResolve(approval.id, { scope: "session", status: "approved" })}
              >
                <Pin size={14} aria-hidden="true" />
                <span>Allow session</span>
              </button>
            ) : null}
            <button type="button" onClick={() => onResolve(approval.id, { status: "denied" })}>
              <Ban size={14} aria-hidden="true" />
              <span>Deny</span>
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ToolCallList({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set());

  function toggleToolCall(toolCallId: string) {
    setExpandedToolIds((currentIds) => {
      const nextIds = new Set(currentIds);

      if (nextIds.has(toolCallId)) {
        nextIds.delete(toolCallId);
      } else {
        nextIds.add(toolCallId);
      }

      return nextIds;
    });
  }

  return (
    <section className="activity-tool-ledger" aria-label="Tool calls">
      <div className="activity-tool-ledger-header">
        <span>
          <strong>Tool calls</strong>
        </span>
      </div>
      <div className="activity-tool-ledger-list">
        {toolCalls.map((toolCall, index) => {
          const expanded = expandedToolIds.has(toolCall.id);
          const terminalDetail = formatTerminalToolDetail(toolCall);
          const summary = formatToolCallSummary(toolCall, terminalDetail);
          const chips = getToolCallChips(toolCall, index, terminalDetail);

          return (
            <article className="activity-tool-entry" data-expanded={expanded} data-status={toolCall.status} key={`${toolCall.id}-${index}`}>
              <button className="activity-tool-row" type="button" aria-expanded={expanded} onClick={() => toggleToolCall(toolCall.id)}>
                <span className="activity-tool-row-main">
                  <span className="activity-tool-status-dot" aria-hidden="true">
                    <ProgressIcon status={toolStatusToProgressStatus(toolCall.status)} />
                  </span>
                  <span className="activity-tool-copy">
                    <strong><span>{index + 1}.</span> {toolCall.label}</strong>
                    <small>{summary || "No details reported yet."}</small>
                  </span>
                </span>
                <span className="activity-tool-row-actions">
                  <span className="activity-tool-status-label">{formatToolStatus(toolCall.status)}</span>
                  {expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
                </span>
              </button>
              <div className="activity-tool-chip-row" aria-label={`${toolCall.label} summary`}>
                {chips.map((chip) => (
                  <span data-tone={chip.tone ?? "muted"} key={chip.label}>{chip.label}</span>
                ))}
              </div>
              {expanded ? <ToolCallDetails toolCall={toolCall} /> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

interface ToolCallChip {
  label: string;
  tone?: "bad" | "good" | "info" | "muted";
}

function ToolCallDetails({ toolCall }: { toolCall: ChatToolCall }) {
  const hasDetails = Boolean(toolCall.fileChanges?.length || toolCall.input || toolCall.output || (isTerminalToolCall(toolCall) && toolCall.status === "active"));

  if (!hasDetails) {
    return <div className="activity-tool-empty-detail">No input, output, or file changes were reported for this call.</div>;
  }

  return (
    <div className="activity-tool-details">
      {toolCall.fileChanges?.length ? <ToolCallFileChanges fileChanges={toolCall.fileChanges} /> : null}
      {toolCall.input ? <ToolCallTextBlock content={toolCall.input} label="Input" /> : null}
      {toolCall.output ? (
        <ToolCallTextBlock
          content={toolCall.output}
          label={isTerminalToolCall(toolCall) ? (toolCall.status === "active" ? "Live terminal output" : "Terminal output") : "Output"}
          live={isTerminalToolCall(toolCall) && toolCall.status === "active"}
        />
      ) : isTerminalToolCall(toolCall) && toolCall.status === "active" ? (
        <ToolCallTextBlock content="Waiting for terminal output..." label="Live terminal output" live />
      ) : null}
    </div>
  );
}

function ToolCallFileChanges({ fileChanges }: { fileChanges: NonNullable<ChatToolCall["fileChanges"]> }) {
  return (
    <div className="activity-file-change-list" aria-label="File changes">
      {fileChanges.map((change, index) => {
        const previewLines = change.diffPreview ?? [];

        return (
          <div className="activity-file-change-item" key={`${change.path}-${index}`}>
            <div className="activity-file-change-row">
              <span className="activity-file-change-path" title={change.path}>{formatFileChangePath(change.path)}</span>
              <span className="activity-file-change-add">+{change.additions}</span>
              <span className="activity-file-change-del">-{change.deletions}</span>
            </div>
            {previewLines.length > 0 ? (
              <div className="activity-file-diff-preview" aria-label={`Diff preview for ${formatFileChangePath(change.path)}`}>
                {previewLines.map((line, lineIndex) => (
                  <div className="activity-file-diff-line" data-kind={line.kind} key={`${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${lineIndex}`}>
                    <span>{formatActivityDiffMarker(line.kind)}</span>
                    <code>{line.content || " "}</code>
                  </div>
                ))}
                {change.diffTruncated ? <div className="activity-file-diff-trimmed">Preview trimmed in Activity</div> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function formatActivityDiffMarker(kind: NonNullable<NonNullable<ChatToolCall["fileChanges"]>[number]["diffPreview"]>[number]["kind"]) {
  if (kind === "add") {
    return "+";
  }

  if (kind === "remove") {
    return "-";
  }

  if (kind === "hunk") {
    return "@";
  }

  return "";
}

function ToolCallTextBlock({ content, label, live = false }: { content: string; label: string; live?: boolean }) {
  return (
    <div className="activity-tool-text-block" data-live={live}>
      <span>
        <strong>{label}</strong>
        <small>{formatTextBlockSize(content)}</small>
      </span>
      <pre aria-atomic="false" aria-live={live ? "polite" : undefined}>{content}</pre>
    </div>
  );
}

function formatToolCallSummary(toolCall: ChatToolCall, terminalDetail: string) {
  const fileChangeSummary = formatFileChangeSummary(toolCall.fileChanges);
  const outcomeDetail = toolCall.status === "error" || toolCall.status === "skipped" || toolCall.status === "waiting_approval"
    ? cleanInlineText(toolCall.output ?? "")
    : "";

  return limitInlineText([toolCall.detail, terminalDetail, fileChangeSummary, outcomeDetail].filter(Boolean).join(" | "), 180);
}

function getToolCallChips(toolCall: ChatToolCall, index: number, terminalDetail: string): ToolCallChip[] {
  const chips: ToolCallChip[] = [{ label: `#${index + 1}` }];
  const hasInput = Boolean(toolCall.input);
  const hasOutput = Boolean(toolCall.output);
  const fileChanges = toolCall.fileChanges ?? [];

  if (toolCall.status === "active") {
    chips.push({ label: "running", tone: "info" });
  } else if (toolCall.status === "complete") {
    chips.push({ label: "complete", tone: "good" });
  } else if (toolCall.status === "error") {
    chips.push({ label: "error", tone: "bad" });
  } else if (toolCall.status === "waiting_approval") {
    chips.push({ label: "approval", tone: "info" });
  } else {
    chips.push({ label: "skipped" });
  }

  if (terminalDetail) {
    chips.push({ label: "terminal", tone: "info" });
  }

  if (fileChanges.length > 0) {
    const additions = fileChanges.reduce((total, change) => total + change.additions, 0);
    const deletions = fileChanges.reduce((total, change) => total + change.deletions, 0);
    chips.push({ label: fileChanges.length === 1 ? "1 file" : `${fileChanges.length} files`, tone: "info" });
    chips.push({ label: `+${additions}`, tone: additions > 0 ? "good" : "muted" });
    chips.push({ label: `-${deletions}`, tone: deletions > 0 ? "bad" : "muted" });
  }

  if (hasInput) {
    chips.push({ label: formatCompactContentSize("input", toolCall.input ?? "") });
  }

  if (hasOutput) {
    chips.push({ label: formatCompactContentSize("output", toolCall.output ?? "") });
  } else if (toolCall.status === "active") {
    chips.push({ label: "waiting output" });
  }

  return chips;
}

function formatFileChangeSummary(fileChanges: ChatToolCall["fileChanges"]) {
  if (!fileChanges?.length) {
    return "";
  }

  const additions = fileChanges.reduce((total, change) => total + change.additions, 0);
  const deletions = fileChanges.reduce((total, change) => total + change.deletions, 0);
  const fileLabel = fileChanges.length === 1 ? "1 file" : `${fileChanges.length} files`;
  return `${fileLabel} changed, +${additions} -${deletions}`;
}

function formatTextBlockSize(content: string) {
  const lineCount = countTextLines(content);
  return `${formatLineCount(lineCount)}, ${formatCharacterCount(content.length)}`;
}

function formatCompactContentSize(label: string, content: string) {
  if (content.length > 20_000) {
    return `${label} ${formatCharacterCount(content.length)}`;
  }

  return `${label} ${formatLineCount(countTextLines(content))}`;
}

function formatLineCount(lineCount: number) {
  return lineCount === 1 ? "1 line" : `${lineCount} lines`;
}

function countTextLines(content: string) {
  if (!content) {
    return 0;
  }

  let lines = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) {
      lines += 1;
    }
  }

  return lines;
}

function formatCharacterCount(count: number) {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M chars`;
  }

  if (count >= 1_000) {
    return `${Math.round(count / 100) / 10}K chars`;
  }

  return `${count} chars`;
}

function limitInlineText(value: string, maxChars: number) {
  const cleaned = cleanInlineText(value);

  if (cleaned.length <= maxChars) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function formatFileChangePath(path: string) {
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

function isTerminalToolCall(toolCall: ChatToolCall) {
  return Boolean(toolCall.terminal) || /\b(terminal|cmd|powershell|bash|zsh|shell|tests?|typescript|custom tool)\b/i.test(`${toolCall.label} ${toolCall.detail ?? ""}`);
}

function formatTerminalToolDetail(toolCall: ChatToolCall) {
  if (!toolCall.terminal) {
    return "";
  }

  const shell = toolCall.terminal.shell ? terminalShellLabel(toolCall.terminal.shell) : "";
  const status = toolCall.terminal.timedOut
    ? "timed out"
    : typeof toolCall.terminal.exitCode === "number"
      ? `exit ${toolCall.terminal.exitCode}`
      : toolCall.status === "active"
        ? "streaming"
        : "";

  return [shell, toolCall.terminal.workingDirectory, status].filter(Boolean).join(" | ");
}

function toolStatusToProgressStatus(status: ChatToolCall["status"]): ChatProgressStatus {
  if (status === "complete") {
    return "complete";
  }

  if (status === "active") {
    return "active";
  }

  return "pending";
}

function limitActivityText(content: string, maxChars: number | null = MAX_ACTIVITY_TOOL_TEXT_CHARS) {
  if (maxChars === null || !Number.isFinite(maxChars) || content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n[Trimmed in Activity for responsiveness.]`;
}

function getActivityDetailLabel(message: ChatMessage, isActivityLive: boolean, isWritingResponse: boolean, isPlanning: boolean) {
  if (isPlanning) {
    const inputRequest = getPlanningInputRequests(message).find((request) => !request.answeredAt) ?? message.planning?.inputRequest;

    if (message.status === "error") {
      return "Needs attention";
    }

    if (inputRequest && !inputRequest.answeredAt) {
      return "Waiting for your answers";
    }

    if (isActivityLive) {
      if (inputRequest?.answeredAt) {
        return "Using your answers";
      }

      const toolCalls = message.toolCalls ?? [];
      const hasResearchTools = toolCalls.length > 0;

      if (hasResearchTools && !message.content.trim()) {
        return `Researching codebase (${toolCalls.length} tool call${toolCalls.length === 1 ? "" : "s"})`;
      }

      return hasResearchTools ? "Drafting plan from research" : "Building the plan";
    }

    return "Plan ready";
  }

  if (message.webSearch?.enabled) {
    const providerLabel = formatWebSearchProviderLabel(message.webSearch.provider);
    const resultProviderLabel = message.webSearch.resultProvider ? formatWebSearchProviderLabel(message.webSearch.resultProvider) : providerLabel;

    if (message.webSearch.status === "active") {
      return `Searching ${providerLabel}`;
    }

    if (message.webSearch.status === "error") {
      return `${providerLabel} search failed`;
    }

    if (isWritingResponse || isActivityLive) {
      return `${formatSourceCount(message.webSearch.resultCount)} ready; writing response`;
    }

    if (message.webSearch.resultProvider) {
      return `${formatSourceCount(message.webSearch.resultCount)} from ${resultProviderLabel} fallback`;
    }

    return `${formatSourceCount(message.webSearch.resultCount)} from ${providerLabel}`;
  }

  if (isActivityLive) {
    if (message.toolCalls?.length) {
      return formatToolCallCounts(message.toolCalls);
    }

    return "Working through the response";
  }

  if (message.status === "error") {
    return "Needs attention";
  }

  if (message.toolCalls?.length) {
    return formatToolCallCounts(message.toolCalls);
  }

  return isWritingResponse ? "Writing response" : "Done";
}

function formatPlanningFooter(_message: ChatMessage) {
  return "Plan mode";
}

function formatWebSearchFooter(message: ChatMessage) {
  const providerLabel = formatWebSearchProviderLabel(message.webSearch?.provider ?? "duckduckgo");
  const resultProviderLabel = message.webSearch?.resultProvider ? formatWebSearchProviderLabel(message.webSearch.resultProvider) : providerLabel;

  if (message.webSearch?.status === "error") {
    return `${providerLabel} - search failed`;
  }

  if (message.webSearch?.resultProvider) {
    return `${resultProviderLabel} fallback - ${formatSourceCount(message.webSearch?.resultCount)}`;
  }

  return `${providerLabel} - ${formatSourceCount(message.webSearch?.resultCount)}`;
}

function formatSourceCount(count: number | undefined) {
  return count === 1 ? "1 source" : `${count ?? 0} sources`;
}

function getPlanningInputRequests(message: ChatMessage) {
  if (message.planning?.inputRequests?.length) {
    return message.planning.inputRequests;
  }

  return message.planning?.inputRequest ? [message.planning.inputRequest] : [];
}

interface PlanningInputPanelProps {
  onSubmit: (answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
  request: ChatPlanningInputRequest;
}

interface PlanningAnswerDraft {
  optionId?: string;
  value: string;
}

function PlanningInputPanel({ onSubmit, request }: PlanningInputPanelProps) {
  const [drafts, setDrafts] = useState<Record<string, PlanningAnswerDraft>>(() => createInitialAnswerDrafts(request));
  const [submitting, setSubmitting] = useState(false);
  const canSubmit = request.questions.every((question) => !question.required || drafts[question.id]?.value.trim());

  useEffect(() => {
    setDrafts(createInitialAnswerDrafts(request));
    setSubmitting(false);
  }, [request.id]);

  function updateDraft(question: ChatPlanningQuestion, draft: PlanningAnswerDraft) {
    setDrafts((currentDrafts) => ({
      ...currentDrafts,
      [question.id]: draft,
    }));
  }

  async function handleSubmit() {
    if (!canSubmit || submitting) {
      return;
    }

    const answers = request.questions.map((question) => ({
      optionId: drafts[question.id]?.optionId,
      questionId: question.id,
      value: drafts[question.id]?.value.trim() || "No answer provided.",
    }));

    setSubmitting(true);
    await onSubmit(answers);
  }

  return (
    <section className="planning-input-card" aria-label="Planning questions">
      <div className="planning-input-header">
        <strong>{request.title}</strong>
        {request.detail ? <small>{request.detail}</small> : null}
      </div>

      <div className="planning-question-list">
        {request.questions.map((question, index) => (
          <div className="planning-question" key={question.id}>
            <label htmlFor={`planning-answer-${request.id}-${question.id}`}>
              {index + 1}. {question.question}
            </label>
            {question.options?.length ? (
              <div className="planning-option-list">
                {question.options.map((option) => {
                  const selected = drafts[question.id]?.optionId === option.id;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      data-selected={selected}
                      onClick={() =>
                        updateDraft(question, {
                          optionId: option.id,
                          value: option.description ? `${option.label} - ${option.description}` : option.label,
                        })
                      }
                    >
                      <strong>{option.label}</strong>
                      {option.description ? <small>{option.description}</small> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <textarea
              id={`planning-answer-${request.id}-${question.id}`}
              placeholder={question.placeholder || "Answer so the plan can adapt."}
              rows={2}
              value={drafts[question.id]?.value ?? ""}
              onChange={(event) =>
                updateDraft(question, {
                  optionId: drafts[question.id]?.optionId,
                  value: event.target.value,
                })
              }
            />
          </div>
        ))}
      </div>

      <button className="planning-input-submit" type="button" disabled={!canSubmit || submitting} onClick={handleSubmit}>
        {submitting ? <LoaderCircle size={15} aria-hidden="true" /> : <SendHorizontal size={15} aria-hidden="true" />}
        <span>{submitting ? "Continuing" : "Continue planning"}</span>
      </button>
    </section>
  );
}

function PlanningInputSummary({ request }: { request: ChatPlanningInputRequest }) {
  if (!request.answers?.length) {
    return null;
  }

  return (
    <section className="planning-input-summary" aria-label="Planning answers">
      <strong>Your answers</strong>
      <div>
        {request.answers.map((answer) => {
          const question = request.questions.find((item) => item.id === answer.questionId);

          return (
            <span key={answer.questionId}>
              <small>{question?.question ?? "Question"}</small>
              <em>{answer.value}</em>
            </span>
          );
        })}
      </div>
    </section>
  );
}

function createInitialAnswerDrafts(request: ChatPlanningInputRequest) {
  return request.questions.reduce<Record<string, PlanningAnswerDraft>>((drafts, question) => {
    const firstOption = question.options?.[0];

    drafts[question.id] = firstOption
      ? {
          optionId: firstOption.id,
          value: firstOption.description ? `${firstOption.label} - ${firstOption.description}` : firstOption.label,
        }
      : {
          value: "",
        };

    return drafts;
  }, {});
}

interface RailSectionProps {
  items: RailItem[];
  onClose?: () => void;
  title: string;
}

interface ProgressSectionProps {
  items: ProgressRailItem[];
}

function ProgressSection({ items }: ProgressSectionProps) {
  return (
    <section className="rail-card progress-card">
      <div className="rail-heading">
        <h2>Progress</h2>
        <Pin size={16} aria-hidden="true" />
      </div>
      <div className="progress-list rail-card-scroll">
        {items.map((item) => (
          <article className="progress-row" data-status={item.status} key={item.id}>
            <ProgressIcon status={item.status} />
            <span>
              <strong>{item.label}</strong>
              {item.detail ? <small>{item.detail}</small> : null}
            </span>
          </article>
        ))}
      </div>
    </section>
  );
}

function ProgressIcon({ status }: { status: ChatProgressStatus }) {
  if (status === "complete") {
    return <CircleCheck size={16} aria-hidden="true" />;
  }

  if (status === "active") {
    return <LoaderCircle size={16} aria-hidden="true" />;
  }

  return <Circle size={16} aria-hidden="true" />;
}

function RailSection({ items, onClose, title }: RailSectionProps) {
  if (items.length === 0) {
    return null;
  }

  const sectionKey = title.toLowerCase();

  return (
    <section className="rail-card rail-card-compact" data-section={sectionKey}>
      <div className="rail-heading">
        <h2>{title}</h2>
        {onClose ? (
          <button className="rail-close" type="button" aria-label={`Close ${title}`} onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <div className="rail-row-list rail-card-scroll">
        {items.map((item) => {
          const Icon = item.icon;

          if (item.url) {
            return (
              <a className="rail-row rail-row-stacked" href={item.url} key={`${title}-${item.url}`} download={item.download} rel="noreferrer" target={item.download ? undefined : "_blank"}>
                <Icon size={16} aria-hidden="true" />
                <span>
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
              </a>
            );
          }

          return <RailButton icon={Icon} item={item} key={`${title}-${item.label}-${item.detail}`} />;
        })}
      </div>
    </section>
  );
}

function RailButton({ icon: Icon, item }: { icon: LucideIcon; item: RailItem }) {
  return (
    <button className="rail-row rail-row-stacked" type="button" disabled>
      <Icon size={16} aria-hidden="true" />
      <span>
        <strong>{item.label}</strong>
        <small>{item.detail}</small>
      </span>
    </button>
  );
}

function getRightRailContent(chat: ChatSummary) {
  return {
    activityMessage: getLatestActivityMessage(chat),
    artifactItems: getArtifactItems(chat),
    progressItems: getProgressItems(chat),
  };
}

function getLatestActivityMessage(chat: ChatSummary) {
  return [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        Boolean(
            message.approvals?.some((approval) => approval.status === "pending") ||
            message.toolCalls?.length ||
            message.planning?.startedAt ||
            message.planning?.completedAt ||
            message.webSearch?.enabled,
        ),
    );
}

function getProgressItems(chat: ChatSummary): ProgressRailItem[] {
  const assistantMessages = [...chat.messages].reverse().filter((message) => message.role === "assistant");
  const messageWithToolCalls = assistantMessages.find((message) => message.toolCalls?.length);

  if (messageWithToolCalls?.toolCalls?.length) {
    return createToolProgressItems(messageWithToolCalls);
  }

  const messageWithProgress = assistantMessages.find((message) => message.progress?.some((item) => !isPlanningProgressItem(item)));

  if (messageWithProgress?.progress?.length) {
    return messageWithProgress.progress.filter((item) => !isPlanningProgressItem(item)).slice(0, MAX_PROGRESS_ITEMS).map((item, index) => ({
      detail: item.detail,
      id: item.id ?? `progress-${messageWithProgress.id}-${index}`,
      label: cleanInlineText(item.label),
      status: item.status,
    }));
  }

  for (const message of assistantMessages) {
    const items = parseTaskList(message.content);

    if (items.length > 0) {
      return items.slice(0, MAX_PROGRESS_ITEMS).map((item, index) => ({
        ...item,
        id: `progress-${message.id}-${index}`,
      }));
    }
  }

  return [];
}

function isPlanningProgressItem(item: NonNullable<ChatMessage["progress"]>[number]) {
  return item.id?.startsWith("plan-") ?? false;
}

function createToolProgressItems(message: ChatMessage): ProgressRailItem[] {
  const toolCalls = message.toolCalls ?? [];
  const summary = createToolProgressSummary(message, toolCalls);
  const toolItems = toolCalls.map((toolCall, index) => ({
    detail: formatToolProgressDetail(toolCall),
    id: `progress-${message.id}-${toolCall.id}-${index}`,
    label: `${index + 1}. ${toolCall.label}`,
    status: toolStatusToProgressStatus(toolCall.status),
  }));

  return [summary, ...toolItems];
}

function createToolProgressSummary(message: ChatMessage, toolCalls: ChatToolCall[]): ProgressRailItem {
  const activeCount = countToolCallsByStatus(toolCalls, "active");
  const completeCount = countToolCallsByStatus(toolCalls, "complete");
  const errorCount = countToolCallsByStatus(toolCalls, "error");
  const skippedCount = countToolCallsByStatus(toolCalls, "skipped");
  const approvalCount = countToolCallsByStatus(toolCalls, "waiting_approval");
  const blockedCount = errorCount + skippedCount;
  const status = activeCount > 0 ? "active" : approvalCount > 0 ? "pending" : completeCount > 0 ? "complete" : "pending";
  const countParts = [
    `${toolCalls.length} total`,
    activeCount > 0 ? `${activeCount} running` : "",
    approvalCount > 0 ? `${approvalCount} waiting approval` : "",
    completeCount > 0 ? `${completeCount} complete` : "",
    blockedCount > 0 ? `${blockedCount} blocked` : "",
  ].filter(Boolean);

  return {
    detail: countParts.join(" | "),
    id: `progress-${message.id}-tool-summary`,
    label: "Agent tools",
    status,
  };
}

function formatToolProgressDetail(toolCall: ChatToolCall) {
  const outputDetail = toolCall.status === "error" || toolCall.status === "skipped" || toolCall.status === "waiting_approval"
    ? cleanInlineText(toolCall.output ?? "")
    : "";

  return [formatToolStatus(toolCall.status), outputDetail || toolCall.detail].filter(Boolean).join(" | ");
}

function formatToolCallCounts(toolCalls: ChatToolCall[]) {
  const activeCount = countToolCallsByStatus(toolCalls, "active");
  const completeCount = countToolCallsByStatus(toolCalls, "complete");
  const errorCount = countToolCallsByStatus(toolCalls, "error");
  const skippedCount = countToolCallsByStatus(toolCalls, "skipped");
  const parts = [`${toolCalls.length} total`];

  if (activeCount > 0) {
    parts.push(`${activeCount} running`);
  }

  if (completeCount > 0) {
    parts.push(`${completeCount} complete`);
  }

  if (errorCount > 0) {
    parts.push(`${errorCount} error`);
  }

  if (skippedCount > 0) {
    parts.push(`${skippedCount} skipped`);
  }

  return parts.join(" | ");
}

function countToolCallsByStatus(toolCalls: ChatToolCall[], status: ChatToolCall["status"]) {
  return toolCalls.filter((toolCall) => toolCall.status === status).length;
}

function formatToolStatus(status: ChatToolCall["status"]) {
  if (status === "complete") {
    return "Complete";
  }

  if (status === "active") {
    return "Running";
  }

  if (status === "error") {
    return "Error";
  }

  if (status === "waiting_approval") {
    return "Waiting";
  }

  return "Skipped";
}

function getToolActivityStatusLabel(toolCalls: ChatToolCall[]) {
  const runningCount = countToolCallsByStatus(toolCalls, "active");
  const waitingCount = countToolCallsByStatus(toolCalls, "waiting_approval");
  const errorCount = countToolCallsByStatus(toolCalls, "error");
  const skippedCount = countToolCallsByStatus(toolCalls, "skipped");

  if (waitingCount > 0) {
    return "Waiting for approval";
  }

  if (runningCount > 0) {
    return runningCount === 1 ? "Running tool" : "Running tools";
  }

  if (errorCount + skippedCount > 0) {
    return "Needs attention";
  }

  return "Tools complete";
}

function getToolActivityDetailLabel(toolCalls: ChatToolCall[]) {
  const activeTool = [...toolCalls].reverse().find((toolCall) => toolCall.status === "active");
  const approvalTool = [...toolCalls].reverse().find((toolCall) => toolCall.status === "waiting_approval");
  const latestTool = [...toolCalls].reverse()[0];
  const toolCall = activeTool ?? approvalTool ?? latestTool;

  if (!toolCall) {
    return "No tool calls yet.";
  }

  const summary = formatToolCallSummary(toolCall, formatTerminalToolDetail(toolCall));

  if (activeTool) {
    return [`Running ${activeTool.label}`, summary].filter(Boolean).join(" | ");
  }

  if (approvalTool) {
    return [`Waiting for approval: ${approvalTool.label}`, summary].filter(Boolean).join(" | ");
  }

  return [`Latest: ${toolCall.label}`, summary].filter(Boolean).join(" | ");
}

function getArtifactItems(chat: ChatSummary): RailItem[] {
  const messageWithArtifacts = [...chat.messages].reverse().find((message) => message.role === "assistant" && message.artifacts?.length);

  if (!messageWithArtifacts?.artifacts?.length) {
    return [];
  }

  return messageWithArtifacts.artifacts.slice(0, MAX_RAIL_ITEMS).map((artifact) => ({
    detail: artifact.detail ?? artifact.url ?? formatArtifactKind(artifact.kind),
    icon: getArtifactIcon(artifact.kind),
    label: cleanInlineText(artifact.title),
    download: artifact.title,
    url: artifact.url,
  }));
}

function parseTaskList(content: string): ProgressRailItem[] {
  return stripCodeFences(limitTextForScan(content, MAX_TASK_SCAN_CHARS))
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.match(/^\s*(?:[-*+]|\d+[.)])\s+\[([ xX/~\-])\]\s+(.+?)\s*$/);

      if (!match) {
        return [];
      }

      return [
        {
          id: "",
          label: cleanInlineText(match[2]),
          status: parseTaskStatus(match[1]),
        },
      ];
    })
    .filter((item) => item.label.length > 0);
}

function parseTaskStatus(marker: string): ChatProgressStatus {
  if (marker.toLowerCase() === "x") {
    return "complete";
  }

  if (marker === "/" || marker === "~" || marker === "-") {
    return "active";
  }

  return "pending";
}

function limitTextForScan(content: string, maxChars: number | null) {
  if (maxChars === null || !Number.isFinite(maxChars) || content.length <= maxChars) {
    return content;
  }

  const headChars = Math.floor(maxChars * 0.58);
  const tailChars = maxChars - headChars;
  return `${content.slice(0, headChars)}\n\n${content.slice(-tailChars)}`;
}

function cleanInlineText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCodeFences(value: string) {
  return value.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

function getArtifactIcon(kind?: ChatArtifactKind) {
  if (kind === "image") {
    return Image;
  }

  if (kind === "document") {
    return FileText;
  }

  if (kind === "preview") {
    return Globe2;
  }

  return FileCode2;
}

function formatArtifactKind(kind?: ChatArtifactKind) {
  if (!kind || kind === "other") {
    return "Generated output";
  }

  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)} artifact`;
}

function formatEffort(effort: string) {
  return formatReasoningEffort(effort);
}
