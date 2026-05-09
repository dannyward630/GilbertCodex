import {
  Bot,
  Braces,
  BrainCircuit,
  CheckCircle2,
  Database,
  FileCode2,
  FileSearch,
  GitBranch,
  Globe2,
  HardDrive,
  KeyRound,
  MonitorUp,
  PenTool,
  ScanSearch,
  ShieldCheck,
  TerminalSquare,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { normalizeToolRegistrySettings } from "../types/tools";
import type { ToolRegistryId, ToolRegistrySettings } from "../types/tools";

type ToolPhase = "Current" | "Upcoming";
type ToolStatus = "Active" | "Available" | "Preview" | "Queued";

interface ToolSurface {
  capabilities: string[];
  detail: string;
  icon: LucideIcon;
  id: ToolRegistryId;
  label: string;
  phase: ToolPhase;
  rail: string;
  status: ToolStatus;
  summary: string;
}

interface ToolRail {
  count: string;
  icon: LucideIcon;
  label: string;
  status: string;
}

interface ToolboxPageProps {
  onSettingsChange: (settings: ToolRegistrySettings) => void;
  settings: ToolRegistrySettings;
}

const currentTools: ToolSurface[] = [
  {
    capabilities: ["web_search", "DuckDuckGo", "Sources"],
    detail: "Agent-callable",
    icon: Globe2,
    id: "webSearch",
    label: "Web Search",
    phase: "Current",
    rail: "Agent runtime",
    status: "Active",
    summary: "On-demand web search from chat or thinking for current facts, docs, errors, and citations.",
  },
  {
    capabilities: ["list_directory", "build_index", "Roots"],
    detail: "Workspace",
    icon: HardDrive,
    id: "fileBrowser",
    label: "Local Workspace",
    phase: "Current",
    rail: "Computer files",
    status: "Active",
    summary: "Open folders, browse directories, build the local vector index, and load project memory.",
  },
  {
    capabilities: ["search_files", "Vectors", "Snippets"],
    detail: "Embedding index",
    icon: Database,
    id: "fileSearch",
    label: "Vector File Search",
    phase: "Current",
    rail: "Retrieval",
    status: "Active",
    summary: "Find relevant files through the local embedding index before reading or editing code.",
  },
  {
    capabilities: ["view_code", "read_file", "Line/char"],
    detail: "Precision view",
    icon: FileSearch,
    id: "codeView",
    label: "Code Viewer",
    phase: "Current",
    rail: "Read tools",
    status: "Active",
    summary: "Inspect exact line ranges, word offsets, and character windows for careful code work.",
  },
  {
    capabilities: ["edit_file", "write_file", "1-char edits"],
    detail: "Workspace writes",
    icon: PenTool,
    id: "codeEdit",
    label: "Code Editor",
    phase: "Current",
    rail: "Write tools",
    status: "Active",
    summary: "Patch code with exact replacements, line-range edits, or single-letter punctuation fixes.",
  },
  {
    capabilities: ["PowerShell", "CMD", "Logs"],
    detail: "Desktop surface",
    icon: TerminalSquare,
    id: "terminal",
    label: "Terminal",
    phase: "Current",
    rail: "Execution",
    status: "Available",
    summary: "Run local commands and checks in the built-in terminal panel.",
  },
  {
    capabilities: ["Tabs", "Preview", "Localhost"],
    detail: "Preview surface",
    icon: MonitorUp,
    id: "browserPreview",
    label: "Browser Preview",
    phase: "Current",
    rail: "Browser rail",
    status: "Available",
    summary: "Open web pages or local app previews beside the chat thread.",
  },
  {
    capabilities: ["Reasoning", "Trace", "Effort"],
    detail: "Model mode",
    icon: BrainCircuit,
    id: "thinking",
    label: "Thinking",
    phase: "Current",
    rail: "Model runtime",
    status: "Active",
    summary: "Request and display model reasoning for harder coding and debugging work.",
  },
  {
    capabilities: ["Plan mode", "Questions", "Passes"],
    detail: "Workflow mode",
    icon: Workflow,
    id: "planning",
    label: "Planning",
    phase: "Current",
    rail: "Conversation",
    status: "Active",
    summary: "Run staged planning passes and clarification cards before implementation.",
  },
  {
    capabilities: ["OpenRouter", "Models", "Context"],
    detail: "Provider",
    icon: Braces,
    id: "provider",
    label: "Model Provider",
    phase: "Current",
    rail: "Model calls",
    status: "Active",
    summary: "Route chat requests through the selected model, context window, and token settings.",
  },
];

const upcomingTools: ToolSurface[] = [
  {
    capabilities: ["Click", "Type", "Screenshots"],
    detail: "Queued",
    icon: MonitorUp,
    id: "desktopComputer",
    label: "Desktop Computer",
    phase: "Upcoming",
    rail: "Computer control",
    status: "Queued",
    summary: "Controlled visual desktop actions for app QA and local UI flows.",
  },
  {
    capabilities: ["Git", "Diff", "PR"],
    detail: "Queued",
    icon: GitBranch,
    id: "sourceControl",
    label: "Source Control",
    phase: "Upcoming",
    rail: "Repository",
    status: "Queued",
    summary: "Branch state, diffs, commits, pushes, and pull request workflows.",
  },
  {
    capabilities: ["Runs", "Follow-ups", "Monitors"],
    detail: "Queued",
    icon: Workflow,
    id: "workflowAutomation",
    label: "Workflow Automation",
    phase: "Upcoming",
    rail: "Background work",
    status: "Queued",
    summary: "Long-running jobs, scheduled checks, and resumable follow-up workflows.",
  },
];

const toolFlow = [
  { icon: ScanSearch, label: "Discover", value: "Search web, files, and local vectors" },
  { icon: FileCode2, label: "Inspect", value: "View exact code lines or characters" },
  { icon: BrainCircuit, label: "Reason", value: "Think with tool evidence in context" },
  { icon: PenTool, label: "Act", value: "Patch files or run local surfaces" },
];

export function ToolboxPage({ onSettingsChange, settings }: ToolboxPageProps) {
  const normalizedSettings = normalizeToolRegistrySettings(settings);
  const allTools = [...currentTools, ...upcomingTools];
  const enabledCount = allTools.filter((tool) => normalizedSettings[tool.id]).length;
  const disabledCount = allTools.length - enabledCount;
  const toolRails: ToolRail[] = [
    { count: String(currentTools.length).padStart(2, "0"), icon: Bot, label: "Current tools", status: "Live" },
    { count: String(upcomingTools.length).padStart(2, "0"), icon: KeyRound, label: "Upcoming tools", status: "Queued" },
    { count: String(enabledCount).padStart(2, "0"), icon: CheckCircle2, label: "Enabled", status: disabledCount ? `${disabledCount} off` : "All on" },
    { count: "01", icon: ShieldCheck, label: "Safety gate", status: "Always enforced" },
  ];

  function toggleTool(toolId: ToolRegistryId) {
    onSettingsChange({
      ...normalizedSettings,
      [toolId]: !normalizedSettings[toolId],
    });
  }

  function setAllTools(enabled: boolean) {
    onSettingsChange(
      Object.fromEntries(allTools.map((tool) => [tool.id, enabled])) as ToolRegistrySettings,
    );
  }

  return (
    <div className="utility-page">
      <section className="utility-shell" aria-labelledby="toolbox-title">
        <header className="utility-header">
          <div>
            <p className="eyebrow">Toolbox</p>
            <h1 id="toolbox-title">Tool registry</h1>
          </div>
          <div className="utility-header-actions" aria-label="Toolbox actions">
            <button type="button" onClick={() => setAllTools(true)}>
              Enable all
            </button>
            <button type="button" onClick={() => setAllTools(false)}>
              Disable all
            </button>
          </div>
        </header>

        <div className="utility-stat-grid" aria-label="Toolbox overview">
          {toolRails.map((item) => {
            const Icon = item.icon;

            return (
              <article className="utility-stat-card" key={item.label}>
                <Icon size={18} aria-hidden="true" />
                <span>{item.label}</span>
                <strong>{item.count}</strong>
                <small>{item.status}</small>
              </article>
            );
          })}
        </div>

        <ToolSection
          heading="Current Tools"
          settings={normalizedSettings}
          subheading="Live in this build"
          tools={currentTools}
          onToggle={toggleTool}
        />

        <ToolSection
          heading="Upcoming Tools"
          settings={normalizedSettings}
          subheading="Pre-enabled for rollout"
          tools={upcomingTools}
          onToggle={toggleTool}
        />

        <section className="utility-section utility-section-split" aria-labelledby="toolbox-flow-title">
          <div className="utility-section-heading">
            <h2 id="toolbox-flow-title">Tool Flow</h2>
            <span>Runtime path</span>
          </div>
          <div className="tool-flow-panel" aria-label="Tool call path">
            {toolFlow.map((item) => {
              const Icon = item.icon;

              return (
                <article key={item.label}>
                  <Icon size={18} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </article>
              );
            })}
          </div>
        </section>
      </section>
    </div>
  );
}

function ToolSection({
  heading,
  onToggle,
  settings,
  subheading,
  tools,
}: {
  heading: string;
  onToggle: (toolId: ToolRegistryId) => void;
  settings: ToolRegistrySettings;
  subheading: string;
  tools: ToolSurface[];
}) {
  return (
    <section className="utility-section" aria-labelledby={`${heading.toLowerCase().replace(/\s+/g, "-")}-title`}>
      <div className="utility-section-heading">
        <h2 id={`${heading.toLowerCase().replace(/\s+/g, "-")}-title`}>{heading}</h2>
        <span>{subheading}</span>
      </div>
      <div className="tool-surface-grid">
        {tools.map((tool) => (
          <ToolSurfaceCard enabled={settings[tool.id]} key={tool.id} tool={tool} onToggle={() => onToggle(tool.id)} />
        ))}
      </div>
    </section>
  );
}

function ToolSurfaceCard({ enabled, onToggle, tool }: { enabled: boolean; onToggle: () => void; tool: ToolSurface }) {
  const Icon = tool.icon;

  return (
    <article className="tool-surface-card" data-enabled={enabled} data-phase={tool.phase} data-status={tool.status}>
      <div className="tool-card-header">
        <span className="tool-card-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <button
          className="tool-toggle"
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={`${enabled ? "Disable" : "Enable"} ${tool.label}`}
          data-on={enabled}
          onClick={onToggle}
        >
          <span />
        </button>
      </div>
      <div>
        <div className="tool-card-title-row">
          <h3>{tool.label}</h3>
          <span className="tool-status">{enabled ? "Enabled" : "Off"}</span>
        </div>
        <p>{tool.summary}</p>
      </div>
      <div className="tool-card-meta">
        <span>{tool.rail}</span>
        <span>{tool.detail}</span>
      </div>
      <div className="tool-chip-row" aria-label={`${tool.label} capabilities`}>
        {tool.capabilities.map((capability) => (
          <span key={capability}>{capability}</span>
        ))}
      </div>
    </article>
  );
}
