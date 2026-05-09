export type ReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type AppearanceMode = "system" | "dark" | "light";

export interface ThinkingSettings {
  effort: ReasoningEffort;
  enabled: boolean;
  showReasoning: boolean;
}

export interface ProviderSettings {
  maxTokens: number;
  model: string;
  openRouterApiKey: string;
  systemPrompt: string;
  thinking: ThinkingSettings;
  temperature: number;
}
