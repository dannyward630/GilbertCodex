import type { ComputerDirectoryListing, ComputerSearchResult } from "../../../types/localWorkspace";
import type { GilbertProjectMemory } from "../files";

export function formatDirectoryListing(listing: ComputerDirectoryListing) {
  const rows = listing.entries.map((entry, index) => {
    const type = entry.kind === "directory" ? "dir" : entry.kind;
    const size = typeof entry.size === "number" ? ` ${entry.size} bytes` : "";
    return `${index + 1}. [${type}] ${entry.path}${size}`;
  });

  return [
    `Path: ${listing.path}`,
    listing.parentPath ? `Parent: ${listing.parentPath}` : "",
    `Entries returned: ${listing.entries.length}${listing.limited ? " (limited)" : ""}`,
    listing.inaccessibleEntries > 0 ? `Inaccessible entries: ${listing.inaccessibleEntries}` : "",
    ...rows,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatSearchResults(query: string, results: ComputerSearchResult[]) {
  if (results.length === 0) {
    return `Query: ${query}\nNo indexed file matches were found.`;
  }

  return [
    `Query: ${query}`,
    `Matches: ${results.length}`,
    ...results.map((result, index) => {
      const kind = result.matchKind ? `/${result.matchKind}` : "";
      const line = result.line ? ` line=${result.line}` : "";
      const matches = result.matches?.length ? ` matches=${result.matches.join(",")}` : "";
      const preview = result.preview ? `\n   preview: ${result.preview.replace(/\s+/g, " ")}` : "";
      return `${index + 1}. [${result.kind}${kind}] ${result.path} score=${result.score.toFixed(3)}${line}${matches}${preview}`;
    }),
  ].join("\n");
}

interface ContextRecallMemoryHit {
  line?: number;
  matches: string[];
  path: string;
  preview: string;
  score: number;
}

export function formatContextRecallResults(query: string, memories: GilbertProjectMemory[], fileResults: ComputerSearchResult[], limit?: number) {
  const effectiveLimit = limit ?? Math.max(fileResults.length, memories.length, 1);
  const memoryHits = searchGilbertMemory(query, memories, limit ?? effectiveLimit);
  const fileLines = fileResults.slice(0, limit ?? undefined).map((result, index) => {
    const kind = result.matchKind ? `/${result.matchKind}` : "";
    const line = result.line ? ` line=${result.line}` : "";
    const matches = result.matches?.length ? ` matches=${result.matches.join(",")}` : "";
    const preview = result.preview ? `\n   preview: ${result.preview.replace(/\s+/g, " ")}` : "";
    return `${index + 1}. [${result.kind}${kind}] ${result.path} score=${result.score.toFixed(3)}${line}${matches}${preview}`;
  });
  const memoryLines = memoryHits.map((hit, index) => {
    const line = hit.line ? ` line=${hit.line}` : "";
    const matches = hit.matches.length ? ` matches=${hit.matches.join(",")}` : "";
    return `${index + 1}. [memory] ${hit.path} score=${hit.score.toFixed(3)}${line}${matches}\n   preview: ${hit.preview.replace(/\s+/g, " ")}`;
  });

  return [
    `Query: ${query}`,
    "CONTEXT RECALL RESULTS",
    "Use memory hits for project rules and prior context. Use file hits as concrete code locations to inspect with view_code before editing.",
    memoryLines.length > 0 ? "Project memory hits:" : "Project memory hits: none",
    ...memoryLines,
    fileLines.length > 0 ? "Code and file hits:" : "Code and file hits: none",
    ...fileLines,
  ].join("\n");
}

function searchGilbertMemory(query: string, memories: GilbertProjectMemory[], limit: number): ContextRecallMemoryHit[] {
  const queryLower = query.trim().toLowerCase();
  const tokens = tokenizeRecallQuery(query);

  if (!queryLower && tokens.length === 0) {
    return [];
  }

  return memories
    .map((memory) => scoreGilbertMemory(memory, queryLower, tokens))
    .filter((hit): hit is ContextRecallMemoryHit => Boolean(hit && hit.score > 0))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function scoreGilbertMemory(memory: GilbertProjectMemory, queryLower: string, tokens: string[]): ContextRecallMemoryHit | undefined {
  const contentLower = memory.content.toLowerCase();
  let score = 0;
  const matches = new Set<string>();

  if (queryLower && contentLower.includes(queryLower)) {
    score += 4;
    matches.add(queryLower);
  }

  for (const token of tokens) {
    if (memory.path.toLowerCase().includes(token)) {
      score += 1.5;
      matches.add(token);
    }

    if (contentLower.includes(token)) {
      score += 1;
      matches.add(token);
    }
  }

  const snippet = findRecallSnippet(memory.content, queryLower, tokens);

  if (snippet) {
    score += 1.25;
    snippet.matches.forEach((match) => matches.add(match));
  }

  if (score <= 0) {
    return undefined;
  }

  return {
    line: snippet?.line,
    matches: Array.from(matches),
    path: memory.path,
    preview: snippet?.preview ?? memory.content.trim(),
    score,
  } satisfies ContextRecallMemoryHit;
}

function findRecallSnippet(content: string, queryLower: string, tokens: string[]) {
  for (const [index, line] of content.split(/\r?\n/).entries()) {
    const lineLower = line.toLowerCase();
    const matches = new Set<string>();

    if (queryLower && lineLower.includes(queryLower)) {
      matches.add(queryLower);
    }

    for (const token of tokens) {
      if (lineLower.includes(token)) {
        matches.add(token);
      }
    }

    if (matches.size > 0) {
      return {
        line: index + 1,
        matches: Array.from(matches),
        preview: line.trim(),
      };
    }
  }

  return undefined;
}

function tokenizeRecallQuery(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_-]+/i)
    .flatMap((token) => token.split(/[_-]+/).concat(token))
    .map((token) => token.trim())
    .filter((token, index, tokens) => token.length > 1 && tokens.indexOf(token) === index);
}
