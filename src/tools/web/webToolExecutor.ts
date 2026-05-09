import type { ChatSource } from "../../types/chat";
import { createChatSourcesFromWebResults, searchDuckDuckGo } from "../../services/webSearchClient";

export interface WebToolExecutionResult {
  content: string;
  sources: ChatSource[];
}

export async function executeWebSearchTool(args: Record<string, string>, fallbackQuery: string, maxResults: number): Promise<WebToolExecutionResult> {
  const query = argValue(args, ["query", "q", "search", "text"]) || fallbackQuery;
  const resultLimit = Math.min(Math.max(numberArg(args, ["max_results", "maxResults", "limit"], maxResults), 1), maxResults);

  if (!query.trim()) {
    return {
      content: "Skipped because web_search did not include a query.",
      sources: [],
    };
  }

  const results = await searchDuckDuckGo(query, {
    maxResults: resultLimit,
  });
  const sources = createChatSourcesFromWebResults(results);

  return {
    content: formatWebSearchResults(query, sources),
    sources,
  };
}

export function isWebToolName(tool: string) {
  return ["web_search", "web-search", "search_web", "search-web", "duckduckgo_search", "duckduckgo-search", "web"].includes(tool);
}

function formatWebSearchResults(query: string, sources: ChatSource[]) {
  if (sources.length === 0) {
    return `Query: ${query}\nNo usable web sources were returned.`;
  }

  return [
    "WEB TOOL RESULTS",
    `Query: ${query}`,
    `Sources: ${sources.length}`,
    ...sources.map((source, index) => [`${index + 1}. ${source.title}`, `URL: ${source.url}`, source.detail ? `Snippet: ${source.detail}` : ""].filter(Boolean).join("\n")),
  ].join("\n\n");
}

function argValue(args: Record<string, string>, names: string[]) {
  for (const name of names) {
    const normalizedName = normalizeArgName(name);

    if (Object.prototype.hasOwnProperty.call(args, normalizedName)) {
      return args[normalizedName];
    }
  }

  return undefined;
}

function numberArg(args: Record<string, string>, names: string[], fallback: number) {
  const rawValue = argValue(args, names);

  if (rawValue === undefined || rawValue === "") {
    return fallback;
  }

  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeArgName(name: string) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}
