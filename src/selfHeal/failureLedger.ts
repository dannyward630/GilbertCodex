/**
 * In-memory ledger of recent tool failures, keyed by workspace + signature.
 *
 * Phase 1 keeps everything in memory: the high-value case is "same agent run
 * keeps hitting the same broken tool", which is exactly what the runtime
 * loop produces. Persistence across process restarts can be added later
 * without changing this module's surface.
 *
 * The streak is what drives adaptation. Every same-signature failure
 * increments the streak; any success on the same tool clears the streak for
 * every signature on that tool (a success means whatever was broken now
 * works, so the streak shouldn't carry over to a future regression).
 */

import { isWorkspaceLoaded, loadPersistedFailures, schedulePersistFailures } from "./failurePersistence";
import type { ClassifiedFailure, ToolFailureRecord } from "./types";

interface WorkspaceLedger {
  /** Last few failures kept for UI / debugging. Capped at MAX_RETAINED_FAILURES. */
  recent: ToolFailureRecord[];
  /** Streak counter per cause signature. */
  streaks: Map<string, number>;
}

const MAX_RETAINED_FAILURES = 50;
const ledgersByWorkspace = new Map<string, WorkspaceLedger>();

/** Returns a stable key for a workspace's primary root. */
export function workspaceKey(roots: string[]): string {
  if (roots.length === 0) {
    return "<no-workspace>";
  }
  return roots[0].trim().replace(/[\\/]+$/, "").toLowerCase();
}

function getLedger(workspace: string): WorkspaceLedger {
  let ledger = ledgersByWorkspace.get(workspace);
  if (!ledger) {
    ledger = { recent: [], streaks: new Map() };
    ledgersByWorkspace.set(workspace, ledger);
  }
  return ledger;
}

/** Snapshot of what the ledger looked like after a record was added. */
export interface RecordedFailure {
  /** How many consecutive failures share this signature (this one included). */
  streak: number;
  /** True once the streak meets the adaptation threshold. */
  shouldAdapt: boolean;
  /** Record as stored. */
  record: ToolFailureRecord;
}

const ADAPTATION_THRESHOLD = 2;

/** Records a failure and returns whether adaptation should kick in. */
export function recordToolFailure(
  workspace: string,
  input: {
    tool: string;
    args: Record<string, string>;
    classification: ClassifiedFailure;
    /** Workspace roots used purely to authorize the debounced disk write. */
    roots?: string[];
  },
): RecordedFailure {
  const ledger = getLedger(workspace);
  const record: ToolFailureRecord = {
    args: sanitizeArgs(input.args),
    at: Date.now(),
    cause: input.classification.cause,
    signature: input.classification.signature,
    summary: input.classification.summary,
    tool: input.tool,
  };

  ledger.recent.unshift(record);
  if (ledger.recent.length > MAX_RETAINED_FAILURES) {
    ledger.recent.length = MAX_RETAINED_FAILURES;
  }

  const streak = (ledger.streaks.get(record.signature) ?? 0) + 1;
  ledger.streaks.set(record.signature, streak);

  if (input.roots && input.roots.length > 0) {
    schedulePersistFailures(workspace, ledger.recent, input.roots);
  }

  return {
    record,
    shouldAdapt: input.classification.adaptable && streak >= ADAPTATION_THRESHOLD,
    streak,
  };
}

/**
 * Loads persisted failures for a workspace on first access. Safe to call from
 * UI mount points or from the executor before tool dispatch — it's a no-op
 * after the first call per workspace.
 */
export async function ensureWorkspaceFailuresLoaded(workspace: string): Promise<ToolFailureRecord[]> {
  if (isWorkspaceLoaded(workspace)) {
    return getRecentFailures(workspace);
  }

  const loaded = await loadPersistedFailures(workspace);
  if (loaded.length === 0) {
    return getRecentFailures(workspace);
  }

  const ledger = getLedger(workspace);
  // Merge persisted records into the in-memory recent list, newest first,
  // and skip duplicates (same tool + signature + at).
  const seen = new Set(ledger.recent.map((record) => `${record.tool}::${record.signature}::${record.at}`));
  for (const record of loaded) {
    const key = `${record.tool}::${record.signature}::${record.at}`;
    if (!seen.has(key)) {
      ledger.recent.push(record);
      seen.add(key);
    }
  }
  ledger.recent.sort((a, b) => b.at - a.at);
  if (ledger.recent.length > MAX_RETAINED_FAILURES) {
    ledger.recent.length = MAX_RETAINED_FAILURES;
  }

  return getRecentFailures(workspace);
}

/** Clears streaks for every signature on this tool — the tool just worked. */
export function recordToolSuccess(workspace: string, tool: string) {
  const ledger = getLedger(workspace);
  if (ledger.streaks.size === 0) return;

  const prefix = `${tool}::`;
  for (const signature of [...ledger.streaks.keys()]) {
    if (signature.startsWith(prefix)) {
      ledger.streaks.delete(signature);
    }
  }
}

/** Returns the N most-recent failure records, newest first. */
export function getRecentFailures(workspace: string, limit = MAX_RETAINED_FAILURES): ToolFailureRecord[] {
  const ledger = ledgersByWorkspace.get(workspace);
  if (!ledger) return [];
  return ledger.recent.slice(0, Math.max(0, limit));
}

/** Test/utility hook — clears everything. Not exported beyond the package. */
export function resetFailureLedgerForTests() {
  ledgersByWorkspace.clear();
}

/** Strips secret-shaped arg values so the ledger / UI / prompts never leak them. */
function sanitizeArgs(args: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (looksSecret(key) || looksSecret(value)) {
      out[key] = "<redacted>";
      continue;
    }
    out[key] = value.length > 600 ? `${value.slice(0, 600)}…` : value;
  }
  return out;
}

const SECRET_KEY_RE = /(?:token|secret|password|api[_-]?key|authorization|bearer)/i;
const SECRET_VALUE_RE = /^(?:ghp_|github_pat_|sk-|xoxb-|xoxp-|AKIA[0-9A-Z]{16})/;

function looksSecret(value: string) {
  if (SECRET_KEY_RE.test(value)) return true;
  if (SECRET_VALUE_RE.test(value)) return true;
  return false;
}
