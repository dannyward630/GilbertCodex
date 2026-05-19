import { isMediaAttachment } from "../lib/chatAttachments";
import { isOpenRouterFreeModel, OPENROUTER_FREE_AUTO_MODEL, OPENROUTER_SPEED_OPTIMIZED_FREE_MODELS } from "../lib/models";
import type { ChatMessage } from "../types/chat";

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
  // Free endpoint metadata can lag behind supported request shapes. Keep this
  // permissive so a harmless parameter does not collapse routing entirely.
  require_parameters: false,
} satisfies Omit<OpenRouterProviderPreferences, "sort">;
const MAX_OPENROUTER_MODELS_ROUTE_COUNT = 3;

export function applyOpenRouterFreeModelRouting(body: Record<string, unknown>, model: string, messages: ChatMessage[]) {
  const normalizedModel = model.trim();

  if (!isOpenRouterFreeModel(normalizedModel)) {
    return;
  }

  const useSpeedOptimizedModelSet = normalizedModel === OPENROUTER_FREE_AUTO_MODEL && !hasMediaAttachments(messages);

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

function hasMediaAttachments(messages: ChatMessage[]) {
  return messages.some((message) => message.attachments?.some(isMediaAttachment));
}

function isSpecificFreeModel(model: string) {
  return model.endsWith(":free");
}
