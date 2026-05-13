import {
  Bot,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  FileCode2,
  FileSearch,
  GitBranch,
  Globe2,
  Hammer,
  MonitorUp,
  Repeat2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  TimerReset,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useMemo } from "react";
import { UtilityPageShell } from "../components/utility/UtilityPageShell";
import { formatChatAge } from "../lib/chatUtils";
import type { AgentRun, AgentRunStatus } from "../types/agentRun";
import type { ChatSendInput, ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { WebSearchSettings } from "../types/settings";
import type { ToolRegistryId, ToolRegistrySettings } from "../types/tools";

type CapabilityStatus = "Live" | "Partial" | "Missing";

interface WorkflowTemplate {
  cta: string;
  icon: LucideIcon;
  id: string;
  label: string;
  mode: ChatSendInput["mode"];
  prompt: string;
  requires: ToolRegistryId[];
  steps: string[];
  summary: string;
  webSearch?: boolean;
  workflowId: string;
}

interface CapabilityGap {
  icon: LucideIcon;
  label: string;
  status: CapabilityStatus;
  summary: string;
}

interface TrendSignal {
  icon: LucideIcon;
  label: string;
  summary: string;
}

interface WorkflowsPageProps {
  agentRuns: AgentRun[];
  chats: ChatSummary[];
  localWorkspace: LocalWorkspaceSettings;
  onOpenChat: (chatId: string) => void;
  onStartWorkflow: (input: ChatSendInput) => void;
  toolSettings: ToolRegistrySettings;
  webSearchSettings: WebSearchSettings;
}

const workflowTemplates: WorkflowTemplate[] = [
  {
    cta: "Start audit",
    icon: FileSearch,
    id: "agent-gap-audit",
    label: "Agent workflow audit",
    mode: "plan",
    prompt:
      "Audit this app for missing agentic workflow behavior. Inspect the current workflow, tool, approval, planning, terminal, web, and persistence paths. Produce a prioritized implementation plan with concrete files to change, approval gates for risky work, and focused verification steps before making edits.",
    requires: ["planning", "fileSearch", "codeView", "webSearch"],
    steps: ["Inspect runtime", "Rank gaps", "Plan patch"],
    summary: "Find the next product gaps across the real agent loop instead of only the visible UI.",
    webSearch: true,
    workflowId: "agent-workflow-audit",
  },
  {
    cta: "Start feature",
    icon: Hammer,
    id: "feature-build",
    label: "Plan, patch, verify",
    mode: "plan",
    prompt:
      "Run a safe implementation workflow for the next requested feature. First inspect the repo, then create a short plan, wait for plan approval if needed, make scoped edits, run the most relevant checks, and summarize files changed plus any remaining risk.",
    requires: ["planning", "codeView", "codeEdit", "terminal", "testingTools"],
    steps: ["Plan", "Patch", "Verify"],
    summary: "The default coding lane: scoped edits, approval-aware execution, and verification evidence.",
    workflowId: "plan-patch-verify",
  },
  {
    cta: "Research patch",
    icon: Globe2,
    id: "research-backed-patch",
    label: "Research-backed patch",
    mode: "plan",
    prompt:
      "Use current web research plus local code inspection to solve a product or technical issue. Cite the sources used, keep web results capped, translate findings into app-specific requirements, then implement the smallest safe patch and verify it.",
    requires: ["webSearch", "planning", "codeView", "codeEdit"],
    steps: ["Research", "Ground", "Patch"],
    summary: "For fast-moving APIs, product patterns, docs, and ecosystem changes.",
    webSearch: true,
    workflowId: "research-backed-patch",
  },
  {
    cta: "Run checks",
    icon: TerminalSquare,
    id: "repo-health",
    label: "Repo health sweep",
    mode: "chat",
    prompt:
      "Run a repo health sweep. Inspect the current git state without reverting unrelated work, run the focused frontend and Rust checks available in this repository, identify blockers, and report the highest-risk issues with file references.",
    requires: ["terminal", "testingTools", "typescriptTools", "codeView"],
    steps: ["Status", "Checks", "Report"],
    summary: "A quick confidence pass before shipping or handing work to another contributor.",
    workflowId: "repo-health-sweep",
  },
  {
    cta: "Prep branch",
    icon: GitBranch,
    id: "branch-prep",
    label: "Branch and PR prep",
    mode: "chat",
    prompt:
      "Prepare the current work for source control review. Inspect the diff, group changes by user-facing behavior, run lightweight validation, draft a concise PR summary, and call out any files that look unrelated or risky before staging.",
    requires: ["sourceControl", "terminal", "codeView"],
    steps: ["Diff", "Validate", "Draft"],
    summary: "Turns local work into reviewable context without hiding risk or unrelated changes.",
    workflowId: "branch-pr-prep",
  },
  {
    cta: "Make brief",
    icon: CalendarClock,
    id: "manual-monitor",
    label: "Manual monitor brief",
    mode: "chat",
    prompt:
      "Create a monitor brief for this workspace. Identify what should be checked repeatedly, what evidence should be collected, which command or source proves it, and what condition should notify the user. Do not create a schedule until the workflow automation runtime exists.",
    requires: ["workflowAutomation", "terminal", "webSearch"],
    steps: ["Define signal", "Choose proof", "Notify rule"],
    summary: "Shapes future recurring jobs while the actual scheduler remains a missing runtime piece.",
    webSearch: true,
    workflowId: "monitor-brief",
  },
];

const trendSignals: TrendSignal[] = [
  {
    icon: ShieldCheck,
    label: "Human approvals",
    summary: "Pause risky tools, show the exact action, allow edits, then resume the same run.",
  },
  {
    icon: TimerReset,
    label: "Durable runs",
    summary: "Persist steps, approvals, evidence, and restart recovery instead of treating work as a transient chat.",
  },
  {
    icon: Globe2,
    label: "Grounded research",
    summary: "Use web and connected data with citations when facts, docs, APIs, or prices can drift.",
  },
  {
    icon: CalendarClock,
    label: "Recurring work",
    summary: "Let finished tasks become monitors, scheduled checks, and follow-up jobs.",
  },
  {
    icon: MonitorUp,
    label: "Visible computer use",
    summary: "Keep browser, terminal, files, and tool progress visible so users can interrupt or steer.",
  },
  {
    icon: BrainCircuit,
    label: "Guarded autonomy",
    summary: "Separate normal chat, planning, deep research, and high-risk actions with hard runtime limits.",
  },
];

const capabilityGaps: CapabilityGap[] = [
  {
    icon: TimerReset,
    label: "Run persistence",
    status: "Live",
    summary: "Agent runs are saved locally and recovered after restart with failed in-flight work marked clearly.",
  },
  {
    icon: ShieldCheck,
    label: "Approval interrupts",
    status: "Live",
    summary: "Planning handoffs and risky tools can pause, accept edits, deny, or resume from the same chat.",
  },
  {
    icon: MonitorUp,
    label: "Live activity rail",
    status: "Live",
    summary: "Thinking, web search, tool calls, terminal output, sources, artifacts, and approvals have a visible rail.",
  },
  {
    icon: Workflow,
    label: "Startable templates",
    status: "Live",
    summary: "Workflow cards can now launch real chat or plan-mode runs with the current workspace context.",
  },
  {
    icon: CalendarClock,
    label: "Schedules and monitors",
    status: "Missing",
    summary: "The registry has workflow automation, but there is no in-app recurring job runner yet.",
  },
  {
    icon: Bot,
    label: "Multi-agent delegation",
    status: "Partial",
    summary: "The prompt shape anticipates subagents, but this app runtime still needs a real delegated-run executor.",
  },
  {
    icon: FileCode2,
    label: "Guardrail harness",
    status: "Partial",
    summary: "Permission gates exist; separate input, output, tool, and regression guardrails are not first-class yet.",
  },
  {
    icon: Repeat2,
    label: "App connectors",
    status: "Partial",
    summary: "GitHub is present, but Gmail, Drive, Calendar, and enterprise app scopes need their own connector layer.",
  },
];

const liveStatuses = new Set<AgentRunStatus>(["queued", "running", "waiting_for_approval"]);

export function WorkflowsPage({
  agentRuns,
  chats,
  localWorkspace,
  onOpenChat,
  onStartWorkflow,
  toolSettings,
  webSearchSettings,
}: WorkflowsPageProps) {
  const sortedRuns = useMemo(
    () => [...agentRuns].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)),
    [agentRuns],
  );
  const chatTitleById = useMemo(() => new Map(chats.map((chat) => [chat.id, chat.title])), [chats]);
  const activeRuns = sortedRuns.filter((run) => liveStatuses.has(run.status));
  const pendingApprovals = sortedRuns.flatMap((run) => run.approvals.filter((approval) => approval.status === "pending"));
  const completedToday = sortedRuns.filter((run) => run.status === "completed" && isToday(run.completedAt ?? run.updatedAt)).length;
  const enabledTemplateCount = workflowTemplates.filter((template) => getMissingTools(template.requires, toolSettings).length === 0).length;
  const liveCapabilityCount = capabilityGaps.filter((gap) => gap.status === "Live").length;
  const recentRuns = sortedRuns.slice(0, 6);
  const visibleRuns = activeRuns.length > 0 ? activeRuns.slice(0, 6) : recentRuns;

  const workflowStats = [
    { icon: Sparkles, label: "Live runs", value: formatPadded(activeRuns.length), detail: activeRuns.length ? "Needs attention" : "Idle" },
    { icon: ShieldCheck, label: "Approvals", value: formatPadded(pendingApprovals.length), detail: pendingApprovals.length ? "Waiting" : "Clear" },
    { icon: CheckCircle2, label: "Done today", value: formatPadded(completedToday), detail: `${formatPadded(sortedRuns.length)} stored` },
    { icon: Workflow, label: "Ready lanes", value: `${enabledTemplateCount}/${workflowTemplates.length}`, detail: `${liveCapabilityCount} live systems` },
  ];

  function startWorkflow(template: WorkflowTemplate) {
    onStartWorkflow({
      attachments: [],
      content: createWorkflowPrompt(template, localWorkspace),
      localWorkspace,
      mode: template.mode,
      planning: template.mode === "plan" ? {} : undefined,
      webSearch: template.webSearch && toolSettings.webSearch
        ? {
            enabled: true,
            maxResults: webSearchSettings.maxResults,
            provider: webSearchSettings.provider,
          }
        : undefined,
    });
  }

  return (
    <UtilityPageShell
      actions={
        <>
          <span>{formatWorkspaceScope(localWorkspace)}</span>
          <span>{formatApprovalMode(localWorkspace.permissionMode)}</span>
        </>
      }
      actionsLabel="Workflow status"
      eyebrow="Workflows"
      stats={workflowStats}
      statsLabel="Workflow overview"
      title="Agent command center"
      titleId="workflows-title"
    >
        <section className="utility-section" aria-labelledby="workflow-live-title">
          <div className="utility-section-heading">
            <h2 id="workflow-live-title">{activeRuns.length > 0 ? "Active Runs" : "Recent Runs"}</h2>
            <span>{sortedRuns.length ? `${sortedRuns.length} saved` : "No saved runs"}</span>
          </div>
          {visibleRuns.length > 0 ? (
            <div className="workflow-run-list">
              {visibleRuns.map((run) => (
                <RunRow
                  chatTitle={chatTitleById.get(run.chatId)}
                  key={run.id}
                  run={run}
                  onOpenChat={() => onOpenChat(run.chatId)}
                />
              ))}
            </div>
          ) : (
            <div className="workflow-empty-state">
              <Sparkles size={20} aria-hidden="true" />
              <span>Start a workflow to create a durable run with steps, approvals, sources, and artifacts.</span>
            </div>
          )}
        </section>

        <section className="utility-section" aria-labelledby="workflow-library-title">
          <div className="utility-section-heading">
            <h2 id="workflow-library-title">Workflow Library</h2>
            <span>Launches real runs</span>
          </div>
          <div className="workflow-template-grid">
            {workflowTemplates.map((template) => (
              <WorkflowTemplateCard
                key={template.id}
                missingTools={getMissingTools(template.requires, toolSettings)}
                template={template}
                onStart={() => startWorkflow(template)}
              />
            ))}
          </div>
        </section>

        <section className="utility-section" aria-labelledby="workflow-signals-title">
          <div className="utility-section-heading">
            <h2 id="workflow-signals-title">Agentic Signals</h2>
            <span>Current product direction</span>
          </div>
          <div className="workflow-signal-grid">
            {trendSignals.map((signal) => {
              const Icon = signal.icon;

              return (
                <article className="workflow-signal-card" key={signal.label}>
                  <Icon size={18} aria-hidden="true" />
                  <strong>{signal.label}</strong>
                  <p>{signal.summary}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section className="utility-section" aria-labelledby="workflow-gap-title">
          <div className="utility-section-heading">
            <h2 id="workflow-gap-title">Capability Map</h2>
            <span>{capabilityGaps.filter((gap) => gap.status !== "Live").length} gaps left</span>
          </div>
          <div className="workflow-gap-grid">
            {capabilityGaps.map((gap) => {
              const Icon = gap.icon;

              return (
                <article className="workflow-gap-card" data-status={gap.status} key={gap.label}>
                  <div className="workflow-gap-header">
                    <span className="tool-card-icon" aria-hidden="true">
                      <Icon size={18} />
                    </span>
                    <span className="tool-status">{gap.status}</span>
                  </div>
                  <strong>{gap.label}</strong>
                  <p>{gap.summary}</p>
                </article>
              );
            })}
          </div>
        </section>
    </UtilityPageShell>
  );
}

function WorkflowTemplateCard({
  missingTools,
  onStart,
  template,
}: {
  missingTools: string[];
  onStart: () => void;
  template: WorkflowTemplate;
}) {
  const Icon = template.icon;
  const ready = missingTools.length === 0;

  return (
    <article className="workflow-template-card" data-ready={ready}>
      <div className="workflow-card-header">
        <span className="tool-card-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <span className="tool-status">{ready ? "Ready" : "Needs tools"}</span>
      </div>
      <div>
        <h3>{template.label}</h3>
        <p>{template.summary}</p>
      </div>
      <div className="workflow-step-row" aria-label={`${template.label} steps`}>
        {template.steps.map((step) => (
          <span key={step}>{step}</span>
        ))}
      </div>
      {missingTools.length > 0 ? <small className="workflow-tool-warning">Enable {missingTools.join(", ")}</small> : null}
      <button className="workflow-start-button" type="button" onClick={onStart}>
        <Sparkles size={15} aria-hidden="true" />
        <span>{template.cta}</span>
      </button>
    </article>
  );
}

function RunRow({
  chatTitle,
  onOpenChat,
  run,
}: {
  chatTitle?: string;
  onOpenChat: () => void;
  run: AgentRun;
}) {
  const pendingApprovalCount = run.approvals.filter((approval) => approval.status === "pending").length;
  const completedSteps = run.steps.filter((step) => step.status === "completed").length;
  const failedSteps = run.steps.filter((step) => step.status === "failed").length;
  const totalSteps = run.steps.length;

  return (
    <article className="workflow-run-row" data-status={run.status}>
      <div className="workflow-run-main">
        <span className="workflow-run-icon" aria-hidden="true">
          <RunStatusIcon status={run.status} />
        </span>
        <span>
          <strong>{run.title || chatTitle || "Agent run"}</strong>
          <small>{formatRunDetail(run, completedSteps, totalSteps, failedSteps, pendingApprovalCount)}</small>
        </span>
      </div>
      <div className="workflow-run-meta">
        <span className="tool-status">{formatRunStatus(run.status)}</span>
        <small>{formatChatAge(run.updatedAt)}</small>
        <button type="button" onClick={onOpenChat}>
          {pendingApprovalCount ? "Review" : "Open"}
        </button>
      </div>
    </article>
  );
}

function RunStatusIcon({ status }: { status: AgentRunStatus }) {
  if (status === "completed") {
    return <CheckCircle2 size={18} />;
  }

  if (status === "failed" || status === "cancelled") {
    return <ShieldCheck size={18} />;
  }

  if (status === "waiting_for_approval") {
    return <ShieldCheck size={18} />;
  }

  return <Sparkles size={18} />;
}

function createWorkflowPrompt(template: WorkflowTemplate, localWorkspace: LocalWorkspaceSettings) {
  const workspaceLine = localWorkspace.enabled
    ? `Workspace: ${localWorkspace.roots.length ? localWorkspace.roots.join(", ") : "current configured workspace"} (${formatWorkspaceScope(localWorkspace)}).`
    : "Workspace tools are currently off; ask before assuming local files are available.";

  return [
    `Start the ${template.workflowId} workflow with workflow_run before using direct primitive tools.`,
    `Workflow goal: ${template.prompt}`,
    workspaceLine,
  ].join("\n\n");
}

function getMissingTools(requiredTools: ToolRegistryId[], settings: ToolRegistrySettings) {
  return requiredTools.filter((toolId) => !settings[toolId]).map(formatToolName);
}

function formatToolName(toolId: ToolRegistryId) {
  return toolId
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (match) => match.toUpperCase());
}

function formatWorkspaceScope(localWorkspace: LocalWorkspaceSettings) {
  if (!localWorkspace.enabled) {
    return "Workspace off";
  }

  if (localWorkspace.scope === "full-computer") {
    return "Full computer";
  }

  if (localWorkspace.scope === "selected-folder") {
    return "Selected folder";
  }

  return "Current folder";
}

function formatApprovalMode(mode: LocalWorkspaceSettings["permissionMode"]) {
  if (mode === "full-workspace") {
    return "Auto full";
  }

  if (mode === "read-only") {
    return "Read only";
  }

  if (mode === "gilbert-review") {
    return "Review gated";
  }

  return "Ask first";
}

function formatRunStatus(status: AgentRunStatus) {
  if (status === "waiting_for_approval") {
    return "Approval";
  }

  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatRunDetail(run: AgentRun, completedSteps: number, totalSteps: number, failedSteps: number, pendingApprovals: number) {
  const parts = [
    run.mode === "plan" ? "Plan mode" : "Chat run",
    totalSteps ? `${completedSteps}/${totalSteps} steps` : "",
    pendingApprovals ? `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"}` : "",
    failedSteps ? `${failedSteps} failed` : "",
    run.toolCalls.length ? `${run.toolCalls.length} tools` : "",
  ].filter(Boolean);

  return parts.join(" | ");
}

function isToday(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
}

function formatPadded(value: number) {
  return String(value).padStart(2, "0");
}
