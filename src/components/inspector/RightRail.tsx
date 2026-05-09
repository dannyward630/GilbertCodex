import { Circle, CircleCheck, FileCode2, FileText, Globe2, Image, LoaderCircle, Pin, SendHorizontal, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatThinkingDuration, splitThinkingContent } from "../../lib/thinkingActivity";
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
const MAX_ACTIVITY_TOOL_CALLS = 12;
const MAX_ACTIVITY_TOOL_TEXT_CHARS = 2_400;
const MAX_ACTIVITY_TRACE_CHARS = 24_000;
const MAX_ACTIVITY_TRACE_SEGMENTS = 8;
const MAX_LIVE_TRACE_CHARS = 8_000;
const MAX_PLANNING_MINI_ITEMS = 8;
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
  onSubmitPlanningInput?: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
}

export function RightRail({ chat, hasActivity = false, onClose, onSubmitPlanningInput }: RightRailProps) {
  const { activityMessage, artifactItems, progressItems, sourceItems } = useMemo(() => getRightRailContent(chat), [chat]);
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
      {activityMessage ? <ActivityCard message={activityMessage} now={now} onClose={onClose} onSubmitPlanningInput={onSubmitPlanningInput} /> : null}
      {progressItems.length > 0 ? <ProgressSection items={progressItems} /> : null}
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

      return (
        message.role === "assistant" &&
        Boolean(
            (message.isStreaming || hasPendingPlanningInput) &&
            (message.planning?.startedAt ||
              message.thinking?.startedAt ||
              message.webSearch?.status === "active" ||
              message.reasoning?.trim() ||
              message.progress?.length ||
              parseTaskList(message.content).length),
        )
      );
    },
  );
}

interface ActivityCardProps {
  message: ChatMessage;
  now: number;
  onClose?: () => void;
  onSubmitPlanningInput?: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
}

function ActivityCard({ message, now, onClose, onSubmitPlanningInput }: ActivityCardProps) {
  const isPlanning = message.mode === "plan" || Boolean(message.planning) || Boolean(message.progress?.some((item) => item.id?.startsWith("plan-")));
  const isWebSearch = !isPlanning && Boolean(message.webSearch?.enabled);
  const isActivityLive = Boolean(
    message.planning
      ? !message.planning.completedAt
      : message.thinking
        ? !message.thinking.completedAt
        : message.webSearch?.status === "active"
          ? true
          : message.isStreaming,
  );
  const isWritingResponse = Boolean(message.isStreaming && !isActivityLive);
  const startedAt = message.planning?.startedAt ?? message.thinking?.startedAt ?? message.createdAt;
  const completedAt = isActivityLive ? undefined : message.planning?.completedAt ?? message.thinking?.completedAt ?? message.createdAt;
  const duration = formatThinkingDuration(startedAt, completedAt, now);
  const { hiddenCount: hiddenTraceCount, segments: traceSegments, trimmed: traceTrimmed } = getVisibleThinkingTraceSegments(message.reasoning, isActivityLive);
  const hasTrace = traceSegments.length > 0;
  const activityName = isPlanning ? "Planning" : isWebSearch ? "Web + thinking" : "Thinking";
  const statusLabel = isActivityLive ? activityName : isPlanning ? `Planned for ${duration}` : isWebSearch ? `Searched web in ${duration}` : `Thought for ${duration}`;
  const detailLabel = getActivityDetailLabel(message, isActivityLive, isWritingResponse, isPlanning);
  const inputRequests = getPlanningInputRequests(message);
  const inputRequest = inputRequests.find((request) => !request.answeredAt);
  const answeredInputRequests = inputRequests.filter((request) => request.answeredAt);
  const inputPending = Boolean(inputRequest && !inputRequest.answeredAt);

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

        {isPlanning && message.progress?.length ? <PlanningProgressMini items={message.progress} /> : null}

        {inputRequest && inputPending && onSubmitPlanningInput ? (
          <PlanningInputPanel request={inputRequest} onSubmit={(answers) => onSubmitPlanningInput(message.id, answers)} />
        ) : null}

        {answeredInputRequests.map((answeredRequest) => (
          <PlanningInputSummary key={answeredRequest.id} request={answeredRequest} />
        ))}

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

function ToolCallList({ toolCalls }: { toolCalls: ChatToolCall[] }) {
  const visibleToolCalls = toolCalls.slice(0, MAX_ACTIVITY_TOOL_CALLS);
  const hiddenToolCount = toolCalls.length - visibleToolCalls.length;

  return (
    <div className="activity-tool-list" aria-label="Tool calls">
      <h4>
        <span>Tool calls</span>
        <small>{formatToolCallCounts(toolCalls)}</small>
      </h4>
      {visibleToolCalls.map((toolCall, index) => (
        <article className="activity-tool-call" data-status={toolCall.status} key={`${toolCall.id}-${index}`}>
          <div>
            <ProgressIcon status={toolStatusToProgressStatus(toolCall.status)} />
            <span>
              <strong>{index + 1}. {toolCall.label}</strong>
              {toolCall.detail ? <small>{toolCall.detail}</small> : null}
            </span>
          </div>
          {toolCall.input ? <pre>{limitActivityText(toolCall.input)}</pre> : null}
          {toolCall.output ? <pre>{limitActivityText(toolCall.output)}</pre> : null}
        </article>
      ))}
      {hiddenToolCount > 0 ? (
        <article className="activity-tool-call" data-status="skipped">
          <div>
            <ProgressIcon status="pending" />
            <span>
              <strong>{hiddenToolCount} more tool calls hidden</strong>
              <small>Kept out of the live panel for responsiveness.</small>
            </span>
          </div>
        </article>
      ) : null}
    </div>
  );
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

function limitActivityText(content: string) {
  if (content.length <= MAX_ACTIVITY_TOOL_TEXT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_ACTIVITY_TOOL_TEXT_CHARS)}\n[Trimmed in Activity for responsiveness.]`;
}

function getActivityDetailLabel(message: ChatMessage, isActivityLive: boolean, isWritingResponse: boolean, isPlanning: boolean) {
  if (isPlanning) {
    const maxPasses = message.planning?.maxPasses;
    const passCount = message.planning?.passCount ?? 0;
    const inputRequest = getPlanningInputRequests(message).find((request) => !request.answeredAt) ?? message.planning?.inputRequest;

    if (message.status === "error") {
      return "Stopped with an error";
    }

    if (inputRequest && !inputRequest.answeredAt) {
      return "Waiting for your answers";
    }

    if (isActivityLive) {
      const activeProgress = message.progress?.find((item) => item.status === "active");

      if (activeProgress?.detail) {
        return `${activeProgress.label}: ${activeProgress.detail}`;
      }

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
    return "Stopped with an error";
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

function PlanningProgressMini({ items }: { items: NonNullable<ChatMessage["progress"]> }) {
  const visibleItems = items.slice(0, MAX_PLANNING_MINI_ITEMS);
  const hiddenCount = items.length - visibleItems.length;

  return (
    <div className="planning-mini-progress" aria-label="Planning progress">
      {visibleItems.map((item) => (
        <span data-status={item.status} key={item.id ?? `${item.label}-${item.detail}`}>
          <ProgressIcon status={item.status} />
          <span>
            <strong>{item.label}</strong>
            {item.detail ? <small>{item.detail}</small> : null}
          </span>
        </span>
      ))}
      {hiddenCount > 0 ? (
        <span data-status="pending">
          <ProgressIcon status="pending" />
          <span>
            <strong>{hiddenCount} more</strong>
            <small>Hidden while live</small>
          </span>
        </span>
      ) : null}
    </div>
  );
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
            message.toolCalls?.length ||
            message.planning?.startedAt ||
            message.planning?.completedAt ||
            message.thinking?.startedAt ||
            message.thinking?.completedAt ||
            message.webSearch?.enabled ||
            message.progress?.length ||
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

  const messageWithProgress = assistantMessages.find((message) => message.progress?.length);

  if (messageWithProgress?.progress?.length) {
    return messageWithProgress.progress.slice(0, MAX_PROGRESS_ITEMS).map((item, index) => ({
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

function createToolProgressItems(message: ChatMessage): ProgressRailItem[] {
  const toolCalls = message.toolCalls ?? [];
  const summary = createToolProgressSummary(message, toolCalls);
  const visibleToolCount = Math.max(MAX_PROGRESS_ITEMS - 1, 0);
  const toolItems = toolCalls.slice(0, visibleToolCount).map((toolCall, index) => ({
    detail: formatToolProgressDetail(toolCall),
    id: `progress-${message.id}-${toolCall.id}-${index}`,
    label: `${index + 1}. ${toolCall.label}`,
    status: toolStatusToProgressStatus(toolCall.status),
  }));
  const hiddenCount = toolCalls.length - toolItems.length;

  if (hiddenCount <= 0) {
    return [summary, ...toolItems];
  }

  return [
    summary,
    ...toolItems,
    {
      detail: `${hiddenCount} more tool calls are visible in Activity`,
      id: `progress-${message.id}-tool-overflow`,
      label: "More agent tools",
      status: "pending",
    },
  ];
}

function createToolProgressSummary(message: ChatMessage, toolCalls: ChatToolCall[]): ProgressRailItem {
  const activeCount = countToolCallsByStatus(toolCalls, "active");
  const completeCount = countToolCallsByStatus(toolCalls, "complete");
  const errorCount = countToolCallsByStatus(toolCalls, "error");
  const skippedCount = countToolCallsByStatus(toolCalls, "skipped");
  const blockedCount = errorCount + skippedCount;
  const status = activeCount > 0 ? "active" : completeCount > 0 ? "complete" : "pending";
  const countParts = [
    `${toolCalls.length} total`,
    activeCount > 0 ? `${activeCount} running` : "",
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
  return [formatToolStatus(toolCall.status), toolCall.detail].filter(Boolean).join(" | ");
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
  return effort.charAt(0).toUpperCase() + effort.slice(1);
}
