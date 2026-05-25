import { appendUsageHistoryRecord } from "../lib/appStorage";
import { getChatModelOption, getModelProvider, type ModelPricing } from "../lib/models";
import type { ContextWindowUsage } from "../lib/contextWindow";
import type { ProviderUsage } from "./modelProviderClient";
import type { ProviderSettings } from "../types/settings";
import type { ProviderUsageRecord, UsageCostBreakdown, UsageCostSource, UsageRecordSource } from "../types/usage";

export interface ProviderUsageRecordInput {
  chatId?: string;
  endpoint?: string;
  measuredUsage: ContextWindowUsage;
  rawUsage?: ProviderUsage;
  settings: ProviderSettings;
}

export function recordModelProviderUsage(input: ProviderUsageRecordInput) {
  try {
    const record = createProviderUsageRecord(input);

    if (!record || record.totalTokens <= 0) {
      return;
    }

    appendUsageHistoryRecord(record);
  } catch {
    // Usage history should never block the provider response path.
  }
}

export function createProviderUsageRecord(input: ProviderUsageRecordInput): ProviderUsageRecord | null {
  const provider = input.settings.provider;
  const providerDefinition = getModelProvider(provider);
  const model = input.measuredUsage.model || input.settings.model;
  const rawInputTokens = normalizeTokenCount(input.rawUsage?.prompt_tokens);
  const rawOutputTokens = normalizeTokenCount(input.rawUsage?.completion_tokens);
  const rawReasoningTokens = normalizeTokenCount(input.rawUsage?.reasoning_tokens);
  const rawTotalTokens = normalizeTokenCount(input.rawUsage?.total_tokens);
  const rawCacheCreationInputTokens = normalizeTokenCount(input.rawUsage?.cache_creation_input_tokens);
  const rawCachedInputTokens = normalizeTokenCount(input.rawUsage?.cached_input_tokens);
  const estimatedInputTokens = normalizeTokenCount(input.measuredUsage.inputTokens);
  const inputTokens = rawInputTokens ?? estimatedInputTokens ?? 0;
  const outputTokens = rawOutputTokens ?? normalizeTokenCount(input.measuredUsage.openRouterCompletionTokens) ?? 0;
  const reasoningTokens = rawReasoningTokens ?? 0;
  const totalTokens = rawTotalTokens ?? inputTokens + outputTokens + reasoningTokens;
  const cachedInputTokens = clampTokenCount(rawCachedInputTokens ?? 0, inputTokens);
  const cacheCreationInputTokens = rawCacheCreationInputTokens ?? 0;

  if (totalTokens <= 0) {
    return null;
  }

  const source: UsageRecordSource = rawInputTokens !== undefined || rawOutputTokens !== undefined || rawTotalTokens !== undefined ? "provider" : provider === "9router" ? "9router" : "estimated";
  const pricing = getChatModelOption(model, provider)?.pricing;
  const cost = estimateUsageCost({
    cacheCreationInputTokens,
    inputTokens,
    outputTokens,
    pricing,
    provider,
    reasoningTokens,
    cachedInputTokens,
  });
  const createdAt = new Date().toISOString();
  const cacheSavingsUsd = estimateCacheSavingsUsd(cachedInputTokens, pricing);

  return {
    cacheCreationInputTokens,
    cachedInputTokens,
    cacheSavingsUsd,
    chatId: input.chatId,
    completionTokens: outputTokens,
    costSource: cost.source,
    createdAt,
    dateKey: createLocalDateKey(createdAt),
    dayKey: createLocalDateKey(createdAt),
    endpoint: input.endpoint ?? "/v1/chat/completions",
    id: createUsageRecordId(createdAt, input.chatId, provider, model, totalTokens),
    inputTokens,
    model,
    monthKey: createLocalMonthKey(createdAt),
    outputTokens,
    pricingNote: pricing?.note,
    provider,
    providerLabel: providerDefinition.label,
    reasoningTokens,
    requestCount: 1,
    source,
    totalCostUsd: cost.breakdown.totalUsd,
    totalTokens,
    unitCost: cost.breakdown,
    weekKey: createLocalWeekKey(createdAt),
  };
}

export function estimateUsageCost({
  cacheCreationInputTokens = 0,
  cachedInputTokens = 0,
  inputTokens,
  outputTokens,
  pricing,
  provider,
  reasoningTokens = 0,
}: {
  cacheCreationInputTokens?: number;
  cachedInputTokens?: number;
  inputTokens: number;
  outputTokens: number;
  pricing?: ModelPricing;
  provider: ProviderSettings["provider"];
  reasoningTokens?: number;
}): { breakdown: UsageCostBreakdown; source: UsageCostSource } {
  if (!pricing) {
    return {
      breakdown: emptyCostBreakdown(),
      source: provider === "9router" ? "subscription" : "unknown",
    };
  }

  const hasInputRate = typeof pricing.inputPerMillionTokens === "number";
  const hasCacheWriteRate = typeof pricing.cacheWriteInputPerMillionTokens === "number";
  const hasCachedInputRate = typeof pricing.cachedInputPerMillionTokens === "number";
  const hasOutputRate = typeof pricing.outputPerMillionTokens === "number";
  const hasReasoningRate = typeof pricing.internalReasoningPerMillionTokens === "number";
  const hasRequestRate = typeof pricing.requestUsd === "number";
  const isFree = pricing.inputPerMillionTokens === 0 && pricing.outputPerMillionTokens === 0 && !hasRequestRate;

  if (isFree) {
    return {
      breakdown: emptyCostBreakdown(),
      source: "free",
    };
  }

  if (!hasInputRate && !hasCacheWriteRate && !hasCachedInputRate && !hasOutputRate && !hasReasoningRate && !hasRequestRate) {
    return {
      breakdown: emptyCostBreakdown(),
      source: provider === "9router" ? "subscription" : "unknown",
    };
  }

  const boundedCachedInputTokens = clampTokenCount(cachedInputTokens, inputTokens);
  const boundedCacheCreationInputTokens = clampTokenCount(cacheCreationInputTokens, Math.max(inputTokens - boundedCachedInputTokens, 0));
  const uncachedInputTokens = Math.max(inputTokens - boundedCachedInputTokens - boundedCacheCreationInputTokens, 0);
  const inputUsd = uncachedInputTokens * ((pricing.inputPerMillionTokens ?? 0) / 1_000_000);
  const cacheCreationInputUsd = boundedCacheCreationInputTokens * (((pricing.cacheWriteInputPerMillionTokens ?? pricing.inputPerMillionTokens) ?? 0) / 1_000_000);
  const cachedInputUsd = boundedCachedInputTokens * (((pricing.cachedInputPerMillionTokens ?? pricing.inputPerMillionTokens) ?? 0) / 1_000_000);
  const outputUsd = outputTokens * ((pricing.outputPerMillionTokens ?? 0) / 1_000_000);
  const reasoningUsd = reasoningTokens * (((pricing.internalReasoningPerMillionTokens ?? pricing.outputPerMillionTokens) ?? 0) / 1_000_000);
  const requestUsd = pricing.requestUsd ?? 0;
  const totalUsd = inputUsd + cacheCreationInputUsd + cachedInputUsd + outputUsd + reasoningUsd + requestUsd;

  return {
    breakdown: {
      cacheCreationInputUsd: roundUsd(cacheCreationInputUsd),
      cachedInputUsd: roundUsd(cachedInputUsd),
      inputUsd: roundUsd(inputUsd),
      outputUsd: roundUsd(outputUsd),
      reasoningUsd: roundUsd(reasoningUsd),
      requestUsd: roundUsd(requestUsd),
      totalUsd: roundUsd(totalUsd),
    },
    source: "catalog",
  };
}

function emptyCostBreakdown(): UsageCostBreakdown {
  return {
    cacheCreationInputUsd: 0,
    cachedInputUsd: 0,
    inputUsd: 0,
    outputUsd: 0,
    reasoningUsd: 0,
    requestUsd: 0,
    totalUsd: 0,
  };
}

function normalizeTokenCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function clampTokenCount(value: number, max: number) {
  return Math.min(Math.max(Math.round(value), 0), Math.max(Math.round(max), 0));
}

function estimateCacheSavingsUsd(cachedInputTokens: number, pricing: ModelPricing | undefined) {
  if (!pricing || typeof pricing.inputPerMillionTokens !== "number" || typeof pricing.cachedInputPerMillionTokens !== "number") {
    return 0;
  }

  const perMillionSavings = Math.max(pricing.inputPerMillionTokens - pricing.cachedInputPerMillionTokens, 0);

  return roundUsd(cachedInputTokens * (perMillionSavings / 1_000_000));
}

function roundUsd(value: number) {
  return Number(Math.max(value, 0).toFixed(8));
}

function createUsageRecordId(createdAt: string, chatId: string | undefined, provider: string, model: string, totalTokens: number) {
  const randomId = globalThis.crypto?.randomUUID?.();

  if (randomId) {
    return `usage-${randomId}`;
  }

  return `usage-${createdAt}-${chatId ?? "chat"}-${provider}-${hashStableText(`${model}:${totalTokens}:${Math.random()}`)}`;
}

function createLocalDateKey(isoTimestamp: string) {
  const date = new Date(isoTimestamp);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function createLocalMonthKey(isoTimestamp: string) {
  const date = new Date(isoTimestamp);

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function createLocalWeekKey(isoTimestamp: string) {
  const date = new Date(isoTimestamp);
  const utcDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utcDate.getUTCDay() || 7;
  utcDate.setUTCDate(utcDate.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utcDate.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utcDate.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);

  return `${utcDate.getUTCFullYear()}-W${pad(week)}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function hashStableText(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash.toString(36);
}
