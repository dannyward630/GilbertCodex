import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";

const DEFAULT_MAX_BYTES = 65_536;
const HARD_CAP_MAX_BYTES = 1_048_576;

export function createFilesReadTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Read a UTF-8 text file from inside the configured workspace roots. " +
      "Use this before claiming to know a file's contents; do not guess. The file " +
      "must be a text file; binary files are rejected. Returns at most maxBytes " +
      "bytes of content; if the file is larger, `truncated: true` is set so you " +
      "know to ask for the next chunk or a different file. Paths can be absolute " +
      "or relative to the first workspace root.",
    execute: async (args, context) => {
      const resolution = tryResolveAllowedPath(context, args.path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const maxBytes = clampMaxBytes(args.maxBytes);

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_read could call the backend.", ok: false };
      }

      try {
        const file = await backend.readTextFile(resolution.path.resolved, maxBytes);
        return {
          content: file.content,
          data: {
            content: file.content,
            extension: file.extension ?? null,
            modifiedAt: file.modifiedAt ?? null,
            name: file.name,
            path: file.path,
            sha256: file.sha256 ?? null,
            size: file.size,
            truncated: file.truncated,
          } as JsonValue,
          ok: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not read file.";
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_read",
    inputSchema: {
      additionalProperties: false,
      properties: {
        maxBytes: {
          description: `Maximum bytes to read. Defaults to ${DEFAULT_MAX_BYTES}. Hard cap ${HARD_CAP_MAX_BYTES}.`,
          maximum: HARD_CAP_MAX_BYTES,
          minimum: 1,
          type: "integer",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["path"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Read workspace file",
  };
}

function clampMaxBytes(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_BYTES;
  }
  const truncated = Math.floor(value);
  if (truncated < 1) {
    return DEFAULT_MAX_BYTES;
  }
  return Math.min(truncated, HARD_CAP_MAX_BYTES);
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
