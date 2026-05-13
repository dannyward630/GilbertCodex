/**
 * Disk persistence for the failure ledger.
 *
 * The ledger lives in memory for hot dispatch, but persists to
 * `.gilbert/tool-failures.json` so cross-session "this keeps breaking"
 * signals survive restarts. Reads are best-effort (missing file =
 * empty ledger); writes are debounced and fire-and-forget so a slow
 * disk never blocks tool execution.
 */

import { readComputerTextFile, writeComputerTextFile } from "../tools/computer/files";
import type { ToolFailureRecord } from "./types";

const PERSIST_PATH_SUFFIX = ".gilbert/tool-failures.json";
const PERSIST_DEBOUNCE_MS = 600;
const MAX_PERSISTED_FAILURES = 100;
const PERSIST_FORMAT_VERSION = 1 as const;

interface PersistedFailureLedger {
  version: typeof PERSIST_FORMAT_VERSION;
  failures: ToolFailureRecord[];
}

interface PendingWrite {
  timer: ReturnType<typeof setTimeout>;
  records: ToolFailureRecord[];
  roots: string[];
}

const pendingWrites = new Map<string, PendingWrite>();
const loadedWorkspaces = new Set<string>();

function persistPath(workspaceRoot: string) {
  return `${workspaceRoot.replace(/[\\/]+$/, "")}/${PERSIST_PATH_SUFFIX}`;
}

/** Loads persisted failures for a workspace. Returns [] if missing or malformed. */
export async function loadPersistedFailures(workspaceRoot: string): Promise<ToolFailureRecord[]> {
  if (!workspaceRoot || workspaceRoot === "<no-workspace>") return [];

  try {
    const file = await readComputerTextFile(persistPath(workspaceRoot), 512 * 1024);
    const parsed = JSON.parse(file.content) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const record = parsed as PersistedFailureLedger;
    if (record.version !== PERSIST_FORMAT_VERSION) return [];
    if (!Array.isArray(record.failures)) return [];

    return record.failures
      .filter(isWellFormedFailureRecord)
      .slice(0, MAX_PERSISTED_FAILURES);
  } catch {
    return [];
  } finally {
    loadedWorkspaces.add(workspaceRoot);
  }
}

/** Returns true once `loadPersistedFailures` has been called for this workspace. */
export function isWorkspaceLoaded(workspaceRoot: string) {
  return loadedWorkspaces.has(workspaceRoot);
}

/**
 * Schedules a debounced write. Subsequent calls within the debounce window
 * overwrite the queued records. Errors are swallowed — persistence must never
 * break the tool runtime.
 */
export function schedulePersistFailures(workspaceRoot: string, records: ToolFailureRecord[], roots: string[]) {
  if (!workspaceRoot || workspaceRoot === "<no-workspace>") return;
  if (roots.length === 0) return;

  const existing = pendingWrites.get(workspaceRoot);
  if (existing) {
    clearTimeout(existing.timer);
  }

  const trimmed = records.slice(0, MAX_PERSISTED_FAILURES);
  const timer = setTimeout(() => {
    pendingWrites.delete(workspaceRoot);
    void writePersistedFailures(workspaceRoot, trimmed, roots).catch(() => undefined);
  }, PERSIST_DEBOUNCE_MS);

  pendingWrites.set(workspaceRoot, { records: trimmed, roots, timer });
}

async function writePersistedFailures(workspaceRoot: string, records: ToolFailureRecord[], roots: string[]) {
  const body = JSON.stringify({ failures: records, version: PERSIST_FORMAT_VERSION } satisfies PersistedFailureLedger, null, 2);
  await writeComputerTextFile(persistPath(workspaceRoot), body, roots, {
    createParentDirs: true,
    overwrite: true,
  });
}

function isWellFormedFailureRecord(value: unknown): value is ToolFailureRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tool === "string" &&
    typeof record.cause === "string" &&
    typeof record.summary === "string" &&
    typeof record.signature === "string" &&
    typeof record.at === "number" &&
    record.args !== null &&
    typeof record.args === "object"
  );
}

/** Test hook — clears the in-memory tracking sets. Does not touch disk. */
export function resetFailurePersistenceForTests() {
  for (const pending of pendingWrites.values()) {
    clearTimeout(pending.timer);
  }
  pendingWrites.clear();
  loadedWorkspaces.clear();
}
