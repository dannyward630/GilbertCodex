import type { JsonValue, ToolDefinition, ToolExecutionResult } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";

const DEFAULT_LIMIT = 100;
const HARD_CAP_LIMIT = 500;

export function createFilesListTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "List the immediate entries of a directory inside the configured workspace " +
      "roots. Returns directories before files; each entry includes name, kind, " +
      "absolute path, and (for files) size and modifiedAt. Limit defaults to 100; " +
      "use a higher limit only when you actually need it. The result's `limited` " +
      "field tells you whether the listing was capped.",
    execute: async (args, context) => {
      const resolution = tryResolveAllowedPath(context, args.path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const limit = clampLimit(args.limit);

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_list could call the backend.", ok: false };
      }

      try {
        const listing = await backend.listDirectory(resolution.path.resolved, limit);
        return {
          content: formatListingPreview(listing.path, listing.entries, listing.limited),
          data: {
            entries: listing.entries.map((entry) => ({
              extension: entry.extension ?? null,
              kind: entry.kind,
              modifiedAt: entry.modifiedAt ?? null,
              name: entry.name,
              path: entry.path,
              size: entry.size ?? null,
            })),
            inaccessibleEntries: listing.inaccessibleEntries,
            limited: listing.limited,
            parentPath: listing.parentPath ?? null,
            path: listing.path,
          } as JsonValue,
          ok: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not list directory.";
        return {
          content: message,
          error: message,
          ok: false,
        };
      }
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_list",
    inputSchema: {
      additionalProperties: false,
      properties: {
        limit: {
          description: `Maximum entries to return. Defaults to ${DEFAULT_LIMIT}. Hard cap ${HARD_CAP_LIMIT}.`,
          maximum: HARD_CAP_LIMIT,
          minimum: 1,
          type: "integer",
        },
        path: {
          description: "Absolute directory path or path relative to the first workspace root.",
          minLength: 1,
          type: "string",
        },
      },
      required: ["path"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "List workspace directory",
  };
}

function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  const truncated = Math.floor(value);
  if (truncated < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(truncated, HARD_CAP_LIMIT);
}

function formatListingPreview(
  path: string,
  entries: Array<{ kind: string; name: string }>,
  limited: boolean,
): string {
  if (entries.length === 0) {
    return `Directory ${path} is empty${limited ? " (listing was limited)" : ""}.`;
  }
  const previewLines = entries.slice(0, 20).map((entry) => `${entry.kind === "directory" ? "[dir]" : "[file]"} ${entry.name}`);
  const omitted = entries.length - previewLines.length;
  return [
    `Directory ${path}:`,
    ...previewLines,
    omitted > 0 ? `... and ${omitted} more entries.` : "",
    limited ? "Listing was limited; raise `limit` if you need more entries." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolutionToResult(error: PathResolutionError): ToolExecutionResult {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
