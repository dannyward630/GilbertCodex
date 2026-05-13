import { useEffect, useState } from "react";
import { AlertTriangle, FileCode2, FlaskConical, Layers, RefreshCw, Trash2 } from "lucide-react";
import {
  emptyProjectToolsSnapshot,
  loadProjectToolsSnapshot,
  removeToolOverlay,
} from "../../selfHeal";
import type { ProjectToolsSnapshot } from "../../selfHeal";

interface ProjectToolsPanelProps {
  /** Active workspace root. Empty string disables most actions and shows a hint. */
  workspaceRoot: string;
  /** All enabled workspace roots — forwarded to write helpers so they pass policy. */
  workspaceRoots: string[];
}

/**
 * Workspace-pivoted view of project-specific tool adaptations: overlays from
 * `.gilbert/tool-overrides.json`, shadows under `.gilbert/tools/`, and the
 * recent failure rollup. All actions write back through the self-heal package
 * and refresh the snapshot — no app-wide state is involved.
 */
export function ProjectToolsPanel({ workspaceRoot, workspaceRoots }: ProjectToolsPanelProps) {
  const [snapshot, setSnapshot] = useState<ProjectToolsSnapshot>(() => emptyProjectToolsSnapshot(workspaceRoot));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingTool, setPendingTool] = useState<string | null>(null);

  async function refresh() {
    if (!workspaceRoot) {
      setSnapshot(emptyProjectToolsSnapshot(workspaceRoot));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await loadProjectToolsSnapshot(workspaceRoot);
      setSnapshot(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load project tools.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // Re-run when the workspace root changes; refresh is stable enough across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceRoot]);

  const hasContent = snapshot.overlays.length > 0 || snapshot.shadows.length > 0 || snapshot.failureSummaries.length > 0;

  const handleRemoveOverlay = async (tool: string) => {
    if (!workspaceRoot || workspaceRoots.length === 0) return;
    setPendingTool(tool);
    try {
      await removeToolOverlay(workspaceRoot, tool, workspaceRoots);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove overlay.");
    } finally {
      setPendingTool(null);
    }
  };

  return (
    <section className="utility-section" aria-labelledby="project-tools-title">
      <div className="utility-section-heading">
        <h2 id="project-tools-title">This Project</h2>
        <span>{workspaceRoot ? truncatePath(workspaceRoot) : "Open a workspace to enable per-project tools"}</span>
      </div>

      <div className="utility-header-actions" style={{ marginBottom: "0.75rem" }}>
        <button type="button" onClick={() => void refresh()} disabled={loading || !workspaceRoot}>
          <RefreshCw size={14} aria-hidden="true" style={{ marginRight: "0.35rem" }} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error ? (
        <p role="alert" style={{ color: "var(--utility-warn, #c0a000)" }}>
          {error}
        </p>
      ) : null}

      {!workspaceRoot ? (
        <p>
          Once a workspace is open, this section shows project overlays from <code>.gilbert/tool-overrides.json</code>, shadow scripts under <code>.gilbert/tools/</code>, and recent tool failures the agent can adapt to.
        </p>
      ) : !hasContent ? (
        <p>
          No project adaptations yet. The agent will adapt foundational tools per-workspace after repeat failures and the results will appear here.
        </p>
      ) : null}

      {snapshot.failureSummaries.length > 0 ? (
        <FailureSummarySection summaries={snapshot.failureSummaries} />
      ) : null}

      {snapshot.overlays.length > 0 ? (
        <OverlaysSection
          overlays={snapshot.overlays}
          onRemove={handleRemoveOverlay}
          pendingTool={pendingTool}
        />
      ) : null}

      {snapshot.shadows.length > 0 ? (
        <ShadowsSection shadows={snapshot.shadows} />
      ) : null}
    </section>
  );
}

function FailureSummarySection({ summaries }: { summaries: ProjectToolsSnapshot["failureSummaries"] }) {
  return (
    <div className="tool-surface-grid" aria-label="Recent tool failures">
      {summaries.slice(0, 8).map((summary) => (
        <article className="tool-surface-card" key={`${summary.tool}::${summary.cause}`} data-status="error" data-phase="Current">
          <div className="tool-card-header">
            <span className="tool-card-icon" aria-hidden="true">
              <AlertTriangle size={18} />
            </span>
            <span className="tool-status">{summary.count}× — {formatRelative(summary.latestAt)}</span>
          </div>
          <div>
            <div className="tool-card-title-row">
              <h3>{summary.tool}</h3>
              <span className="tool-status">{summary.cause}</span>
            </div>
            <p>{summary.summary}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

interface OverlaysSectionProps {
  overlays: ProjectToolsSnapshot["overlays"];
  onRemove: (tool: string) => void;
  pendingTool: string | null;
}

function OverlaysSection({ overlays, onRemove, pendingTool }: OverlaysSectionProps) {
  return (
    <>
      <div className="utility-section-heading" style={{ marginTop: "1.25rem" }}>
        <h3>Active overlays</h3>
        <span>Arg-merge overrides applied at dispatch</span>
      </div>
      <div className="tool-surface-grid" aria-label="Project tool overlays">
        {overlays.map((overlay) => {
          const argKeys = overlay.args ? Object.keys(overlay.args) : [];
          return (
            <article className="tool-surface-card" key={overlay.tool} data-status="Active" data-enabled={true} data-phase="Current">
              <div className="tool-card-header">
                <span className="tool-card-icon" aria-hidden="true">
                  <Layers size={18} />
                </span>
                <button
                  className="tool-toggle"
                  type="button"
                  onClick={() => onRemove(overlay.tool)}
                  disabled={pendingTool === overlay.tool}
                  aria-label={`Reset overlay for ${overlay.tool}`}
                  title="Reset to foundation"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
              <div>
                <div className="tool-card-title-row">
                  <h3>{overlay.tool}</h3>
                  <span className="tool-status">{overlay.motivatingCause ?? "manual"}</span>
                </div>
                <p>{overlay.notes ?? "No notes recorded."}</p>
              </div>
              <div className="tool-card-meta">
                <span>{argKeys.length} arg override{argKeys.length === 1 ? "" : "s"}</span>
                <span>Updated {formatRelative(overlay.updatedAt)}</span>
              </div>
              <div className="tool-chip-row" aria-label={`${overlay.tool} overlay args`}>
                {argKeys.slice(0, 6).map((key) => (
                  <span key={key}>{key}</span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

function ShadowsSection({ shadows }: { shadows: ProjectToolsSnapshot["shadows"] }) {
  return (
    <>
      <div className="utility-section-heading" style={{ marginTop: "1.25rem" }}>
        <h3>Project shadows</h3>
        <span>Scripts under .gilbert/tools/ that override built-in tools</span>
      </div>
      <div className="tool-surface-grid" aria-label="Project shadow tools">
        {shadows.map((shadow) => (
          <article className="tool-surface-card" key={shadow.path} data-status="Active" data-enabled={true} data-phase="Current">
            <div className="tool-card-header">
              <span className="tool-card-icon" aria-hidden="true">
                <FileCode2 size={18} />
              </span>
              <span className="tool-status">{shadow.runtime}</span>
            </div>
            <div>
              <div className="tool-card-title-row">
                <h3>{shadow.name}</h3>
                <span className="tool-status">shadow</span>
              </div>
              <p style={{ wordBreak: "break-all" }}>{shadow.path}</p>
            </div>
            <div className="tool-card-meta">
              <span>{shadow.size ? `${Math.round(shadow.size / 1024)} KB` : "Size unknown"}</span>
              <span>{shadow.modifiedAt ? `Modified ${formatRelative(shadow.modifiedAt)}` : "Modified unknown"}</span>
            </div>
            <div className="tool-chip-row" aria-label={`${shadow.name} runtime`}>
              <span>
                <FlaskConical size={11} aria-hidden="true" style={{ marginRight: "0.2rem" }} />
                {shadow.runtime}
              </span>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

function truncatePath(path: string): string {
  if (path.length <= 64) return path;
  return `${path.slice(0, 28)}…${path.slice(-32)}`;
}

function formatRelative(ms: number): string {
  const delta = Date.now() - ms;
  const seconds = Math.max(0, Math.floor(delta / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

