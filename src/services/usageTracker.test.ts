import { describe, expect, it } from "vitest";
import { defaultProviderSettings } from "../lib/appStorage";
import { createProviderUsageRecord, estimateUsageCost } from "./usageTracker";

describe("usage tracker", () => {
  it("creates a provider usage record with catalog pricing", () => {
    const record = createProviderUsageRecord({
      chatId: "chat-1",
      measuredUsage: {
        inputTokens: 1000,
        model: "gpt-5.4-mini",
        openRouterCompletionTokens: 500,
        totalTokens: 1500,
      } as any,
      rawUsage: {
        completion_tokens: 500,
        prompt_tokens: 1000,
        total_tokens: 1500,
      },
      settings: {
        ...defaultProviderSettings,
        model: "gpt-5.4-mini",
        provider: "openai",
      },
    });

    expect(record).toMatchObject({
      chatId: "chat-1",
      costSource: "catalog",
      inputTokens: 1000,
      model: "gpt-5.4-mini",
      outputTokens: 500,
      provider: "openai",
      source: "provider",
      totalCostUsd: 0.003,
      totalTokens: 1500,
    });
  });

  it("marks free model pricing as zero-cost", () => {
    const cost = estimateUsageCost({
      inputTokens: 2000,
      outputTokens: 1000,
      pricing: {
        inputPerMillionTokens: 0,
        outputPerMillionTokens: 0,
      },
      provider: "openrouter",
    });

    expect(cost).toEqual({
      breakdown: {
        inputUsd: 0,
        outputUsd: 0,
        reasoningUsd: 0,
        requestUsd: 0,
        totalUsd: 0,
      },
      source: "free",
    });
  });

  it("falls back to estimated input tokens when providers omit usage", () => {
    const record = createProviderUsageRecord({
      measuredUsage: {
        inputTokens: 2400,
        model: "cx/gpt-5.5",
        totalTokens: 2400,
      } as any,
      settings: {
        ...defaultProviderSettings,
        model: "cx/gpt-5.5",
        provider: "9router",
      },
    });

    expect(record).toMatchObject({
      costSource: "subscription",
      inputTokens: 2400,
      model: "cx/gpt-5.5",
      provider: "9router",
      source: "9router",
      totalCostUsd: 0,
      totalTokens: 2400,
    });
  });
});
