import { Ban, CalendarDays, Check, FileCode2, FileText, Globe2, Image, LoaderCircle, Mail, Pencil, Pin, Save, SendHorizontal, Sparkles, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentApproval, AgentApprovalDecision } from "../../types/agentRun";
import type {
  ChatArtifactKind,
  ChatMessage,
  ChatPlanningInputAnswer,
  ChatPlanningInputRequest,
  ChatPlanningQuestion,
  ChatSummary,
} from "../../types/chat";
import { PlanReviewPanel } from "./PlanReviewPanel";

const MAX_RAIL_ITEMS = Number.POSITIVE_INFINITY;

interface RailItem {
  detail: string;
  download?: string;
  icon: LucideIcon;
  label: string;
  url?: string;
}

interface RightRailProps {
  /** When set, the rail renders the plan-review panel for this message. */
  activePlanReviewMessageId?: string | null;
  chat: ChatSummary;
  planReviewExpanded?: boolean;
  onClose?: () => void;
  onRequestPlanRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onSubmitPlanningInput?: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
  onTogglePlanReviewExpanded?: () => void;
}

export function RightRail({
  activePlanReviewMessageId,
  chat,
  planReviewExpanded = false,
  onClose,
  onRequestPlanRevision,
  onResolveToolApproval,
  onSubmitPlanningInput,
  onTogglePlanReviewExpanded,
}: RightRailProps) {
  const { artifactItems, reviewMessage } = useMemo(() => getRightRailContent(chat), [chat]);
  const planReviewMessage = useMemo(() => {
    if (!activePlanReviewMessageId) return undefined;
    return chat.messages.find((message) => message.id === activePlanReviewMessageId && message.role === "assistant");
  }, [activePlanReviewMessageId, chat.messages]);

  // Plan-review mode wins over review/inspector when an explicit message is
  // selected. This preserves the inline "Open full plan" → side-panel flow.
  const railMode: "plan-review" | "review" | "inspector" = planReviewMessage
    ? "plan-review"
    : reviewMessage
      ? "review"
      : "inspector";

  return (
    <aside className="right-rail" data-mode={railMode} aria-label="Conversation details">
      {planReviewMessage ? (
        <PlanReviewPanel
          expanded={planReviewExpanded}
          message={planReviewMessage}
          onClose={onClose}
          onRequestRevision={onRequestPlanRevision}
          onResolvePlanApproval={onResolveToolApproval}
          onToggleExpanded={onTogglePlanReviewExpanded}
        />
      ) : reviewMessage ? (
        <ReviewRailCard
          message={reviewMessage}
          onClose={onClose}
          onResolveToolApproval={onResolveToolApproval}
          onSubmitPlanningInput={onSubmitPlanningInput}
        />
      ) : null}
      {!planReviewMessage ? <RailSection items={artifactItems} title="Artifacts" /> : null}
    </aside>
  );
}

export function chatHasRightRailContent(chat: ChatSummary) {
  const { artifactItems, reviewMessage } = getRightRailContent(chat);

  return Boolean(reviewMessage || artifactItems.length > 0);
}

export function chatHasPlanReviewContent(chat: ChatSummary, messageId?: string | null) {
  if (messageId) {
    const message = chat.messages.find((candidate) => candidate.id === messageId);
    return Boolean(message && isPlanReviewMessage(message));
  }

  return chat.messages.some(isPlanReviewMessage);
}

export function chatHasPendingRightRailAction(chat: ChatSummary) {
  return chat.messages.some((message) => message.role === "assistant" && hasPendingReviewAction(message));
}

interface ReviewRailCardProps {
  message: ChatMessage;
  onClose?: () => void;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onSubmitPlanningInput?: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
}

function ReviewRailCard({ message, onClose, onResolveToolApproval, onSubmitPlanningInput }: ReviewRailCardProps) {
  const inputRequests = getPlanningInputRequests(message);
  const inputRequest = inputRequests.find((request) => !request.answeredAt);
  const answeredInputRequests = inputRequests.filter((request) => request.answeredAt);
  const pendingApprovals = (message.approvals ?? []).filter((approval) => approval.status === "pending");
  const hasApprovals = pendingApprovals.length > 0;
  const title = hasApprovals ? "Approval needed" : "Planning question";
  const subtitle = hasApprovals
    ? pendingApprovals.length === 1
      ? "Review 1 request to continue"
      : `Review ${pendingApprovals.length} requests to continue`
    : inputRequest?.detail ?? "Answer to continue planning";

  return (
    <section className="review-card" aria-labelledby="review-panel-title">
      <div className="review-card-header">
        <span>
          <h2 id="review-panel-title">{title}</h2>
          <small>{subtitle}</small>
        </span>
        <button className="rail-close" type="button" aria-label="Close review panel" onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </div>

      <div className="review-card-body">
        {inputRequest && onSubmitPlanningInput ? (
          <PlanningInputPanel request={inputRequest} onSubmit={(answers) => onSubmitPlanningInput(message.id, answers)} />
        ) : null}

        {answeredInputRequests.map((answeredRequest) => (
          <PlanningInputSummary key={answeredRequest.id} request={answeredRequest} />
        ))}

        {pendingApprovals.length > 0 && onResolveToolApproval ? (
          <ApprovalPanel approvals={pendingApprovals} onResolve={(approvalId, decision) => onResolveToolApproval(message.id, approvalId, decision)} />
        ) : null}
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
  return (
    <div className="approval-list" aria-label="Pending approvals">
      <h4>
        <span>Approvals</span>
        <small>{approvals.length} pending</small>
      </h4>
      {approvals.map((approval) => (
        <ApprovalCard approval={approval} key={approval.id} onResolve={onResolve} />
      ))}
    </div>
  );
}

type ApprovalEditMode = "manual" | "request" | null;

function ApprovalCard({
  approval,
  onResolve,
}: {
  approval: AgentApproval;
  onResolve: (approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
}) {
  const display = getApprovalDisplay(approval);
  const Icon = display.icon;
  const [editMode, setEditMode] = useState<ApprovalEditMode>(null);
  const [argsText, setArgsText] = useState(() => formatApprovalArgs(approval.args));
  const [editRequest, setEditRequest] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const connectedAppApproval = isConnectedAppApproval(approval);
  const canAllowSession = approval.tool !== "planning_handoff";

  useEffect(() => {
    setArgsText(formatApprovalArgs(approval.args));
    setEditRequest("");
    setEditError(null);
    setEditMode(null);
    setSubmitting(false);
  }, [approval.id, approval.args]);

  async function resolve(decision: AgentApprovalDecision) {
    setSubmitting(true);
    try {
      await onResolve(approval.id, decision);
    } finally {
      setSubmitting(false);
    }
  }

  async function approveEditedArgs() {
    setEditError(null);

    try {
      const parsed = JSON.parse(argsText);

      if (!isRecord(parsed)) {
        setEditError("Edited arguments must be a JSON object.");
        return;
      }

      await resolve({ editedArgs: parsed, status: "edited" });
    } catch {
      setEditError("Edited arguments must be valid JSON.");
    }
  }

  async function requestRevision() {
    const note = editRequest.trim();

    if (!note) {
      setEditError("Add the change you want first.");
      return;
    }

    await resolve({ note, status: "edited" });
  }

  return (
    <article className="approval-card approval-card-rich" data-family={display.family} data-risk={approval.risk}>
      <div className="approval-card-header approval-card-header-rich">
        <span className="approval-card-icon" aria-hidden="true">
          <Icon size={16} />
        </span>
        <span>
          <strong>{approval.title}</strong>
          <small>{display.detail}</small>
        </span>
        <b>{approval.risk}</b>
      </div>

      <ApprovalPreview approval={approval} display={display} />

      {editMode === "manual" ? (
        <div className="approval-editor" data-mode="manual">
          <textarea
            aria-label="Edit approval arguments"
            spellCheck={false}
            value={argsText}
            onChange={(event) => {
              setArgsText(event.target.value);
              setEditError(null);
            }}
          />
          {editError ? <small className="approval-editor-error">{editError}</small> : null}
          <div className="approval-editor-actions">
            <button type="button" disabled={submitting} onClick={() => void approveEditedArgs()}>
              <Save size={14} aria-hidden="true" />
              <span>{getEditedApprovalLabel(approval)}</span>
            </button>
            <button type="button" disabled={submitting} onClick={() => setEditMode(null)}>
              <X size={14} aria-hidden="true" />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      ) : null}

      {editMode === "request" ? (
        <div className="approval-editor" data-mode="request">
          <textarea
            aria-label="Describe approval changes"
            placeholder="Make the email warmer, change Tuesday to Thursday, add the meeting room..."
            value={editRequest}
            onChange={(event) => {
              setEditRequest(event.target.value);
              setEditError(null);
            }}
          />
          {editError ? <small className="approval-editor-error">{editError}</small> : null}
          <div className="approval-editor-actions">
            <button type="button" disabled={submitting} onClick={() => void requestRevision()}>
              <Sparkles size={14} aria-hidden="true" />
              <span>Revise</span>
            </button>
            <button type="button" disabled={submitting} onClick={() => setEditMode(null)}>
              <X size={14} aria-hidden="true" />
              <span>Cancel</span>
            </button>
          </div>
        </div>
      ) : null}

      <div className="approval-actions">
        <button type="button" disabled={submitting} data-primary="true" onClick={() => void resolve({ status: "approved" })}>
          <Check size={14} aria-hidden="true" />
          <span>{getPrimaryApprovalLabel(approval)}</span>
        </button>
        <button type="button" disabled={submitting} data-active={editMode === "manual" ? "true" : undefined} onClick={() => setEditMode((mode) => mode === "manual" ? null : "manual")}>
          <Pencil size={14} aria-hidden="true" />
          <span>Edit</span>
        </button>
        {connectedAppApproval ? (
          <button type="button" disabled={submitting} data-active={editMode === "request" ? "true" : undefined} onClick={() => setEditMode((mode) => mode === "request" ? null : "request")}>
            <Sparkles size={14} aria-hidden="true" />
            <span>Ask Gilbert</span>
          </button>
        ) : null}
        {canAllowSession ? (
          <button
            type="button"
            data-variant="session"
            data-connected-app={connectedAppApproval ? "true" : undefined}
            disabled={submitting}
            title={connectedAppApproval ? "Always allow this Gmail or Google Calendar action type in this chat" : "Allow this tool for this chat"}
            onClick={() => void resolve({ scope: "session", status: "approved" })}
          >
            <Pin size={14} aria-hidden="true" />
            <span>{connectedAppApproval ? "Always allow in chat" : "Allow in chat"}</span>
          </button>
        ) : null}
        <button type="button" disabled={submitting} onClick={() => void resolve({ status: "denied" })}>
          <Ban size={14} aria-hidden="true" />
          <span>Deny</span>
        </button>
      </div>
    </article>
  );
}

interface ApprovalDisplay {
  detail: string;
  family: "calendar" | "gmail" | "other";
  icon: LucideIcon;
}

function ApprovalPreview({ approval, display }: { approval: AgentApproval; display: ApprovalDisplay }) {
  const preview = approval.preview ? parseApprovalPreview(approval.preview) : undefined;

  if (!preview) {
    return approval.detail ? <p className="approval-preview-empty">{approval.detail}</p> : null;
  }

  const Icon = display.icon;

  return (
    <div className="approval-preview" data-family={display.family}>
      <div className="approval-preview-heading">
        <Icon size={15} aria-hidden="true" />
        <span>
          <strong>{preview.title || approval.title}</strong>
          <small>{display.family === "gmail" ? "Gmail action" : display.family === "calendar" ? "Google Calendar action" : approval.kind}</small>
        </span>
      </div>
      {preview.fields.length > 0 ? (
        <dl className="approval-preview-fields">
          {preview.fields.map((field) => (
            <div key={`${field.label}-${field.value}`}>
              <dt>{field.label}</dt>
              <dd>{field.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {preview.body ? (
        <div className="approval-preview-body">
          <small>{display.family === "gmail" ? "Message" : "Notes"}</small>
          <p>{preview.body}</p>
        </div>
      ) : null}
      {preview.raw.length > 0 ? <pre>{preview.raw.join("\n")}</pre> : null}
    </div>
  );
}

function getApprovalDisplay(approval: AgentApproval): ApprovalDisplay {
  if (approval.tool.startsWith("gmail_")) {
    return {
      detail: approval.detail ?? "Review the Gmail action before it runs.",
      family: "gmail",
      icon: Mail,
    };
  }

  if (approval.tool.startsWith("calendar_")) {
    return {
      detail: approval.detail ?? "Review the Google Calendar action before it runs.",
      family: "calendar",
      icon: CalendarDays,
    };
  }

  return {
    detail: approval.detail ?? approval.kind,
    family: "other",
    icon: FileCode2,
  };
}

function getPrimaryApprovalLabel(approval: AgentApproval) {
  if (approval.tool === "gmail_send_message" || approval.tool === "gmail_send_separate_messages" || approval.tool === "gmail_send_draft") {
    return "Send";
  }

  if (approval.tool === "calendar_create_event") {
    return "Create event";
  }

  if (approval.tool === "calendar_update_event") {
    return "Update event";
  }

  if (approval.tool.includes("delete") || approval.tool.includes("trash")) {
    return "Delete";
  }

  return "Allow";
}

function getEditedApprovalLabel(approval: AgentApproval) {
  if (approval.tool.startsWith("gmail_")) {
    return "Use edited email";
  }

  if (approval.tool.startsWith("calendar_")) {
    return "Use edited event";
  }

  return "Use edited args";
}

function isConnectedAppApproval(approval: AgentApproval) {
  return approval.tool.startsWith("gmail_") || approval.tool.startsWith("calendar_");
}

function formatApprovalArgs(args: Record<string, unknown> | undefined) {
  return JSON.stringify(args ?? {}, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseApprovalPreview(value: string) {
  const lines = limitPreviewText(value, 1600)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim());
  const [title = "", ...rest] = lines;
  const fields: Array<{ label: string; value: string }> = [];
  const raw: string[] = [];
  let body = "";

  for (const line of rest) {
    const match = line.match(/^([^:]{2,36}):\s*(.*)$/);

    if (!match) {
      raw.push(line);
      continue;
    }

    const label = match[1].trim();
    const fieldValue = match[2].trim();

    if (/body preview|description|notes?/i.test(label)) {
      body = body ? `${body}\n${fieldValue}` : fieldValue;
      continue;
    }

    fields.push({ label, value: fieldValue });
  }

  return {
    body,
    fields,
    raw,
    title,
  };
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
    artifactItems: getArtifactItems(chat),
    reviewMessage: getLatestReviewMessage(chat),
  };
}

function getLatestReviewMessage(chat: ChatSummary) {
  return [...chat.messages].reverse().find((message) => message.role === "assistant" && hasPendingReviewAction(message));
}

function hasPendingReviewAction(message: ChatMessage) {
  return Boolean(
    message.approvals?.some((approval) => approval.status === "pending") ||
      getPlanningInputRequests(message).some((request) => !request.answeredAt),
  );
}

function isPlanReviewMessage(message: ChatMessage) {
  return Boolean(
    message.role === "assistant" &&
      (message.mode === "plan" ||
        message.planning ||
        message.approvals?.some((approval) => approval.tool === "planning_handoff")),
  );
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

function cleanInlineText(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limitPreviewText(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars).trimEnd()}\n...`;
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
