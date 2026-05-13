import type { ChatToolCall } from "../../../../types/chat";
import type { ComputerReadFileResult } from "../../../../types/localWorkspace";
import { buildComputerFileIndex, readComputerTextFile, writeComputerTextFile } from "../../files";
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

const WRITE_FILE_CONTENT_ARGS = [
  "content",
  "text",
  "body",
  "new_text",
  "newText",
  "new_content",
  "newContent",
  "file_content",
  "fileContent",
  "contents",
  "full_content",
  "fullContent",
  "full_file_content",
  "fullFileContent",
  "replacement",
  "replacement_text",
  "replacementText",
  "source",
  "css",
  "stylesheet",
];

export async function executeWriteFileHandler(
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
): Promise<LocalComputerToolCallResult> {
  const { roots, settings } = context;

  if (roots.length === 0) {
    return skipNoRoots();
  }

  const rawPath = firstArg(call.args, ["path", "file_path", "file"]);
  const content = argValue(call.args, WRITE_FILE_CONTENT_ARGS);

  if (!rawPath || content === undefined) {
    return {
      content: "Skipped because write_file requires both path and file content.",
      executed: false,
      recovery: recoverableToolFailure(
        "write_retry",
        "Retry with path plus content/new_text/new_content/file_content, or switch to edit_file if the target already exists and only needs a targeted change.",
      ),
    };
  }

  const path = resolveWorkspacePath(rawPath, roots);
  const writeCheck = getWritePolicy(settings, roots, path);

  if (!writeCheck.allowed) {
    return {
      content: `Write blocked: ${writeCheck.reason}`,
      executed: false,
    };
  }

  context.onTerminalProgress?.({
    output: `Preparing file write: ${path}`,
  });

  let existingFile: ComputerReadFileResult | undefined;
  try {
    existingFile = await readComputerTextFile(path);
  } catch (error) {
    const message = readLocalToolErrorMessage(error);
    if (!isMissingTextFileError(message)) {
      return {
        content: `Skipped because write_file cannot safely replace the existing target as text: ${message}`,
        executed: false,
        recovery: recoverableToolFailure(
          "write_retry",
          "Inspect the target with read_file/view_code if it is text, then use edit_file for targeted changes or a guarded write_file only after a fresh read.",
        ),
      };
    }
  }

  const replaceEntireFile = booleanArg(call.args, ["replace_entire_file", "replaceEntireFile", "full_replace", "fullReplace", "allow_full_rewrite", "allowFullRewrite"], false);
  const expectedSha256 = firstArg(call.args, ["expected_sha256", "expectedSha256", "if_match_sha256", "ifMatchSha256", "sha256"]);

  if (existingFile && !replaceEntireFile) {
    return {
      content: [
        `Skipped because write_file is create-only by default for existing files: ${existingFile.path}`,
        "Use edit_file/inline_edit with old_text/new_text, start_line/end_line/content, insert_at_line/content, or start_char/end_char/content for normal code edits.",
        "Only retry write_file for an intentional full-file replacement after re-reading the current file and passing replace_entire_file=true plus expected_sha256 from that read.",
      ].join("\n"),
      executed: false,
      recovery: recoverableToolFailure(
        "write_retry",
        "Use edit_file/inline_edit for the existing file, or re-read it and retry write_file only with replace_entire_file=true plus expected_sha256 for an intentional full replacement.",
      ),
    };
  }

  if (existingFile?.sha256 && !expectedSha256) {
    return {
      content: [
        `Skipped because full-file replacement of ${existingFile.path} requires expected_sha256.`,
        `Current sha256 from the latest read is ${existingFile.sha256}.`,
        "Prefer edit_file for targeted changes. If replacing the entire file is truly intended, re-read the file and retry write_file with replace_entire_file=true and expected_sha256 set to the sha256 from that read.",
      ].join("\n"),
      executed: false,
      recovery: recoverableToolFailure(
        "write_retry",
        "Prefer edit_file for the targeted change; if a full replacement is intended, re-read the file and retry write_file with replace_entire_file=true and expected_sha256.",
      ),
    };
  }

  if (existingFile?.sha256 && expectedSha256 && existingFile.sha256.toLowerCase() !== expectedSha256.toLowerCase()) {
    return {
      content: [
        `Skipped because expected_sha256 does not match the current file: ${existingFile.path}`,
        `Expected: ${expectedSha256}`,
        `Current: ${existingFile.sha256}`,
        "Re-read the file before retrying, or switch to edit_file with exact current text.",
      ].join("\n"),
      executed: false,
      recovery: recoverableToolFailure(
        "write_retry",
        "Re-read the current file, then retry with the new expected_sha256 or switch to edit_file with exact current text.",
      ),
    };
  }

  const originalContent = existingFile?.content;
  try {
    assertSyntaxBeforeWrite(path, content, { originalContent });
  } catch (error) {
    return {
      content: error instanceof Error ? error.message : String(error),
      executed: false,
      is_error: true,
      errorCode: "pre_write_syntax_check",
      recovery: recoverableToolFailure(
        "syntax_retry",
        "Inspect the syntax error, fix the generated content, and retry with edit_file for targeted corrections or guarded write_file for an intentional full replacement.",
      ),
    };
  }

  context.onTerminalProgress?.({
    output: `${existingFile ? "Replacing" : "Writing"} file: ${path}`,
  });

  const result = await writeComputerTextFile(path, content, roots, {
    createParentDirs: booleanArg(call.args, ["create_parent_dirs", "createParentDirs"], true),
    expectedSha256: existingFile?.sha256 ? expectedSha256 : undefined,
    overwrite: booleanArg(call.args, ["overwrite"], true),
  });
  const summary = await buildComputerFileIndex(roots, settings.scope).catch(() => undefined);
  const qualityWarnings = collectTextQualityWarnings(result.path, content);

  return {
    content: [
      `Path: ${result.path}`,
      `Bytes written: ${result.bytesWritten}`,
      `Created: ${result.created ? "yes" : "no"}`,
      result.created ? "Replacement guard: new file" : "Replacement guard: explicit full-file replacement with expected_sha256",
      summary ? `Index refreshed: ${summary.entryCount} entries` : "Index refresh: skipped",
      formatTextQualityWarnings(qualityWarnings),
    ].join("\n"),
    executed: true,
    fileChanges: [createFileChangeSummary(result.path, originalContent, content, result.created ? "create" : "update")].filter(
      (change): change is NonNullable<ChatToolCall["fileChanges"]>[number] => Boolean(change),
    ),
    recovery: qualityWarnings.length > 0
      ? recoverableToolFailure(
          "write_retry",
          "Inspect or edit the written file and fix the quality warnings before finalizing.",
        )
      : undefined,
  };
}
