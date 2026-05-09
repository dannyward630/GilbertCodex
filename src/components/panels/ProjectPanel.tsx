import { FolderOpen, GitBranch, ShieldCheck } from "lucide-react";
import { StatusPill } from "../status/StatusPill";

export function ProjectPanel() {
  return (
    <section className="workspace-panel project-panel" aria-labelledby="project-panel-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Project</p>
          <h2 id="project-panel-title">No folder selected</h2>
        </div>
        <StatusPill icon={ShieldCheck} label="Local first" tone="ready" />
      </div>
      <div className="empty-state">
        <FolderOpen size={28} aria-hidden="true" />
        <p>Phase 1 keeps project loading dormant while the desktop shell comes online.</p>
      </div>
      <div className="metadata-list">
        <span>
          <GitBranch size={15} aria-hidden="true" />
          Worktree support planned
        </span>
        <span>
          <ShieldCheck size={15} aria-hidden="true" />
          Approval gates planned
        </span>
      </div>
    </section>
  );
}
