import { listComputerDirectory, readComputerTextFile } from "../localWorkspace/files";
import { isTerminalShellId } from "./terminalShells";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type {
  ProjectRunAction,
  ProjectRunActionKind,
  ProjectRunActionSource,
  ProjectRunConfig,
  ProjectRunLastRun,
  ProjectRunStatus,
} from "../types/projectRun";
import type { TerminalShellId } from "../types/terminal";

export const PROJECT_RUN_CONFIG_VERSION = 1;

const NODE_DEV_SCRIPT_PRIORITY = ["app:dev", "dev", "start", "serve", "preview"];
const NODE_BUILD_SCRIPT_PRIORITY = ["app:build", "build"];
const NODE_TEST_SCRIPT_PRIORITY = ["test", "check"];

interface ProjectRunDetectionInput {
  files: string[];
  packageJson?: string;
  pyprojectToml?: string;
  root: string;
}

export function normalizeProjectRunConfig(value: unknown): ProjectRunConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions.flatMap((action) => {
        const normalized = normalizeProjectRunAction(action);
        return normalized ? [normalized] : [];
      })
    : [];
  const selectedActionId = typeof candidate.selectedActionId === "string" ? candidate.selectedActionId.trim() : "";
  const selectedActionExists = selectedActionId && actions.some((action) => action.id === selectedActionId);
  const lastRun = normalizeProjectRunLastRun(candidate.lastRun);

  if (actions.length === 0 && !lastRun) {
    return undefined;
  }

  return {
    actions,
    lastRun,
    selectedActionId: selectedActionExists ? selectedActionId : actions[0]?.id,
    version: PROJECT_RUN_CONFIG_VERSION,
  };
}

export function createProjectRunAction(
  patch: Partial<ProjectRunAction> & Pick<ProjectRunAction, "command" | "kind" | "label">,
): ProjectRunAction {
  const now = new Date().toISOString();
  const kind = normalizeRunActionKind(patch.kind) ?? "custom";

  return {
    background: patch.background ?? kind === "dev-server",
    command: patch.command.trim(),
    cwd: normalizeOptionalText(patch.cwd),
    id: patch.id?.trim() || createRunActionId(patch.label, patch.command),
    kind,
    label: patch.label.trim() || "Run",
    previewUrl: normalizePreviewUrl(patch.previewUrl),
    shell: normalizeTerminalShellId(patch.shell),
    source: normalizeRunActionSource(patch.source) ?? "user",
    updatedAt: patch.updatedAt || now,
  };
}

export function createEmptyProjectRunConfig(root?: string): ProjectRunConfig {
  const action = createProjectRunAction({
    command: "",
    cwd: root,
    id: "user:run",
    kind: "dev-server",
    label: "Run",
    source: "user",
  });

  return {
    actions: [action],
    selectedActionId: action.id,
    version: PROJECT_RUN_CONFIG_VERSION,
  };
}

export function ensureEditableProjectRunConfig(config: ProjectRunConfig | undefined, root?: string): ProjectRunConfig {
  if (config?.actions.length) {
    return config;
  }

  return createEmptyProjectRunConfig(root);
}

export function getSelectedProjectRunAction(config: ProjectRunConfig | undefined) {
  if (!config?.actions.length) {
    return undefined;
  }

  return config.actions.find((action) => action.id === config.selectedActionId) ?? config.actions[0];
}

export function saveProjectRunAction(config: ProjectRunConfig | undefined, action: ProjectRunAction): ProjectRunConfig {
  const normalizedAction = createProjectRunAction({
    ...action,
    source: "user",
    updatedAt: new Date().toISOString(),
  });
  const base = config ?? createEmptyProjectRunConfig(normalizedAction.cwd);
  const actions = base.actions.some((candidate) => candidate.id === normalizedAction.id)
    ? base.actions.map((candidate) => (candidate.id === normalizedAction.id ? normalizedAction : candidate))
    : [normalizedAction, ...base.actions];

  return {
    ...base,
    actions,
    selectedActionId: normalizedAction.id,
    version: PROJECT_RUN_CONFIG_VERSION,
  };
}

export function updateProjectRunLastRun(
  config: ProjectRunConfig | undefined,
  action: ProjectRunAction,
  patch: Partial<ProjectRunLastRun> & Pick<ProjectRunLastRun, "status">,
): ProjectRunConfig {
  const nextConfig = saveProjectRunAction(config, action);

  return {
    ...nextConfig,
    lastRun: {
      actionId: action.id,
      previewUrl: patch.previewUrl ?? action.previewUrl,
      ranAt: patch.ranAt ?? new Date().toISOString(),
      sessionId: patch.sessionId,
      status: patch.status,
    },
  };
}

export function mergeDetectedProjectRunActions(
  existing: ProjectRunConfig | undefined,
  detectedActions: ProjectRunAction[],
): ProjectRunConfig | undefined {
  const normalizedExisting = existing ? normalizeProjectRunConfig(existing) : undefined;
  const detected = detectedActions.map((action) =>
    createProjectRunAction({
      ...action,
      source: "detected",
    }),
  );

  if (!normalizedExisting?.actions.length) {
    if (detected.length === 0) {
      return normalizedExisting;
    }

    return {
      actions: detected,
      selectedActionId: detected.find((action) => action.kind === "dev-server")?.id ?? detected[0]?.id,
      version: PROJECT_RUN_CONFIG_VERSION,
    };
  }

  let changed = false;
  const existingById = new Map(normalizedExisting.actions.map((action) => [action.id, action]));
  const mergedActions = normalizedExisting.actions.map((action) => {
    const detectedAction = existingById.has(action.id) ? detected.find((candidate) => candidate.id === action.id) : undefined;

    if (!detectedAction) {
      return action;
    }

    if (action.source !== "detected" && action.command.trim()) {
      return action;
    }

    changed = true;
    return {
      ...detectedAction,
      id: action.id,
      updatedAt: action.updatedAt || detectedAction.updatedAt,
    };
  });

  for (const action of detected) {
    if (!existingById.has(action.id)) {
      mergedActions.push(action);
      changed = true;
    }
  }

  if (!changed) {
    return normalizedExisting;
  }

  const selectedActionId = normalizedExisting.selectedActionId && mergedActions.some((action) => action.id === normalizedExisting.selectedActionId)
    ? normalizedExisting.selectedActionId
    : mergedActions.find((action) => action.kind === "dev-server")?.id ?? mergedActions[0]?.id;

  return {
    ...normalizedExisting,
    actions: mergedActions,
    selectedActionId,
    version: PROJECT_RUN_CONFIG_VERSION,
  };
}

export async function detectProjectRunConfigForWorkspace(
  workspace: LocalWorkspaceSettings,
  existing?: ProjectRunConfig,
): Promise<ProjectRunConfig | undefined> {
  const root = workspace.enabled ? workspace.roots[0] : "";

  if (!root) {
    return existing ? normalizeProjectRunConfig(existing) : undefined;
  }

  try {
    const listing = await listComputerDirectory(root, 160);
    const files = listing.entries.map((entry) => entry.name);
    const lowerFiles = new Set(files.map((name) => name.toLowerCase()));
    const packageJson = lowerFiles.has("package.json")
      ? await readOptionalWorkspaceText(root, "package.json", 96 * 1024)
      : undefined;
    const pyprojectToml = lowerFiles.has("pyproject.toml")
      ? await readOptionalWorkspaceText(root, "pyproject.toml", 96 * 1024)
      : undefined;

    return mergeDetectedProjectRunActions(
      existing,
      detectProjectRunActions({
        files,
        packageJson,
        pyprojectToml,
        root,
      }),
    );
  } catch {
    return existing ? normalizeProjectRunConfig(existing) : undefined;
  }
}

export function detectProjectRunActions(input: ProjectRunDetectionInput): ProjectRunAction[] {
  const files = new Set(input.files.map((file) => file.toLowerCase()));
  const actions: ProjectRunAction[] = [];

  if (files.has("package.json")) {
    actions.push(...detectNodeRunActions(input.root, files, input.packageJson));
  }

  if (files.has("cargo.toml")) {
    actions.push(...detectRustRunActions(input.root));
  }

  actions.push(...detectPythonRunActions(input.root, files, input.pyprojectToml));
  actions.push(...detectCppRunActions(input.root, files));

  return dedupeActions(actions);
}

function detectNodeRunActions(root: string, files: Set<string>, packageJsonText?: string) {
  const parsedPackage = parsePackageJson(packageJsonText);
  const scripts = parsedPackage?.scripts ?? {};
  const scriptNames = new Set(Object.keys(scripts));
  const packageManager = detectNodePackageManager(files, parsedPackage?.packageManager);
  const actions: ProjectRunAction[] = [];
  const devScript = NODE_DEV_SCRIPT_PRIORITY.find((script) => scriptNames.has(script));
  const buildScript = NODE_BUILD_SCRIPT_PRIORITY.find((script) => scriptNames.has(script));
  const testScript = NODE_TEST_SCRIPT_PRIORITY.find((script) => scriptNames.has(script));

  actions.push(createDetectedRunAction({
    command: `${packageManager} install`,
    cwd: root,
    id: "detected:setup",
    kind: "setup",
    label: "Install dependencies",
    source: "detected",
  }));

  if (devScript) {
    const command = createNodeScriptCommand(packageManager, devScript);
    const scriptBody = typeof scripts[devScript] === "string" ? scripts[devScript] : "";
    actions.push(createDetectedRunAction({
      background: true,
      command,
      cwd: root,
      id: "detected:dev-server",
      kind: "dev-server",
      label: devScript === "app:dev" ? "Run app" : "Run dev server",
      previewUrl: detectPreviewUrl(scriptBody, devScript),
      source: "detected",
    }));
  }

  if (buildScript) {
    actions.push(createDetectedRunAction({
      background: false,
      command: createNodeScriptCommand(packageManager, buildScript),
      cwd: root,
      id: "detected:build",
      kind: "build",
      label: buildScript === "app:build" ? "Build app" : "Build",
      source: "detected",
    }));
  }

  if (testScript) {
    actions.push(createDetectedRunAction({
      background: false,
      command: createNodeScriptCommand(packageManager, testScript),
      cwd: root,
      id: "detected:test",
      kind: "test",
      label: testScript === "check" ? "Check" : "Test",
      source: "detected",
    }));
  }

  return actions;
}

function detectRustRunActions(root: string) {
  return [
    createDetectedRunAction({
      background: false,
      command: "cargo run",
      cwd: root,
      id: "detected:rust-run",
      kind: "custom",
      label: "Cargo run",
      source: "detected",
    }),
    createDetectedRunAction({
      background: false,
      command: "cargo build",
      cwd: root,
      id: "detected:rust-build",
      kind: "build",
      label: "Cargo build",
      source: "detected",
    }),
    createDetectedRunAction({
      background: false,
      command: "cargo test",
      cwd: root,
      id: "detected:rust-test",
      kind: "test",
      label: "Cargo test",
      source: "detected",
    }),
  ];
}

function detectPythonRunActions(root: string, files: Set<string>, pyprojectToml?: string) {
  if (files.has("manage.py")) {
    return [
      createDetectedRunAction({
        background: true,
        command: "python manage.py runserver",
        cwd: root,
        id: "detected:python-django",
        kind: "dev-server",
        label: "Run Django",
        previewUrl: "http://localhost:8000/",
        source: "detected",
      }),
    ];
  }

  const entryFile = files.has("app.py") ? "app.py" : files.has("main.py") ? "main.py" : "";

  if (!entryFile || (!files.has("requirements.txt") && !files.has("pyproject.toml") && !pyprojectToml)) {
    return [];
  }

  const isLikelyWebApp = pyprojectToml ? /\b(?:fastapi|flask|django|uvicorn)\b/i.test(pyprojectToml) : false;

  return [
    createDetectedRunAction({
      background: isLikelyWebApp,
      command: `python ${entryFile}`,
      cwd: root,
      id: "detected:python-run",
      kind: isLikelyWebApp ? "dev-server" : "custom",
      label: isLikelyWebApp ? "Run Python app" : "Run Python",
      source: "detected",
    }),
  ];
}

function detectCppRunActions(root: string, files: Set<string>) {
  if (files.has("cmakelists.txt")) {
    return [
      createDetectedRunAction({
        background: false,
        command: "cmake -S . -B build; cmake --build build",
        cwd: root,
        id: "detected:cmake-build",
        kind: "build",
        label: "Build with CMake",
        source: "detected",
      }),
    ];
  }

  if (files.has("makefile")) {
    return [
      createDetectedRunAction({
        background: false,
        command: "make",
        cwd: root,
        id: "detected:make-build",
        kind: "build",
        label: "Build",
        source: "detected",
      }),
    ];
  }

  return [];
}

function createDetectedRunAction(patch: Partial<ProjectRunAction> & Pick<ProjectRunAction, "command" | "kind" | "label">) {
  return createProjectRunAction({
    ...patch,
    source: "detected",
  });
}

function normalizeProjectRunAction(value: unknown): ProjectRunAction | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const id = normalizeOptionalText(candidate.id);
  const kind = normalizeRunActionKind(candidate.kind);
  const label = normalizeOptionalText(candidate.label);
  const source = normalizeRunActionSource(candidate.source) ?? "user";
  const command = typeof candidate.command === "string" ? candidate.command.trim() : "";

  if (!id || !kind || !label) {
    return undefined;
  }

  return {
    background: typeof candidate.background === "boolean" ? candidate.background : kind === "dev-server",
    command,
    cwd: normalizeOptionalText(candidate.cwd),
    id,
    kind,
    label,
    previewUrl: normalizePreviewUrl(candidate.previewUrl),
    shell: normalizeTerminalShellId(candidate.shell),
    source,
    updatedAt: normalizeOptionalText(candidate.updatedAt) ?? new Date().toISOString(),
  };
}

function normalizeProjectRunLastRun(value: unknown): ProjectRunLastRun | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const actionId = normalizeOptionalText(candidate.actionId);
  const ranAt = normalizeOptionalText(candidate.ranAt);
  const status = normalizeRunStatus(candidate.status);

  if (!actionId || !ranAt || !status) {
    return undefined;
  }

  return {
    actionId,
    previewUrl: normalizePreviewUrl(candidate.previewUrl),
    ranAt,
    sessionId: normalizeOptionalText(candidate.sessionId),
    status,
  };
}

function normalizeRunActionKind(value: unknown): ProjectRunActionKind | undefined {
  return value === "dev-server" || value === "setup" || value === "test" || value === "build" || value === "custom"
    ? value
    : undefined;
}

function normalizeRunActionSource(value: unknown): ProjectRunActionSource | undefined {
  return value === "detected" || value === "ai" || value === "user" ? value : undefined;
}

function normalizeRunStatus(value: unknown): ProjectRunStatus | undefined {
  return value === "running" || value === "reused" || value === "complete" || value === "error" ? value : undefined;
}

function normalizeTerminalShellId(value: unknown): TerminalShellId | undefined {
  return isTerminalShellId(value) ? value : undefined;
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePreviewUrl(value: unknown) {
  const raw = normalizeOptionalText(value);

  if (!raw) {
    return undefined;
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }
    if (url.hostname === "127.0.0.1" || url.hostname === "0.0.0.0" || url.hostname === "::1" || url.hostname === "[::1]") {
      url.hostname = "localhost";
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function parsePackageJson(text?: string) {
  if (!text) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const scripts = parsed.scripts && typeof parsed.scripts === "object"
      ? parsed.scripts as Record<string, unknown>
      : {};

    return {
      packageManager: typeof parsed.packageManager === "string" ? parsed.packageManager : undefined,
      scripts,
    };
  } catch {
    return undefined;
  }
}

function detectNodePackageManager(files: Set<string>, packageManager?: string) {
  const declared = packageManager?.split("@")[0]?.toLowerCase();

  if (declared === "npm" || declared === "pnpm" || declared === "yarn" || declared === "bun") {
    return declared;
  }

  if (files.has("pnpm-lock.yaml")) {
    return "pnpm";
  }

  if (files.has("yarn.lock")) {
    return "yarn";
  }

  if (files.has("bun.lockb") || files.has("bun.lock")) {
    return "bun";
  }

  return "npm";
}

function createNodeScriptCommand(packageManager: string, script: string) {
  if (packageManager === "npm") {
    return `npm run ${script}`;
  }

  return `${packageManager} run ${script}`;
}

function detectPreviewUrl(scriptBody: string, scriptName: string) {
  const explicitUrl = scriptBody.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/[^\s"'<>)]*)?/i)?.[0];
  const normalizedExplicitUrl = normalizePreviewUrl(explicitUrl);

  if (normalizedExplicitUrl) {
    return normalizedExplicitUrl;
  }

  const explicitPort = scriptBody.match(/(?:--port(?:=|\s+)|\bPORT=|\bPORT\s*=\s*)(\d{2,5})/i)?.[1];
  if (explicitPort) {
    return `http://localhost:${explicitPort}/`;
  }

  if (scriptName === "app:dev") {
    return "http://localhost:1420/";
  }

  return "http://localhost:5173/";
}

function dedupeActions(actions: ProjectRunAction[]) {
  const seen = new Set<string>();

  return actions.filter((action) => {
    const key = `${action.id}:${action.command}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function createRunActionId(label: string, command: string) {
  const slug = `${label} ${command}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);

  return `user:${slug || "run"}`;
}

async function readOptionalWorkspaceText(root: string, name: string, maxBytes: number) {
  try {
    const file = await readComputerTextFile(joinWorkspacePath(root, name), maxBytes);
    return file.content;
  } catch {
    return undefined;
  }
}

function joinWorkspacePath(root: string, name: string) {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${name}`;
}
