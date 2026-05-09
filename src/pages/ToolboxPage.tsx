import {
  Bot,
  Braces,
  BrainCircuit,
  CheckCircle2,
  Code2,
  Database,
  FileSearch,
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

interface ToolSurface {
  capabilities: string[];
  icon: LucideIcon;
  label: string;
  rail: string;
  status: "Phase 1 UI" | "Planned" | "Gated";
  summary: string;
}

interface ToolRail {
  count: string;
  icon: LucideIcon;
  label: string;
  status: string;
}

const primaryTools: ToolSurface[] = [
  {
    capabilities: ["Search", "Open", "Capture"],
    icon: Globe2,
    label: "Web",
    rail: "Browser rail",
    status: "Phase 1 UI",
    summary: "Browse pages, collect sources, and inspect web app previews.",
  },
  {
    capabilities: ["Read", "Chunk", "Embed"],
    icon: FileSearch,
    label: "Files",
    rail: "Workspace rail",
    status: "Planned",
    summary: "Read project files, build local vectors, and retrieve relevant context.",
  },
  {
    capabilities: ["Patch", "Create", "Format"],
    icon: PenTool,
    label: "Write",
    rail: "Approval rail",
    status: "Gated",
    summary: "Create and edit files through reviewable, permissioned changes.",
  },
  {
    capabilities: ["Click", "Type", "Screenshot"],
    icon: MonitorUp,
    label: "Computer",
    rail: "Desktop rail",
    status: "Gated",
    summary: "Use controlled desktop access for visual checks and local app flows.",
  },
];

const supportingTools: ToolSurface[] = [
  {
    capabilities: ["Commands", "Logs"],
    icon: TerminalSquare,
    label: "Terminal",
    rail: "Execution",
    status: "Planned",
    summary: "Run local checks and collect command output.",
  },
  {
    capabilities: ["Repo", "Diff"],
    icon: Code2,
    label: "Source control",
    rail: "Workspace",
    status: "Planned",
    summary: "Track branch state, staged work, and reviewable changes.",
  },
  {
    capabilities: ["Models", "Keys"],
    icon: Braces,
    label: "Provider",
    rail: "Model calls",
    status: "Phase 1 UI",
    summary: "Route chat requests through configured model providers.",
  },
  {
    capabilities: ["Policy", "Audit"],
    icon: ShieldCheck,
    label: "Permissions",
    rail: "Safety",
    status: "Phase 1 UI",
    summary: "Keep sensitive actions behind confirmation and review gates.",
  },
];

const toolRails: ToolRail[] = [
  { count: "04", icon: Bot, label: "Primary surfaces", status: "Visible" },
  { count: "03", icon: KeyRound, label: "Approval gates", status: "Required" },
  { count: "01", icon: Database, label: "Vector index", status: "Planned" },
  { count: "00", icon: CheckCircle2, label: "Active runs", status: "Idle" },
];

const buildPath = [
  { icon: ScanSearch, label: "Discover", value: "Tool registry and permissions" },
  { icon: HardDrive, label: "Context", value: "Files, vectors, and workspace state" },
  { icon: BrainCircuit, label: "Reason", value: "Model call plus retrieved evidence" },
  { icon: Workflow, label: "Act", value: "Write, browser, terminal, or computer tool" },
];

export function ToolboxPage() {
  return (
    <div className="utility-page">
      <section className="utility-shell" aria-labelledby="toolbox-title">
        <header className="utility-header">
          <div>
            <p className="eyebrow">Toolbox</p>
            <h1 id="toolbox-title">Tool registry</h1>
          </div>
          <div className="utility-header-actions" aria-label="Toolbox status">
            <span>UI scaffold</span>
            <span>Permission first</span>
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

        <section className="utility-section" aria-labelledby="toolbox-primary-title">
          <div className="utility-section-heading">
            <h2 id="toolbox-primary-title">Primary tools</h2>
            <span>Phase-one layout</span>
          </div>
          <div className="tool-surface-grid">
            {primaryTools.map((tool) => (
              <ToolSurfaceCard key={tool.label} tool={tool} featured />
            ))}
          </div>
        </section>

        <section className="utility-section utility-section-split" aria-labelledby="toolbox-system-title">
          <div className="utility-section-heading">
            <h2 id="toolbox-system-title">System tools</h2>
            <span>Shared surfaces</span>
          </div>
          <div className="tool-support-grid">
            {supportingTools.map((tool) => (
              <ToolSurfaceCard key={tool.label} tool={tool} />
            ))}
          </div>
          <div className="tool-flow-panel" aria-label="Tool call path">
            {buildPath.map((item) => {
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

function ToolSurfaceCard({ featured = false, tool }: { featured?: boolean; tool: ToolSurface }) {
  const Icon = tool.icon;

  return (
    <article className="tool-surface-card" data-featured={featured} data-status={tool.status}>
      <div className="tool-card-header">
        <span className="tool-card-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <span className="tool-status">{tool.status}</span>
      </div>
      <div>
        <h3>{tool.label}</h3>
        <p>{tool.summary}</p>
      </div>
      <div className="tool-card-meta">
        <span>{tool.rail}</span>
      </div>
      <div className="tool-chip-row" aria-label={`${tool.label} capabilities`}>
        {tool.capabilities.map((capability) => (
          <span key={capability}>{capability}</span>
        ))}
      </div>
    </article>
  );
}
