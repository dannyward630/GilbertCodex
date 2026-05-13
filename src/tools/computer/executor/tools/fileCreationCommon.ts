import { listComputerDirectory } from "../../files";
import {
  baseName,
  directoryName,
  isPathInsideRoot,
  joinLocalPath,
  normalizeComparablePath,
  readOriginalContentForSyntaxCheck,
  resolveWorkspacePath,
} from "../argHelpers";
import type { FileCreationPrepareFailure, PreparedFileCreationWrite } from "../../../fileCreation";

export interface BatchFileCreationFailure {
  kind: "duplicate" | "existing" | "policy" | "prepare" | "syntax" | "write";
  path: string;
  reason: string;
}

export interface BatchFileCreationSkip {
  path: string;
  reason: string;
}

export interface DeduplicatedWritePlan {
  failures: BatchFileCreationFailure[];
  skipped: BatchFileCreationSkip[];
  writes: PreparedFileCreationWrite[];
}

export async function prepareDeduplicatedWrites(
  writes: PreparedFileCreationWrite[],
  roots: string[],
): Promise<DeduplicatedWritePlan> {
  const nextWrites: PreparedFileCreationWrite[] = [];
  const failures: BatchFileCreationFailure[] = [];
  const skipped: BatchFileCreationSkip[] = [];
  const plannedWrites = new Map<string, PreparedFileCreationWrite>();

  for (const write of writes) {
    const key = normalizeComparablePath(write.path);
    const plannedWrite = plannedWrites.get(key);

    if (plannedWrite) {
      if (write.duplicateStrategy === "skip") {
        skipped.push({
          path: write.path,
          reason: "Duplicate path skipped by duplicate_strategy=skip.",
        });
        continue;
      }

      if (write.duplicateStrategy === "increment") {
        const uniquePath = await nextUniquePath(write.path, roots, new Set(plannedWrites.keys()));
        const uniqueWrite = {
          ...write,
          path: uniquePath,
        };
        nextWrites.push(uniqueWrite);
        plannedWrites.set(normalizeComparablePath(uniquePath), uniqueWrite);
        continue;
      }

      if (areFileContentsEquivalent(plannedWrite.content, write.content)) {
        skipped.push({
          path: write.path,
          reason: "Duplicate path already planned with the same content.",
        });
      } else {
        failures.push({
          kind: "duplicate",
          path: write.path,
          reason: "Path is repeated in the same batch with different content. Retry only one entry for this path, or use duplicate_strategy=increment.",
        });
      }

      continue;
    }

    if (!write.overwrite && (await computerPathExists(write.path, roots))) {
      if (write.duplicateStrategy === "skip") {
        skipped.push({
          path: write.path,
          reason: "Existing file skipped by duplicate_strategy=skip.",
        });
        plannedWrites.set(key, write);
        continue;
      }

      if (write.duplicateStrategy === "increment") {
        const uniquePath = await nextUniquePath(write.path, roots, new Set(plannedWrites.keys()));
        const uniqueWrite = {
          ...write,
          path: uniquePath,
        };
        nextWrites.push(uniqueWrite);
        plannedWrites.set(normalizeComparablePath(uniquePath), uniqueWrite);
        continue;
      }

      const existingContent = await readOriginalContentForSyntaxCheck(write.path);

      if (existingContent !== undefined && areFileContentsEquivalent(existingContent, write.content)) {
        skipped.push({
          path: write.path,
          reason: "Existing file already matches the requested content.",
        });
        plannedWrites.set(key, write);
        continue;
      }

      failures.push({
        kind: "existing",
        path: write.path,
        reason: "Existing file differs. Use edit_file for changes, overwrite=true for intentional full replacement, duplicate_strategy=increment for a new copy, or duplicate_strategy=skip to preserve it.",
      });
      plannedWrites.set(key, write);
      continue;
    }

    nextWrites.push(write);
    plannedWrites.set(key, write);
  }

  return {
    failures,
    skipped,
    writes: nextWrites,
  };
}

export function fileCreationPrepareFailureToBatchFailure(
  failure: FileCreationPrepareFailure,
): BatchFileCreationFailure {
  const location = failure.path ?? (failure.index === undefined ? "batch" : `batch item ${failure.index + 1}`);

  return {
    kind: "prepare",
    path: location,
    reason: failure.reason,
  };
}

export async function computerPathExists(path: string, roots: string[]) {
  const resolvedPath = resolveWorkspacePath(path, roots);

  if (!roots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    return false;
  }

  try {
    const listing = await listComputerDirectory(directoryName(resolvedPath), 2_000);
    const name = baseName(resolvedPath).toLowerCase();
    return listing.entries.some((entry) => entry.name.toLowerCase() === name);
  } catch {
    return false;
  }
}

export async function nextUniquePath(path: string, roots: string[], plannedPaths = new Set<string>()) {
  const directory = directoryName(path);
  const name = baseName(path);
  const dotIndex = name.lastIndexOf(".");
  const stem = dotIndex > 0 ? name.slice(0, dotIndex) : name;
  const extension = dotIndex > 0 ? name.slice(dotIndex) : "";

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = joinLocalPath(directory, [`${stem}-${index}${extension}`]);
    const key = normalizeComparablePath(candidate);

    if (!plannedPaths.has(key) && !(await computerPathExists(candidate, roots))) {
      return candidate;
    }
  }

  throw new Error(`Could not find a unique file path for ${path}.`);
}

function areFileContentsEquivalent(left: string, right: string) {
  return normalizeComparableFileContent(left) === normalizeComparableFileContent(right);
}

function normalizeComparableFileContent(content: string) {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\s+$/g, "");
}
