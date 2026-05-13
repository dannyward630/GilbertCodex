/**
 * Read/write helpers for `.gilbert/tool-overrides.json`.
 *
 * Phase 1 only exposes read + write; the dispatcher does not yet *apply*
 * overlays at call time. That happens in Phase 2 once the schema settles
 * and the UI exists. Reads are cached per-workspace to keep dispatch
 * costs flat — the cache invalidates whenever we (or anyone else) writes.
 */

import { readComputerTextFile, writeComputerTextFile } from "../tools/computer/files";
import { emptyToolOverridesManifest } from "./types";
import type { ToolOverlay, ToolOverridesManifest } from "./types";

const MANIFEST_PATH_SUFFIX = ".gilbert/tool-overrides.json";

interface ManifestCacheEntry {
  manifest: ToolOverridesManifest;
  loadedAt: number;
}

const MANIFEST_CACHE_TTL_MS = 2_000;
const manifestCache = new Map<string, ManifestCacheEntry>();

function manifestPath(workspaceRoot: string) {
  const trimmed = workspaceRoot.replace(/[\\/]+$/, "");
  return `${trimmed}/${MANIFEST_PATH_SUFFIX}`;
}

/** Reads the manifest for a workspace. Returns the empty manifest if missing. Cached briefly. */
export async function readToolOverrides(workspaceRoot: string): Promise<ToolOverridesManifest> {
  const cached = manifestCache.get(workspaceRoot);
  if (cached && Date.now() - cached.loadedAt < MANIFEST_CACHE_TTL_MS) {
    return cached.manifest;
  }

  try {
    const file = await readComputerTextFile(manifestPath(workspaceRoot), 256 * 1024);
    const parsed = parseManifest(file.content);
    manifestCache.set(workspaceRoot, { loadedAt: Date.now(), manifest: parsed });
    return parsed;
  } catch {
    // Missing/unreadable manifest is the default; treat as empty.
    const fresh = emptyToolOverridesManifest();
    manifestCache.set(workspaceRoot, { loadedAt: Date.now(), manifest: fresh });
    return fresh;
  }
}

/** Writes the manifest and refreshes the cache. */
export async function writeToolOverrides(workspaceRoot: string, manifest: ToolOverridesManifest, roots: string[]) {
  const path = manifestPath(workspaceRoot);
  const body = JSON.stringify(manifest, null, 2);
  await writeComputerTextFile(path, body, roots, { createParentDirs: true, overwrite: true });
  manifestCache.set(workspaceRoot, { loadedAt: Date.now(), manifest });
}

/** Upserts a single overlay and writes the manifest. Returns the updated manifest. */
export async function upsertToolOverlay(workspaceRoot: string, overlay: ToolOverlay, roots: string[]): Promise<ToolOverridesManifest> {
  const current = await readToolOverrides(workspaceRoot);
  const next: ToolOverridesManifest = {
    overlays: { ...current.overlays, [overlay.tool]: { ...overlay, updatedAt: Date.now() } },
    version: 1,
  };
  await writeToolOverrides(workspaceRoot, next, roots);
  return next;
}

/** Removes an overlay and writes the manifest. Returns the updated manifest. */
export async function removeToolOverlay(workspaceRoot: string, tool: string, roots: string[]): Promise<ToolOverridesManifest> {
  const current = await readToolOverrides(workspaceRoot);
  if (!(tool in current.overlays)) return current;
  const remaining = { ...current.overlays };
  delete remaining[tool];
  const next: ToolOverridesManifest = { overlays: remaining, version: 1 };
  await writeToolOverrides(workspaceRoot, next, roots);
  return next;
}

/** Returns the overlay for a tool, or undefined if none is set. */
export function lookupOverlay(manifest: ToolOverridesManifest, tool: string): ToolOverlay | undefined {
  return manifest.overlays[tool];
}

/** Test hook — clears the in-memory cache. */
export function clearOverridesCacheForTests() {
  manifestCache.clear();
}

function parseManifest(raw: string): ToolOverridesManifest {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return emptyToolOverridesManifest();
    const record = parsed as Record<string, unknown>;
    if (record.version !== 1) return emptyToolOverridesManifest();

    const overlays = record.overlays;
    if (!overlays || typeof overlays !== "object") return emptyToolOverridesManifest();

    const normalized: Record<string, ToolOverlay> = {};
    for (const [tool, value] of Object.entries(overlays as Record<string, unknown>)) {
      const overlay = normalizeOverlay(tool, value);
      if (overlay) normalized[tool] = overlay;
    }

    return { overlays: normalized, version: 1 };
  } catch {
    return emptyToolOverridesManifest();
  }
}

function normalizeOverlay(tool: string, value: unknown): ToolOverlay | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : Date.now();
  const args = isStringRecord(record.args) ? record.args : undefined;
  const notes = typeof record.notes === "string" ? record.notes : undefined;
  const motivatingCauseRaw = typeof record.motivatingCause === "string" ? record.motivatingCause : undefined;

  return {
    args,
    motivatingCause: motivatingCauseRaw as ToolOverlay["motivatingCause"],
    notes,
    tool,
    updatedAt,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).every((entry) => typeof entry === "string");
}
