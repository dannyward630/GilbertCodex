import { ArrowRight, Check, ClipboardList, LoaderCircle, PencilLine, ShieldOff, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { getSavedPlanContent } from "../../lib/planReview";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatMessage } from "../../types/chat";
import { MarkdownMessage } from "./MarkdownMessage";

interface PlanReviewCardProps {
  content: string;
  isStreaming?: boolean;
  message: ChatMessage;
  onOpenFullPlan?: (messageId: string) => void;
  onRequestRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onResolvePlanApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
}

type PlanResponseState = "streaming" | "pending" | "accepted" | "denied" | "superseded" | "error" | "ready";

interface PlanResponseStateDescriptor {
  description: string;
  label: string;
  state: PlanResponseState;
  tone: "info" | "warning" | "success" | "danger" | "muted";
}

export function PlanReviewCard({ content, isStreaming, message, onOpenFullPlan, onRequestRevision, onResolvePlanApproval }: PlanReviewCardProps) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [acceptingPlan, setAcceptingPlan] = useState(false);
  const [decliningPlan, setDecliningPlan] = useState(false);

  const planApproval = message.approvals?.find((approval) => approval.tool === "planning_handoff");
  const pendingPlanApproval = planApproval?.status === "pending" ? planApproval : undefined;
  const acceptedPlan = planApproval?.status === "approved" || planApproval?.status === "edited";
  const deniedPlan = planApproval?.status === "denied";
  const supersededPlan = planApproval?.status === "expired" || message.agentRunStatus === "cancelled";
  const toolCalls = message.toolCalls ?? [];
  const completedToolCount = toolCalls.filter((toolCall) => toolCall.status === "complete").length;
  const activeToolCount = toolCalls.filter((toolCall) => toolCall.status === "active").length;
  const inResearchPhase = isStreaming && (toolCalls.length > 0 || activeToolCount > 0) && !content.trim();
  const planContent = getSavedPlanContent(message) || content.trim();
  const shouldRenderPlanResponse = Boolean(planContent || planApproval);

  const descriptor = useMemo<PlanResponseStateDescriptor>(() => {
    if (isStreaming) {
      if (inResearchPhase) {
        const inspected = completedToolCount + activeToolCount;
        const detail = activeToolCount > 0
          ? `Inspecting ${inspected} file${inspected === 1 ? "" : "s"}...`
          : completedToolCount > 0
            ? `Read ${completedToolCount} file${completedToolCount === 1 ? "" : "s"} so far`
            : "Reading the codebase";
        return { description: detail, label: "Researching codebase", state: "streaming", tone: "info" };
      }
      return { description: "Writing the plan from research", label: "Drafting plan", state: "streaming", tone: "info" };
    }

    if (pendingPlanApproval) {
      return {
        description: "Review it here, ask for changes, or approve it to start.",
        label: "Plan ready for review",
        state: "pending",
        tone: "warning",
      };
    }

    if (deniedPlan) {
      return { description: "You declined this plan. Send a new message to retry.", label: "Plan declined", state: "denied", tone: "danger" };
    }

    if (acceptedPlan) {
      return { description: "Approved. The saved plan stays attached while execution continues.", label: "Plan accepted", state: "accepted", tone: "success" };
    }

    if (supersededPlan) {
      return { description: "Replaced by a newer plan revision.", label: "Plan superseded", state: "superseded", tone: "muted" };
    }

    if (message.status === "error") {
      return { description: "Something went wrong while building this plan.", label: "Plan failed", state: "error", tone: "danger" };
    }

    return { description: "Plan ready", label: "Plan ready", state: "ready", tone: "info" };
  }, [acceptedPlan, activeToolCount, completedToolCount, deniedPlan, inResearchPhase, isStreaming, message.status, pendingPlanApproval, supersededPlan]);

  const canAccept = Boolean(pendingPlanApproval && onResolvePlanApproval && !acceptingPlan && !submittingRevision && !decliningPlan);
  const canDecline = canAccept;
  const canRequestRevision = Boolean(onRequestRevision && !isStreaming && !submittingRevision && !acceptingPlan && !decliningPlan && !acceptedPlan && !deniedPlan && !supersededPlan);
  const trimmedFeedback = revisionFeedback.trim();
  const showActions = Boolean(pendingPlanApproval || revisionOpen);

  if (!shouldRenderPlanResponse) {
    return null;
  }

  async function acceptPlan() {
    if (!pendingPlanApproval || !onResolvePlanApproval || acceptingPlan || decliningPlan || submittingRevision) return;
    setAcceptingPlan(true);
    try {
      await onResolvePlanApproval(message.id, pendingPlanApproval.id, { status: "approved" });
    } finally {
      setAcceptingPlan(false);
    }
  }

  async function declinePlan() {
    if (!pendingPlanApproval || !onResolvePlanApproval || decliningPlan || acceptingPlan || submittingRevision) return;
    setDecliningPlan(true);
    try {
      await onResolvePlanApproval(message.id, pendingPlanApproval.id, { status: "denied" });
    } finally {
      setDecliningPlan(false);
    }
  }

  async function submitRevision() {
    if (!onRequestRevision || !trimmedFeedback || submittingRevision || acceptingPlan || decliningPlan) return;
    setSubmittingRevision(true);
    try {
      await onRequestRevision(message.id, trimmedFeedback);
      setRevisionFeedback("");
      setRevisionOpen(false);
    } finally {
      setSubmittingRevision(false);
    }
  }

  function openFullPlan() {
    onOpenFullPlan?.(message.id);
  }

  const headerIcon = isStreaming ? (
    <LoaderCircle size={17} aria-hidden="true" />
  ) : descriptor.state === "accepted" ? (
    <Check size={17} aria-hidden="true" />
  ) : descriptor.state === "denied" || descriptor.state === "superseded" || descriptor.state === "error" ? (
    <X size={17} aria-hidden="true" />
  ) : (
    <ClipboardList size={17} aria-hidden="true" />
  );

  return (
    <section className="plan-review-response" data-state={descriptor.state} data-tone={descriptor.tone}>
      <header className="plan-response-header">
        <span className="plan-response-badge">
          <Sparkles size={12} aria-hidden="true" />
          Plan mode
        </span>
        <span className="plan-response-status">
          {headerIcon}
          <strong>{descriptor.label}</strong>
        </span>
        <small>{descriptor.description}</small>
        {onOpenFullPlan && planContent ? (
          <button
            className="plan-response-panel-button"
            type="button"
            aria-label="Open plan in side panel"
            onClick={openFullPlan}
          >
            <span>Open plan</span>
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {planContent ? (
        <div className="plan-response-body">
          <MarkdownMessage content={planContent} isStreaming={isStreaming} />
        </div>
      ) : null}

      {showActions ? (
        <footer className="plan-response-actions" aria-label="Plan decisions">
          {pendingPlanApproval ? (
            <>
              <button
                className="plan-response-decline"
                type="button"
                data-loading={decliningPlan ? "true" : undefined}
                disabled={!canDecline}
                onClick={declinePlan}
              >
                {decliningPlan ? <LoaderCircle size={15} aria-hidden="true" /> : <ShieldOff size={15} aria-hidden="true" />}
                <span>{decliningPlan ? "Cancelling" : "Decline"}</span>
              </button>
              {canRequestRevision ? (
                <button className="plan-response-secondary" type="button" data-active={revisionOpen ? "true" : undefined} onClick={() => setRevisionOpen((open) => !open)}>
                  <PencilLine size={15} aria-hidden="true" />
                  <span>{revisionOpen ? "Close feedback" : "Ask for changes"}</span>
                </button>
              ) : null}
              <button
                className="plan-response-primary"
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
            <button className="plan-response-secondary" type="button" data-active={revisionOpen ? "true" : undefined} onClick={() => setRevisionOpen((open) => !open)}>
              <PencilLine size={15} aria-hidden="true" />
              <span>{revisionOpen ? "Close feedback" : "Ask for changes"}</span>
            </button>
          ) : null}
        </footer>
      ) : null}

      {revisionOpen ? (
        <div className="plan-response-feedback">
          <textarea
            aria-label="Plan feedback"
            placeholder="Tell Gilbert Codex what to change. For example: drop the migration step, focus on the UI..."
            rows={3}
            value={revisionFeedback}
            onChange={(event) => setRevisionFeedback(event.currentTarget.value)}
          />
          <div className="plan-response-feedback-actions">
            <span className="plan-response-feedback-hint">A new plan will replace this one.</span>
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

export function truncatePreview(content: string, lineLimit: number): { preview: string; truncated: boolean } {
  if (!content) return { preview: "", truncated: false };

  const lines = content.split("\n");
  if (lines.length <= lineLimit) return { preview: content, truncated: false };

  let cut = lineLimit;
  let inFence = false;
  for (let index = 0; index < cut && index < lines.length; index += 1) {
    if (/^```/.test(lines[index].trim())) inFence = !inFence;
  }
  if (inFence) {
    const extraCap = Math.min(lines.length, cut + 12);
    for (let index = cut; index < extraCap; index += 1) {
      if (/^```/.test(lines[index].trim())) {
        cut = index + 1;
        inFence = false;
        break;
      }
      cut = index + 1;
    }
  }

  return {
    preview: lines.slice(0, cut).join("\n"),
    truncated: lines.length > cut,
  };
}
