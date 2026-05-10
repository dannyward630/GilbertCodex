import { Check, GitBranch, LoaderCircle, PencilLine, Sparkles, X } from "lucide-react";
import { useState } from "react";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatMessage } from "../../types/chat";
import { MarkdownMessage } from "./MarkdownMessage";

interface PlanReviewCardProps {
  content: string;
  isStreaming?: boolean;
  message: ChatMessage;
  onOpenActivity?: () => void;
  onRequestRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onResolvePlanApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
}

export function PlanReviewCard({ content, isStreaming, message, onOpenActivity, onRequestRevision, onResolvePlanApproval }: PlanReviewCardProps) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [acceptingPlan, setAcceptingPlan] = useState(false);
  const planApproval = message.approvals?.find((approval) => approval.tool === "planning_handoff");
  const pendingPlanApproval = planApproval?.status === "pending" ? planApproval : undefined;
  const acceptedPlan = planApproval?.status === "approved" || planApproval?.status === "edited";
  const supersededPlan = planApproval?.status === "denied" || planApproval?.status === "expired" || message.agentRunStatus === "cancelled";
  const passLabel = message.planning ? `${message.planning.passCount}/${message.planning.maxPasses} passes` : "Plan";
  const stateLabel = isStreaming
    ? "Building plan"
    : pendingPlanApproval
      ? "Ready for review"
      : acceptedPlan
        ? "Accepted"
        : supersededPlan
          ? "Superseded"
          : message.status === "error"
            ? "Needs attention"
            : "Plan ready";
  const canAccept = Boolean(pendingPlanApproval && onResolvePlanApproval && !acceptingPlan && !submittingRevision);
  const canRequestRevision = Boolean(onRequestRevision && !isStreaming && !submittingRevision && !acceptingPlan);
  const trimmedFeedback = revisionFeedback.trim();

  async function acceptPlan() {
    if (!pendingPlanApproval || !onResolvePlanApproval || acceptingPlan) {
      return;
    }

    setAcceptingPlan(true);
    try {
      await onResolvePlanApproval(message.id, pendingPlanApproval.id, { status: "approved" });
    } finally {
      setAcceptingPlan(false);
    }
  }

  async function submitRevision() {
    if (!onRequestRevision || !trimmedFeedback || submittingRevision || acceptingPlan) {
      return;
    }

    setSubmittingRevision(true);
    try {
      await onRequestRevision(message.id, trimmedFeedback);
      setRevisionFeedback("");
      setRevisionOpen(false);
    } finally {
      setSubmittingRevision(false);
    }
  }

  return (
    <section className="plan-review-card" data-state={pendingPlanApproval ? "pending" : acceptedPlan ? "accepted" : supersededPlan ? "superseded" : isStreaming ? "streaming" : "ready"}>
      <div className="plan-review-header">
        <span className="plan-review-icon" aria-hidden="true">
          {isStreaming ? <LoaderCircle size={18} /> : acceptedPlan ? <Check size={18} /> : supersededPlan ? <X size={18} /> : <Sparkles size={18} />}
        </span>
        <span className="plan-review-title">
          <strong>{stateLabel}</strong>
          <small>{passLabel}</small>
        </span>
        <button className="plan-review-activity" type="button" aria-label="Open activity" title="Open activity" onClick={onOpenActivity}>
          <GitBranch size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="plan-review-body">
        {content.trim() ? (
          <MarkdownMessage content={content} isStreaming={isStreaming} />
        ) : (
          <div className="plan-review-skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      {pendingPlanApproval || revisionOpen ? (
        <div className="plan-review-actions">
          {pendingPlanApproval ? (
            <button className="plan-review-primary" type="button" data-loading={acceptingPlan ? "true" : undefined} disabled={!canAccept} onClick={acceptPlan}>
              {acceptingPlan ? <LoaderCircle size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
              <span>{acceptingPlan ? "Starting" : "Accept plan"}</span>
            </button>
          ) : null}
          {canRequestRevision ? (
            <button className="plan-review-secondary" type="button" onClick={() => setRevisionOpen((open) => !open)}>
              <PencilLine size={15} aria-hidden="true" />
              <span>{revisionOpen ? "Close feedback" : "Ask for changes"}</span>
            </button>
          ) : null}
        </div>
      ) : null}

      {revisionOpen ? (
        <div className="plan-review-feedback">
          <textarea
            aria-label="Plan feedback"
            placeholder="Tell Gilbert Codex what to change in the plan..."
            rows={3}
            value={revisionFeedback}
            onChange={(event) => setRevisionFeedback(event.currentTarget.value)}
          />
          <button type="button" data-loading={submittingRevision ? "true" : undefined} disabled={!trimmedFeedback || submittingRevision || acceptingPlan} onClick={submitRevision}>
            {submittingRevision ? <LoaderCircle size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            <span>{submittingRevision ? "Reworking" : "Rework plan"}</span>
          </button>
        </div>
      ) : null}
    </section>
  );
}
