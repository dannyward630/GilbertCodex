/**
 * Combined view of a workspace's tool surface, built for the Toolbox UI.
 *
 * Reads three sources:
 *   1. `.gilbert/tool-overrides.json` — arg-merge overlays
 *   2. `.gilbert/tools/` directory listing — shadow scripts
 *   3. The in-memory failure ledger (hydrated from disk on first call)
 *
 * The output is intentionally flat and serializable so the UI never has to
 * reach back into the self-heal package internals — it just renders this.
 */

import { listComputerDirectory } from "../tools/computer/files";
import { ensureWorkspaceFailuresLoaded, workspaceKey } from "./failureLedger";
import { readToolOverrides } from "./overrides";
import type { ToolFailureRecord, ToolOverlay } from "./types";

const SHADOW_RUNTIMES_BY_EXT: Record<string, string> = {
  bash: "bash",
  cmd: "cmd",
  js: "javascript",
  ps1: "powershell",
  py: "python",
  sh: "sh",
  ts: "typescript",
  zsh: "zsh",
};

export interface ProjectShadowTool {
  /** Tool name derived from the file (sans extension). May shadow a built-in. */
  name: string;
  /** Absolute path of the shadow script. */
  path: string;
  /** Detected runtime label (python, typescript, powershell, ...). */
  runtime: string;
  /** File size in bytes if reported by the directory listing. */
  size?: number;
  /** Last modification time (ms) if reported. */
  modifiedAt?: number;
}

export interface ProjectFailureSummary {
  tool: string;
  /** Most recent same-cause grouping. Lets the UI render "3× package_manager_mismatch — 5m ago". */
  cause: string;
  summary: string;
  count: number;
  latestAt: number;
}

export interface ProjectToolsSnapshot {
  workspaceRoot: string;
  workspaceKey: string;
  overlays: ToolOverlay[];
  shadows: ProjectShadowTool[];
  recentFailures: ToolFailureRecord[];
  failureSummaries: ProjectFailureSummary[];
}

/** Returns an empty snapshot tagged with the workspace key. Use when no roots are open. */
export function emptyProjectToolsSnapshot(workspaceRoot = ""): ProjectToolsSnapshot {
  return {
    failureSummaries: [],
    overlays: [],
    recentFailures: [],
    shadows: [],
    workspaceKey: workspaceKey(workspaceRoot ? [workspaceRoot] : []),
    workspaceRoot,
  };
}

/** Builds the snapshot for the given workspace root. Best-effort: I/O failures yield empty arrays. */
export async function loadProjectToolsSnapshot(workspaceRoot: string): Promise<ProjectToolsSnapshot> {
  if (!workspaceRoot) return emptyProjectToolsSnapshot();

  const key = workspaceKey([workspaceRoot]);
  const [manifest, shadows, failures] = await Promise.all([
    readToolOverrides(workspaceRoot).catch(() => ({ overlays: {}, version: 1 as const })),
    listShadowTools(workspaceRoot).catch(() => [] as ProjectShadowTool[]),
    ensureWorkspaceFailuresLoaded(key).catch(() => [] as ToolFailureRecord[]),
  ]);

  return {
    failureSummaries: summarizeFailures(failures),
    overlays: Object.values(manifest.overlays).sort((a, b) => b.updatedAt - a.updatedAt),
    recentFailures: failures,
    shadows: shadows.sort((a, b) => a.name.localeCompare(b.name)),
    workspaceKey: key,
    workspaceRoot,
  };
}

async function listShadowTools(workspaceRoot: string): Promise<ProjectShadowTool[]> {
  const dir = `${workspaceRoot.replace(/[\\/]+$/, "")}/.gilbert/tools`;
  try {
    const listing = await listComputerDirectory(dir, 200);
    return listing.entries
      .filter((entry) => entry.kind === "file" && entry.extension && entry.extension in SHADOW_RUNTIMES_BY_EXT)
      .map((entry) => ({
        modifiedAt: entry.modifiedAt,
        name: entry.name.replace(/\.[^.]+$/, ""),
        path: entry.path,
        runtime: SHADOW_RUNTIMES_BY_EXT[entry.extension ?? ""] ?? "unknown",
        size: entry.size,
      }));
  } catch {
    return [];
  }
}

function summarizeFailures(records: ToolFailureRecord[]): ProjectFailureSummary[] {
  const grouped = new Map<string, ProjectFailureSummary>();
  for (const record of records) {
    const key = `${record.tool}::${record.cause}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count += 1;
      existing.latestAt = Math.max(existing.latestAt, record.at);
    } else {
      grouped.set(key, {
        cause: record.cause,
        count: 1,
        latestAt: record.at,
        summary: record.summary,
        tool: record.tool,
      });
    }
  }
  return [...grouped.values()].sort((a, b) => b.latestAt - a.latestAt);
}
