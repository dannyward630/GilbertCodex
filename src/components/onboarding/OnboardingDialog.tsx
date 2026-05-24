import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  FileSearch,
  Globe2,
  HardDrive,
  KeyRound,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { DialogShell } from "../dialogs/AppDialog";

type OnboardingAction = "close" | "settings";
type OnboardingPageId = "launch" | "workspace" | "ship";

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
  open: boolean;
}

const onboardingPages: OnboardingPage[] = [
  {
    checklist: ["Choose provider and model", "Set reasoning effort", "Keep web available on demand", "Start with a clear goal"],
    description: "Pick the model route, context behavior, and web/search posture before the first serious run. The point is to start calm, capable, and already aimed at the work.",
    eyebrow: "First run",
    features: [
      { detail: "Open provider settings, confirm API/runtime state, and keep the selected model intentional.", icon: Settings, label: "Model", title: "Set the path" },
      { detail: "Use higher reasoning effort when the task needs staged work, broad inspection, or careful source review.", icon: BrainCircuit, label: "Reasoning", title: "Set effort" },
      { detail: "Leave web search available for current facts, docs, dependency changes, and release checks.", icon: Globe2, label: "Fresh facts", title: "Search when needed" },
      { detail: "Ask for real work directly: inspect, change, test, rebuild, and summarize the result.", icon: Bot, label: "Agent", title: "Give it momentum" },
    ],
    flow: ["Model", "Reasoning", "Web", "First prompt"],
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
    checklist: ["Attach a project folder", "Review workspace context", "Use web when facts may be current", "Keep review gates visible"],
    description: "Gilbert Codex is strongest when it knows where the work lives. Workspace details ground the model, and attached tool-bridge actions stay bounded by the selected permissions.",
    eyebrow: "Workspace",
    features: [
      { detail: "Select a project folder so the app can attach bounded workspace metadata to the conversation.", icon: HardDrive, label: "Roots", title: "Connect the project" },
      { detail: "Use the selected project as orientation for file, terminal, browser, Git, and web work when matching tools are available.", icon: FileSearch, label: "Context", title: "Stay grounded" },
      { detail: "Keep web search available for current docs, releases, and source-backed facts.", icon: Globe2, label: "Web", title: "Use live sources" },
      { detail: "Terminal, destructive, credential, publish, and outside-scope actions stay behind review gates.", icon: ShieldCheck, label: "Review", title: "Keep control" },
    ],
    flow: ["Workspace", "Context", "Web", "Chat"],
    icon: HardDrive,
    id: "workspace",
    primaryAction: "close",
    primaryLabel: "Start a Chat",
    prompt: "Use the selected workspace, read the relevant files first, then implement and verify the fix.",
    stats: ["Bounded roots", "Local context", "Web-ready"],
    tabDetail: "Workspace context",
    tabLabel: "Workspace",
    title: "Keep the workspace visible while tools stay permissioned.",
  },
  {
    checklist: ["Use plans for broad changes", "Review sensitive actions", "Steer while streaming", "Ship with tests and Git evidence"],
    description: "The best sessions feel fast and trustworthy at the same time. Use review gates, visible activity, queued steering, and focused verification so the final answer has receipts.",
    eyebrow: "Ship safely",
    features: [
      { detail: "Sensitive local and remote actions stay visible through approvals, activity records, and final verification.", icon: ShieldCheck, label: "Control", title: "Keep authority visible" },
      { detail: "Planning and higher reasoning effort help split broad requests into staged, checkable moves.", icon: BrainCircuit, label: "Depth", title: "Plan before impact" },
      { detail: "Session approval and connected accounts keep repeated work smooth while preserving clear trust boundaries.", icon: KeyRound, label: "Access", title: "Approve once, work faster" },
      { detail: "End with tests, build checks, diffs, links, or release notes depending on what changed.", icon: CheckCircle2, label: "Evidence", title: "Finish with proof" },
    ],
    flow: ["Plan", "Act", "Review", "Verify"],
    icon: ShieldCheck,
    id: "ship",
    primaryAction: "settings",
    primaryLabel: "Open Settings",
    prompt: "Make the change, run the focused checks, and tell me exactly what passed or could not run.",
    stats: ["Review gates", "Steerable runs", "Web evidence"],
    tabDetail: "Review and verification",
    tabLabel: "Ship",
    title: "Move quickly, but leave a clean trail.",
  },
];

export function OnboardingDialog({ onClose, onNeverShowAgain, onOpenSettings, open }: OnboardingDialogProps) {
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
      description="A guided launch map for models, workspace context, web search, and review-first chat."
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
                Page {activePageIndex + 1} of {onboardingPages.length} - {activePage.eyebrow}
              </span>
              <h3>{activePage.title}</h3>
              <p>{activePage.description}</p>
              <div className="onboarding-stage-actions">
                <button type="button" onClick={() => runAction(activePage.primaryAction)}>
                  {activePage.primaryLabel}
                  <ChevronRight size={15} aria-hidden="true" />
                </button>
                {activePage.primaryAction !== "settings" ? (
                  <button type="button" onClick={onOpenSettings}>
                    Settings
                    <ChevronRight size={15} aria-hidden="true" />
                  </button>
                ) : null}
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
