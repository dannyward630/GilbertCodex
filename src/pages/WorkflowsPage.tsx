import { CalendarClock, CheckCircle2, GitBranch, Hammer, Repeat2, ShieldCheck, Sparkles, TimerReset } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface WorkflowCard {
  icon: LucideIcon;
  label: string;
  meta: string;
  status: "Draft" | "Ready" | "Queued";
  steps: string[];
}

const workflows: WorkflowCard[] = [
  {
    icon: Repeat2,
    label: "Repo health",
    meta: "Checks, lint, and focused review",
    status: "Draft",
    steps: ["Inspect", "Verify", "Report"],
  },
  {
    icon: Hammer,
    label: "Patch run",
    meta: "Scoped edits with review gates",
    status: "Draft",
    steps: ["Plan", "Patch", "Build"],
  },
  {
    icon: GitBranch,
    label: "Branch prep",
    meta: "Diff summary and release notes",
    status: "Queued",
    steps: ["Compare", "Clean", "Publish"],
  },
  {
    icon: CalendarClock,
    label: "Scheduled check",
    meta: "Future background automation",
    status: "Draft",
    steps: ["Trigger", "Run", "Notify"],
  },
];

const workflowStats = [
  { icon: Sparkles, label: "Routines", value: "04" },
  { icon: ShieldCheck, label: "Gated", value: "02" },
  { icon: TimerReset, label: "Scheduled", value: "00" },
  { icon: CheckCircle2, label: "Ready", value: "01" },
];

export function WorkflowsPage() {
  return (
    <div className="utility-page">
      <section className="utility-shell" aria-labelledby="workflows-title">
        <header className="utility-header">
          <div>
            <p className="eyebrow">Workflows</p>
            <h1 id="workflows-title">Agent routines</h1>
          </div>
          <div className="utility-header-actions" aria-label="Workflow status">
            <span>Local first</span>
            <span>Review gated</span>
          </div>
        </header>

        <div className="utility-stat-grid" aria-label="Workflow overview">
          {workflowStats.map((item) => {
            const Icon = item.icon;

            return (
              <article className="utility-stat-card" key={item.label}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <small>Phase 1</small>
              </article>
            );
          })}
        </div>

        <section className="utility-section" aria-labelledby="workflow-library-title">
          <div className="utility-section-heading">
            <h2 id="workflow-library-title">Routine library</h2>
            <span>UI scaffold</span>
          </div>
          <div className="workflow-grid">
            {workflows.map((workflow) => {
              const Icon = workflow.icon;

              return (
                <article className="workflow-card" key={workflow.label} data-status={workflow.status}>
                  <div className="workflow-card-header">
                    <span className="tool-card-icon" aria-hidden="true">
                      <Icon size={20} />
                    </span>
                    <span className="tool-status">{workflow.status}</span>
                  </div>
                  <h3>{workflow.label}</h3>
                  <p>{workflow.meta}</p>
                  <div className="workflow-step-row" aria-label={`${workflow.label} steps`}>
                    {workflow.steps.map((step) => (
                      <span key={step}>{step}</span>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </div>
  );
}
