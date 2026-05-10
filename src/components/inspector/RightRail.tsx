import { Ban, Check, ChevronDown, ChevronRight, Circle, CircleCheck, FileCode2, FileText, Globe2, Image, LoaderCircle, PencilLine, Pin, SendHorizontal, Sparkles, TerminalSquare, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { terminalShellLabel } from "../../lib/terminalShells";
import { formatThinkingDuration, splitThinkingContent } from "../../lib/thinkingActivity";
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

const MAX_RAIL_ITEMS = 12;
const MAX_PROGRESS_ITEMS = 40;
const MAX_ACTIVITY_TOOL_TEXT_CHARS = 2_400;
const MAX_ACTIVITY_TRACE_CHARS = 24_000;
const MAX_ACTIVITY_TRACE_SEGMENTS = 8;
const MAX_LIVE_TRACE_CHARS = 8_000;
const MAX_SOURCE_SCAN_CHARS = 80_000;
const MAX_TASK_SCAN_CHARS = 60_000;

interface RailItem {
  detail: string;
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
  const { activityMessage, artifactItems, progressItems, sourceItems } = useMemo(() => getRightRailContent(chat), [chat]);
  const visibleProgressItems = activityMessage ? [] : progressItems;
  const isThinkingLive = Boolean(activityMessage?.thinking && !activityMessage.thinking.completedAt);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!isThinkingLive) {
      return;
    }

    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isThinkingLive]);

  return (
    <aside className="right-rail" data-active={hasActivity} data-mode={activityMessage ? "activity" : "inspector"} aria-label="Conversation details">
      {activityMessage ? <ActivityCard message={activityMessage} now={now} onClose={onClose} onResolveToolApproval={onResolveToolApproval} onSubmitPlanningInput={onSubmitPlanningInput} /> : null}
      {visibleProgressItems.length > 0 ? <ProgressSection items={visibleProgressItems} /> : null}
      <RailSection items={artifactItems} title="Artifacts" />
      <RailSection items={sourceItems} title="Sources" />
    </aside>
  );
}

export function chatHasRightRailContent(chat: ChatSummary) {
  const { activityMessage, artifactItems, progressItems, sourceItems } = getRightRailContent(chat);

  return Boolean(activityMessage || artifactItems.length > 0 || progressItems.length > 0 || sourceItems.length > 0);
}

export function chatHasLiveRightRailActivity(chat: ChatSummary) {
  return chat.messages.some(
    (message) => {
      const hasPendingPlanningInput = getPlanningInputRequests(message).some((request) => !request.answeredAt);
      const hasPendingApproval = message.approvals?.some((approval) => approval.status === "pending");

      return (
        message.role === "assistant" &&
        Boolean(
            (message.isStreaming || hasPendingPlanningInput || hasPendingApproval) &&
            (message.planning?.startedAt ||
              message.thinking?.startedAt ||
              message.webSearch?.status === "active" ||
              message.reasoning?.trim() ||
              message.toolCalls?.length),
        )
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
  const { hiddenCount: hiddenTraceCount, segments: traceSegments, trimmed: traceTrimmed } = getVisibleThinkingTraceSegments(message.reasoning, isActivityLive);
  const hasTrace = traceSegments.length > 0;
  const activityName = hasPendingApproval ? "Approval needed" : isPlanning ? "Planning" : isWebSearch ? "Web + thinking" : "Thinking";
  const statusLabel = hasPendingApproval ? "Waiting for your decision" : isActivityLive ? activityName : isPlanning ? `Planned for ${duration}` : isWebSearch ? `Searched web in ${duration}` : `Thought for ${duration}`;
  const detailLabel = getActivityDetailLabel(message, isActivityLive, isWritingResponse, isPlanning);
  const inputRequests = getPlanningInputRequests(message);
  const inputRequest = inputRequests.find((request) => !request.answeredAt);
  const answeredInputRequests = inputRequests.filter((request) => request.answeredAt);
  const inputPending = Boolean(inputRequest && !inputRequest.answeredAt);
  const pendingApprovals = (message.approvals ?? []).filter((approval) => approval.status === "pending");

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

      <div className="activity-section">
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

        {isActivityLive && !hasTrace ? (
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

        {pendingApprovals.length > 0 && onResolveToolApproval ? (
          <ApprovalPanel
            approvals={pendingApprovals}
            onResolve={(approvalId, decision) => onResolveToolApproval(message.id, approvalId, decision)}
          />
        ) : null}

        {message.toolCalls?.length ? <ToolCallList toolCalls={message.toolCalls} /> : null}

        {hasTrace ? (
          <div className="activity-trace-list">
            {traceTrimmed || hiddenTraceCount > 0 ? (
              <article className="activity-trace-item">
                <p>{formatHiddenTraceLabel(hiddenTraceCount, traceTrimmed)}</p>
              </article>
            ) : null}
            {traceSegments.map((segment, index) => (
              <article className="activity-trace-item" key={`${index}-${segment.slice(0, 24)}`}>
                <p>{segment}</p>
              </article>
            ))}
          </div>
        ) : null}
      </div>

      <div className="activity-footer">
        <Sparkles size={14} aria-hidden="true" />
        <span>{isPlanning ? formatPlanningFooter(message) : message.webSearch?.enabled ? formatWebSearchFooter(message) : message.thinking ? `${formatEffort(message.thinking.effort)} depth` : "Reasoning capture"}</span>
      </div>
    </section>
  );
}

function ApprovalPanel({
  approvals,
  onResolve,
}: {
  approvals: AgentApproval[];
  onResolve: (approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
}) {
  const [editedArgsById, setEditedArgsById] = useState<Record<string, string>>(() =>
    approvals.reduce<Record<string, string>>((drafts, approval) => {
      drafts[approval.id] = JSON.stringify(approval.args ?? {}, null, 2);
      return drafts;
    }, {}),
  );
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  function updateEditedArgs(approvalId: string, value: string) {
    setEditedArgsById((drafts) => ({ ...drafts, [approvalId]: value }));
    setErrorById((errors) => ({ ...errors, [approvalId]: "" }));
  }

  async function approveEdited(approval: AgentApproval) {
    try {
      const parsedArgs = JSON.parse(editedArgsById[approval.id] ?? "{}");

      if (!parsedArgs || typeof parsedArgs !== "object" || Array.isArray(parsedArgs)) {
        throw new Error("Edited arguments must be a JSON object.");
      }

      await onResolve(approval.id, {
        editedArgs: parsedArgs,
        status: "edited",
      });
    } catch (error) {
      setErrorById((errors) => ({
        ...errors,
        [approval.id]: error instanceof Error ? error.message : "Edited arguments must be valid JSON.",
      }));
    }
  }

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
          <label className="approval-edit-label" htmlFor={`approval-edit-${approval.id}`}>
            Edit arguments
          </label>
          <textarea
            id={`approval-edit-${approval.id}`}
            value={editedArgsById[approval.id] ?? "{}"}
            spellCheck={false}
            onChange={(event) => updateEditedArgs(approval.id, event.currentTarget.value)}
          />
          {errorById[approval.id] ? <p className="approval-error">{errorById[approval.id]}</p> : null}
          <div className="approval-actions">
            <button type="button" onClick={() => onResolve(approval.id, { status: "approved" })}>
              <Check size={14} aria-hidden="true" />
              <span>Allow</span>
            </button>
            <button type="button" onClick={() => approveEdited(approval)}>
              <PencilLine size={14} aria-hidden="true" />
              <span>Approve edited</span>
            </button>
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

  useEffect(() => {
    const activeTerminalIds = toolCalls.filter((toolCall) => isTerminalToolCall(toolCall) && toolCall.status === "active").map((toolCall) => toolCall.id);

    if (activeTerminalIds.length === 0) {
      return;
    }

    setExpandedToolIds((currentIds) => {
      const nextIds = new Set(currentIds);
      let changed = false;

      for (const id of activeTerminalIds) {
        if (!nextIds.has(id)) {
          nextIds.add(id);
          changed = true;
        }
      }

      return changed ? nextIds : currentIds;
    });
  }, [toolCalls]);

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
    <div className="activity-tool-list" aria-label="Tool calls">
      <h4>
        <span>Tool calls</span>
        <small>{formatToolCallCounts(toolCalls)}</small>
      </h4>
      {toolCalls.map((toolCall, index) => {
        const expanded = expandedToolIds.has(toolCall.id) || (isTerminalToolCall(toolCall) && toolCall.status === "active");
        const terminalDetail = formatTerminalToolDetail(toolCall);

        return (
          <article className="activity-tool-call" data-expanded={expanded} data-status={toolCall.status} data-terminal={isTerminalToolCall(toolCall)} key={`${toolCall.id}-${index}`}>
            <button className="activity-tool-call-header" type="button" aria-expanded={expanded} onClick={() => toggleToolCall(toolCall.id)}>
              <ProgressIcon status={toolStatusToProgressStatus(toolCall.status)} />
              <span>
                <strong>{index + 1}. {toolCall.label}</strong>
                {toolCall.detail ? <small>{toolCall.detail}</small> : null}
                {terminalDetail ? <small>{terminalDetail}</small> : null}
              </span>
              {isTerminalToolCall(toolCall) ? <TerminalSquare size={15} aria-hidden="true" /> : null}
              {expanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
            </button>
            {toolCall.input ? <ToolCallTextBlock content={toolCall.input} expanded={expanded} label="Input" /> : null}
            {toolCall.output ? (
              <ToolCallTextBlock
                content={toolCall.output}
                expanded={expanded}
                label={isTerminalToolCall(toolCall) ? (toolCall.status === "active" ? "Live terminal output" : "Terminal output") : "Output"}
                live={isTerminalToolCall(toolCall) && toolCall.status === "active"}
              />
            ) : isTerminalToolCall(toolCall) && expanded && toolCall.status === "active" ? (
              <ToolCallTextBlock content="Waiting for terminal output..." expanded label="Live terminal output" live />
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function ToolCallTextBlock({ content, expanded, label, live = false }: { content: string; expanded: boolean; label: string; live?: boolean }) {
  return (
    <div className="activity-tool-text-block" data-expanded={expanded}>
      <span>{label}</span>
      <pre aria-atomic="false" aria-live={live ? "polite" : undefined}>{expanded ? content : limitActivityText(content)}</pre>
    </div>
  );
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

function getVisibleThinkingTraceSegments(content: string | undefined, live: boolean) {
  const trimmedContent = content?.trim() ?? "";

  if (!trimmedContent) {
    return {
      hiddenCount: 0,
      segments: [] as string[],
      trimmed: false,
    };
  }

  const maxChars = live ? MAX_LIVE_TRACE_CHARS : MAX_ACTIVITY_TRACE_CHARS;
  const limitedContent = trimmedContent.length > maxChars ? trimmedContent.slice(-maxChars) : trimmedContent;
  const segments = splitThinkingContent(limitedContent);
  const visibleSegments = segments.slice(-MAX_ACTIVITY_TRACE_SEGMENTS);

  return {
    hiddenCount: Math.max(segments.length - visibleSegments.length, 0),
    segments: visibleSegments,
    trimmed: trimmedContent.length > limitedContent.length,
  };
}

function formatHiddenTraceLabel(hiddenCount: number, trimmed: boolean) {
  const parts = [];

  if (trimmed) {
    parts.push("Earlier reasoning was trimmed from this live panel");
  }

  if (hiddenCount > 0) {
    parts.push(`${hiddenCount} older note${hiddenCount === 1 ? "" : "s"} hidden`);
  }

  return `${parts.join("; ")}.`;
}

function limitActivityText(content: string, maxChars = MAX_ACTIVITY_TOOL_TEXT_CHARS) {
  if (content.length <= maxChars) {
    return content;
  }

  return `${content.slice(0, maxChars)}\n[Trimmed in Activity for responsiveness.]`;
}

function getActivityDetailLabel(message: ChatMessage, isActivityLive: boolean, isWritingResponse: boolean, isPlanning: boolean) {
  if (isPlanning) {
    const maxPasses = message.planning?.maxPasses;
    const passCount = message.planning?.passCount ?? 0;
    const inputRequest = getPlanningInputRequests(message).find((request) => !request.answeredAt) ?? message.planning?.inputRequest;

    if (message.status === "error") {
      return "Needs attention";
    }

    if (inputRequest && !inputRequest.answeredAt) {
      return "Waiting for your answers";
    }

    if (isActivityLive) {
      return inputRequest?.answeredAt ? "Using your answers" : maxPasses ? `Pass ${Math.max(passCount, 1)} of ${maxPasses}` : "Building the plan";
    }

    return maxPasses ? `${passCount} of ${maxPasses} passes used` : "Plan ready";
  }

  if (message.webSearch?.enabled) {
    if (message.webSearch.status === "active") {
      return "Searching DuckDuckGo";
    }

    if (message.webSearch.status === "error") {
      return "DuckDuckGo search failed";
    }

    if (isWritingResponse || isActivityLive) {
      return `${formatSourceCount(message.webSearch.resultCount)} ready; writing response`;
    }

    return `${formatSourceCount(message.webSearch.resultCount)} from DuckDuckGo`;
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

function formatPlanningFooter(message: ChatMessage) {
  const maxPasses = message.planning?.maxPasses;
  const passCount = message.planning?.passCount ?? 0;

  return maxPasses ? `Plan mode - ${passCount}/${maxPasses} passes` : "Plan mode";
}

function formatWebSearchFooter(message: ChatMessage) {
  if (message.webSearch?.status === "error") {
    return "DuckDuckGo - search failed";
  }

  return `DuckDuckGo - ${formatSourceCount(message.webSearch?.resultCount)}`;
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

function RailSection({ items, title }: RailSectionProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="rail-card rail-card-compact">
      <div className="rail-heading">
        <h2>{title}</h2>
      </div>
      <div className="rail-row-list rail-card-scroll">
        {items.map((item) => {
          const Icon = item.icon;

          if (item.url) {
            return (
              <a className="rail-row rail-row-stacked" href={item.url} key={`${title}-${item.url}`} rel="noreferrer" target="_blank">
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
    sourceItems: getSourceItems(chat),
  };
}

function getLatestActivityMessage(chat: ChatSummary) {
  return [...chat.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        Boolean(
            message.reasoning?.trim() ||
            message.approvals?.some((approval) => approval.status === "pending") ||
            message.toolCalls?.length ||
            message.planning?.startedAt ||
            message.planning?.completedAt ||
            message.thinking?.startedAt ||
            message.thinking?.completedAt ||
            message.webSearch?.enabled ||
            message.isStreaming,
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

  return "Skipped";
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
    url: artifact.url,
  }));
}

function getSourceItems(chat: ChatSummary): RailItem[] {
  const assistantMessages = [...chat.messages].reverse().filter((message) => message.role === "assistant");
  const messageWithExplicitSources = assistantMessages.find((message) => message.sources?.length);

  if (messageWithExplicitSources?.sources?.length) {
    return messageWithExplicitSources.sources.slice(0, MAX_RAIL_ITEMS).map((source) => ({
      detail: source.detail ?? source.url,
      icon: Globe2,
      label: cleanInlineText(source.title),
      url: source.url,
    }));
  }

  for (const message of assistantMessages) {
    const sources = extractWebSources(message.content);

    if (sources.length > 0) {
      return sources.slice(0, MAX_RAIL_ITEMS);
    }
  }

  return [];
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

function extractWebSources(content: string): RailItem[] {
  const sources = new Map<string, RailItem>();
  const body = stripCodeFences(limitTextForScan(content, MAX_SOURCE_SCAN_CHARS));
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  const bareUrlPattern = /(^|[\s(])(https?:\/\/[^\s<>)]+)/gi;

  for (const match of body.matchAll(markdownLinkPattern)) {
    addSource(sources, match[2], match[1]);
  }

  for (const match of body.matchAll(bareUrlPattern)) {
    addSource(sources, match[2]);
  }

  return [...sources.values()];
}

function limitTextForScan(content: string, maxChars: number) {
  if (content.length <= maxChars) {
    return content;
  }

  const headChars = Math.floor(maxChars * 0.58);
  const tailChars = maxChars - headChars;
  return `${content.slice(0, headChars)}\n\n${content.slice(-tailChars)}`;
}

function addSource(sources: Map<string, RailItem>, rawUrl: string, label?: string) {
  const url = normalizeSourceUrl(rawUrl);

  if (!url || !isExternalWebUrl(url) || sources.has(url)) {
    return;
  }

  sources.set(url, {
    detail: formatUrlDetail(url),
    icon: Globe2,
    label: cleanInlineText(label || formatUrlHost(url)),
    url,
  });
}

function normalizeSourceUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim().replace(/[.,;:!?]+$/g, "");

  try {
    return new URL(trimmedUrl).href;
  } catch {
    return "";
  }
}

function isExternalWebUrl(url: string) {
  try {
    const { hostname, protocol } = new URL(url);
    const host = hostname.toLowerCase();

    return (
      (protocol === "http:" || protocol === "https:") &&
      host !== "localhost" &&
      host !== "0.0.0.0" &&
      host !== "127.0.0.1" &&
      host !== "::1" &&
      !host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function formatUrlDetail(url: string) {
  try {
    const parsedUrl = new URL(url);
    return `${parsedUrl.hostname}${parsedUrl.pathname === "/" ? "" : parsedUrl.pathname}`;
  } catch {
    return url;
  }
}

function formatUrlHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
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
