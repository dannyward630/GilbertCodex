import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  Github,
  Globe2,
  HardDrive,
  KeyRound,
  MonitorUp,
  Plug,
  Settings,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Workflow,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { DialogShell } from "../dialogs/AppDialog";

type OnboardingAction = "close" | "settings" | "toolbox";
type OnboardingPageId = "launch" | "workspace" | "toolbox" | "ship";

interface OnboardingFeature {
  detail: string;
  icon: LucideIcon;
  label: string;
  title: string;
}

interface OnboardingPage {
  checklist: string[];
  description: string;
  eyebrow: string;
  features: OnboardingFeature[];
  flow: string[];
  icon: LucideIcon;
  id: OnboardingPageId;
  primaryAction: OnboardingAction;
  primaryLabel: string;
  prompt: string;
  stats: string[];
  tabDetail: string;
  tabLabel: string;
  title: string;
}

interface OnboardingDialogProps {
  onClose: () => void;
  onNeverShowAgain: () => void;
  onOpenSettings: () => void;
  onOpenToolbox: () => void;
  open: boolean;
}

const onboardingPages: OnboardingPage[] = [
  {
    checklist: ["Choose provider and model", "Set thinking depth", "Keep web available on demand", "Start with a clear goal"],
    description: "Pick the model route, context behavior, and web/search posture before the first serious run. The point is to start calm, capable, and already aimed at the work.",
    eyebrow: "First run",
    features: [
      { detail: "Open provider settings, confirm API/runtime state, and keep the selected model intentional.", icon: Settings, label: "Model", title: "Set the path" },
      { detail: "Use planning or deep thinking when the task needs staged reasoning, broad inspection, or careful tool use.", icon: BrainCircuit, label: "Reasoning", title: "Choose depth" },
      { detail: "Leave web search available for current facts, docs, dependency changes, and release checks.", icon: Globe2, label: "Fresh facts", title: "Search when needed" },
      { detail: "Ask for real work directly: inspect, change, test, rebuild, and summarize the result.", icon: Bot, label: "Agent", title: "Give it momentum" },
    ],
    flow: ["Model", "Thinking", "Web", "First prompt"],
    icon: Sparkles,
    id: "launch",
    primaryAction: "settings",
    primaryLabel: "Open Settings",
    prompt: "Inspect this project, tell me what matters, then make the smallest useful improvement.",
    stats: ["Model-ready", "Web-aware", "Context-conscious"],
    tabDetail: "Model and first prompt",
    tabLabel: "Launch",
    title: "Turn an empty thread into a ready local agent.",
  },
  {
    checklist: ["Attach a project folder", "Pick permission mode", "Let file search build context", "Preview app changes beside chat"],
    description: "Gilbert Codex is strongest when it knows where the work lives. Give it a bounded workspace, then let file, terminal, Git, and browser-preview tools cooperate in one thread.",
    eyebrow: "Workspace",
    features: [
      { detail: "Select a project folder so reads, edits, Git, tests, and terminal commands share the same boundary.", icon: HardDrive, label: "Roots", title: "Connect the project" },
      { detail: "Index and inspect before changing files, especially when the app has several moving pieces.", icon: FileSearch, label: "Context", title: "Find the right files" },
      { detail: "Run checks from the project path and keep output connected to the active conversation.", icon: TerminalSquare, label: "Commands", title: "Use the terminal" },
      { detail: "Open local pages or docs in the browser rail when visual verification matters.", icon: MonitorUp, label: "Preview", title: "See the result" },
    ],
    flow: ["Workspace", "Index", "Terminal", "Preview"],
    icon: HardDrive,
    id: "workspace",
    primaryAction: "close",
    primaryLabel: "Start a Chat",
    prompt: "Use the selected workspace, read the relevant files first, then implement and verify the fix.",
    stats: ["Bounded roots", "Local context", "Live preview"],
    tabDetail: "Files, terminal, preview",
    tabLabel: "Workspace",
    title: "Give every tool the same sense of place.",
  },
  {
    checklist: ["Review enabled tool categories", "Connect GitHub in Settings", "Add remote MCP servers", "Use Workflows for repeatable runs"],
    description: "Toolbox is the control center for current and upcoming capabilities. Keep the defaults on, turn off what you do not want, and connect external surfaces when they add real leverage.",
    eyebrow: "Toolbox",
    features: [
      { detail: "Browse the live registry and decide what the agent may call during chat, thinking, and planning.", icon: Wrench, label: "Registry", title: "Shape available tools" },
      { detail: "Use local Git for workspace changes and GitHub tools for remote repos, releases, PRs, and workflows.", icon: Github, label: "Source", title: "Bridge local and remote" },
      { detail: "Register remote MCP servers when a service should become part of the agent's tool belt.", icon: Plug, label: "MCP", title: "Extend the surface" },
      { detail: "Turn recurring or staged tasks into workflows instead of rebuilding the same process by hand.", icon: Workflow, label: "Runs", title: "Repeat the good path" },
    ],
    flow: ["Toolbox", "GitHub", "MCP", "Workflows"],
    icon: Wrench,
    id: "toolbox",
    primaryAction: "toolbox",
    primaryLabel: "Open Toolbox",
    prompt: "Check which tools are enabled, then use the right ones automatically while you work.",
    stats: ["Default-on tools", "GitHub-ready", "MCP-capable"],
    tabDetail: "Tools and integrations",
    tabLabel: "Tools",
    title: "Make the agent powerful without making it mysterious.",
  },
  {
    checklist: ["Use plans for broad changes", "Review sensitive actions", "Steer while streaming", "Ship with tests and Git evidence"],
    description: "The best sessions feel fast and trustworthy at the same time. Use review gates, visible activity, queued steering, and focused verification so the final answer has receipts.",
    eyebrow: "Ship safely",
    features: [
      { detail: "Sensitive file, terminal, Git, GitHub, and destructive actions surface for review when the mode requires it.", icon: ShieldCheck, label: "Control", title: "Keep authority visible" },
      { detail: "Planning and deep thinking help split broad requests into staged, checkable moves.", icon: BrainCircuit, label: "Depth", title: "Think before impact" },
      { detail: "Session approval and connected accounts keep repeated work smooth while preserving clear trust boundaries.", icon: KeyRound, label: "Access", title: "Approve once, work faster" },
      { detail: "End with tests, build checks, diffs, links, or release notes depending on what changed.", icon: CheckCircle2, label: "Evidence", title: "Finish with proof" },
    ],
    flow: ["Plan", "Act", "Review", "Verify"],
    icon: ShieldCheck,
    id: "ship",
    primaryAction: "toolbox",
    primaryLabel: "Open Toolbox",
    prompt: "Make the change, run the focused checks, and tell me exactly what passed or could not run.",
    stats: ["Review gates", "Steerable runs", "Verified output"],
    tabDetail: "Review and verification",
    tabLabel: "Ship",
    title: "Move quickly, but leave a clean trail.",
  },
];

export function OnboardingDialog({ onClose, onNeverShowAgain, onOpenSettings, onOpenToolbox, open }: OnboardingDialogProps) {
  const [activePageIndex, setActivePageIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activePage = onboardingPages[activePageIndex];
  const isFinalPage = activePageIndex === onboardingPages.length - 1;
  const progress = ((activePageIndex + 1) / onboardingPages.length) * 100;

  useEffect(() => {
    if (open) {
      setActivePageIndex(0);
    }
  }, [open]);

  function selectPage(index: number) {
    setActivePageIndex(index);
    scrollRef.current?.scrollTo({ behavior: "smooth", top: 0 });
  }

  function runAction(action: OnboardingAction) {
    if (action === "settings") {
      onOpenSettings();
      return;
    }

    if (action === "toolbox") {
      onOpenToolbox();
      return;
    }

    onClose();
  }

  function showPreviousPage() {
    selectPage(Math.max(activePageIndex - 1, 0));
  }

  function showNextPage() {
    selectPage(Math.min(activePageIndex + 1, onboardingPages.length - 1));
  }

  return (
    <DialogShell
      description="A guided launch map for models, workspaces, Toolbox, integrations, and review-first agent work."
      icon={Sparkles}
      onClose={onClose}
      open={open}
      title="Welcome to Gilbert Codex"
      actions={
        <>
          {activePageIndex > 0 ? (
            <button className="dialog-button onboarding-secondary-action" type="button" onClick={showPreviousPage}>
              <ArrowLeft size={15} aria-hidden="true" />
              Back
            </button>
          ) : null}
          <button className="dialog-button onboarding-secondary-action" type="button" onClick={onClose}>
            <X size={15} aria-hidden="true" />
            Skip
          </button>
          <button className="dialog-button onboarding-secondary-action" type="button" onClick={onNeverShowAgain}>
            Never show again
          </button>
          <button
            className="dialog-button dialog-button-primary onboarding-primary-action"
            type="button"
            onClick={isFinalPage ? () => runAction(activePage.primaryAction) : showNextPage}
          >
            {isFinalPage ? activePage.primaryLabel : "Next"}
            {isFinalPage ? <ChevronRight size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
          </button>
        </>
      }
    >
      <div className="onboarding-dialog-content">
        <div className="onboarding-progress-track" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>

        <nav className="onboarding-page-tabs" aria-label="Onboarding pages">
          {onboardingPages.map((page, index) => {
            const Icon = page.icon;
            const isActive = index === activePageIndex;

            return (
              <button
                aria-current={isActive ? "page" : undefined}
                className="onboarding-page-tab"
                data-active={isActive}
                key={page.id}
                type="button"
                onClick={() => selectPage(index)}
              >
                <span className="onboarding-tab-icon" aria-hidden="true">
                  <Icon size={16} />
                </span>
                <span>
                  <strong>{page.tabLabel}</strong>
                  <small>{page.tabDetail}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <section className="onboarding-page-scroll" data-page={activePage.id} ref={scrollRef} aria-label={`${activePage.tabLabel} onboarding page`}>
          <div className="onboarding-stage">
            <div className="onboarding-stage-copy">
              <span className="onboarding-pill">
                Page {activePageIndex + 1} of {onboardingPages.length} · {activePage.eyebrow}
              </span>
              <h3>{activePage.title}</h3>
              <p>{activePage.description}</p>
              <div className="onboarding-stage-actions">
                <button type="button" onClick={() => runAction(activePage.primaryAction)}>
                  {activePage.primaryLabel}
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
                {activePage.primaryAction !== "toolbox" ? (
                  <button type="button" onClick={onOpenToolbox}>
                    Toolbox
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" onClick={onOpenSettings}>
                    Settings
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>

            <div className="onboarding-stage-map" aria-hidden="true">
              <div className="onboarding-map-header">
                <span>{activePage.eyebrow}</span>
                <strong>{activePage.stats[0]}</strong>
              </div>
              <div className="onboarding-flow-chain">
                {activePage.flow.map((item, index) => (
                  <span key={item} data-active={index <= activePageIndex}>
                    {item}
                  </span>
                ))}
              </div>
              <div className="onboarding-map-stats">
                {activePage.stats.map((stat) => (
                  <span key={stat}>{stat}</span>
                ))}
              </div>
            </div>
          </div>

          <div className="onboarding-feature-grid" aria-label={`${activePage.tabLabel} highlights`}>
            {activePage.features.map((feature) => {
              const Icon = feature.icon;

              return (
                <article className="onboarding-feature-card" key={feature.title}>
                  <span className="onboarding-feature-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <small>{feature.label}</small>
                  <h4>{feature.title}</h4>
                  <p>{feature.detail}</p>
                </article>
              );
            })}
          </div>

          <div className="onboarding-useful-row">
            <section className="onboarding-checklist" aria-label={`${activePage.tabLabel} checklist`}>
              <div className="onboarding-panel-heading">
                <h4>Make It Real</h4>
                <span>{activePage.checklist.length} moves</span>
              </div>
              <ul>
                {activePage.checklist.map((item) => (
                  <li key={item}>
                    <CheckCircle2 size={15} aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="onboarding-prompt-card" aria-label="Starter prompt">
              <div className="onboarding-panel-heading">
                <h4>Starter Prompt</h4>
                <span>Ready to ask</span>
              </div>
              <p>{activePage.prompt}</p>
            </section>
          </div>

          <div className="onboarding-note">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Skip closes this launch only. Never show again saves the choice for this local user.</span>
          </div>
        </section>
      </div>
    </DialogShell>
  );
}
