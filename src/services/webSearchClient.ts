import { invoke } from "@tauri-apps/api/core";
import { createId } from "../lib/chatUtils";
import { isTauriDesktopRuntime } from "../app/tauriClient";
import type { ChatMessage, ChatSource } from "../types/chat";

export const DEFAULT_WEB_SEARCH_MAX_RESULTS = 6;
export const MAX_WEB_SEARCH_RESULTS = 12;

export interface WebSearchResult {
  snippet?: string;
  title: string;
  url: string;
}

interface DuckDuckGoInstantAnswer {
  AbstractText?: string;
  AbstractURL?: string;
  Heading?: string;
  RelatedTopics?: DuckDuckGoRelatedTopic[];
}

interface DuckDuckGoRelatedTopic {
  FirstURL?: string;
  Name?: string;
  Text?: string;
  Topics?: DuckDuckGoRelatedTopic[];
}

interface SearchDuckDuckGoOptions {
  maxResults?: number;
  signal?: AbortSignal;
}

export async function searchDuckDuckGo(query: string, options: SearchDuckDuckGoOptions = {}): Promise<WebSearchResult[]> {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  const maxResults = clampMaxResults(options.maxResults);

  throwIfAborted(options.signal);

  if (isTauriDesktopRuntime()) {
    const desktopResults = await invoke<WebSearchResult[]>("duckduckgo_search", {
      maxResults,
      query: normalizedQuery,
    });

    throwIfAborted(options.signal);
    const normalizedResults = normalizeSearchResults(desktopResults, maxResults);

    if (normalizedResults.length === 0) {
      throw new Error("DuckDuckGo returned no usable sources.");
    }

    return normalizedResults;
  }

  const response = await fetch(
    `https://api.duckduckgo.com/?${new URLSearchParams({
      format: "json",
      no_html: "1",
      q: normalizedQuery,
      skip_disambig: "1",
    })}`,
    {
      method: "GET",
      signal: options.signal,
    },
  );

  if (!response.ok) {
    throw new Error(`DuckDuckGo search failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as DuckDuckGoInstantAnswer;
  const normalizedResults = normalizeSearchResults(extractInstantAnswerResults(payload), maxResults);

  if (normalizedResults.length === 0) {
    throw new Error("DuckDuckGo returned no usable sources.");
  }

  return normalizedResults;
}

export function createChatSourcesFromWebResults(results: WebSearchResult[]): ChatSource[] {
  return normalizeSearchResults(results, results.length).map((result, index) => ({
    detail: formatSourceDetail(result),
    id: `web-source-${index + 1}-${stableSourceId(result.url)}`,
    title: cleanInlineText(result.title) || formatSourceHost(result.url),
    url: result.url,
  }));
}

export function createWebSearchContextMessage(query: string, sources: ChatSource[], error?: string): ChatMessage[] {
  const normalizedQuery = normalizeQuery(query);

  if (sources.length === 0 && !error) {
    return [];
  }

  const resultLines = sources.map((source, index) =>
    [`${index + 1}. ${source.title}`, `URL: ${source.url}`, source.detail ? `Snippet: ${source.detail}` : ""].filter(Boolean).join("\n"),
  );
  const guidance = [
    "WEB SEARCH CONTEXT - DuckDuckGo web search is enabled for the user's latest request.",
    normalizedQuery ? `Search query: ${normalizedQuery}` : "",
    sources.length > 0
      ? "Use the DuckDuckGo results below as the live web evidence for this answer. Do not fill gaps with memory. If the results are insufficient, say what could not be verified from the live results."
      : "DuckDuckGo did not return usable sources. Do not answer current factual claims from memory; say the live web search did not return usable results.",
    sources.length > 0 ? "Cite web-supported claims with Markdown links using only the URLs listed below." : "",
    error ? `Search error: ${error}` : "",
    resultLines.length > 0 ? "DuckDuckGo results:" : "",
    resultLines.join("\n\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    {
      content: guidance,
      createdAt: new Date().toISOString(),
      id: createId("web-context"),
      role: "user",
    },
  ];
}

function extractInstantAnswerResults(payload: DuckDuckGoInstantAnswer): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  if (payload.AbstractURL && payload.Heading) {
    results.push({
      snippet: payload.AbstractText,
      title: payload.Heading,
      url: payload.AbstractURL,
    });
  }

  collectRelatedTopics(payload.RelatedTopics, results);
  return results;
}

function collectRelatedTopics(topics: DuckDuckGoRelatedTopic[] | undefined, results: WebSearchResult[]) {
  for (const topic of topics ?? []) {
    if (topic.Topics?.length) {
      collectRelatedTopics(topic.Topics, results);
      continue;
    }

    if (!topic.FirstURL || !topic.Text) {
      continue;
    }

    const [title, ...snippetParts] = topic.Text.split(" - ");

    results.push({
      snippet: snippetParts.join(" - ") || topic.Text,
      title: topic.Name || title || formatSourceHost(topic.FirstURL),
      url: topic.FirstURL,
    });
  }
}

function normalizeSearchResults(results: WebSearchResult[], maxResults: number) {
  const seenUrls = new Set<string>();

  return results
    .flatMap((result) => {
      const url = normalizeUrl(result.url);
      const title = cleanInlineText(result.title);

      if (!url || !title || seenUrls.has(url)) {
        return [];
      }

      seenUrls.add(url);

      return [
        {
          snippet: cleanInlineText(result.snippet ?? ""),
          title,
          url,
        },
      ];
    })
    .slice(0, maxResults);
}

function normalizeQuery(query: string) {
  return query.replace(/\s+/g, " ").trim().slice(0, 420);
}

function clampMaxResults(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_WEB_SEARCH_MAX_RESULTS;
  }

  return Math.min(Math.max(Math.round(value ?? DEFAULT_WEB_SEARCH_MAX_RESULTS), 1), MAX_WEB_SEARCH_RESULTS);
}

function normalizeUrl(rawUrl: string) {
  try {
    const parsedUrl = new URL(rawUrl);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return "";
    }

    return parsedUrl.href;
  } catch {
    return "";
  }
}

function formatSourceDetail(result: WebSearchResult) {
  const host = formatSourceHost(result.url);
  const snippet = cleanInlineText(result.snippet ?? "");

  return snippet ? `${host} - ${snippet.slice(0, 180)}` : host;
}

function formatSourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
}

function stableSourceId(url: string) {
  return formatSourceHost(url)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

function cleanInlineText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[*_`~]/g, "")
    .trim();
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException("The operation was aborted.", "AbortError");
  }
}
