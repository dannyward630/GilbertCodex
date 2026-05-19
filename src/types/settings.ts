import type { ToolRegistrySettings } from "./tools";

export type ReasoningEffort = "low" | "medium" | "high";
export type AppearanceMode = "system" | "dark" | "light";
export type ModelProviderId = "9router" | "anthropic" | "deepseek" | "google" | "groq" | "lmstudio" | "mistral" | "ollama" | "openai" | "openrouter" | "vllm" | "xai";
export type ProviderContextWindowMap = Partial<Record<ModelProviderId, number>>;
export interface ProviderModelBudgetOverride {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
}
export type ProviderModelBudgetOverrideMap = Partial<Record<ModelProviderId, Record<string, ProviderModelBudgetOverride>>>;
export type ProviderModelVisibilityMap = Partial<Record<ModelProviderId, string[]>>;
export type ProviderSecretMap = Partial<Record<ModelProviderId, string>>;

export interface ThinkingSettings {
  effort: ReasoningEffort;
  enabled: boolean;
}

export function formatReasoningEffort(effort: ReasoningEffort | string) {
  if (effort === "xhigh") {
    return "High";
  }

  if (effort === "minimal") {
    return "Low";
  }

  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export type WebSearchProvider = "brave" | "duckduckgo";
export type BraveSearchSafeSearch = "moderate" | "off" | "strict";
export type BraveSearchFreshness = "any" | "custom" | "pd" | "pm" | "pw" | "py";
export type BraveSearchResultFilter = "discussions" | "faq" | "infobox" | "locations" | "news" | "query" | "summarizer" | "videos" | "web";
export type BraveSearchRequestMethod = "get" | "post";
export type BraveSearchUnits = "imperial" | "metric";
export type BraveAnswersModel = "brave" | "brave-pro";

export const WEB_SEARCH_PROVIDER_LABELS: Record<WebSearchProvider, string> = {
  brave: "Brave Search",
  duckduckgo: "DuckDuckGo",
};

export interface BraveSearchSettings {
  apiKey: string;
  apiVersion: string;
  answersMaxCompletionTokens: number;
  answersModel: BraveAnswersModel;
  cacheControlNoCache: boolean;
  country: string;
  enableAnswers: boolean;
  enableImageSearch: boolean;
  enableNewsSearch: boolean;
  enablePlaceSearch: boolean;
  enableRichCallback: boolean;
  enableSemanticRerank: boolean;
  enableVideoSearch: boolean;
  extraSnippets: boolean;
  freshness: BraveSearchFreshness;
  freshnessEndDate: string;
  freshnessStartDate: string;
  goggles: string;
  imageResultCount: number;
  includeFetchMetadata: boolean;
  locationCity: string;
  locationCountry: string;
  locationLatitude: string;
  locationLongitude: string;
  locationPostalCode: string;
  locationState: string;
  locationStateName: string;
  locationTimezone: string;
  newsResultCount: number;
  offset: number;
  operators: boolean;
  placeLocation: string;
  placeRadiusMeters: number;
  placeResultCount: number;
  requestMethod: BraveSearchRequestMethod;
  resultFilter: BraveSearchResultFilter[];
  safesearch: BraveSearchSafeSearch;
  searchLang: string;
  showImageResults: boolean;
  spellcheck: boolean;
  summary: boolean;
  textDecorations: boolean;
  uiLang: string;
  units: BraveSearchUnits;
  videoResultCount: number;
}

export const DEFAULT_BRAVE_SEARCH_SETTINGS: BraveSearchSettings = {
  apiKey: "",
  apiVersion: "",
  answersMaxCompletionTokens: 700,
  answersModel: "brave",
  cacheControlNoCache: false,
  country: "US",
  enableAnswers: false,
  enableImageSearch: false,
  enableNewsSearch: false,
  enablePlaceSearch: false,
  enableRichCallback: false,
  enableSemanticRerank: true,
  enableVideoSearch: false,
  extraSnippets: true,
  freshness: "any",
  freshnessEndDate: "",
  freshnessStartDate: "",
  goggles: "",
  imageResultCount: 6,
  includeFetchMetadata: false,
  locationCity: "",
  locationCountry: "",
  locationLatitude: "",
  locationLongitude: "",
  locationPostalCode: "",
  locationState: "",
  locationStateName: "",
  locationTimezone: "",
  newsResultCount: 6,
  offset: 0,
  operators: true,
  placeLocation: "",
  placeRadiusMeters: 2500,
  placeResultCount: 6,
  requestMethod: "get",
  resultFilter: [],
  safesearch: "moderate",
  searchLang: "en",
  showImageResults: true,
  spellcheck: true,
  summary: false,
  textDecorations: false,
  uiLang: "en-US",
  units: "imperial",
  videoResultCount: 4,
};

export interface WebSearchSettings {
  brave: BraveSearchSettings;
  enabled: boolean;
  maxResults: number;
  provider: WebSearchProvider;
}

export interface AppPersonalizationSettings {
  locationServicesEnabled: boolean;
}

export interface ProviderSettings {
  apiKeys: ProviderSecretMap;
  baseUrls: ProviderSecretMap;
  contextWindowTokens: ProviderContextWindowMap;
  disabledModels: ProviderModelVisibilityMap;
  maxTokens: number;
  model: string;
  modelBudgetOverrides?: ProviderModelBudgetOverrideMap;
  openRouterApiKey: string;
  provider: ModelProviderId;
  providerModels: ProviderSecretMap;
  systemPrompt: string;
  thinking: ThinkingSettings;
  temperature: number;
  topK: number;
  topP: number;
  tools: ToolRegistrySettings;
  userInstructions: string;
  webSearch: WebSearchSettings;
  workspaceDependencies: WorkspaceDependencySettings;
}

export interface WorkspaceDependencySettings {
  enabled: boolean;
}
