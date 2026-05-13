import { ArrowRight, Check, ChevronDown, ChevronUp, ClipboardList, LoaderCircle, PencilLine, ShieldOff, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
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

type PlanCardState = "streaming" | "pending" | "accepted" | "denied" | "superseded" | "error" | "ready";

interface PlanCardStateDescriptor {
  description: string;
  label: string;
  state: PlanCardState;
  tone: "info" | "warning" | "success" | "danger" | "muted";
}

export function PlanReviewCard({ content, isStreaming, message, onOpenActivity, onRequestRevision, onResolvePlanApproval }: PlanReviewCardProps) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [acceptingPlan, setAcceptingPlan] = useState(false);
  const [decliningPlan, setDecliningPlan] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const planApproval = message.approvals?.find((approval) => approval.tool === "planning_handoff");
  const pendingPlanApproval = planApproval?.status === "pending" ? planApproval : undefined;
  const acceptedPlan = planApproval?.status === "approved" || planApproval?.status === "edited";
  const deniedPlan = planApproval?.status === "denied";
  const supersededPlan = planApproval?.status === "expired" || message.agentRunStatus === "cancelled";
  const toolCalls = message.toolCalls ?? [];
  const completedToolCount = toolCalls.filter((toolCall) => toolCall.status === "complete").length;
  const activeToolCount = toolCalls.filter((toolCall) => toolCall.status === "active").length;
  const inResearchPhase = isStreaming && (toolCalls.length > 0 || activeToolCount > 0) && !content.trim();

  const descriptor = useMemo<PlanCardStateDescriptor>(() => {
    if (isStreaming) {
      if (inResearchPhase) {
        const detail = activeToolCount > 0
          ? `Inspecting ${completedToolCount + activeToolCount} file${completedToolCount + activeToolCount === 1 ? "" : "s"}...`
          : completedToolCount > 0
            ? `Read ${completedToolCount} file${completedToolCount === 1 ? "" : "s"} so far`
            : "Reading the codebase";
        return {
          description: detail,
          label: "Researching codebase",
          state: "streaming",
          tone: "info",
        };
      }
      return {
        description: "Writing the plan from research",
        label: "Drafting plan",
        state: "streaming",
        tone: "info",
      };
    }

    if (pendingPlanApproval) {
      return {
        description: "Approve to start coding, request changes, or decline.",
        label: "Plan ready for review",
        state: "pending",
        tone: "warning",
      };
    }

    if (deniedPlan) {
      return {
        description: "You declined this plan. Send a new message to retry.",
        label: "Plan declined",
        state: "denied",
        tone: "danger",
      };
    }

    if (acceptedPlan) {
      return {
        description: "Approved. Plan mode is closed and the agent is executing it now.",
        label: "Plan accepted",
        state: "accepted",
        tone: "success",
      };
    }

    if (supersededPlan) {
      return {
        description: "Replaced by a newer plan revision.",
        label: "Plan superseded",
        state: "superseded",
        tone: "muted",
      };
    }

    if (message.status === "error") {
      return {
        description: "Something went wrong while building this plan.",
        label: "Plan failed",
        state: "error",
        tone: "danger",
      };
    }

    return {
      description: "Plan ready",
      label: "Plan ready",
      state: "ready",
      tone: "info",
    };
  }, [acceptedPlan, activeToolCount, completedToolCount, content, deniedPlan, inResearchPhase, isStreaming, message.status, pendingPlanApproval, supersededPlan]);

  const canAccept = Boolean(pendingPlanApproval && onResolvePlanApproval && !acceptingPlan && !submittingRevision && !decliningPlan);
  const canDecline = Boolean(pendingPlanApproval && onResolvePlanApproval && !acceptingPlan && !submittingRevision && !decliningPlan);
  const canRequestRevision = Boolean(onRequestRevision && !isStreaming && !submittingRevision && !acceptingPlan && !decliningPlan && !acceptedPlan && !deniedPlan && !supersededPlan);
  const trimmedFeedback = revisionFeedback.trim();
  const showActions = pendingPlanApproval || revisionOpen;
  const showCollapseToggle = acceptedPlan && content.trim().length > 0;

  async function acceptPlan() {
    if (!pendingPlanApproval || !onResolvePlanApproval || acceptingPlan || decliningPlan || submittingRevision) {
      return;
    }

    setAcceptingPlan(true);
    try {
      await onResolvePlanApproval(message.id, pendingPlanApproval.id, { status: "approved" });
    } finally {
      setAcceptingPlan(false);
    }
  }

  async function declinePlan() {
    if (!pendingPlanApproval || !onResolvePlanApproval || decliningPlan || acceptingPlan || submittingRevision) {
      return;
    }

    setDecliningPlan(true);
    try {
      await onResolvePlanApproval(message.id, pendingPlanApproval.id, { status: "denied" });
    } finally {
      setDecliningPlan(false);
    }
  }

  async function submitRevision() {
    if (!onRequestRevision || !trimmedFeedback || submittingRevision || acceptingPlan || decliningPlan) {
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

  const headerIcon = isStreaming ? (
    <LoaderCircle size={18} aria-hidden="true" />
  ) : descriptor.state === "accepted" ? (
    <Check size={18} aria-hidden="true" />
  ) : descriptor.state === "denied" || descriptor.state === "superseded" || descriptor.state === "error" ? (
    <X size={18} aria-hidden="true" />
  ) : (
    <ClipboardList size={18} aria-hidden="true" />
  );

  const bodyVisible = !collapsed || !acceptedPlan;
  const bodyContent = content.trim();

  return (
    <section className="plan-review-card" data-state={descriptor.state} data-tone={descriptor.tone}>
      <header className="plan-review-header">
        <span className="plan-review-icon" aria-hidden="true">
          {headerIcon}
        </span>
        <div className="plan-review-title">
          <span className="plan-review-eyebrow">
            <Sparkles size={11} aria-hidden="true" />
            Plan mode
          </span>
          <strong>{descriptor.label}</strong>
          <small>{descriptor.description}</small>
        </div>
        <div className="plan-review-meta">
          {onOpenActivity ? (
            <button className="plan-review-activity" type="button" aria-label="Open plan activity" title="Open activity" onClick={onOpenActivity}>
              <span className="plan-review-activity-label">Activity</span>
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : null}
          {showCollapseToggle ? (
            <button
              className="plan-review-collapse"
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Show approved plan" : "Hide approved plan"}
              onClick={() => setCollapsed((current) => !current)}
            >
              {collapsed ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
            </button>
          ) : null}
        </div>
      </header>

      {bodyVisible ? (
        <div className="plan-review-body">
          {bodyContent ? (
            <MarkdownMessage content={bodyContent} isStreaming={isStreaming} />
          ) : (
            <div className="plan-review-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      ) : null}

      {showActions ? (
        <footer className="plan-review-actions" aria-label="Plan decisions">
          {pendingPlanApproval ? (
            <>
              <button
                className="plan-review-decline"
                type="button"
                data-loading={decliningPlan ? "true" : undefined}
                disabled={!canDecline}
                onClick={declinePlan}
              >
                {decliningPlan ? <LoaderCircle size={15} aria-hidden="true" /> : <ShieldOff size={15} aria-hidden="true" />}
                <span>{decliningPlan ? "Cancelling" : "Decline"}</span>
              </button>
              {canRequestRevision ? (
                <button className="plan-review-secondary" type="button" data-active={revisionOpen ? "true" : undefined} onClick={() => setRevisionOpen((open) => !open)}>
                  <PencilLine size={15} aria-hidden="true" />
                  <span>{revisionOpen ? "Close feedback" : "Ask for changes"}</span>
                </button>
              ) : null}
              <button
                className="plan-review-primary"
                type="button"
                data-loading={acceptingPlan ? "true" : undefined}
                disabled={!canAccept}
                onClick={acceptPlan}
              >
                {acceptingPlan ? <LoaderCircle size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}
                <span>{acceptingPlan ? "Starting" : "Accept & start"}</span>
                {!acceptingPlan ? <ArrowRight size={14} aria-hidden="true" /> : null}
              </button>
            </>
          ) : canRequestRevision ? (
            <button className="plan-review-secondary" type="button" data-active={revisionOpen ? "true" : undefined} onClick={() => setRevisionOpen((open) => !open)}>
              <PencilLine size={15} aria-hidden="true" />
              <span>{revisionOpen ? "Close feedback" : "Ask for changes"}</span>
            </button>
          ) : null}
        </footer>
      ) : null}

      {revisionOpen ? (
        <div className="plan-review-feedback">
          <textarea
            aria-label="Plan feedback"
            placeholder="Tell Gilbert Codex what to change. For example: drop the migration step, focus on the UI..."
            rows={3}
            value={revisionFeedback}
            onChange={(event) => setRevisionFeedback(event.currentTarget.value)}
          />
          <div className="plan-review-feedback-actions">
            <span className="plan-review-feedback-hint">A new plan will replace this one.</span>
            <button type="button" data-loading={submittingRevision ? "true" : undefined} disabled={!trimmedFeedback || submittingRevision || acceptingPlan || decliningPlan} onClick={submitRevision}>
              {submittingRevision ? <LoaderCircle size={15} aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
              <span>{submittingRevision ? "Reworking" : "Rework plan"}</span>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
