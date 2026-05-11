import { getHostPlatform, getDefaultTerminalShell, terminalShellLabel } from "../lib/terminalShells";
import { getComputerGitStatus, listComputerDirectory, readComputerTextFile } from "./computer/files";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";

export type WorkspaceProjectType = "node" | "python" | "rust" | "tauri" | "unknown";

export type WorkspacePackageManager =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "uv"
  | "poetry"
  | "pipenv"
  | "pip"
  | "cargo"
  | "unknown";

export interface WorkspaceProjectSnapshot {
  nodeRequirement?: string;
  packageManager: WorkspacePackageManager;
  packageName?: string;
  projectType: WorkspaceProjectType;
  pythonRequirement?: string;
  root: string;
  scripts?: string[];
}

export interface WorkspaceGitSnapshot {
  ahead: number;
  behind: number;
  branch?: string;
  clean: boolean;
  root: string;
  upstream?: string;
}

export interface WorkspaceContextSnapshot {
  capturedAt: number;
  gitBranches: WorkspaceGitSnapshot[];
  permissionMode: string;
  platform: string;
  projects: WorkspaceProjectSnapshot[];
  roots: string[];
  scope: string;
  shell: string;
}

let cachedSnapshot: WorkspaceContextSnapshot | null = null;
let lastInputSignature: string | null = null;
let pendingRefresh: Promise<void> | null = null;

const CACHE_TTL_MS = 30_000;
const DETECTION_TIMEOUT_MS = 1_500;
const MAX_DETECTED_ROOTS = 4;

function signatureForInputs(settings: LocalWorkspaceSettings) {
  return `${settings.scope}|${settings.permissionMode}|${[...settings.roots].sort().join("|")}`;
}

export function getWorkspaceContextSnapshot(): WorkspaceContextSnapshot | null {
  return cachedSnapshot;
}

export function clearWorkspaceContextCache() {
  cachedSnapshot = null;
  lastInputSignature = null;
}

export async function refreshWorkspaceContext(settings: LocalWorkspaceSettings): Promise<void> {
  if (!settings || settings.roots.length === 0) {
    cachedSnapshot = {
      capturedAt: Date.now(),
      gitBranches: [],
      permissionMode: settings?.permissionMode ?? "unknown",
      platform: getHostPlatform(),
      projects: [],
      roots: [],
      scope: settings?.scope ?? "current-folder",
      shell: terminalShellLabel(getDefaultTerminalShell()),
    };
    lastInputSignature = settings ? signatureForInputs(settings) : null;
    return;
  }

  const signature = signatureForInputs(settings);
  const cacheStillFresh =
    cachedSnapshot !== null &&
    lastInputSignature === signature &&
    Date.now() - cachedSnapshot.capturedAt < CACHE_TTL_MS;

  if (cacheStillFresh) {
    return;
  }

  if (pendingRefresh) {
    return pendingRefresh;
  }

  pendingRefresh = runDetection(settings, signature).finally(() => {
    pendingRefresh = null;
  });

  return pendingRefresh;
}

async function runDetection(settings: LocalWorkspaceSettings, signature: string): Promise<void> {
  const roots = settings.roots.slice(0, MAX_DETECTED_ROOTS);

  try {
    const [projects, gitStatuses] = await Promise.all([
      Promise.all(roots.map((root) => withTimeout(detectProjectAtRoot(root), DETECTION_TIMEOUT_MS, null))),
      Promise.all(roots.map((root) => withTimeout(getComputerGitStatus(root), DETECTION_TIMEOUT_MS, null).catch(() => null))),
    ]);

    cachedSnapshot = {
      capturedAt: Date.now(),
      gitBranches: gitStatuses
        .flatMap((status, index): WorkspaceGitSnapshot[] => {
          if (!status || !status.available || !status.branch) {
            return [];
          }

          return [{
            ahead: status.ahead ?? 0,
            behind: status.behind ?? 0,
            branch: status.branch,
            clean: status.clean ?? true,
            root: roots[index],
            upstream: status.upstream,
          }];
        }),
      permissionMode: settings.permissionMode,
      platform: getHostPlatform(),
      projects: projects.filter((project): project is WorkspaceProjectSnapshot => project !== null),
      roots,
      scope: settings.scope,
      shell: terminalShellLabel(getDefaultTerminalShell()),
    };
    lastInputSignature = signature;
  } catch {
    // Detection failures should never break prompt assembly. Leave any
    // previous snapshot in place; the next refresh will try again.
  }
}

async function detectProjectAtRoot(root: string): Promise<WorkspaceProjectSnapshot | null> {
  let listing;

  try {
    listing = await listComputerDirectory(root, 96);
  } catch {
    return null;
  }

  const fileNames = new Set(listing.entries.map((entry) => entry.name.toLowerCase()));
  const has = (name: string) => fileNames.has(name.toLowerCase());

  let projectType: WorkspaceProjectType = "unknown";

  if (has("tauri.conf.json") || has("tauri.conf.json5") || has("src-tauri")) {
    projectType = "tauri";
  } else if (has("package.json")) {
    projectType = "node";
  } else if (has("pyproject.toml") || has("requirements.txt") || has("setup.py")) {
    projectType = "python";
  } else if (has("cargo.toml")) {
    projectType = "rust";
  }

  if (projectType === "unknown") {
    return null;
  }

  if (projectType === "node" || projectType === "tauri") {
    return await detectNodeLikeProject(root, projectType, fileNames);
  }

  if (projectType === "python") {
    return await detectPythonProject(root, fileNames);
  }

  return {
    packageManager: "cargo",
    projectType: "rust",
    root,
  };
}

async function detectNodeLikeProject(
  root: string,
  projectType: WorkspaceProjectType,
  fileNames: Set<string>,
): Promise<WorkspaceProjectSnapshot> {
  let packageManager: WorkspacePackageManager = "npm";

  if (fileNames.has("pnpm-lock.yaml")) {
    packageManager = "pnpm";
  } else if (fileNames.has("yarn.lock")) {
    packageManager = "yarn";
  } else if (fileNames.has("bun.lockb") || fileNames.has("bun.lock")) {
    packageManager = "bun";
  }

  let packageName: string | undefined;
  let scripts: string[] | undefined;
  let nodeRequirement: string | undefined;

  try {
    const file = await readComputerTextFile(joinWorkspacePath(root, "package.json"), 64 * 1024);
    const parsed = JSON.parse(file.content) as Record<string, unknown>;

    if (typeof parsed.name === "string") {
      packageName = parsed.name;
    }

    if (parsed.scripts && typeof parsed.scripts === "object") {
      scripts = Object.keys(parsed.scripts as Record<string, unknown>).slice(0, 16);
    }

    const engines = parsed.engines as Record<string, unknown> | undefined;
    if (engines && typeof engines.node === "string") {
      nodeRequirement = engines.node;
    }

    if (typeof parsed.packageManager === "string") {
      const declared = parsed.packageManager.split("@")[0]?.toLowerCase();

      if (declared === "npm" || declared === "pnpm" || declared === "yarn" || declared === "bun") {
        packageManager = declared;
      }
    }
  } catch {
    // The directory listing already confirmed package.json exists; if read or
    // JSON parse fails we still report the detected type with safe defaults.
  }

  return {
    nodeRequirement,
    packageManager,
    packageName,
    projectType,
    root,
    scripts,
  };
}

async function detectPythonProject(root: string, fileNames: Set<string>): Promise<WorkspaceProjectSnapshot> {
  let packageManager: WorkspacePackageManager = "pip";

  if (fileNames.has("uv.lock")) {
    packageManager = "uv";
  } else if (fileNames.has("poetry.lock")) {
    packageManager = "poetry";
  } else if (fileNames.has("pipfile.lock") || fileNames.has("pipfile")) {
    packageManager = "pipenv";
  }

  let pythonRequirement: string | undefined;
  let packageName: string | undefined;

  if (fileNames.has("pyproject.toml")) {
    try {
      const file = await readComputerTextFile(joinWorkspacePath(root, "pyproject.toml"), 64 * 1024);
      const versionMatch = file.content.match(/requires-python\s*=\s*["']([^"']+)["']/i);

      if (versionMatch) {
        pythonRequirement = versionMatch[1];
      }

      const nameMatch = file.content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);

      if (nameMatch) {
        packageName = nameMatch[1];
      }
    } catch {
      // Same fallback policy as Node — keep detected type.
    }
  }

  return {
    packageManager,
    packageName,
    projectType: "python",
    pythonRequirement,
    root,
  };
}

function joinWorkspacePath(root: string, name: string) {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const trimmed = root.replace(/[\\/]+$/, "");
  return `${trimmed}${separator}${name}`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

export function formatWorkspaceContextForPrompt(snapshot: WorkspaceContextSnapshot | null): string {
  if (!snapshot) {
    return "";
  }

  if (snapshot.roots.length === 0) {
    return [
      "# Workspace Context",
      "No workspace root is currently enabled. File and terminal tools are unavailable until the user selects a project folder.",
    ].join("\n");
  }

  const lines: string[] = [
    "# Workspace Context",
    `Workspace roots: ${snapshot.roots.join(" | ")}`,
    `Permission mode: ${snapshot.permissionMode}; scope: ${snapshot.scope}`,
    `Host platform: ${snapshot.platform}; default shell: ${snapshot.shell}.`,
  ];

  if (snapshot.projects.length === 0) {
    lines.push("Project type: not yet detected. If you need build/install hints, read package.json, pyproject.toml, or Cargo.toml directly.");
  } else {
    for (const project of snapshot.projects) {
      const detail: string[] = [`type=${project.projectType}`];

      if (project.packageName) {
        detail.push(`name=${project.packageName}`);
      }

      detail.push(`package_manager=${project.packageManager}`);

      if (project.nodeRequirement) {
        detail.push(`engines.node=${project.nodeRequirement}`);
      }

      if (project.pythonRequirement) {
        detail.push(`requires-python=${project.pythonRequirement}`);
      }

      lines.push(`Detected project at ${project.root}: ${detail.join(", ")}.`);

      if (project.scripts && project.scripts.length > 0) {
        lines.push(`  Available npm scripts: ${project.scripts.join(", ")}.`);
      }
    }
  }

  for (const git of snapshot.gitBranches) {
    const parts = [`branch=${git.branch ?? "(detached)"}`, `clean=${git.clean ? "yes" : "no"}`];

    if (git.upstream) {
      parts.push(`upstream=${git.upstream}`);
    }

    if (git.ahead > 0) {
      parts.push(`ahead=${git.ahead}`);
    }

    if (git.behind > 0) {
      parts.push(`behind=${git.behind}`);
    }

    lines.push(`Git at ${git.root}: ${parts.join(", ")}.`);
  }

  lines.push("Use this context to skip discovery tool calls when the answer is already here. Re-check with read_file or git_status only when state may have changed.");

  return lines.join("\n");
}

export function getDetectedProjectTypes(): Set<WorkspaceProjectType> {
  if (!cachedSnapshot) {
    return new Set();
  }

  return new Set(cachedSnapshot.projects.map((project) => project.projectType));
}
