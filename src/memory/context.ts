import type {
  DurableChatMemoryState,
  DurableMemoryContextOptions,
  DurableMemoryRecord,
  DurableProjectMemoryState,
  ProjectFileMapEntry,
} from "./types";
import { createMemoryEmbedding, scoreMemoryVectors, tokenizeForMemory } from "./embedding";

const DEFAULT_MEMORY_CONTEXT_MAX_CHARS = 7_000;
const DEFAULT_MEMORY_CONTEXT_RECORDS = 12;

export function createDurableMemoryContext(
  chatState: DurableChatMemoryState,
  projectState: DurableProjectMemoryState,
  options: DurableMemoryContextOptions = {},
) {
  const maxChars = Math.max(1_200, Math.round(options.maxChars ?? DEFAULT_MEMORY_CONTEXT_MAX_CHARS));
  const maxRecords = Math.max(1, Math.round(options.maxRecords ?? DEFAULT_MEMORY_CONTEXT_RECORDS));
  const now = options.now ?? new Date().toISOString();
  const prompt = options.prompt ?? "";
  const relevantRecords = rankMemoryRecords(chatState, projectState, prompt, now).slice(0, maxRecords);
  const recentEvents = options.includeRecentEvents === false
    ? []
    : [...chatState.events]
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
      .slice(0, 8);
  const fileMap = options.includeProjectMap === false ? "" : formatProjectFileMap(projectState, prompt, now);

  if (relevantRecords.length === 0 && recentEvents.length === 0 && !fileMap) {
    return "";
  }

  const sections: string[] = [
    [
      "DURABLE MEMORY",
      `Current chat: ${chatState.chatTitle} (${chatState.chatId})`,
      `Project: ${projectState.projectName}`,
      projectState.workspaceRoots.length > 0 ? `Workspace roots: ${projectState.workspaceRoots.join(" | ")}` : "Workspace roots: none",
      "This is local saved memory from visible chat text, tool calls/results/errors, response-thinking summaries, and project-map snapshots. Hidden chain-of-thought is not stored. Use it silently for continuity unless the user asks about memory.",
    ].join("\n"),
  ];

  if (recentEvents.length > 0) {
    sections.push([
      "Recent saved events:",
      ...recentEvents.map((event) => `- ${formatAge(event.updatedAt, now)} ${event.kind}${event.status ? ` (${event.status})` : ""}: ${event.summary}`),
    ].join("\n"));
  }

  if (relevantRecords.length > 0) {
    sections.push([
      "Relevant recall:",
      ...relevantRecords.map((record) => {
        const chatLabel = record.chatTitle && record.chatId !== chatState.chatId ? ` [${record.chatTitle}]` : "";
        return `- ${formatAge(record.updatedAt, now)} ${record.source}${chatLabel}: ${record.summary}`;
      }),
    ].join("\n"));
  }

  if (fileMap) {
    sections.push(fileMap);
  }

  let output = "";

  for (const section of sections) {
    const next = output ? `${output}\n\n${section}` : section;

    if (next.length > maxChars) {
      break;
    }

    output = next;
  }

  return output;
}

function rankMemoryRecords(
  chatState: DurableChatMemoryState,
  projectState: DurableProjectMemoryState,
  prompt: string,
  now: string,
) {
  const queryEmbedding = createMemoryEmbedding(prompt);
  const promptTokens = new Set(tokenizeForMemory(prompt).filter((token) => token.length >= 3));
  const records = dedupeMemoryRecords([...projectState.records, ...chatState.records]);

  return records
    .map((record) => ({
      record,
      score: scoreRecord(record, queryEmbedding, promptTokens, chatState.chatId, now),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.record.updatedAt) - Date.parse(left.record.updatedAt))
    .map((item) => item.record);
}

function scoreRecord(
  record: DurableMemoryRecord,
  queryEmbedding: ReturnType<typeof createMemoryEmbedding>,
  promptTokens: Set<string>,
  activeChatId: string,
  now: string,
) {
  const vectorScore = scoreMemoryVectors(record.vector, queryEmbedding);
  const keywordScore = scoreKeywords(record, promptTokens);
  const recency = scoreRecency(record.updatedAt, now);
  const chatBoost = record.chatId === activeChatId ? 0.45 : 0;
  const toolBoost = record.source === "tool-error" ? 0.3 : record.source === "tool" ? 0.18 : 0;

  return vectorScore * 4 + keywordScore + recency + chatBoost + toolBoost;
}

function scoreKeywords(record: DurableMemoryRecord, promptTokens: Set<string>) {
  if (promptTokens.size === 0) {
    return 0;
  }

  const haystack = `${record.summary}\n${record.content}`.toLowerCase();
  let score = 0;

  for (const token of promptTokens) {
    if (haystack.includes(token)) {
      score += 0.35;
    }
  }

  return Math.min(2.8, score);
}

function scoreRecency(updatedAt: string, now: string) {
  const ageMs = Math.max(0, Date.parse(now) - Date.parse(updatedAt));
  const ageDays = ageMs / 86_400_000;

  if (ageDays < 1 / 24) return 1.4;
  if (ageDays < 1) return 1.1;
  if (ageDays < 7) return 0.75;
  if (ageDays < 31) return 0.45;
  return 0.2;
}

function dedupeMemoryRecords(records: DurableMemoryRecord[]) {
  const seen = new Set<string>();
  const deduped: DurableMemoryRecord[] = [];

  for (const record of records) {
    const key = `${record.eventId}:${record.chunkId}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(record);
  }

  return deduped;
}

function formatProjectFileMap(projectState: DurableProjectMemoryState, prompt: string, now: string) {
  const fileMap = projectState.fileMap;
  const roots = fileMap.roots.length > 0 ? fileMap.roots.join(" | ") : "none";
  const summary = fileMap.indexSummary;
  const relevantFiles = rankFileMapEntries(fileMap.knownFiles, prompt).slice(0, 18);

  if (!summary && relevantFiles.length === 0 && roots === "none") {
    return "";
  }

  const lines = [
    "Project file map:",
    `- Roots: ${roots}`,
  ];

  if (summary) {
    lines.push(`- Index snapshot: ${summary.entryCount} entries, ${summary.scannedDirectories} folders, ${summary.ignoredEntries} ignored, ${summary.skippedEntries} skipped${summary.truncated ? ", truncated" : ""}${fileMap.capturedAt ? ` (${formatAge(fileMap.capturedAt, now)})` : ""}.`);
  }

  if (relevantFiles.length > 0) {
    lines.push(`- Known paths: ${relevantFiles.map(formatFileMapEntry).join("; ")}`);
  }

  return lines.join("\n");
}

function rankFileMapEntries(entries: ProjectFileMapEntry[], prompt: string) {
  const tokens = tokenizeForMemory(prompt);

  return [...entries]
    .map((entry) => {
      const path = entry.path.toLowerCase();
      const tokenScore = tokens.reduce((score, token) => score + (path.includes(token) ? 1 : 0), 0);
      const sourceScore = entry.source === "tool" ? 2 : entry.source === "root" ? 0.5 : 1;

      return {
        entry,
        score: tokenScore * 2 + sourceScore + Date.parse(entry.lastSeenAt) / 10_000_000_000_000,
      };
    })
    .sort((left, right) => right.score - left.score || left.entry.path.localeCompare(right.entry.path))
    .map((item) => item.entry);
}

function formatFileMapEntry(entry: ProjectFileMapEntry) {
  const kind = entry.kind ? `${entry.kind}:` : "";
  return `${kind}${entry.path}`;
}

function formatAge(value: string, now: string) {
  const thenMs = Date.parse(value);
  const nowMs = Date.parse(now);

  if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs)) {
    return "at an unknown time";
  }

  const elapsedSeconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));

  if (elapsedSeconds < 60) return "just now";

  const minutes = Math.round(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;

  const days = Math.round(hours / 24);
  if (days < 14) return `${days} ${days === 1 ? "day" : "days"} ago`;

  const weeks = Math.round(days / 7);
  if (days < 61) return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;

  const months = Math.round(days / 30);
  if (days < 730) return `${months} ${months === 1 ? "month" : "months"} ago`;

  const years = Math.round(days / 365);
  return `${years} ${years === 1 ? "year" : "years"} ago`;
}
