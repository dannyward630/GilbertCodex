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
  const estimatedInputTokens = normalizeTokenCount(input.measuredUsage.inputTokens);
  const inputTokens = rawInputTokens ?? estimatedInputTokens ?? 0;
  const outputTokens = rawOutputTokens ?? normalizeTokenCount(input.measuredUsage.openRouterCompletionTokens) ?? 0;
  const reasoningTokens = rawReasoningTokens ?? 0;
  const totalTokens = rawTotalTokens ?? inputTokens + outputTokens + reasoningTokens;

  if (totalTokens <= 0) {
    return null;
  }

  const source: UsageRecordSource = rawInputTokens !== undefined || rawOutputTokens !== undefined || rawTotalTokens !== undefined ? "provider" : provider === "9router" ? "9router" : "estimated";
  const pricing = getChatModelOption(model, provider)?.pricing;
  const cost = estimateUsageCost({
    inputTokens,
    outputTokens,
    pricing,
    provider,
    reasoningTokens,
  });
  const createdAt = new Date().toISOString();

  return {
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
  inputTokens,
  outputTokens,
  pricing,
  provider,
  reasoningTokens = 0,
}: {
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

  if (!hasInputRate && !hasOutputRate && !hasReasoningRate && !hasRequestRate) {
    return {
      breakdown: emptyCostBreakdown(),
      source: provider === "9router" ? "subscription" : "unknown",
    };
  }

  const inputUsd = inputTokens * ((pricing.inputPerMillionTokens ?? 0) / 1_000_000);
  const outputUsd = outputTokens * ((pricing.outputPerMillionTokens ?? 0) / 1_000_000);
  const reasoningUsd = reasoningTokens * (((pricing.internalReasoningPerMillionTokens ?? pricing.outputPerMillionTokens) ?? 0) / 1_000_000);
  const requestUsd = pricing.requestUsd ?? 0;
  const totalUsd = inputUsd + outputUsd + reasoningUsd + requestUsd;

  return {
    breakdown: {
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
