import type { ChatSource } from "../types/chat";
import { createChatSourcesFromWebResults, formatWebSearchErrorMessage, formatWebSearchProviderLabel, searchWebWithProvider } from "../services/webSearchClient";
import type { WebSearchSettings } from "../types/settings";

export interface WebToolExecutionResult {
  content: string;
  sources: ChatSource[];
  // True only for search failures; zero results is a successful empty result.
  isError?: boolean;
  errorCode?: string;
}

interface WebToolExecutionOptions {
  signal?: AbortSignal;
}

export async function executeWebSearchTool(
  args: Record<string, string>,
  fallbackQuery: string,
  maxResults: number,
  settings: WebSearchSettings,
  options: WebToolExecutionOptions = {},
): Promise<WebToolExecutionResult> {
  const query = argValue(args, ["query", "q", "search", "text"]) || fallbackQuery;
  const resultLimit = Math.min(Math.max(numberArg(args, ["max_results", "maxResults", "limit"], maxResults), 1), maxResults);
  const webSearchSettings: WebSearchSettings = {
    ...settings,
    maxResults: resultLimit,
  };
  const providerLabel = formatWebSearchProviderLabel(webSearchSettings.provider);

  if (!query.trim()) {
    return {
      content: formatWebSearchResults("", [], providerLabel, "Skipped because web_search did not include a query."),
      sources: [],
      isError: true,
      errorCode: "missing_query",
    };
  }

  try {
    const searchResponse = await searchWebWithProvider(query, webSearchSettings, {
      includeVisualResults: false,
      maxResults: resultLimit,
      signal: options.signal,
    });
    const sources = createChatSourcesFromWebResults(searchResponse.results);
    const resultProviderLabel = formatWebSearchProviderLabel(searchResponse.provider);
    const fallbackNote =
      searchResponse.fallbackError && searchResponse.provider !== searchResponse.primaryProvider
        ? `${providerLabel} failed, so ${resultProviderLabel} fallback results were used: ${searchResponse.fallbackError}`
        : undefined;

    return {
      content: formatWebSearchResults(query, sources, resultProviderLabel, fallbackNote),
      sources,
    };
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    const detail = formatWebSearchErrorMessage(error, `${providerLabel} search failed.`);

    return {
      content: formatWebSearchResults(query, [], providerLabel, detail),
      sources: [],
      isError: true,
      errorCode: "web_search_failed",
    };
  }
}

export function isWebToolName(tool: string) {
  return ["web_search", "web-search", "search_web", "search-web", "brave_search", "brave-search", "duckduckgo_search", "duckduckgo-search", "web"].includes(tool);
}

function formatWebSearchResults(query: string, sources: ChatSource[], providerLabel: string, error?: string) {
  return [
    `WEB TOOL RESULTS - ${providerLabel}`,
    query ? `Query: ${query}` : "",
    `Sources: ${sources.length}`,
    sources.length > 0
      ? "Use these sources as live web evidence. Cite supported claims with Markdown links using only these URLs."
      : "No usable web sources were returned. Do not answer current factual claims from memory; say the live web search did not return usable results.",
    error ? `Search note: ${error}` : "",
    ...sources.map((source, index) => [`${index + 1}. ${source.title}`, `URL: ${source.url}`, source.detail ? `Snippet: ${source.detail}` : ""].filter(Boolean).join("\n")),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
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
