import type { ToolDefinition, ToolExecutionResult } from "../../types";
import { tryResolveAllowedPath } from "../../paths";
import { defaultEditingBackend, type EditingBackend } from "./backend";
import {
  booleanArg,
  createErrorResult,
  optionalStringArg,
  stringArg,
  writePreparedText,
  type PreparedTextWrite,
} from "./editUtils";

export function createFilesWriteTool(backend: EditingBackend = defaultEditingBackend): ToolDefinition {
  return {
    description:
      "Create or overwrite a text file inside a workspace root. " +
      "For existing files, this behaves like a whole-file replacement and should go through the normal approval/diff preview path. " +
      "Set overwrite false only when the write must create a brand-new file. Supports dryRun for approval previews.",
    execute: async (args, context) => {
      const content = stringArg(args.content);
      const overwrite = args.overwrite !== false;
      const dryRun = booleanArg(args.dryRun);
      const createParentDirs = args.createParentDirs !== false;
      const expectedSha256 = optionalStringArg(args.expectedSha256);
      const forceEol = normalizeForceEol(args.forceEol);
      const resolution = tryResolveAllowedPath(context, args.path);

      if (!resolution.ok) {
        return {
          content: resolution.error.message,
          error: resolution.error.message,
          ok: false,
        };
      }

      const existing = await readExistingFile(backend, resolution.path.resolved);

      if (!existing.ok && existing.error) {
        return existing;
      }

      const existingFile = existing.ok && "path" in existing ? existing : null;

      if (existingFile && !overwrite) {
        return createErrorResult("File already exists and overwrite is false. Omit overwrite or set it true for a reviewed whole-file replacement.");
      }

      if (expectedSha256 && existingFile?.sha256 && expectedSha256.toLowerCase() !== existingFile.sha256.toLowerCase()) {
        return createErrorResult(`Refusing to write because \`${existingFile.path}\` changed since it was last read.`);
      }

      if (!existingFile && expectedSha256) {
        return createErrorResult("expectedSha256 was provided, but the target file does not exist.");
      }

      const prepared: PreparedTextWrite = {
        after: content,
        before: existingFile ? existingFile.content : "",
        created: !existingFile,
        expectedSha256: existingFile?.sha256,
        path: existingFile?.path ?? resolution.path.resolved,
      };

      return await writePreparedText(backend, context, prepared, {
        createParentDirs,
        dryRun,
        forceEol,
        kind: prepared.created ? "create" : "update",
        overwrite: true,
        summary: `${dryRun ? "Previewed" : prepared.created ? "Created" : "Overwrote"} \`${prepared.path}\`.`,
      });
    },
    executorMetadata: { family: "editing", version: 1 },
    id: "files_write",
    inputSchema: {
      additionalProperties: false,
      properties: {
        content: {
          description: "Full text content to write.",
          type: "string",
        },
        createParentDirs: {
          description: "Create missing parent directories. Defaults to true.",
          type: "boolean",
        },
        dryRun: {
          description: "Preview the change and diff metadata without writing. Defaults to false.",
          type: "boolean",
        },
        expectedSha256: {
          description: "Optional SHA-256 from the last read. The write is refused if the existing file changed.",
          minLength: 1,
          type: "string",
        },
        forceEol: {
          description: "Optional line ending family to force.",
          enum: ["crlf", "lf"],
          type: "string",
        },
        overwrite: {
          description: "Allow replacing an existing file. Defaults to true. Set false for create-only writes.",
          type: "boolean",
        },
        path: {
          description: "Absolute path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["path", "content"],
      type: "object",
    },
    permission: "mutating",
    risk: "mutating",
    title: "Write workspace file",
  };
}

async function readExistingFile(backend: EditingBackend, path: string): Promise<
  | {
      content: string;
      ok: true;
      path: string;
      sha256?: string;
    }
  | ToolExecutionResult
> {
  try {
    const file = await backend.readTextFile(path);
    return {
      content: file.content,
      ok: true,
      path: file.path,
      sha256: file.sha256,
    };
  } catch (error) {
    const errorMessage = readErrorMessage(error, "Could not inspect target file.");
    const message = errorMessage.toLowerCase();

    if (isMissingFileError(message)) {
      return { content: "", ok: false };
    }

    return {
      content: errorMessage,
      error: errorMessage,
      ok: false,
    };
  }
}

function isMissingFileError(message: string) {
  return (
    message.includes("not found") ||
    message.includes("does not exist") ||
    message.includes("cannot find") ||
    message.includes("no such file") ||
    message.includes("os error 2") ||
    message.includes("os error 3")
  );
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}

function normalizeForceEol(value: unknown) {
  return value === "crlf" || value === "lf" ? value : undefined;
}
