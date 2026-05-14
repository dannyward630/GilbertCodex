import { Ban, Check, FileCode2, FileText, Globe2, Image, LoaderCircle, Pin, SendHorizontal, X } from "lucide-react";
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

const MAX_RAIL_ITEMS = Number.POSITIVE_INFINITY;

interface RailItem {
  detail: string;
  download?: string;
  icon: LucideIcon;
  label: string;
  url?: string;
}

interface RightRailProps {
  chat: ChatSummary;
  onClose?: () => void;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onSubmitPlanningInput?: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
}

export function RightRail({ chat, onClose, onResolveToolApproval, onSubmitPlanningInput }: RightRailProps) {
  const { artifactItems, reviewMessage } = useMemo(() => getRightRailContent(chat), [chat]);

  return (
    <aside className="right-rail" data-mode={reviewMessage ? "review" : "inspector"} aria-label="Conversation details">
      {reviewMessage ? (
        <ReviewRailCard
          message={reviewMessage}
          onClose={onClose}
          onResolveToolApproval={onResolveToolApproval}
          onSubmitPlanningInput={onSubmitPlanningInput}
        />
      ) : null}
      <RailSection items={artifactItems} title="Artifacts" />
    </aside>
  );
}

export function chatHasRightRailContent(chat: ChatSummary) {
  const { artifactItems, reviewMessage } = getRightRailContent(chat);

  return Boolean(reviewMessage || artifactItems.length > 0);
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
        <article className="approval-card" data-risk={approval.risk} key={approval.id}>
          <div className="approval-card-header">
            <span>
              <strong>{approval.title}</strong>
              <small>{approval.detail ?? approval.kind}</small>
            </span>
            <b>{approval.risk}</b>
          </div>
          {approval.preview ? <pre>{limitPreviewText(approval.preview, 1600)}</pre> : null}
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
