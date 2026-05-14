import type { TerminalShellId } from "../types/terminal";

export interface BackgroundTerminalSession {
  browserPreviewUrl?: string;
  command: string;
  lastSeenAt: number;
  outputPreview?: string;
  sessionId: string;
  shell?: TerminalShellId;
  startedAt: number;
  workingDirectory?: string;
}

const STORAGE_KEY = "gilbert-codex-background-terminal-sessions";
const MAX_SESSION_AGE_MS = 8 * 60 * 60 * 1000;

let sessions = loadStoredSessions();

export function registerBackgroundTerminalSession(session: {
  browserPreviewUrl?: string;
  command: string;
  outputPreview?: string;
  sessionId: string;
  shell?: TerminalShellId;
  startedAt?: number;
  workingDirectory?: string;
}) {
  const now = Date.now();
  const existing = sessions.get(session.sessionId);
  sessions.set(session.sessionId, {
    ...existing,
    browserPreviewUrl: session.browserPreviewUrl ?? existing?.browserPreviewUrl,
    command: session.command,
    lastSeenAt: now,
    outputPreview: trimOutputPreview(session.outputPreview) ?? existing?.outputPreview,
    sessionId: session.sessionId,
    shell: session.shell ?? existing?.shell,
    startedAt: session.startedAt ?? existing?.startedAt ?? now,
    workingDirectory: session.workingDirectory ?? existing?.workingDirectory,
  });
  pruneBackgroundTerminalSessions();
  persistSessions();
}

export function updateBackgroundTerminalSession(sessionId: string, patch: Partial<Omit<BackgroundTerminalSession, "sessionId" | "startedAt">>) {
  const existing = sessions.get(sessionId);

  if (!existing) {
    return;
  }

  sessions.set(sessionId, {
    ...existing,
    browserPreviewUrl: patch.browserPreviewUrl ?? existing.browserPreviewUrl,
    command: patch.command ?? existing.command,
    lastSeenAt: Date.now(),
    outputPreview: trimOutputPreview(patch.outputPreview ?? existing.outputPreview),
    shell: patch.shell ?? existing.shell,
    workingDirectory: patch.workingDirectory ?? existing.workingDirectory,
  });
  pruneBackgroundTerminalSessions();
  persistSessions();
}

export function unregisterBackgroundTerminalSession(sessionId: string) {
  if (!sessions.delete(sessionId)) {
    return;
  }

  persistSessions();
}

export function getBackgroundTerminalSessions() {
  pruneBackgroundTerminalSessions();
  return [...sessions.values()].sort((left, right) => right.lastSeenAt - left.lastSeenAt);
}

export function formatBackgroundTerminalSessionsForPrompt() {
  const activeSessions = getBackgroundTerminalSessions();

  if (activeSessions.length === 0) {
    return "";
  }

  const lines = [
    "# Background Terminal Sessions",
    "Gilbert Codex has started these long-running local commands recently. Treat them as owned by the app: reuse their localhost URL or inspect/attach before starting a duplicate. If one looks stale, verify it first instead of telling the user to run the command themselves.",
  ];

  for (const session of activeSessions) {
    const detail = [
      `session=${session.sessionId}`,
      session.shell ? `shell=${session.shell}` : "",
      session.workingDirectory ? `cwd=${session.workingDirectory}` : "",
      session.browserPreviewUrl ? `url=${session.browserPreviewUrl}` : "",
    ].filter(Boolean).join(", ");
    lines.push(`- ${session.command}${detail ? ` (${detail})` : ""}.`);
  }

  return lines.join("\n");
}

function trimOutputPreview(value?: string) {
  return value?.trim() || undefined;
}

function pruneBackgroundTerminalSessions() {
  const cutoff = Date.now() - MAX_SESSION_AGE_MS;

  for (const [sessionId, session] of sessions.entries()) {
    if (session.lastSeenAt < cutoff) {
      sessions.delete(sessionId);
    }
  }
}

function loadStoredSessions() {
  const map = new Map<string, BackgroundTerminalSession>();

  if (typeof window === "undefined") {
    return map;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return map;
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return map;
    }

    for (const item of parsed) {
      const session = normalizeStoredSession(item);

      if (session) {
        map.set(session.sessionId, session);
      }
    }
  } catch {
    return new Map();
  }

  return map;
}

function normalizeStoredSession(value: unknown): BackgroundTerminalSession | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const command = typeof candidate.command === "string" ? candidate.command.trim() : "";
  const sessionId = typeof candidate.sessionId === "string" ? candidate.sessionId.trim() : "";

  if (!command || !sessionId) {
    return undefined;
  }

  const now = Date.now();
  return {
    browserPreviewUrl: typeof candidate.browserPreviewUrl === "string" ? candidate.browserPreviewUrl : undefined,
    command,
    lastSeenAt: typeof candidate.lastSeenAt === "number" ? candidate.lastSeenAt : now,
    outputPreview: typeof candidate.outputPreview === "string" ? trimOutputPreview(candidate.outputPreview) : undefined,
    sessionId,
    shell: isTerminalShellId(candidate.shell) ? candidate.shell : undefined,
    startedAt: typeof candidate.startedAt === "number" ? candidate.startedAt : now,
    workingDirectory: typeof candidate.workingDirectory === "string" ? candidate.workingDirectory : undefined,
  };
}

function persistSessions() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...sessions.values()]));
  } catch {
    // Session memory is convenience-only; storage failures must not break command execution.
  }
}

function isTerminalShellId(value: unknown): value is TerminalShellId {
  return value === "powershell" || value === "cmd" || value === "bash" || value === "zsh" || value === "sh";
}
