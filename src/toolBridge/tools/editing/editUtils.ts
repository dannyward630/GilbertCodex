import type { JsonValue, ToolExecutionContext, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import type { EditingBackend } from "./backend";
import { createTextChangePreview, formatFileChangeSummary } from "./diffPreview";

export interface PreparedTextWrite {
  after: string;
  before: string;
  created: boolean;
  expectedSha256?: string;
  path: string;
}

export interface EditableLines {
  eol: "\n" | "\r\n";
  hasTrailingNewline: boolean;
  lines: string[];
}

export function booleanArg(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

export function stringArg(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function optionalStringArg(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function positiveIntegerArg(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  const integer = Math.floor(value);
  return integer > 0 ? integer : undefined;
}

export function splitEditableLines(content: string): EditableLines {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const normalized = content.replace(/\r\n/g, "\n");
  const hasTrailingNewline = content.endsWith("\n") || content.endsWith("\r\n");

  if (!normalized) {
    return {
      eol,
      hasTrailingNewline,
      lines: [],
    };
  }

  const lines = normalized.split("\n");
  return {
    eol,
    hasTrailingNewline,
    lines: hasTrailingNewline ? lines.slice(0, -1) : lines,
  };
}

export function splitReplacementLines(content: string) {
  if (!content) {
    return [];
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  return normalized.endsWith("\n") ? lines.slice(0, -1) : lines;
}

export function joinEditableLines(value: EditableLines) {
  const content = value.lines.join(value.eol);
  return value.hasTrailingNewline && value.lines.length > 0 ? `${content}${value.eol}` : content;
}

export async function prepareExistingFileWrite(
  backend: EditingBackend,
  context: ToolExecutionContext,
  pathArg: unknown,
  nextContent: (currentContent: string, currentSha256?: string) => string | ToolExecutionResult,
): Promise<PreparedTextWrite | ToolExecutionResult> {
  const resolution = tryResolveAllowedPath(context, pathArg);

  if (!resolution.ok) {
    return resolutionToResult(resolution.error);
  }

  try {
    const file = await backend.readTextFile(resolution.path.resolved);
    const content = nextContent(file.content, file.sha256);

    if (isToolResult(content)) {
      return content;
    }

    return {
      after: content,
      before: file.content,
      created: false,
      expectedSha256: file.sha256,
      path: file.path,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not read file before editing.";
    return {
      content: message,
      error: message,
      ok: false,
    };
  }
}

export async function writePreparedText(
  backend: EditingBackend,
  context: ToolExecutionContext,
  prepared: PreparedTextWrite,
  options: {
    createParentDirs?: boolean;
    dryRun: boolean;
    forceEol?: "crlf" | "lf";
    kind?: "create" | "update";
    overwrite?: boolean;
    summary: string;
  },
): Promise<ToolExecutionResult> {
  const preview = createTextChangePreview(prepared.path, prepared.before, prepared.after, options.kind ?? (prepared.created ? "create" : "update"));
  const roots = context.workspaceRoots ?? [];

  if (options.dryRun) {
    return createWriteResult({
      content: [
        `Dry run: ${options.summary}`,
        formatFileChangeSummary(preview.change, true),
        "",
        preview.previewText,
      ].join("\n"),
      dryRun: true,
      fileChanges: [preview.change],
      path: prepared.path,
    });
  }

  try {
    const result = await backend.writeTextFile(prepared.path, prepared.after, roots, {
      createParentDirs: options.createParentDirs,
      expectedSha256: prepared.expectedSha256,
      forceEol: options.forceEol,
      overwrite: options.overwrite,
    });

    return createWriteResult({
      content: [
        `${options.summary}`,
        formatFileChangeSummary(preview.change, false),
        `Wrote ${result.bytesWritten.toLocaleString("en-US")} bytes${result.eol ? ` using ${result.eol.toUpperCase()} line endings` : ""}.`,
        "",
        preview.previewText,
      ].join("\n"),
      dryRun: false,
      fileChanges: [preview.change],
      path: result.path,
      writeResult: result as unknown as JsonValue,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not write file.";
    return {
      content: message,
      error: message,
      ok: false,
    };
  }
}

export function createErrorResult(message: string): ToolExecutionResult {
  return {
    content: message,
    error: message,
    ok: false,
  };
}

function createWriteResult({
  content,
  dryRun,
  fileChanges,
  path,
  writeResult,
}: {
  content: string;
  dryRun: boolean;
  fileChanges: ReturnType<typeof createTextChangePreview>["change"][];
  path: string;
  writeResult?: JsonValue;
}): ToolExecutionResult {
  return {
    content,
    data: {
      dryRun,
      fileChanges,
      path,
      writeResult: writeResult ?? null,
    } as unknown as JsonValue,
    ok: true,
  };
}

function isToolResult(value: string | ToolExecutionResult): value is ToolExecutionResult {
  return typeof value === "object";
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
