import type { JsonValue, ToolDefinition } from "../../types";
import { PathResolutionError, tryResolveAllowedPath } from "../../paths";
import { defaultFilesBackend, type FilesBackend } from "./backend";
import {
  DEFAULT_TEXT_SEARCH_EXTENSIONS,
  normalizeExtension,
  toStringArray,
  walkWorkspaceFiles,
  type TraversedFile,
} from "./filesTraversal";

const MAX_CONCURRENT_READS = 8;

interface FileSearchMatch {
  after?: Array<{ line: number; preview: string }>;
  before?: Array<{ line: number; preview: string }>;
  line: number;
  preview: string;
}

interface FileSearchResult {
  contentMatches: FileSearchMatch[];
  extension: string | null;
  name: string;
  path: string;
  pathMatched: boolean;
  size?: number | null;
}

interface SearchOptions {
  caseSensitive: boolean;
  contextLines: number;
  excludeDirectories: Set<string>;
  extensions?: Set<string>;
  globs: string[];
  includeContent: boolean;
  includeGenerated: boolean;
  includePath: boolean;
  maxMatches?: number;
  maxMatchesPerFile?: number;
  path: string;
  query: string;
  regex: boolean;
}

export function createFilesSearchTool(backend: FilesBackend = defaultFilesBackend): ToolDefinition {
  return {
    description:
      "Search file paths and/or full text content inside the configured workspace roots. " +
      "Use this before reading files when you need to find relevant code quickly. " +
      "By default it searches paths and content across text-like files, skips generated/cache folders, " +
      "and does not impose a bridge-side result cap unless maxMatches is provided.",
    execute: async (args, context) => {
      const options = normalizeOptions(args, context.workspaceRoots?.[0] ?? "");
      if (!options.query) {
        return {
          content: "files_search requires a non-empty query.",
          error: "files_search requires a non-empty query.",
          ok: false,
        };
      }

      const resolution = tryResolveAllowedPath(context, options.path);
      if (!resolution.ok) {
        return resolutionToResult(resolution.error);
      }

      const matcher = createMatcher(options);
      if (!matcher.ok) {
        return {
          content: matcher.error,
          error: matcher.error,
          ok: false,
        };
      }
      const activeMatcher = matcher;

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_search could scan the workspace.", ok: false };
      }

      const traversal = await walkWorkspaceFiles(backend, resolution.path.resolved, {
        excludeDirectories: options.excludeDirectories,
        includeGenerated: options.includeGenerated,
        signal: context.signal,
      });
      const searchableExtensions = options.extensions ?? new Set(DEFAULT_TEXT_SEARCH_EXTENSIONS);
      const candidateFiles = traversal.files.filter((file) => matchesGlobs(file, options.globs));
      const results: FileSearchResult[] = [];
      let filesRead = 0;
      let unreadableFiles = 0;
      let totalContentMatches = 0;

      let nextIndex = 0;
      const workerCount = Math.max(1, Math.min(MAX_CONCURRENT_READS, candidateFiles.length));

      async function worker() {
        while (!context.signal?.aborted) {
          const currentIndex = nextIndex;
          if (currentIndex >= candidateFiles.length || isMatchLimitReached(results.length, options.maxMatches)) {
            return;
          }

          nextIndex += 1;
          const file = candidateFiles[currentIndex]!;
          const pathMatched = options.includePath && activeMatcher.test(file.path);
          const shouldReadContent = options.includeContent && searchableExtensions.has(file.extension);
          let contentMatches: FileSearchMatch[] = [];

          if (shouldReadContent) {
            try {
              const read = await backend.readTextFile(file.path);
              filesRead += 1;
              contentMatches = findContentMatches(read.content, activeMatcher, options.maxMatchesPerFile, options.contextLines);
              totalContentMatches += contentMatches.length;
            } catch {
              unreadableFiles += 1;
            }
          }

          if (pathMatched || contentMatches.length > 0) {
            results.push({
              contentMatches,
              extension: file.extension || null,
              name: file.name,
              path: file.path,
              pathMatched,
              size: file.size,
            });
          }
        }
      }

      await Promise.all(Array.from({ length: workerCount }, () => worker()));

      if (context.signal?.aborted) {
        return { content: "Tool bridge run aborted before files_search finished scanning the workspace.", ok: false };
      }

      const orderedResults = sortResults(results, options.query);
      const limitedResults = options.maxMatches === undefined ? orderedResults : orderedResults.slice(0, options.maxMatches);

      return {
        content: formatSearchContent(options, limitedResults, {
          filteredByGlob: traversal.files.length - candidateFiles.length,
          filesRead,
          filesScanned: candidateFiles.length,
          inaccessibleEntries: traversal.inaccessibleEntries,
          limited: traversal.limited || limitedResults.length < orderedResults.length,
          scannedDirectories: traversal.scannedDirectories,
          skippedDirectories: traversal.skippedDirectories,
          skippedFiles: traversal.skippedFiles,
          totalContentMatches,
          unreadableFiles,
        }),
        data: {
          filesRead,
          filesScanned: candidateFiles.length,
          filteredByGlob: traversal.files.length - candidateFiles.length,
          inaccessibleEntries: traversal.inaccessibleEntries,
          limited: traversal.limited || limitedResults.length < orderedResults.length,
          matches: limitedResults,
          query: options.query,
          scannedDirectories: traversal.scannedDirectories,
          skippedDirectories: traversal.skippedDirectories,
          skippedFiles: traversal.skippedFiles,
          totalContentMatches,
          unreadableFiles,
        } as unknown as JsonValue,
        ok: true,
      };
    },
    executorMetadata: { family: "files", version: 1 },
    id: "files_search",
    inputSchema: {
      additionalProperties: false,
      properties: {
        caseSensitive: {
          description: "When true, match case exactly. Defaults to false.",
          type: "boolean",
        },
        contextLines: {
          description: "Optional number of surrounding lines to include before and after each content match. Defaults to 0.",
          minimum: 0,
          type: "integer",
        },
        excludeDirectories: {
          description: "Directory names to skip in addition to default generated/cache folders.",
          items: { type: "string" },
          type: "array",
        },
        extensions: {
          description: "Optional file extensions to search for content, without dots. Omit to search common text/code files.",
          items: { type: "string" },
          type: "array",
        },
        glob: {
          description: "Optional wildcard path filter such as src/**/*.ts or **/*.tsx.",
          minLength: 1,
          type: "string",
        },
        globs: {
          description: "Optional wildcard path filters. A file matches if any glob matches its path or filename.",
          items: { type: "string" },
          type: "array",
        },
        includeContent: {
          description: "Whether to search file contents. Defaults to true.",
          type: "boolean",
        },
        includeGenerated: {
          description: "When true, do not apply default generated/cache directory exclusions.",
          type: "boolean",
        },
        includePath: {
          description: "Whether to search file paths and names. Defaults to true.",
          type: "boolean",
        },
        maxMatches: {
          description: "Optional maximum matching files to return. Omit this to return every match.",
          minimum: 1,
          type: "integer",
        },
        maxMatchesPerFile: {
          description: "Optional maximum matching lines to return per file. Omit this to return every matching line.",
          minimum: 1,
          type: "integer",
        },
        path: {
          description: "Directory path to search. Defaults to the first configured workspace root.",
          minLength: 1,
          type: "string",
        },
        query: {
          description: "Literal text or regular expression to search for.",
          minLength: 1,
          type: "string",
        },
        regex: {
          description: "When true, treat query as a JavaScript regular expression.",
          type: "boolean",
        },
      },
      required: ["query"],
      type: "object",
    },
    permission: "read-only",
    risk: "read",
    title: "Search workspace files",
  };
}

function normalizeOptions(args: Record<string, unknown>, fallbackPath: string): SearchOptions {
  const explicitExtensions = toStringArray(args.extensions).map(normalizeExtension).filter(Boolean);
  const glob = typeof args.glob === "string" && args.glob.trim() ? [args.glob.trim()] : [];
  const globs = [...glob, ...toStringArray(args.globs).map((value) => value.trim()).filter(Boolean)];

  return {
    caseSensitive: args.caseSensitive === true,
    contextLines: optionalNonNegativeInteger(args.contextLines) ?? 0,
    excludeDirectories: new Set(toStringArray(args.excludeDirectories).map((directory) => directory.toLowerCase())),
    extensions: explicitExtensions.length > 0 ? new Set(explicitExtensions) : undefined,
    globs,
    includeContent: args.includeContent !== false,
    includeGenerated: args.includeGenerated === true,
    includePath: args.includePath !== false,
    maxMatches: optionalPositiveInteger(args.maxMatches),
    maxMatchesPerFile: optionalPositiveInteger(args.maxMatchesPerFile),
    path: typeof args.path === "string" && args.path.trim() ? args.path : fallbackPath,
    query: typeof args.query === "string" ? args.query.trim() : "",
    regex: args.regex === true,
  };
}

function createMatcher(options: SearchOptions): { ok: true; test: (value: string) => boolean } | { error: string; ok: false } {
  if (options.regex) {
    try {
      const expression = new RegExp(options.query, options.caseSensitive ? "" : "i");
      return {
        ok: true,
        test: (value) => {
          expression.lastIndex = 0;
          return expression.test(value);
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid regular expression.";
      return {
        error: `Invalid files_search regex: ${message}`,
        ok: false,
      };
    }
  }

  const needle = options.caseSensitive ? options.query : options.query.toLowerCase();
  return {
    ok: true,
    test: (value) => (options.caseSensitive ? value : value.toLowerCase()).includes(needle),
  };
}

function findContentMatches(
  content: string,
  matcher: { test: (value: string) => boolean },
  maxMatchesPerFile: number | undefined,
  contextLines: number,
): FileSearchMatch[] {
  const matches: FileSearchMatch[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    if (maxMatchesPerFile !== undefined && matches.length >= maxMatchesPerFile) {
      break;
    }

    const line = lines[index]!;
    if (matcher.test(line)) {
      const beforeStart = Math.max(0, index - contextLines);
      const afterEnd = Math.min(lines.length - 1, index + contextLines);
      matches.push({
        after: contextLines > 0
          ? lines.slice(index + 1, afterEnd + 1).map((preview, offset) => ({
              line: index + offset + 2,
              preview: preview.trim(),
            }))
          : undefined,
        before: contextLines > 0
          ? lines.slice(beforeStart, index).map((preview, offset) => ({
              line: beforeStart + offset + 1,
              preview: preview.trim(),
            }))
          : undefined,
        line: index + 1,
        preview: line.trim(),
      });
    }
  }

  return matches;
}

function sortResults(results: FileSearchResult[], query: string) {
  const lowerQuery = query.toLowerCase();
  return [...results].sort((left, right) => {
    const leftScore = scoreSearchResult(left, lowerQuery);
    const rightScore = scoreSearchResult(right, lowerQuery);

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return left.path.localeCompare(right.path);
  });
}

function scoreSearchResult(result: FileSearchResult, lowerQuery: string) {
  const lowerName = result.name.toLowerCase();
  const lowerPath = result.path.toLowerCase();
  let score = 0;

  if (lowerName === lowerQuery) {
    score += 1000;
  } else if (lowerName.includes(lowerQuery)) {
    score += 500;
  }

  if (result.pathMatched) {
    score += 120;
  }

  if (lowerPath.includes(`/src/`) || lowerPath.includes(`\\src\\`)) {
    score += 80;
  }

  score += Math.min(result.contentMatches.length, 20) * 20;
  score -= Math.min(lowerPath.split(/[\\/]+/).length, 30);
  return score;
}

function formatSearchContent(
  options: SearchOptions,
  results: FileSearchResult[],
  stats: {
    filteredByGlob: number;
    filesRead: number;
    filesScanned: number;
    inaccessibleEntries: number;
    limited: boolean;
    scannedDirectories: number;
    skippedDirectories: number;
    skippedFiles: number;
    totalContentMatches: number;
    unreadableFiles: number;
  },
) {
  const lines = [
    `Found ${formatNumber(results.length)} matching file${results.length === 1 ? "" : "s"} for "${options.query}".`,
    `Scanned ${formatNumber(stats.filesScanned)} file${stats.filesScanned === 1 ? "" : "s"} across ${formatNumber(stats.scannedDirectories)} director${stats.scannedDirectories === 1 ? "y" : "ies"}; read ${formatNumber(stats.filesRead)} text file${stats.filesRead === 1 ? "" : "s"}.`,
    stats.filteredByGlob > 0 ? `Filtered ${formatNumber(stats.filteredByGlob)} file${stats.filteredByGlob === 1 ? "" : "s"} by glob.` : "",
    stats.totalContentMatches > 0 ? `Content matches: ${formatNumber(stats.totalContentMatches)} line${stats.totalContentMatches === 1 ? "" : "s"}.` : "",
    stats.skippedDirectories > 0 ? `Skipped ${formatNumber(stats.skippedDirectories)} generated/cache director${stats.skippedDirectories === 1 ? "y" : "ies"}.` : "",
    stats.skippedFiles > 0 ? `Skipped ${formatNumber(stats.skippedFiles)} non-file or extension-filtered item${stats.skippedFiles === 1 ? "" : "s"}.` : "",
    stats.unreadableFiles > 0 || stats.inaccessibleEntries > 0 ? `${formatNumber(stats.unreadableFiles + stats.inaccessibleEntries)} item${stats.unreadableFiles + stats.inaccessibleEntries === 1 ? "" : "s"} could not be read.` : "",
    stats.limited ? "Search results were limited by an explicit maxMatches/maxMatchesPerFile or backend interruption." : "",
    "",
    ...results.flatMap(formatSearchResultLines),
  ].filter((line, index, array) => line || array[index - 1]);

  return lines.join("\n");
}

function formatSearchResultLines(result: FileSearchResult) {
  // Wrap the path in backticks so markdown renderers don't strip Windows
  // backslashes that precede punctuation (e.g. `\.git`).
  const header = `\`${result.path}\`${result.pathMatched ? " (path match)" : ""}`;
  const matchLines = result.contentMatches.flatMap((match) => [
    ...(match.before ?? []).map((line) => `  L${line.line}: ${line.preview}`),
    `  L${match.line}: ${match.preview}`,
    ...(match.after ?? []).map((line) => `  L${line.line}: ${line.preview}`),
  ]);
  return matchLines.length > 0 ? [header, ...matchLines] : [header];
}

function isMatchLimitReached(currentMatches: number, maxMatches: number | undefined) {
  return maxMatches !== undefined && currentMatches >= maxMatches;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated > 0 ? truncated : undefined;
}

function optionalNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const truncated = Math.floor(value);
  return truncated >= 0 ? truncated : undefined;
}

function matchesGlobs(file: TraversedFile, globs: string[]) {
  if (globs.length === 0) {
    return true;
  }

  const normalizedPath = file.path.replace(/\\/g, "/");
  return globs.some((glob) => {
    const expression = globToRegExp(glob);
    return expression.test(normalizedPath) || expression.test(file.name);
  });
}

function globToRegExp(glob: string) {
  const normalized = glob.replace(/\\/g, "/").replace(/^\.?\//, "");
  let pattern = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      const afterGlobstar = normalized[index + 2];
      if (afterGlobstar === "/") {
        pattern += "(?:.*/)?";
        index += 2;
      } else {
        pattern += ".*";
        index += 1;
      }
    } else if (char === "*") {
      pattern += "[^/]*";
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += escapeRegExp(char);
    }
  }

  return new RegExp(`(?:^|.*/)${pattern}$`, "i");
}

function escapeRegExp(value: string) {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function resolutionToResult(error: PathResolutionError) {
  return {
    content: error.message,
    error: error.message,
    ok: false,
  };
}
