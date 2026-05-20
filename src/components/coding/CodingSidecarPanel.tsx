import { Code2, GitBranch, GripVertical, Maximize2, Minimize2, ShieldCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import type { AgentRun } from "../../types/agentRun";
import type { ChatSummary } from "../../types/chat";
import type { LocalWorkspaceSettings } from "../../types/localWorkspace";
import { CodingCodebaseTab } from "./CodingCodebaseTab";
import { CodingReviewTab } from "./CodingReviewTab";
import { formatRelativeTime } from "./CodingSidecarShared";

export type CodingSidecarTab = "review" | "codebase";

interface CodingSidecarPanelProps {
  agentRuns: AgentRun[];
  chat: ChatSummary;
  expanded: boolean;
  initialTab: CodingSidecarTab;
  localWorkspace: LocalWorkspaceSettings;
  previewWidth: number;
  resizeMaxWidth: number;
  resizeMinWidth: number;
  root: string;
  onClose: () => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>) => void;
  onSubmitPrompt: (prompt: string) => void | Promise<void>;
  onToggleExpanded: () => void;
}

const TABS: Array<{ id: CodingSidecarTab; label: string; icon: LucideIcon }> = [
  { icon: GitBranch, id: "review", label: "Review" },
  { icon: Code2, id: "codebase", label: "Codebase" },
];

export function CodingSidecarPanel({
  agentRuns,
  chat,
  expanded,
  initialTab,
  localWorkspace,
  previewWidth,
  resizeMaxWidth,
  resizeMinWidth,
  root,
  onClose,
  onResizeKeyDown,
  onResizeStart,
  onSubmitPrompt,
  onToggleExpanded,
}: CodingSidecarPanelProps) {
  const [activeTab, setActiveTab] = useState<CodingSidecarTab>(initialTab);
  const safeAgentRuns = agentRuns ?? [];
  const activeRun = useMemo(() => findActiveRun(chat, safeAgentRuns), [safeAgentRuns, chat]);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  return (
    <aside className="coding-sidecar-panel" data-expanded={expanded} style={{ "--coding-sidecar-width": `${previewWidth}px` } as CSSProperties} aria-label="Coding environment">
      <div
        className="coding-sidecar-resize-handle"
        aria-label="Resize coding sidecar"
        aria-orientation="vertical"
        aria-valuemax={resizeMaxWidth}
        aria-valuemin={resizeMinWidth}
        aria-valuenow={Math.round(previewWidth)}
        role="separator"
        tabIndex={expanded ? -1 : 0}
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizeStart}
      >
        <GripVertical size={15} aria-hidden="true" />
      </div>

      <div className="coding-sidecar-window">
        <header className="coding-sidecar-header">
          <div className="coding-sidecar-title">
            <ShieldCheck size={19} aria-hidden="true" />
            <span>
              <small>Bridge-first coding</small>
              <strong>{activeRun?.title ?? chat.title}</strong>
              <em>{activeRun ? `${activeRun.status} / updated ${formatRelativeTime(activeRun.updatedAt)}` : "No run captured yet"}</em>
            </span>
          </div>
          <div className="coding-sidecar-actions">
            <button type="button" aria-label={expanded ? "Restore coding sidecar" : "Expand coding sidecar"} title={expanded ? "Restore" : "Expand"} onClick={onToggleExpanded}>
              {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            </button>
            <button type="button" aria-label="Close coding sidecar" title="Close" onClick={onClose}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        <nav className="coding-sidecar-tabs" aria-label="Coding sidecar tabs">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} type="button" data-active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                <Icon size={15} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="coding-sidecar-content">
          {activeTab === "review" ? <CodingReviewTab activeRun={activeRun} root={root} onSubmitPrompt={onSubmitPrompt} /> : null}
          {activeTab === "codebase" ? <CodingCodebaseTab activeRun={activeRun} localWorkspace={localWorkspace} root={root} /> : null}
        </div>
      </div>
    </aside>
  );
}

function findActiveRun(chat: ChatSummary, runs: AgentRun[]) {
  const messageRunIds = [...chat.messages]
    .reverse()
    .map((message) => message.agentRunId)
    .filter((id): id is string => Boolean(id));

  for (const runId of messageRunIds) {
    const run = runs.find((candidate) => candidate.id === runId);
    if (run) return run;
  }

  return runs
    .filter((run) => run.chatId === chat.id)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}
