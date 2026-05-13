import { isImageAttachment } from "../lib/chatAttachments";
import { isOpenRouterFreeModel, OPENROUTER_FREE_AUTO_MODEL, OPENROUTER_SPEED_OPTIMIZED_FREE_MODELS } from "../lib/models";
import type { ChatMessage } from "../types/chat";

/**
 * Models that we have verified support native function calling reliably even
 * when routed through OpenRouter. The list is conservative — when a free
 * model isn't here, the model client falls back to the XML-prompt path.
 *
 * Source: OpenRouter's `supported_parameters` includes "tools" for native
 * function calling; the snapshot below was hand-curated from that field for
 * the models the runtime exposes by default.
 */
const OPENROUTER_NATIVE_TOOL_MODEL_PREFIXES: string[] = [
  // Anthropic family (paid)
  "anthropic/claude-",
  // OpenAI family (paid)
  "openai/gpt-",
  "openai/o1",
  "openai/o3",
  "openai/o4",
  // Google paid
  "google/gemini-",
  // xAI paid
  "x-ai/grok-",
  // Mistral paid
  "mistralai/mistral-large",
  "mistralai/mistral-medium",
  // Cohere paid
  "cohere/command-",
];

export function openRouterModelHasReliableNativeTools(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (isOpenRouterFreeModel(normalized)) {
    return false;
  }
  return OPENROUTER_NATIVE_TOOL_MODEL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

type OpenRouterProviderSort =
  | "latency"
  | "price"
  | "throughput"
  | {
      by: "latency" | "price" | "throughput";
      partition?: "model" | "none";
    };

interface OpenRouterProviderPreferences {
  allow_fallbacks: boolean;
  max_price: {
    completion: number;
    prompt: number;
  };
  preferred_max_latency: {
    p50: number;
    p90: number;
  };
  preferred_min_throughput: {
    p50: number;
    p90: number;
  };
  require_parameters: boolean;
  sort: OpenRouterProviderSort;
}

const OPENROUTER_FAST_FREE_PROVIDER_PREFERENCES = {
  allow_fallbacks: true,
  max_price: {
    completion: 0,
    prompt: 0,
  },
  preferred_max_latency: {
    p50: 3,
    p90: 8,
  },
  preferred_min_throughput: {
    p50: 35,
    p90: 10,
  },
  require_parameters: true,
} satisfies Omit<OpenRouterProviderPreferences, "sort">;
const MAX_OPENROUTER_MODELS_ROUTE_COUNT = 3;

export function applyOpenRouterFreeModelRouting(body: Record<string, unknown>, model: string, messages: ChatMessage[]) {
  const normalizedModel = model.trim();

  if (!isOpenRouterFreeModel(normalizedModel)) {
    return;
  }

  const useSpeedOptimizedModelSet = normalizedModel === OPENROUTER_FREE_AUTO_MODEL && !hasImageAttachments(messages);

  if (useSpeedOptimizedModelSet) {
    body.models = OPENROUTER_SPEED_OPTIMIZED_FREE_MODELS.filter(isSpecificFreeModel).slice(0, MAX_OPENROUTER_MODELS_ROUTE_COUNT);
    delete body.model;
  }

  body.provider = createOpenRouterFastFreeProviderPreferences(useSpeedOptimizedModelSet);
}

function createOpenRouterFastFreeProviderPreferences(useGlobalModelSorting: boolean): OpenRouterProviderPreferences {
  return {
    ...OPENROUTER_FAST_FREE_PROVIDER_PREFERENCES,
    sort: useGlobalModelSorting
      ? {
          by: "throughput",
          partition: "none",
        }
      : "throughput",
  };
}

function hasImageAttachments(messages: ChatMessage[]) {
  return messages.some((message) => message.attachments?.some(isImageAttachment));
}

function isSpecificFreeModel(model: string) {
  return model.endsWith(":free");
}
