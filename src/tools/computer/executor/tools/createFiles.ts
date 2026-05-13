import type { ChatToolCall } from "../../../../types/chat";
import { buildComputerFileIndex, writeComputerTextFile } from "../../files";
import { assertSyntaxBeforeWrite } from "../../syntaxValidation";
import { collectTextQualityWarnings, formatTextQualityWarnings } from "../../textQuality";
import {
  formatFileCreationSummary,
  prepareFileCreationWritePlan,
  type FileCreationPrepareFailure,
  type FileCreationToolName,
  type FileCreationWriteResult,
  type PreparedFileCreationWrite,
} from "../../../fileCreation";
import { readOriginalContentForSyntaxCheck, skipNoRoots } from "../argHelpers";
import { createFileChangeSummary } from "../fileChanges";
import { recoverableToolFailure } from "../results";
import type { LocalComputerToolCallResult, ParsedLocalComputerToolCall, TerminalProgressHandler, ToolHandlerContext } from "../types";
import { getWritePolicy } from "../workspacePolicy";
import {
  fileCreationPrepareFailureToBatchFailure,
  prepareDeduplicatedWrites,
  type BatchFileCreationFailure,
} from "./fileCreationCommon";

interface FileCreationExecutionOptions {
  allowedRoots?: string[];
  indexRoots?: string[];
  onProgress?: TerminalProgressHandler;
  precomputedWrites?: PreparedFileCreationWrite[];
  summaryNote?: string;
  targetRoots?: string[];
}

export async function executeCreateFilesHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  if (context.roots.length === 0) {
    return skipNoRoots();
  }

  return executeFileCreationTool(call as ParsedLocalComputerToolCall & { tool: FileCreationToolName }, context.settings, context.roots, {
    onProgress: context.onTerminalProgress,
  });
}

export async function executeFileCreationTool(
  call: ParsedLocalComputerToolCall & { tool: FileCreationToolName },
  settings: ToolHandlerContext["settings"],
  roots: string[],
  options: FileCreationExecutionOptions = {},
): Promise<LocalComputerToolCallResult> {
  const targetRoots = options.targetRoots ?? roots;
  const allowedRoots = options.allowedRoots ?? targetRoots;
  const preparedPlan = options.precomputedWrites
    ? { failures: [] as FileCreationPrepareFailure[], writes: options.precomputedWrites }
    : prepareFileCreationWritePlan(call, targetRoots);
  const dedupePlan = await prepareDeduplicatedWrites(preparedPlan.writes, allowedRoots);
  const failures: BatchFileCreationFailure[] = [
    ...preparedPlan.failures.map(fileCreationPrepareFailureToBatchFailure),
    ...dedupePlan.failures,
  ];
  const dedupedWrites = dedupePlan.writes;
  const skippedWrites = dedupePlan.skipped;
  const allowedWrites: PreparedFileCreationWrite[] = [];

  for (const write of dedupedWrites) {
    const policy = getWritePolicy(settings, allowedRoots, write.path);

    if (!policy.allowed) {
      failures.push({
        kind: "policy",
        path: write.path,
        reason: policy.reason ?? "Write policy blocked this path.",
      });
      continue;
    }

    allowedWrites.push(write);
  }

  const results: FileCreationWriteResult[] = [];
  const fileChanges: NonNullable<ChatToolCall["fileChanges"]> = [];
  const qualityWarnings = allowedWrites.flatMap((write) =>
    collectTextQualityWarnings(write.path, write.content).map((warning) => `${write.path}: ${warning}`),
  );

  if (allowedWrites.length > 0) {
    options.onProgress?.({
      output: `Preparing file writes: ${allowedWrites.length} files`,
    });
  }

  for (const write of allowedWrites) {
    const originalContent = await readOriginalContentForSyntaxCheck(write.path);
    try {
      assertSyntaxBeforeWrite(write.path, write.content, { originalContent });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: write.path, reason: message, kind: "syntax" });
      continue;
    }

    try {
      const result = await writeComputerTextFile(write.path, write.content, allowedRoots, {
        createParentDirs: write.createParentDirs,
        overwrite: write.overwrite,
      });

      results.push({
        ...write,
        write: result,
      });
      const fileChange = createFileChangeSummary(result.path, originalContent, write.content, result.created ? "create" : "update");
      if (fileChange) {
        fileChanges.push(fileChange);
      }
      options.onProgress?.({
        fileChanges: [...fileChanges],
        output: `Writing files ${results.length}/${allowedWrites.length}: ${result.path}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ path: write.path, reason: message, kind: "write" });
    }
  }

  const indexRoots = options.indexRoots ?? roots;
  const indexSummary = indexRoots.length > 0 ? await buildComputerFileIndex(indexRoots, settings.scope).catch(() => undefined) : undefined;

  const requestedCount = preparedPlan.writes.length + preparedPlan.failures.length;
  const writtenCount = results.length;
  const skippedCount = skippedWrites.length;
  const failureCount = failures.length;
  const isError = failureCount > 0;
  const failureBlock = failures.length > 0
    ? [
        "",
        `Failures (${failures.length} of ${requestedCount}):`,
        ...failures.map((failure) => `- ${failure.path} [${failure.kind}]: ${failure.reason}`),
      ].join("\n")
    : "";
  const skippedBlock = skippedWrites.length > 0
    ? [
        "",
        `Already handled (${skippedWrites.length} of ${requestedCount}):`,
        ...skippedWrites.map((skipped) => `- ${skipped.path}: ${skipped.reason}`),
      ].join("\n")
    : "";

  return {
    content: [
      options.summaryNote,
      `Outcome: ${writtenCount}/${requestedCount} files written${skippedCount > 0 ? `, ${skippedCount} already handled` : ""}${failureCount > 0 ? `, ${failureCount} failed` : ""}.`,
      formatFileCreationSummary({
        indexSummary,
        results,
      }),
      skippedBlock,
      failureBlock,
      formatTextQualityWarnings(qualityWarnings),
    ]
      .filter(Boolean)
      .join("\n"),
    executed: writtenCount > 0 || (failureCount === 0 && skippedCount > 0),
    is_error: isError,
    errorCode: isError ? (writtenCount === 0 && skippedCount === 0 ? "all_writes_failed" : "partial_write_failure") : undefined,
    fileChanges,
    recovery: isError
      ? recoverableToolFailure(
          "create_retry",
          "Inspect the failed file-creation entries, then retry only the affected files with corrected create_files/write_file content or edit_file for existing files.",
        )
      : qualityWarnings.length > 0
        ? recoverableToolFailure(
            "create_retry",
            "Inspect or edit the created files and fix the quality warnings before finalizing.",
          )
        : undefined,
  };
}
