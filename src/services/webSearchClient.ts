import { invoke } from "@tauri-apps/api/core";
import { createId } from "../lib/chatUtils";
import { isTauriDesktopRuntime } from "../app/tauriClient";
import type { ChatMessage, ChatSource } from "../types/chat";
import { WEB_SEARCH_PROVIDER_LABELS, type BraveSearchSettings, type WebSearchProvider, type WebSearchSettings } from "../types/settings";

/** Default source cap for ordinary web-enabled chat turns. */
export const DEFAULT_WEB_SEARCH_MAX_RESULTS = 6;
/** Hard runtime ceiling for one web_search call, including Deep Research. */
export const MAX_WEB_SEARCH_RESULTS = 6;
const DESKTOP_WEB_SEARCH_TIMEOUT_MS = 22_000;
const BROWSER_WEB_SEARCH_TIMEOUT_MS = 12_000;

/** Normalized source result shared by desktop search providers and browser fallback. */
export interface WebSearchResult {
  imageUrl?: string;
  sourceType?: ChatSource["sourceType"];
  snippet?: string;
  thumbnailUrl?: string;
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

interface SearchProviderOptions {
  includeVisualResults?: boolean;
  maxResults?: number;
  signal?: AbortSignal;
}

interface BraveSearchCommandOptions {
  apiKey: string;
  apiVersion?: string;
  answersMaxCompletionTokens?: number;
  answersModel?: string;
  cacheControlNoCache?: boolean;
  country?: string;
  enableAnswers?: boolean;
  enableImageSearch?: boolean;
  enableNewsSearch?: boolean;
  enablePlaceSearch?: boolean;
  enableRichCallback?: boolean;
  enableVideoSearch?: boolean;
  extraSnippets?: boolean;
  freshness?: string;
  goggles?: string[];
  imageResultCount?: number;
  includeFetchMetadata?: boolean;
  locationCity?: string;
  locationCountry?: string;
  locationLatitude?: string;
  locationLongitude?: string;
  locationPostalCode?: string;
  locationState?: string;
  locationStateName?: string;
  locationTimezone?: string;
  newsResultCount?: number;
  offset?: number;
  operators?: boolean;
  placeLocation?: string;
  placeRadiusMeters?: number;
  placeResultCount?: number;
  requestMethod?: string;
  resultFilter?: string[];
  safesearch?: string;
  searchLang?: string;
  spellcheck?: boolean;
  summary?: boolean;
  textDecorations?: boolean;
  uiLang?: string;
  units?: string;
  videoResultCount?: number;
}

export interface WebSearchProviderResponse {
  fallbackError?: string;
  primaryProvider: WebSearchProvider;
  provider: WebSearchProvider;
  results: WebSearchResult[];
}

export function formatWebSearchProviderLabel(provider: WebSearchProvider) {
  return WEB_SEARCH_PROVIDER_LABELS[provider] ?? "Web Search";
}

export function formatWebSearchErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const message = record.message ?? record.error ?? record.detail;

    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  return fallback;
}

export async function searchWeb(query: string, settings: WebSearchSettings, options: SearchProviderOptions = {}): Promise<WebSearchResult[]> {
  return (await searchWebWithProvider(query, settings, options)).results;
}

export async function searchWebWithProvider(query: string, settings: WebSearchSettings, options: SearchProviderOptions = {}): Promise<WebSearchProviderResponse> {
  const maxResults = clampMaxResults(options.maxResults ?? settings.maxResults);
  const includeVisualResults = options.includeVisualResults !== false;

  if (settings.provider === "brave") {
    try {
      const braveResults = await searchBrave(query, settings.brave, {
        ...options,
        includeVisualResults,
        maxResults,
      });

      return {
        primaryProvider: "brave",
        provider: "brave",
        results: rankAndLimitSearchResults(query, braveResults, maxResults, {
          enableSemanticRerank: settings.brave.enableSemanticRerank,
          includeVisualResults,
        }),
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      const braveError = formatWebSearchErrorMessage(error, "Brave Search failed.");
      if (!shouldUseDuckDuckGoFallbackForBraveError(braveError)) {
        throw new Error(braveError);
      }

      try {
        return {
          fallbackError: braveError,
          primaryProvider: "brave",
          provider: "duckduckgo",
          results: rankAndLimitSearchResults(
            query,
            await searchDuckDuckGo(query, {
              ...options,
              maxResults,
            }),
            maxResults,
            { enableSemanticRerank: true, includeVisualResults: false },
          ),
        };
      } catch (fallbackError) {
        if (isAbortError(fallbackError)) {
          throw fallbackError;
        }

        throw new Error(`${braveError} DuckDuckGo fallback also failed: ${formatWebSearchErrorMessage(fallbackError, "DuckDuckGo search failed.")}`);
      }
    }
  }

  return {
    primaryProvider: "duckduckgo",
    provider: "duckduckgo",
    results: rankAndLimitSearchResults(
      query,
      await searchDuckDuckGo(query, {
        ...options,
        maxResults,
      }),
      maxResults,
      { enableSemanticRerank: true, includeVisualResults: false },
    ),
  };
}

export function shouldUseDuckDuckGoFallbackForBraveError(message: string) {
  const normalized = message.trim();

  if (!normalized) {
    return false;
  }

  if (
    /\b(?:api key|subscription token|HTTP 400|HTTP 401|HTTP 403|HTTP 422|HTTP 429|invalid Brave Search header|Could not build Brave Search URL|Could not parse Brave Search response)\b/i.test(normalized)
  ) {
    return false;
  }

  return /\b(?:returned no usable sources|timed out|request failed|network|dns|HTTP 5\d\d)\b/i.test(normalized);
}

// Searches DuckDuckGo through Rust on desktop and uses the Instant Answer API in browser fallback.
export async function searchDuckDuckGo(query: string, options: SearchProviderOptions = {}): Promise<WebSearchResult[]> {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  const maxResults = clampMaxResults(options.maxResults);

  throwIfAborted(options.signal);

  if (isTauriDesktopRuntime()) {
    const desktopResults = await withSearchTimeout(
      invoke<WebSearchResult[]>("duckduckgo_search", {
        maxResults,
        query: normalizedQuery,
      }),
      DESKTOP_WEB_SEARCH_TIMEOUT_MS,
      options.signal,
      "DuckDuckGo",
    );

    throwIfAborted(options.signal);
    const normalizedResults = normalizeSearchResults(desktopResults, maxResults);

    if (normalizedResults.length === 0) {
      throw new Error("DuckDuckGo returned no usable sources.");
    }

    return normalizedResults;
  }

  const browserController = createSearchAbortController(options.signal);
  const response = await fetch(
    `https://api.duckduckgo.com/?${new URLSearchParams({
      format: "json",
      no_html: "1",
      q: normalizedQuery,
      skip_disambig: "1",
    })}`,
    {
      method: "GET",
      signal: browserController.signal,
    },
  ).finally(() => browserController.dispose());

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

export async function searchBrave(query: string, settings: BraveSearchSettings, options: SearchProviderOptions = {}): Promise<WebSearchResult[]> {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  const apiKey = settings.apiKey.trim();

  if (!apiKey) {
    throw new Error("Add a Brave Search API key in Settings > Brave Search.");
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Brave Search is available in the Gilbert Codex desktop app.");
  }

  const maxResults = clampMaxResults(options.maxResults);

  throwIfAborted(options.signal);

  const desktopResults = await withSearchTimeout(
    invoke<WebSearchResult[]>("brave_search", {
      maxResults,
      options: {
        ...createBraveSearchCommandOptions(settings),
        enableImageSearch: options.includeVisualResults === false ? false : settings.enableImageSearch && settings.showImageResults,
      },
      query: normalizedQuery,
    }),
    DESKTOP_WEB_SEARCH_TIMEOUT_MS,
    options.signal,
    "Brave Search",
  );

  throwIfAborted(options.signal);
  const braveResultLimit = options.includeVisualResults === false ? maxResults : Math.max(maxResults, maxResults + settings.imageResultCount);
  const normalizedResults = normalizeSearchResults(desktopResults, braveResultLimit);

  if (normalizedResults.length === 0) {
    throw new Error("Brave Search returned no usable sources.");
  }

  return normalizedResults;
}

/** Converts normalized web results into stable chat source cards. */
export function createChatSourcesFromWebResults(results: WebSearchResult[]): ChatSource[] {
  return normalizeSearchResults(results, results.length).map((result, index) => ({
    detail: formatSourceDetail(result),
    id: `web-source-${index + 1}-${stableSourceId(result.url)}`,
    imageUrl: result.imageUrl,
    sourceType: result.sourceType,
    thumbnailUrl: result.thumbnailUrl,
    title: cleanInlineText(result.title) || formatSourceHost(result.url),
    url: result.url,
  }));
}

/** Creates a model-visible context message that constrains answers to live sources. */
export function createWebSearchContextMessage(query: string, sources: ChatSource[], error?: string, provider: WebSearchProvider = "duckduckgo"): ChatMessage[] {
  const normalizedQuery = normalizeQuery(query);
  const providerLabel = formatWebSearchProviderLabel(provider);

  if (sources.length === 0 && !error) {
    return [];
  }

  const resultLines = sources.map((source, index) =>
    [`${index + 1}. ${source.title}`, `URL: ${source.url}`, source.detail ? `Snippet: ${source.detail}` : ""].filter(Boolean).join("\n"),
  );
  const guidance = [
    `WEB SEARCH CONTEXT - ${providerLabel} web search is enabled for the user's latest request.`,
    normalizedQuery ? `Search query: ${normalizedQuery}` : "",
    sources.length > 0
      ? `Use the ${providerLabel} results below as the live web evidence for this answer. Do not fill gaps with memory. If the results are insufficient, say what could not be verified from the live results.`
      : `${providerLabel} did not return usable sources. Do not answer current factual claims from memory; say the live web search did not return usable results.`,
    sources.length > 0 ? "Cite web-supported claims with Markdown links using only the URLs listed below." : "",
    error ? `Search note: ${error}` : "",
    resultLines.length > 0 ? `${providerLabel} results:` : "",
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

function createBraveSearchCommandOptions(settings: BraveSearchSettings): BraveSearchCommandOptions {
  const resultFilter = settings.resultFilter.length > 0 ? settings.resultFilter : undefined;

  return {
    apiKey: settings.apiKey.trim(),
    apiVersion: normalizeOptionalApiVersion(settings.apiVersion),
    answersMaxCompletionTokens: clampInteger(settings.answersMaxCompletionTokens, 128, 4000),
    answersModel: settings.answersModel,
    cacheControlNoCache: settings.cacheControlNoCache,
    country: normalizeOptionalCode(settings.country, "country"),
    enableAnswers: settings.enableAnswers,
    enableImageSearch: settings.enableImageSearch && settings.showImageResults,
    enableNewsSearch: settings.enableNewsSearch,
    enablePlaceSearch: settings.enablePlaceSearch,
    enableRichCallback: settings.enableRichCallback,
    enableVideoSearch: settings.enableVideoSearch,
    extraSnippets: settings.extraSnippets,
    freshness: formatBraveFreshness(settings),
    goggles: normalizeGoggles(settings.goggles),
    imageResultCount: clampInteger(settings.imageResultCount, 1, 24),
    includeFetchMetadata: settings.includeFetchMetadata,
    locationCity: normalizeOptionalHeaderText(settings.locationCity, 80),
    locationCountry: normalizeOptionalCode(settings.locationCountry, "country"),
    locationLatitude: normalizeOptionalCoordinate(settings.locationLatitude, -90, 90),
    locationLongitude: normalizeOptionalCoordinate(settings.locationLongitude, -180, 180),
    locationPostalCode: normalizeOptionalHeaderText(settings.locationPostalCode, 24),
    locationState: normalizeOptionalHeaderText(settings.locationState, 3),
    locationStateName: normalizeOptionalHeaderText(settings.locationStateName, 80),
    locationTimezone: normalizeOptionalTimezone(settings.locationTimezone),
    newsResultCount: clampInteger(settings.newsResultCount, 1, 24),
    offset: Number.isFinite(settings.offset) ? Math.min(Math.max(Math.round(settings.offset), 0), 9) : undefined,
    operators: settings.operators,
    placeLocation: normalizeOptionalHeaderText(settings.placeLocation, 120),
    placeRadiusMeters: clampInteger(settings.placeRadiusMeters, 1, 50000),
    placeResultCount: clampInteger(settings.placeResultCount, 1, 24),
    requestMethod: settings.requestMethod,
    resultFilter,
    safesearch: settings.safesearch,
    searchLang: normalizeOptionalCode(settings.searchLang, "language"),
    spellcheck: settings.spellcheck,
    summary: settings.summary || resultFilter?.includes("summarizer"),
    textDecorations: settings.textDecorations,
    uiLang: normalizeOptionalCode(settings.uiLang, "uiLanguage"),
    units: settings.units,
    videoResultCount: clampInteger(settings.videoResultCount, 1, 24),
  };
}

function formatBraveFreshness(settings: BraveSearchSettings) {
  if (settings.freshness === "any") {
    return undefined;
  }

  if (settings.freshness !== "custom") {
    return settings.freshness;
  }

  const startDate = settings.freshnessStartDate.trim();
  const endDate = settings.freshnessEndDate.trim();

  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    return undefined;
  }

  return `${startDate}to${endDate}`;
}

function normalizeOptionalCode(value: string, kind: "country" | "language" | "uiLanguage") {
  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  if (kind === "country") {
    return normalized.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2) || undefined;
  }

  if (kind === "language") {
    return normalized.toLowerCase().replace(/[^a-z-]/g, "").slice(0, 8) || undefined;
  }

  return normalized.replace(/[^a-zA-Z-]/g, "").slice(0, 12) || undefined;
}

function normalizeOptionalApiVersion(value: string) {
  const normalized = value.trim();
  return isIsoDate(normalized) ? normalized : undefined;
}

function normalizeGoggles(value: string) {
  const normalized = value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalCoordinate(value: string, min: number, max: number) {
  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? normalized : undefined;
}

function normalizeOptionalHeaderText(value: string, maxLength: number) {
  const normalized = value.replace(/[\r\n\t]/g, " ").trim().slice(0, maxLength);
  return normalized || undefined;
}

function normalizeOptionalTimezone(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_+\-/]/g, "").slice(0, 64);
  return normalized || undefined;
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(Number.isFinite(value) ? value : min), min), max);
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
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
          imageUrl: normalizeUrl(result.imageUrl ?? ""),
          sourceType: result.sourceType,
          snippet: cleanInlineText(result.snippet ?? ""),
          thumbnailUrl: normalizeUrl(result.thumbnailUrl ?? ""),
          title,
          url,
        },
      ];
    })
    .slice(0, maxResults);
}

function rankAndLimitSearchResults(
  query: string,
  results: WebSearchResult[],
  maxResults: number,
  options: { enableSemanticRerank: boolean; includeVisualResults: boolean },
) {
  const normalizedResults = normalizeSearchResults(
    options.includeVisualResults ? results : results.filter((result) => result.sourceType !== "image"),
    Math.max(results.length, maxResults),
  );

  if (!options.enableSemanticRerank || normalizedResults.length <= 1) {
    return normalizedResults.slice(0, maxResults);
  }

  const queryEmbedding = createSearchEmbedding(query);

  const rankedResults = normalizedResults
    .map((result, index) => {
      const text = [result.title, result.snippet, result.url, result.sourceType].filter(Boolean).join(" ");
      const semanticScore = cosineSimilarity(queryEmbedding, createSearchEmbedding(text));
      const sourceTypeBoost = result.sourceType === "web" ? 0.09 : result.sourceType === "news" ? 0.07 : result.sourceType === "place" ? 0.055 : result.sourceType === "video" ? 0.04 : 0.02;
      const orderScore = Math.max(0, 1 - index / Math.max(normalizedResults.length, 1)) * 0.12;

      return {
        result,
        score: semanticScore + sourceTypeBoost + orderScore,
      };
    })
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.result);
  const limitedResults = rankedResults.slice(0, maxResults);

  if (options.includeVisualResults && maxResults > 1 && !limitedResults.some((result) => result.sourceType === "image")) {
    const bestImageResult = rankedResults.find((result) => result.sourceType === "image");

    if (bestImageResult) {
      return [...limitedResults.slice(0, maxResults - 1), bestImageResult];
    }
  }

  return limitedResults;
}

function normalizeQuery(query: string) {
  return query
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 50)
    .join(" ")
    .slice(0, 400);
}

function clampMaxResults(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_WEB_SEARCH_MAX_RESULTS;
  }

  return Math.min(Math.max(Math.round(value ?? DEFAULT_WEB_SEARCH_MAX_RESULTS), 1), MAX_WEB_SEARCH_RESULTS);
}

function withSearchTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal, providerLabel = "Web search") {
  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The operation was aborted.", "AbortError"));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      reject(new Error(`${providerLabel} search timed out after ${Math.round(timeoutMs / 1000)} seconds.`));
    }, timeoutMs);
    const abort = () => {
      window.clearTimeout(timeoutId);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };

    signal?.addEventListener("abort", abort, { once: true });

    promise.then(
      (value) => {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timeoutId);
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function createSearchAbortController(parentSignal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timeoutId = window.setTimeout(abort, BROWSER_WEB_SEARCH_TIMEOUT_MS);

  parentSignal?.addEventListener("abort", abort, { once: true });

  return {
    dispose() {
      window.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abort);
    },
    signal: controller.signal,
  };
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
  const kind = result.sourceType && result.sourceType !== "web" ? `${result.sourceType} - ` : "";

  return snippet ? `${host} - ${kind}${snippet}` : `${host}${kind ? ` - ${kind.slice(0, -3)}` : ""}`;
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

const SEARCH_EMBEDDING_DIMS = 192;
const SEARCH_STOP_WORDS = new Set(["about", "after", "also", "and", "are", "but", "can", "does", "for", "from", "has", "have", "into", "its", "more", "not", "that", "the", "their", "this", "use", "using", "was", "when", "with", "you", "your"]);

function createSearchEmbedding(text: string) {
  const vector = Array.from({ length: SEARCH_EMBEDDING_DIMS }, () => 0);
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9_:-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token))
    .slice(0, 700);

  for (const token of tokens) {
    pushSearchEmbeddingToken(vector, token, 1);
    const stem = stemSearchToken(token);

    if (stem !== token) {
      pushSearchEmbeddingToken(vector, stem, 0.75);
    }
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    pushSearchEmbeddingToken(vector, `${tokens[index]} ${tokens[index + 1]}`, 1.15);
  }

  normalizeSearchVector(vector);
  return vector;
}

function pushSearchEmbeddingToken(vector: number[], token: string, weight: number) {
  vector[hashSearchTerm(token) % vector.length] += weight * (token.includes(":") || token.includes("-") || token.includes("_") ? 1.15 : Math.min(1.4, 0.8 + token.length / 15));
}

function stemSearchToken(token: string) {
  if (token.length > 6 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }

  if (token.length > 5 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }

  if (token.length > 4 && token.endsWith("s")) {
    return token.slice(0, -1);
  }

  return token;
}

function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  const length = Math.min(left.length, right.length);
  let dot = 0;

  for (let index = 0; index < length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
  }

  return dot;
}

function hashSearchTerm(term: string) {
  let hash = 2166136261;

  for (let index = 0; index < term.length; index += 1) {
    hash ^= term.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function normalizeSearchVector(vector: number[]) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

  if (magnitude <= Number.EPSILON) {
    return;
  }

  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= magnitude;
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}
