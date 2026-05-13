import type { ChatToolCall } from "../../../../types/chat";
import { buildComputerFileIndex, readComputerTextFile, writeComputerTextFile } from "../../files";
import { editComputerTextFile } from "../../editing";
import { assertSyntaxBeforeWrite } from "../../syntaxValidation";
import { collectTextQualityWarnings, formatTextQualityWarnings } from "../../textQuality";
import {
  argValue,
  booleanArg,
  firstArg,
  isMissingTextFileError,
  readLocalToolErrorMessage,
  readOriginalContentForSyntaxCheck,
  resolveWorkspacePath,
  skipNoRoots,
} from "../argHelpers";
import { createFileChangeSummary } from "../fileChanges";
import { recoverableToolFailure } from "../results";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, ToolHandlerContext } from "../types";
import { getWritePolicy } from "../workspacePolicy";

interface BatchEditEntry {
  content?: string;
  end_char?: number;
  end_line?: number;
  expected_text?: string;
  insert_at_line?: number;
  new_str?: string;
  new_string?: string;
  new_text?: string;
  occurrence?: number;
  occurrences?: number;
  old_str?: string;
  old_string?: string;
  old_text?: string;
  path: string;
  replace_entire_file?: boolean;
  sha?: string;
  sha256?: string;
  start_char?: number;
  start_line?: number;
  expected_sha256?: string;
}

interface EditFailure {
  kind: "parse" | "policy" | "missing" | "edit" | "write" | "syntax";
  path: string;
  reason: string;
}

interface EditSuccess {
  bytesWritten: number;
  changed: boolean;
  operation: string;
  path: string;
  qualityWarnings: string[];
  replacements: number;
}

const MAX_EDIT_ENTRIES = 32;

export async function executeEditFilesHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  const { roots, settings } = context;

  if (roots.length === 0) {
    return skipNoRoots();
  }

  let entries: BatchEditEntry[];
  try {
    entries = parseBatchEdits(call.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: `Skipped because edit_files could not parse its edits payload: ${message}`,
      executed: false,
      is_error: true,
      errorCode: "edit_files_parse",
      recovery: recoverableToolFailure(
        "edit_retry",
        "Retry edit_files with edits as a JSON array of {path, old_text, new_text} entries (or edits_json with the same shape).",
      ),
    };
  }

  if (entries.length === 0) {
    return {
      content: "Skipped because edit_files received no edit entries.",
      executed: false,
      recovery: recoverableToolFailure(
        "edit_retry",
        "Retry edit_files with at least one entry containing path plus either old_text/new_text or content.",
      ),
    };
  }

  if (entries.length > MAX_EDIT_ENTRIES) {
    return {
      content: `Skipped because edit_files received ${entries.length} entries (max ${MAX_EDIT_ENTRIES}). Split into smaller batches.`,
      executed: false,
      recovery: recoverableToolFailure(
        "edit_retry",
        `Split the request into batches of at most ${MAX_EDIT_ENTRIES} files per edit_files call.`,
      ),
    };
  }

  const failures: EditFailure[] = [];
  const successes: EditSuccess[] = [];
  const fileChanges: NonNullable<ChatToolCall["fileChanges"]> = [];
  const qualityWarnings: string[] = [];

  for (const [index, entry] of entries.entries()) {
    const rawPath = entry.path;
    if (!rawPath || typeof rawPath !== "string") {
      failures.push({
        kind: "parse",
        path: `entry[${index}]`,
        reason: "Missing or invalid path.",
      });
      continue;
    }

    const path = resolveWorkspacePath(rawPath, roots);
    const writeCheck = getWritePolicy(settings, roots, path);
    if (!writeCheck.allowed) {
      failures.push({ kind: "policy", path, reason: writeCheck.reason ?? "Write policy blocked this path." });
      continue;
    }

    const wantsFullRewrite = entry.content !== undefined
      && entry.old_text === undefined
      && entry.old_string === undefined
      && entry.old_str === undefined;

    if (wantsFullRewrite) {
      const success = await applyFullFileRewrite(entry, path, roots, fileChanges, failures);
      if (success) {
        successes.push(success);
        qualityWarnings.push(...success.qualityWarnings.map((warning) => `${path}: ${warning}`));
      }
      continue;
    }

    const beforeContent = await readOriginalContentForSyntaxCheck(path);
    try {
      const editArgs = buildEditFileArgs(entry);
      const result = await editComputerTextFile({ args: editArgs, path, roots });

      if (result.changed) {
        const afterContent = await readOriginalContentForSyntaxCheck(result.path);
        const change = createFileChangeSummary(result.path, beforeContent, afterContent, "update");
        if (change) {
          fileChanges.push(change);
        }
      }

      successes.push({
        bytesWritten: result.bytesWritten,
        changed: result.changed,
        operation: result.operation,
        path: result.path,
        qualityWarnings: result.qualityWarnings,
        replacements: result.replacements,
      });
      qualityWarnings.push(...result.qualityWarnings.map((warning) => `${result.path}: ${warning}`));
    } catch (error) {
      failures.push({ kind: "edit", path, reason: error instanceof Error ? error.message : String(error) });
    }
  }

  const indexSummary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);
  const failureCount = failures.length;
  const successCount = successes.length;
  const changedCount = successes.filter((entry) => entry.changed).length;
  const isError = failureCount > 0;
  const errorCode = isError
    ? successCount === 0
      ? "all_edits_failed"
      : "partial_edit_failure"
    : undefined;

  const summaryRows = successes.flatMap((entry, index) => [
    `${index + 1}. ${entry.path}`,
    `   Operation: ${entry.operation}`,
    `   Changed: ${entry.changed ? "yes" : "no"}`,
    `   Replacements: ${entry.replacements}`,
    `   Bytes written: ${entry.bytesWritten}`,
  ]);

  const failureBlock = failureCount > 0
    ? [
        "",
        `Failures (${failureCount} of ${entries.length}):`,
        ...failures.map((failure) => `- ${failure.path} [${failure.kind}]: ${failure.reason}`),
      ].join("\n")
    : "";

  return {
    content: [
      `Outcome: ${changedCount} changed, ${successCount - changedCount} unchanged${failureCount > 0 ? `, ${failureCount} failed` : ""} of ${entries.length} requested.`,
      `Index refreshed: ${indexSummary ? `${indexSummary.entryCount} entries` : "skipped"}`,
      ...summaryRows,
      failureBlock,
      formatTextQualityWarnings(qualityWarnings),
    ]
      .filter(Boolean)
      .join("\n"),
    executed: changedCount > 0,
    is_error: isError,
    errorCode,
    fileChanges,
    recovery: isError
      ? recoverableToolFailure(
          "edit_retry",
          "Inspect the failed edit_files entries (path, old_text mismatch, write policy), then retry only the affected files with corrected edit_files entries or fall back to edit_file for tricky single-file edits.",
        )
      : qualityWarnings.length > 0
        ? recoverableToolFailure(
            "edit_retry",
            "Inspect or edit the changed files and fix the quality warnings before finalizing.",
          )
        : undefined,
  };
}

async function applyFullFileRewrite(
  entry: BatchEditEntry,
  path: string,
  roots: string[],
  fileChanges: NonNullable<ChatToolCall["fileChanges"]>,
  failures: EditFailure[],
): Promise<EditSuccess | null> {
  let existing: Awaited<ReturnType<typeof readComputerTextFile>> | undefined;
  try {
    existing = await readComputerTextFile(path);
  } catch (error) {
    const message = readLocalToolErrorMessage(error);
    if (!isMissingTextFileError(message)) {
      failures.push({ kind: "edit", path, reason: message });
      return null;
    }
  }

  const expectedSha = entry.expected_sha256 ?? entry.sha256 ?? entry.sha;
  if (existing?.sha256 && expectedSha && existing.sha256.toLowerCase() !== expectedSha.toLowerCase()) {
    failures.push({
      kind: "edit",
      path,
      reason: `expected_sha256 mismatch (current ${existing.sha256}, expected ${expectedSha}); re-read before retrying.`,
    });
    return null;
  }

  const content = entry.content ?? "";
  try {
    assertSyntaxBeforeWrite(path, content, { originalContent: existing?.content });
  } catch (error) {
    failures.push({ kind: "syntax", path, reason: error instanceof Error ? error.message : String(error) });
    return null;
  }

  try {
    const result = await writeComputerTextFile(path, content, roots, {
      createParentDirs: true,
      expectedSha256: existing?.sha256 ? expectedSha : undefined,
      overwrite: true,
    });

    const change = createFileChangeSummary(result.path, existing?.content, content, result.created ? "create" : "update");
    if (change) {
      fileChanges.push(change);
    }

    return {
      bytesWritten: result.bytesWritten,
      changed: true,
      operation: result.created ? "full_replace_create" : "full_replace",
      path: result.path,
      qualityWarnings: collectTextQualityWarnings(result.path, content),
      replacements: 1,
    };
  } catch (error) {
    failures.push({ kind: "write", path, reason: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

function buildEditFileArgs(entry: BatchEditEntry): Record<string, string> {
  const args: Record<string, string> = {};
  const set = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value === "string") {
      if (value.length === 0) return;
      args[key] = value;
      return;
    }
    args[key] = String(value);
  };

  set("path", entry.path);
  set("old_text", entry.old_text ?? entry.old_string ?? entry.old_str);
  set("new_text", entry.new_text ?? entry.new_string ?? entry.new_str);
  set("expected_text", entry.expected_text);
  set("occurrence", entry.occurrence ?? entry.occurrences);
  set("start_line", entry.start_line);
  set("end_line", entry.end_line);
  set("start_char", entry.start_char);
  set("end_char", entry.end_char);
  set("insert_at_line", entry.insert_at_line);
  set("content", entry.content);
  return args;
}

export function parseBatchEdits(args: Record<string, string>): BatchEditEntry[] {
  // Shape 1: explicit array of entries via edits / edits_json / patches / etc.
  const raw = firstArg(args, ["edits_json", "edits", "patches_json", "patches", "items", "manifest"]);
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`could not parse edits_json (${error instanceof Error ? error.message : "invalid JSON"}).`);
    }

    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { edits?: unknown }).edits)
        ? (parsed as { edits: unknown[] }).edits
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { patches?: unknown }).patches)
          ? (parsed as { patches: unknown[] }).patches
          : null;

    if (!list) {
      throw new Error("edit_files edits must be an array or an object with an edits/patches array.");
    }

    return list.map((item, index) => normalizeEntry(item, index));
  }

  // Shape 2: parallel-array form — `paths: [...]` plus a single old_text/new_text
  // (or matching arrays) to broadcast the same edit across many files. Models
  // naturally reach for this when applying the same find/replace across a batch
  // (e.g. renaming an import). Accepting it cuts a recovery-loop round-trip.
  const pathsRaw = firstArg(args, ["paths", "paths_json", "files_paths", "file_paths"]);
  if (pathsRaw) {
    const paths = parseStringArrayArg(pathsRaw);
    if (paths.length === 0) {
      throw new Error("edit_files received `paths` but it did not parse to a non-empty array of strings.");
    }

    const oldTexts = parseTextBroadcast(firstArg(args, ["old_texts", "old_text", "old_strings", "old_string", "old_strs", "old_str", "search", "find"]), paths.length);
    const newTexts = parseTextBroadcast(firstArg(args, ["new_texts", "new_text", "new_strings", "new_string", "new_strs", "new_str", "replace", "replacement"]), paths.length);
    const contents = parseTextBroadcast(firstArg(args, ["contents", "content"]), paths.length);

    const hasAnchor = oldTexts.some((value) => value !== undefined && value.length > 0);
    const hasContent = contents.some((value) => value !== undefined && value.length > 0);
    if (!hasAnchor && !hasContent) {
      throw new Error("edit_files parallel form needs old_text/new_text (anchored edit) or content (full-file rewrite) alongside paths.");
    }

    return paths.map((path, index) => ({
      path,
      old_text: oldTexts[index],
      new_text: newTexts[index],
      content: contents[index],
    }));
  }

  throw new Error("edit_files requires edits/edits_json (array of {path, old_text, new_text}) OR paths plus old_text/new_text (broadcast across files).");
}

function parseStringArrayArg(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Try JSON first (handles ["a","b","c"] and the rare object-of-paths shape).
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry)).filter((entry) => entry.length > 0);
      }
    } catch {
      // Fall through to scalar/comma parsing.
    }
  }

  // Scalar / comma / newline separated fallback so models that emit "a,b,c" or
  // newline-separated paths still work.
  return trimmed
    .split(/\r?\n|,/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseTextBroadcast(raw: string | undefined, expectedLength: number): Array<string | undefined> {
  if (raw === undefined || raw === null) {
    return new Array<string | undefined>(expectedLength).fill(undefined);
  }

  const trimmed = raw.trim();

  // Prefer JSON-array interpretation only when the input is an array literal
  // — a plain string like "import x from 'foo'" must not get split.
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const list = parsed.map((entry) => (entry === null || entry === undefined ? undefined : String(entry)));
        if (list.length === expectedLength) {
          return list;
        }
        // Length mismatch → fall through and broadcast the raw string.
      }
    } catch {
      // Not JSON — fall through to scalar broadcast.
    }
  }

  // Scalar broadcast: same value for every path. This is what the model used in
  // the report ("paths: [...], old_texts: 'import styles from ...'").
  return new Array<string | undefined>(expectedLength).fill(raw);
}

function normalizeEntry(value: unknown, index: number): BatchEditEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`edit_files entry[${index}] must be an object.`);
  }

  const record = value as Record<string, unknown>;
  const stringValue = (key: string): string | undefined => {
    const raw = record[key];
    return typeof raw === "string" ? raw : raw === undefined ? undefined : String(raw);
  };
  const numberValue = (key: string): number | undefined => {
    const raw = record[key];
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string" && raw.trim() !== "") {
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };
  const booleanValue = (key: string): boolean | undefined => {
    const raw = record[key];
    if (typeof raw === "boolean") return raw;
    if (typeof raw === "string") return /^(true|1|yes|y)$/i.test(raw.trim());
    return undefined;
  };

  return {
    path: stringValue("path") ?? "",
    old_text: stringValue("old_text"),
    old_string: stringValue("old_string"),
    old_str: stringValue("old_str"),
    new_text: stringValue("new_text"),
    new_string: stringValue("new_string"),
    new_str: stringValue("new_str"),
    expected_text: stringValue("expected_text"),
    occurrence: numberValue("occurrence"),
    occurrences: numberValue("occurrences"),
    start_line: numberValue("start_line"),
    end_line: numberValue("end_line"),
    start_char: numberValue("start_char"),
    end_char: numberValue("end_char"),
    insert_at_line: numberValue("insert_at_line"),
    content: stringValue("content"),
    replace_entire_file: booleanValue("replace_entire_file"),
    sha: stringValue("sha"),
    sha256: stringValue("sha256"),
    expected_sha256: stringValue("expected_sha256"),
  };
}
