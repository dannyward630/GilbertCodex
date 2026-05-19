import type { ModelProviderId } from "./settings";

export type ProviderReasoningFormat =
  | "anthropic-thinking"
  | "deepseek-reasoning"
  | "google-thinking"
  | "openai-compatible"
  | "openai-responses"
  | "openrouter-reasoning"
  | "provider-effort";

export interface ProviderReasoningEntry {
  id?: string;
  type: string;
  value: unknown;
}

/**
 * Opaque provider-native reasoning state used only for provider/tool-loop
 * continuity. This must never be rendered as chat text, copied, exported, or
 * written into message memory.
 */
export interface ProviderReasoningState {
  entries: ProviderReasoningEntry[];
  format: ProviderReasoningFormat;
  provider: ModelProviderId;
}

export function createProviderReasoningState(
  provider: ModelProviderId,
  format: ProviderReasoningFormat,
  entries: ProviderReasoningEntry[],
): ProviderReasoningState | undefined {
  const normalizedEntries = entries.filter((entry) => entry.value !== undefined && entry.value !== null && entry.value !== "");

  return normalizedEntries.length > 0
    ? {
        entries: normalizedEntries,
        format,
        provider,
      }
    : undefined;
}
