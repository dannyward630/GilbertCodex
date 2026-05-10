import type { ToolRegistrySettings } from "./tools";

export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type AppearanceMode = "system" | "dark" | "light";
export type ModelProviderId = "anthropic" | "deepseek" | "google" | "groq" | "lmstudio" | "mistral" | "ollama" | "openai" | "openrouter" | "vllm" | "xai";
export type ProviderSecretMap = Partial<Record<ModelProviderId, string>>;

export const DEEP_RESEARCH_REASONING_EFFORT: ReasoningEffort = "xhigh";

export interface ThinkingSettings {
  effort: ReasoningEffort;
  enabled: boolean;
}

export function isDeepResearchThinking(settings: ThinkingSettings) {
  return settings.enabled && settings.effort === DEEP_RESEARCH_REASONING_EFFORT;
}

export function formatReasoningEffort(effort: ReasoningEffort | string) {
  if (effort === "xhigh") {
    return "Deep Research";
  }

  if (effort === "minimal") {
    return "Minimal";
  }

  return effort.charAt(0).toUpperCase() + effort.slice(1);
}

export type WebSearchProvider = "duckduckgo";

export interface WebSearchSettings {
  enabled: boolean;
  maxResults: number;
  provider: WebSearchProvider;
}

export interface ProviderSettings {
  apiKeys: ProviderSecretMap;
  baseUrls: ProviderSecretMap;
  maxTokens: number;
  model: string;
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
