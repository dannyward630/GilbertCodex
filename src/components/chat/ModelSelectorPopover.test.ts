import { describe, expect, it } from "vitest";
import { defaultProviderSettings } from "../../lib/appStorage";
import { NINE_ROUTER_ALWAYS_FREE_MODEL, NINE_ROUTER_CODEX_MODEL_IDS, NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS, NINE_ROUTER_SMART_SAVER_MODEL } from "../../lib/models";
import type { ProviderSettings } from "../../types/settings";
import { buildSelectorEntries, type LiveModelCatalogStatus } from "./ModelSelectorPopover";

function createProviderSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
  return {
    ...defaultProviderSettings,
    ...overrides,
    apiKeys: {
      ...defaultProviderSettings.apiKeys,
      ...overrides.apiKeys,
    },
    baseUrls: {
      ...defaultProviderSettings.baseUrls,
      ...overrides.baseUrls,
    },
    disabledModels: {
      ...defaultProviderSettings.disabledModels,
      ...overrides.disabledModels,
    },
    providerModels: {
      ...defaultProviderSettings.providerModels,
      ...overrides.providerModels,
    },
  };
}

function getSubscriptionModelValues(
  settings: ProviderSettings,
  status: LiveModelCatalogStatus | undefined,
  liveModels: ReadonlyArray<{ id: string }> | undefined,
) {
  return buildSelectorEntries(
    settings,
    settings.model,
    liveModels ? { "9router": [...liveModels] } : {},
    status ? { "9router": status } : {},
    {},
  )
    .filter((entry) => entry.provider.id === "9router")
    .map((entry) => entry.option.value);
}

describe("model selector subscription models", () => {
  const subscriptionDefaults = [
    ...NINE_ROUTER_CODEX_MODEL_IDS,
    NINE_ROUTER_SMART_SAVER_MODEL,
    NINE_ROUTER_ALWAYS_FREE_MODEL,
    ...NINE_ROUTER_GITHUB_COPILOT_MODEL_IDS,
  ];

  it("keeps subscription defaults selectable while the active live catalog is unavailable", () => {
    const settings = createProviderSettings({
      model: "cx/gpt-5.5",
      provider: "9router",
    });

    for (const [status, liveModels] of [
      ["loading", undefined],
      ["error", undefined],
      ["ready", []],
    ] as const) {
      expect(getSubscriptionModelValues(settings, status, liveModels)).toEqual(subscriptionDefaults);
    }
  });

  it("keeps inactive subscription defaults selectable from the composer menu", () => {
    const settings = createProviderSettings({
      model: defaultProviderSettings.providerModels.openrouter,
      provider: "openrouter",
    });

    expect(getSubscriptionModelValues(settings, undefined, undefined)).toEqual(subscriptionDefaults);
  });

  it("merges ready live subscription models with the static defaults", () => {
    const settings = createProviderSettings({
      model: "cx/gpt-5.5",
      provider: "9router",
    });

    const modelValues = getSubscriptionModelValues(settings, "ready", [
      { id: "cx/gpt-5.3-codex-high" },
      { id: "github/gpt-4o" },
      { id: "gh/gpt-5.4" },
    ]);

    expect(modelValues).toEqual(expect.arrayContaining(subscriptionDefaults));
    expect(modelValues).toContain("cx/gpt-5.3-codex-high");
    expect(modelValues).toContain("gh/gpt-4o");
    expect(modelValues).not.toContain("gh/gpt-5.4");
  });
});
