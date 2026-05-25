import type { ModelProviderId } from "./settings";

export type UsageCostSource = "catalog" | "free" | "subscription" | "unknown";
export type UsageRecordSource = "9router" | "estimated" | "provider";

export interface UsageCostBreakdown {
  cacheCreationInputUsd: number;
  cachedInputUsd: number;
  inputUsd: number;
  outputUsd: number;
  reasoningUsd: number;
  requestUsd: number;
  totalUsd: number;
}

export interface ProviderUsageRecord {
  chatId?: string;
  completionTokens: number;
  costSource: UsageCostSource;
  createdAt: string;
  dateKey: string;
  dayKey: string;
  endpoint?: string;
  id: string;
  cacheCreationInputTokens: number;
  cacheSavingsUsd: number;
  cachedInputTokens: number;
  inputTokens: number;
  model: string;
  monthKey: string;
  outputTokens: number;
  pricingNote?: string;
  provider: ModelProviderId;
  providerLabel: string;
  reasoningTokens: number;
  requestCount: number;
  source: UsageRecordSource;
  totalCostUsd: number;
  totalTokens: number;
  unitCost?: UsageCostBreakdown;
  weekKey: string;
}

export interface UsageHistoryState {
  records: ProviderUsageRecord[];
  updatedAt: string | null;
  version: 1;
}
