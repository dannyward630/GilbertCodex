import type { ToolRegistrySettings } from "./tools";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type AppearanceMode = "system" | "dark" | "light";

export interface ThinkingSettings {
  effort: ReasoningEffort;
  enabled: boolean;
}

export type WebSearchProvider = "duckduckgo";

export interface WebSearchSettings {
  enabled: boolean;
  maxResults: number;
  provider: WebSearchProvider;
}

export interface ProviderSettings {
  maxTokens: number;
  model: string;
  openRouterApiKey: string;
  systemPrompt: string;
  thinking: ThinkingSettings;
  temperature: number;
  tools: ToolRegistrySettings;
  webSearch: WebSearchSettings;
}
