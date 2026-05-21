import { ArrowRight, Check, ClipboardList, LoaderCircle, Maximize2, Minimize2, PencilLine, Save, ShieldOff, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatMessage } from "../../types/chat";
import { MarkdownMessage } from "../chat/MarkdownMessage";
import { summarizeResearchEvidence } from "../../services/planResearchClient";
import { getSavedPlanContent } from "../../lib/planReview";

interface PlanReviewPanelProps {
  expanded?: boolean;
  message: ChatMessage;
  onClose?: () => void;
  onRequestRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onResolvePlanApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onToggleExpanded?: () => void;
}

interface TocEntry {
  id: string;
  label: string;
  level: 2 | 3;
}

/**
 * Right-rail surface for reviewing a plan in detail. Pairs with the inline
 * plan response that mounts this panel.
 *
 * Three modes:
 * - viewer: rendered markdown with a left-edge heading TOC.
 * - editor: textarea pre-filled with the plan; saving sends an `approved`
 *   decision with `editedArgs.plan` so the executing agent uses the edited
 *   text. The handshake is supported by App.tsx but had no UI affordance
 *   before this rebuild.
 */
export function PlanReviewPanel({ expanded = false, message, onClose, onRequestRevision, onResolvePlanApproval, onToggleExpanded }: PlanReviewPanelProps) {
  const planApproval = message.approvals?.find((approval) => approval.tool === "planning_handoff");
  const pendingApproval = planApproval?.status === "pending" ? planApproval : undefined;
  const approved = planApproval?.status === "approved" || planApproval?.status === "edited";
  const denied = planApproval?.status === "denied";
  const supersededPlan = planApproval?.status === "expired" || message.agentRunStatus === "cancelled";

  const planContent = getSavedPlanContent(message);
  const tocEntries = useMemo(() => deriveTocEntries(planContent), [planContent]);
  // Live research counters — drive the chip shown next to the title when the
  // plan is still being researched/drafted. Computed from the tool-call ledger
  // so the count reflects reality, not the model's self-report.
  const researchEvidence = useMemo(() => summarizeResearchEvidence(message.toolCalls), [message.toolCalls]);
  const evidenceChip = useMemo(() => {
    const parts: string[] = [];
    if (researchEvidence.filesRead.length > 0) {
      parts.push(`${researchEvidence.filesRead.length} file${researchEvidence.filesRead.length === 1 ? "" : "s"}`);
    }
    const searchTotal = researchEvidence.searchQueries.length + researchEvidence.webQueries.length;
    if (searchTotal > 0) {
      parts.push(`${searchTotal} search${searchTotal === 1 ? "" : "es"}`);
    }
    return parts.join(" · ");
  }, [researchEvidence]);

  const [activeHeading, setActiveHeading] = useState<string | undefined>(tocEntries[0]?.id);
  const [feedback, setFeedback] = useState("");
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(planContent);
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [declining, setDeclining] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);

  // Reset edit buffer when the underlying plan content changes (e.g. a
  // revision came back from the model).
  useEffect(() => {
    setEditValue(planContent);
  }, [planContent]);

  // Markdown rendered via `MarkdownMessage` doesn't set heading IDs, so we
  // assign them ourselves (same slug we used in `deriveTocEntries`). This must
  // run on every body-content change so we can jump to and scroll-spy headings.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const headings = body.querySelectorAll<HTMLElement>("h2, h3");
    const counts = new Map<string, number>();
    for (const heading of headings) {
      const text = (heading.textContent ?? "").trim();
      const base = slugify(text);
      const count = counts.get(base) ?? 0;
      counts.set(base, count + 1);
      heading.id = count === 0 ? base : `${base}-${count}`;
    }
  }, [planContent, editing]);

  // Scroll-spy: as the user scrolls the panel body, update the active TOC
  // entry to whichever heading is closest to the top of the viewport. Cheap
  // because plans are short — no IntersectionObserver needed.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || tocEntries.length === 0) return;

    function update() {
      if (!body) return;
      const headings = body.querySelectorAll<HTMLElement>("h2, h3");
      let current: string | undefined;
      const bodyTop = body.getBoundingClientRect().top;
      for (const heading of headings) {
        const top = heading.getBoundingClientRect().top - bodyTop;
        if (top <= 24) {
          current = heading.id || slugify(heading.textContent ?? "");
        } else {
          break;
        }
      }
      setActiveHeading(current ?? tocEntries[0]?.id);
    }

    update();
    body.addEventListener("scroll", update, { passive: true });
    return () => body.removeEventListener("scroll", update);
  }, [tocEntries, planContent]);

  const canAccept = Boolean(pendingApproval && onResolvePlanApproval && !accepting && !declining && !submittingFeedback);
  const canDecline = canAccept;
  const canEdit = Boolean(pendingApproval && onResolvePlanApproval);
  const canRequestRevision = Boolean(onRequestRevision && !message.isStreaming && !approved && !denied && !supersededPlan);

  const stateLabel: { description: string; label: string; tone: "warning" | "success" | "danger" | "muted" | "info" } = message.isStreaming
    ? { description: "Thinking through the route before review.", label: "Plan in progress", tone: "info" }
    : pendingApproval
      ? { description: "Approve to start coding, edit inline, request changes, or decline.", label: "Plan ready for review", tone: "warning" }
      : approved
        ? { description: "Approved. The agent is executing this plan.", label: "Plan accepted", tone: "success" }
        : denied
          ? { description: "You declined this plan.", label: "Plan declined", tone: "danger" }
          : supersededPlan
            ? { description: "Replaced by a newer revision.", label: "Plan superseded", tone: "muted" }
            : { description: "Plan ready", label: "Plan ready", tone: "info" };

  async function acceptPlan() {
    if (!pendingApproval || !onResolvePlanApproval) return;
    setAccepting(true);
    try {
      const edited = editing && editValue.trim() !== planContent ? { editedArgs: { plan: editValue.trim() } } : {};
      await onResolvePlanApproval(message.id, pendingApproval.id, { status: "approved", ...edited });
    } finally {
      setAccepting(false);
    }
  }

  async function declinePlan() {
    if (!pendingApproval || !onResolvePlanApproval) return;
    setDeclining(true);
    try {
      await onResolvePlanApproval(message.id, pendingApproval.id, { status: "denied" });
    } finally {
      setDeclining(false);
    }
  }

  async function submitFeedback() {
    if (!onRequestRevision) return;
    const trimmed = feedback.trim();
    if (!trimmed) return;
    setSubmittingFeedback(true);
    try {
      await onRequestRevision(message.id, trimmed);
      setFeedback("");
      setFeedbackOpen(false);
    } finally {
      setSubmittingFeedback(false);
    }
  }

  function jumpToHeading(entry: TocEntry) {
    const body = bodyRef.current;
    if (!body) return;
    const target = body.querySelector<HTMLElement>(`#${CSS.escape(entry.id)}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveHeading(entry.id);
  }

  return (
    <section className="plan-review-panel" data-tone={stateLabel.tone} aria-labelledby="plan-review-panel-title">
      <header className="plan-review-panel-header">
        <span className="plan-review-panel-icon" aria-hidden="true">
          {message.isStreaming ? <LoaderCircle size={16} /> : <ClipboardList size={16} />}
        </span>
        <div>
          <span className="plan-review-panel-eyebrow">
            <ClipboardList size={11} aria-hidden="true" /> Plan
          </span>
          <h2 id="plan-review-panel-title">{stateLabel.label}</h2>
          <small>{stateLabel.description}</small>
          {evidenceChip ? <span className="plan-review-panel-evidence">{evidenceChip}</span> : null}
        </div>
        <div className="plan-review-panel-actions">
          {onToggleExpanded ? (
            <button
              className="rail-close"
              type="button"
              aria-label={expanded ? "Restore plan review" : "Expand plan review"}
              aria-pressed={expanded}
              title={expanded ? "Restore plan review" : "Expand plan review"}
              onClick={onToggleExpanded}
            >
              {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            </button>
          ) : null}
          {onClose ? (
            <button className="rail-close" type="button" aria-label="Close plan review" onClick={onClose}>
              <X size={16} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="plan-review-panel-shell">
        {tocEntries.length > 1 ? (
          <nav className="plan-review-panel-toc" aria-label="Plan sections">
            {tocEntries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-active={activeHeading === entry.id ? "true" : undefined}
                data-level={entry.level}
                onClick={() => jumpToHeading(entry)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
        ) : null}

        <div className="plan-review-panel-body" ref={bodyRef}>
          {editing ? (
            <textarea
              aria-label="Edit plan"
              className="plan-review-panel-editor"
              value={editValue}
              onChange={(event) => setEditValue(event.target.value)}
              rows={Math.max(20, editValue.split("\n").length + 2)}
            />
          ) : planContent ? (
            <MarkdownMessage content={planContent} isStreaming={message.isStreaming} />
          ) : (
            <div className="plan-review-panel-skeleton" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
      </div>

      <footer className="plan-review-panel-footer" aria-label="Plan decisions">
        {pendingApproval ? (
          <>
            <button
              className="plan-review-panel-decline"
              type="button"
              data-loading={declining ? "true" : undefined}
              disabled={!canDecline}
              onClick={declinePlan}
            >
              {declining ? <LoaderCircle size={14} aria-hidden="true" /> : <ShieldOff size={14} aria-hidden="true" />}
              <span>{declining ? "Cancelling" : "Decline"}</span>
            </button>
            {canRequestRevision ? (
              <button
                className="plan-review-panel-secondary"
                type="button"
                data-active={feedbackOpen ? "true" : undefined}
                onClick={() => setFeedbackOpen((open) => !open)}
              >
                <PencilLine size={14} aria-hidden="true" />
                <span>{feedbackOpen ? "Close feedback" : "Ask for changes"}</span>
              </button>
            ) : null}
            {canEdit ? (
              <button
                className="plan-review-panel-secondary"
                type="button"
                data-active={editing ? "true" : undefined}
                onClick={() => setEditing((current) => !current)}
              >
                <Save size={14} aria-hidden="true" />
                <span>{editing ? "Stop editing" : "Edit plan"}</span>
              </button>
            ) : null}
            <button
              className="plan-review-panel-primary"
              type="button"
              data-loading={accepting ? "true" : undefined}
              disabled={!canAccept}
              onClick={acceptPlan}
            >
              {accepting ? <LoaderCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
              <span>
                {accepting
                  ? "Starting"
                  : editing && editValue.trim() !== planContent
                    ? "Accept edits & start"
                    : "Accept & start"}
              </span>
              {!accepting ? <ArrowRight size={13} aria-hidden="true" /> : null}
            </button>
          </>
        ) : canRequestRevision ? (
          <button
            className="plan-review-panel-secondary"
            type="button"
            data-active={feedbackOpen ? "true" : undefined}
            onClick={() => setFeedbackOpen((open) => !open)}
          >
            <PencilLine size={14} aria-hidden="true" />
            <span>{feedbackOpen ? "Close feedback" : "Ask for changes"}</span>
          </button>
        ) : null}
      </footer>

      {feedbackOpen ? (
        <div className="plan-review-panel-feedback">
          <textarea
            aria-label="Plan feedback"
            placeholder="Tell the planner what to change. For example: drop the migration step, focus on the UI..."
            rows={3}
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
          <div className="plan-review-panel-feedback-actions">
            <span>A new plan will replace this one.</span>
            <button
              type="button"
              data-loading={submittingFeedback ? "true" : undefined}
              disabled={!feedback.trim() || submittingFeedback}
              onClick={submitFeedback}
            >
              {submittingFeedback ? <LoaderCircle size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
              <span>{submittingFeedback ? "Reworking" : "Rework plan"}</span>
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Pull H2/H3 headings out of the plan markdown so we can render a TOC. Plans
 * follow a fixed section structure (Goal / Files to change / Step-by-step
 * plan / Risks / Verification) — H3s within Step-by-step are common in long
 * plans, so we include them too.
 */
export function deriveTocEntries(content: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const seen = new Map<string, number>();
  const lines = content.split("\n");
  let inFence = false;

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = line.match(/^(#{2,3})\s+(.+?)\s*#*\s*$/);
    if (!match) continue;

    const level = match[1].length as 2 | 3;
    const label = match[2].trim();
    if (!label) continue;

    const baseId = slugify(label);
    const count = seen.get(baseId) ?? 0;
    seen.set(baseId, count + 1);
    const id = count === 0 ? baseId : `${baseId}-${count}`;

    entries.push({ id, label, level });
  }

  return entries;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}
