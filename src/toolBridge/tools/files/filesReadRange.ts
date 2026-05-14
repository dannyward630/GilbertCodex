import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";

export function createFilesReadRangeTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Read a precise 1-based line range from a UTF-8 text file inside the configured workspace roots. " +
      "Use this for large files after files_search finds relevant lines, so the model sees the exact code " +
      "needed without loading the whole file into provider context.",
    execute: async (args, context) => {
      const resolution = tryResolveAllowedPath(context, args.path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const startLine = positiveInteger(args.startLine);
      const endLine = positiveInteger(args.endLine);
      const includeLineNumbers = args.includeLineNumbers !== false;

      if (startLine === undefined || endLine === undefined) {
        return {
          content: "files_read_range requires positive integer startLine and endLine values.",
          error: "files_read_range requires positive integer startLine and endLine values.",
          ok: false,
        };
      }

      if (endLine < startLine) {
        return {
          content: "files_read_range endLine must be greater than or equal to startLine.",
          error: "files_read_range endLine must be greater than or equal to startLine.",
          ok: false,
        };
      }

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_read_range could call the backend.", ok: false };
      }

      try {
        const file = await backend.readTextFile(resolution.path.resolved);
        const lines = splitLines(file.content);
        const totalLines = lines.length;

        if (startLine > totalLines) {
          return {
            content: `Requested startLine ${startLine} is beyond the end of ${file.path} (${totalLines} line${totalLines === 1 ? "" : "s"}).`,
            error: `Requested startLine ${startLine} is beyond the end of ${file.path} (${totalLines} line${totalLines === 1 ? "" : "s"}).`,
            ok: false,
          };
        }

        const actualEndLine = Math.min(endLine, totalLines);
        const selectedLines = lines.slice(startLine - 1, actualEndLine);
        const content = includeLineNumbers
          ? selectedLines.map((line, index) => `${startLine + index}: ${line}`).join("\n")
          : selectedLines.join("\n");

        return {
          content: [
            `Read ${file.path} lines ${startLine}-${actualEndLine} of ${totalLines}.`,
            content,
          ].join("\n"),
          data: {
            content,
            endLine: actualEndLine,
            extension: file.extension ?? null,
            includeLineNumbers,
            lineCount: selectedLines.length,
            name: file.name,
            path: file.path,
            requestedEndLine: endLine,
            requestedStartLine: startLine,
            sha256: file.sha256 ?? null,
            size: file.size,
            startLine,
            totalLines,
            truncated: file.truncated,
          } as unknown as JsonValue,
          ok: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not read file range.";
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_read_range",
    inputSchema: {
      additionalProperties: false,
      properties: {
        endLine: {
          description: "1-based ending line number, inclusive.",
          minimum: 1,
          type: "integer",
        },
        includeLineNumbers: {
          description: "When true, prefix each returned line with its original 1-based line number. Defaults to true.",
          type: "boolean",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
        startLine: {
          description: "1-based starting line number, inclusive.",
          minimum: 1,
          type: "integer",
        },
      },
      required: ["path", "startLine", "endLine"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Read workspace file range",
  };
}

function splitLines(content: string) {
  if (!content) {
    return [""];
  }

  const lines = content.split(/\r?\n/);
  return content.endsWith("\n") || content.endsWith("\r\n") ? lines.slice(0, -1) : lines;
}

function positiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated > 0 ? truncated : undefined;
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
