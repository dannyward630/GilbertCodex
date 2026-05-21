import { ArrowRight, Check, ChevronDown, ClipboardList, LoaderCircle, PencilLine, ShieldOff, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { getSavedPlanContent } from "../../lib/planReview";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatMessage, ChatProgressItem } from "../../types/chat";

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

type PlanPhaseId = "plan-context" | "plan-input" | "plan-research" | "plan-write";

interface PlanPhaseView {
  detail: string;
  id: PlanPhaseId;
  label: string;
  status: ChatProgressItem["status"];
}

const PLAN_PHASE_LABELS: Record<PlanPhaseId, string> = {
  "plan-context": "Understand request",
  "plan-input": "Clarify scope",
  "plan-research": "Research context",
  "plan-write": "Shape the plan",
};

export function PlanReviewCard({ content, isStreaming, message, onOpenFullPlan, onRequestRevision, onResolvePlanApproval }: PlanReviewCardProps) {
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionFeedback, setRevisionFeedback] = useState("");
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [acceptingPlan, setAcceptingPlan] = useState(false);
  const [decliningPlan, setDecliningPlan] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

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
  const phaseItems = useMemo(() => getPlanPhaseItems(message.progress), [message.progress]);
  const activePhase = phaseItems.find((item) => item.status === "active");
  const visiblePlanContent = isStreaming ? "" : planContent;
  const planSummary = useMemo(() => createPlanSummary(visiblePlanContent), [visiblePlanContent]);
  const showLivePlanSteps = Boolean(isStreaming && phaseItems.length > 0);
  const canOpenFullPlan = Boolean(onOpenFullPlan && visiblePlanContent);
  const shouldRenderPlanResponse = Boolean(planContent || planApproval || (isStreaming && message.mode === "plan"));

  const descriptor = useMemo<PlanResponseStateDescriptor>(() => {
    if (isStreaming) {
      if (activePhase?.id === "plan-input") {
        return {
          description: "Checking whether one decision would change the plan.",
          label: "Clarifying scope",
          state: "streaming",
          tone: "info",
        };
      }

      if (inResearchPhase) {
        const inspected = completedToolCount + activeToolCount;
        const detail = activeToolCount > 0
          ? `Inspecting ${inspected} file${inspected === 1 ? "" : "s"}...`
          : completedToolCount > 0
            ? `Read ${completedToolCount} file${completedToolCount === 1 ? "" : "s"} so far`
            : "Reading the codebase";
        return { description: detail, label: "Researching first", state: "streaming", tone: "info" };
      }

      if (activePhase?.id === "plan-research") {
        return {
          description: activePhase.detail || "Reading the workspace before planning.",
          label: "Researching first",
          state: "streaming",
          tone: "info",
        };
      }

      if (activePhase?.id === "plan-write") {
        return {
          description: "Turning the gathered context into a reviewable path.",
          label: "Thinking through plan",
          state: "streaming",
          tone: "info",
        };
      }

      return { description: "Reading the request and choosing the safest route.", label: "Thinking through plan", state: "streaming", tone: "info" };
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
  }, [acceptedPlan, activePhase, activeToolCount, completedToolCount, deniedPlan, inResearchPhase, isStreaming, message.status, pendingPlanApproval, supersededPlan]);

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
    <span className="plan-response-live-mark" aria-hidden="true" />
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
          <ClipboardList size={12} aria-hidden="true" />
          Plan
        </span>
        <span className="plan-response-status">
          {headerIcon}
          <strong>{descriptor.label}</strong>
        </span>
        <small>{descriptor.description}</small>
        {canOpenFullPlan ? (
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

      {showLivePlanSteps ? (
        <ol className="plan-response-steps" aria-label="Planning progress">
          {phaseItems.map((phase) => (
            <li key={phase.id} data-status={phase.status}>
              <span aria-hidden="true" />
              <div>
                <strong>{phase.label}</strong>
                <small>{phase.detail}</small>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {isStreaming ? (
        <div className="plan-response-live-note" role="status">
          <span aria-hidden="true" />
          <small>The plan will appear when it is ready to review.</small>
        </div>
      ) : null}

      {planSummary ? (
        <section className="plan-response-summary" data-expanded={summaryOpen ? "true" : undefined} aria-label="Plan summary">
          <div className="plan-response-summary-main">
            <p>{planSummary.goal}</p>
            <button
              className="plan-response-summary-toggle"
              type="button"
              aria-expanded={summaryOpen}
              onClick={() => setSummaryOpen((open) => !open)}
            >
              <span>{summaryOpen ? "Hide summary" : "Show summary"}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>
          {summaryOpen ? (
            <div className="plan-response-summary-detail">
              {planSummary.sections.length > 0 ? (
                <div className="plan-response-summary-pills" aria-label="Plan sections">
                  {planSummary.sections.map((section) => (
                    <span key={section}>{section}</span>
                  ))}
                </div>
              ) : null}
              {planSummary.highlights.length > 0 ? (
                <ul className="plan-response-summary-list">
                  {planSummary.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
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

interface PlanSummary {
  goal: string;
  highlights: string[];
  sections: string[];
}

const PLAN_SUMMARY_SECTION_LIMIT = 4;
const PLAN_SUMMARY_HIGHLIGHT_LIMIT = 4;

function createPlanSummary(content: string): PlanSummary | null {
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return null;
  }

  const goal =
    clampPlanSummaryText(extractSectionLead(trimmedContent, "goal") || extractFirstPlanParagraph(trimmedContent) || "Review this plan before it starts.", 270);
  const sections = uniqueStrings(
    extractMarkdownHeadings(trimmedContent)
      .filter((heading) => !/^goal$/i.test(heading))
      .slice(0, PLAN_SUMMARY_SECTION_LIMIT),
  );
  const highlights = uniqueStrings(extractMarkdownListItems(trimmedContent)).slice(0, PLAN_SUMMARY_HIGHLIGHT_LIMIT);

  return {
    goal,
    highlights: highlights.map((highlight) => clampPlanSummaryText(highlight, 150)),
    sections,
  };
}

function extractSectionLead(content: string, headingName: string) {
  const lines = content.split(/\r?\n/);
  const headingPattern = new RegExp(`^#{1,4}\\s+${escapeRegExp(headingName)}\\s*$`, "i");
  const startIndex = lines.findIndex((line) => headingPattern.test(line.trim()));

  if (startIndex === -1) {
    return "";
  }

  const collected: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (/^#{1,4}\s+/.test(line)) {
      break;
    }

    if (!line || /^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line)) {
      continue;
    }

    collected.push(line);
    if (collected.join(" ").length >= 220) {
      break;
    }
  }

  return cleanPlanInlineText(collected.join(" "));
}

function extractFirstPlanParagraph(content: string) {
  const paragraph = content
    .split(/\n{2,}/)
    .map((part) => cleanPlanInlineText(part))
    .find((part) => part && !/^goal$/i.test(part));

  return paragraph ?? "";
}

function extractMarkdownHeadings(content: string) {
  return content
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.trim().match(/^#{1,4}\s+(.+)$/);
      return match ? [cleanPlanInlineText(match[1])] : [];
    })
    .filter(Boolean);
}

function extractMarkdownListItems(content: string) {
  return content
    .split(/\r?\n/)
    .flatMap((line) => {
      const match = line.trim().match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
      return match ? [cleanPlanInlineText(match[1])] : [];
    })
    .filter((item) => item.length >= 12);
}

function cleanPlanInlineText(value: string) {
  return value
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~>#]/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampPlanSummaryText(value: string, maxLength: number) {
  const cleaned = cleanPlanInlineText(value);

  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  return `${cleaned.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(value);
  }

  return result;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPlanPhaseItems(progress: ChatProgressItem[] | undefined): PlanPhaseView[] {
  return (progress ?? []).flatMap((item) => {
    if (!item.id || !isPlanPhaseId(item.id)) {
      return [];
    }

    return [
      {
        detail: normalizePlanPhaseDetail(item),
        id: item.id,
        label: PLAN_PHASE_LABELS[item.id],
        status: item.status,
      },
    ];
  });
}

function isPlanPhaseId(id: string | undefined): id is PlanPhaseId {
  return id === "plan-context" || id === "plan-input" || id === "plan-research" || id === "plan-write";
}

function normalizePlanPhaseDetail(item: ChatProgressItem): string {
  const detail = item.detail?.replace(/\s+/g, " ").trim();
  if (!detail || detail === "Waiting") {
    if (item.id === "plan-context") return "Request read";
    if (item.id === "plan-input") return "No extra question needed";
    if (item.id === "plan-research") return "Context pending";
    return "Not started";
  }

  if (detail === "Plan mode") return "Request read";
  if (detail === "Answered or not needed") return "Scope is clear";
  if (detail === "Context gathered") return "Context gathered";
  if (detail === "Writing the plan from research findings") return "Organizing findings";
  return detail;
}
