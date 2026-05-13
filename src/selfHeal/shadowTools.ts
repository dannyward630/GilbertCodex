/**
 * Shadow-tool lookup.
 *
 * The agent can drop a script at `.gilbert/tools/<built_in_name>.<ext>` to
 * shadow a foundational tool inside one workspace. When dispatch sees a
 * shadow for the tool it's about to run, it rewrites the call to `run_tool`
 * so the script runs instead — the foundational tool stays untouched and
 * other workspaces are unaffected.
 *
 * Phase 1 keeps the allowlist tight: only execution-class tools that the
 * agent is most likely to need to adapt (run_terminal, run_tests, ...).
 * Hot read-only tools like read_file, search_files, list_directory must
 * never be shadowed — they'd surprise the agent and break invariants the
 * dispatcher relies on.
 */

import { readComputerTextFile } from "../tools/computer/files";

/** Tools that may be shadowed by a project script. Read-only/query tools are not on this list. */
const SHADOWABLE_TOOLS: ReadonlySet<string> = new Set([
  "run_terminal",
  "run_tests",
  "run_subagents",
  "typescript_check",
]);

/** File extensions probed in priority order. Matches CUSTOM_TOOL_RUNTIME_EXTENSIONS. */
const SHADOW_EXTENSIONS: readonly string[] = ["py", "ts", "js", "ps1", "sh", "bash", "zsh", "cmd"];

const PROBE_CACHE_TTL_MS = 5_000;
interface ShadowProbe {
  /** Absolute path of the shadow script, or null if no shadow exists. */
  path: string | null;
  /** Wall-clock ms when this probe was taken. */
  probedAt: number;
}

const shadowProbeCache = new Map<string, ShadowProbe>();

function cacheKey(workspaceRoot: string, tool: string) {
  return `${workspaceRoot.toLowerCase()}::${tool}`;
}

/** Returns the absolute path of a shadow script for `tool`, or undefined if none. */
export async function findShadowForTool(workspaceRoot: string, tool: string): Promise<string | undefined> {
  if (!SHADOWABLE_TOOLS.has(tool)) return undefined;
  if (!workspaceRoot || workspaceRoot === "<no-workspace>") return undefined;

  const key = cacheKey(workspaceRoot, tool);
  const cached = shadowProbeCache.get(key);
  if (cached && Date.now() - cached.probedAt < PROBE_CACHE_TTL_MS) {
    return cached.path ?? undefined;
  }

  const base = workspaceRoot.replace(/[\\/]+$/, "");
  for (const ext of SHADOW_EXTENSIONS) {
    const candidate = `${base}/.gilbert/tools/${tool}.${ext}`;
    if (await fileExists(candidate)) {
      shadowProbeCache.set(key, { path: candidate, probedAt: Date.now() });
      return candidate;
    }
  }

  shadowProbeCache.set(key, { path: null, probedAt: Date.now() });
  return undefined;
}

/** Invalidates the cached shadow probe so a freshly-written shadow is picked up. */
export function invalidateShadowProbe(workspaceRoot: string, tool: string) {
  shadowProbeCache.delete(cacheKey(workspaceRoot, tool));
}

/** Test hook — clears the entire probe cache. */
export function clearShadowProbeCacheForTests() {
  shadowProbeCache.clear();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readComputerTextFile(path, 1);
    return true;
  } catch {
    return false;
  }
}
