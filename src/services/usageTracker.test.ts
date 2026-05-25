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
        cacheCreationInputUsd: 0,
        cachedInputUsd: 0,
        inputUsd: 0,
        outputUsd: 0,
        reasoningUsd: 0,
        requestUsd: 0,
        totalUsd: 0,
      },
      source: "free",
    });
  });

  it("prices cached input tokens at the cached-input catalog rate", () => {
    const cost = estimateUsageCost({
      cacheCreationInputTokens: 100,
      cachedInputTokens: 400,
      inputTokens: 1000,
      outputTokens: 500,
      pricing: {
        cacheWriteInputPerMillionTokens: 12,
        cachedInputPerMillionTokens: 1,
        inputPerMillionTokens: 10,
        outputPerMillionTokens: 20,
      },
      provider: "openai",
    });

    expect(cost).toEqual({
      breakdown: {
        cacheCreationInputUsd: 0.0012,
        cachedInputUsd: 0.0004,
        inputUsd: 0.005,
        outputUsd: 0.01,
        reasoningUsd: 0,
        requestUsd: 0,
        totalUsd: 0.0166,
      },
      source: "catalog",
    });
  });

  it("records cached token hits and estimated cache savings", () => {
    const record = createProviderUsageRecord({
      chatId: "chat-cache",
      measuredUsage: {
        inputTokens: 1000,
        model: "gpt-5.4-mini",
        totalTokens: 1500,
      } as any,
      rawUsage: {
        cached_input_tokens: 600,
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
      cacheCreationInputTokens: 0,
      cachedInputTokens: 600,
      cacheSavingsUsd: 0.000405,
      inputTokens: 1000,
      totalCostUsd: 0.002595,
    });
    expect(record?.unitCost).toMatchObject({
      cacheCreationInputUsd: 0,
      cachedInputUsd: 0.000045,
      inputUsd: 0.0003,
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
