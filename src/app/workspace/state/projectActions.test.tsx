import { describe, expect, it } from "vitest";

import { defaultProviderSettings } from "../../../lib/appStorage";
import { getDefaultBaseUrlForProvider, isModelProviderId } from "../../../lib/models";
import { NINE_ROUTER_PROVIDER_ID } from "../../../services/nineRouterClient";
import type { ChatSummary } from "../../../types/chat";
import type { ProviderSettings } from "../../../types/settings";
import { handleProviderConnectionChoice } from "./projectActions";

describe("handleProviderConnectionChoice", () => {
  it("updates the current active chat by ref when a subscription provider is activated", () => {
    let providerSettings: ProviderSettings = {
      ...defaultProviderSettings,
      model: defaultProviderSettings.providerModels.openrouter || defaultProviderSettings.model,
      provider: "openrouter",
      providerModels: {
        ...defaultProviderSettings.providerModels,
        openrouter: defaultProviderSettings.providerModels.openrouter || defaultProviderSettings.model,
      },
    };
    let chats: ChatSummary[] = [
      {
        id: "stale-chat",
        messages: [],
        model: "openrouter/auto",
        project: "No project",
        provider: "openrouter",
        title: "Stale chat",
        updatedAt: "2026-05-22T00:00:00.000Z",
      },
      {
        id: "active-chat",
        messages: [],
        model: "openrouter/auto",
        project: "No project",
        provider: "openrouter",
        title: "Active chat",
        updatedAt: "2026-05-22T00:00:00.000Z",
      },
    ];

    handleProviderConnectionChoice(
      {
        activeChatIdRef: { current: "active-chat" },
        getDefaultBaseUrlForProvider,
        isModelProviderId,
        providerSettings,
        setChats(update: typeof chats | ((currentChats: typeof chats) => typeof chats)) {
          chats = typeof update === "function" ? update(chats) : update;
        },
        setProviderSettings(update: ProviderSettings | ((settings: ProviderSettings) => ProviderSettings)) {
          providerSettings = typeof update === "function" ? update(providerSettings) : update;
        },
      } as any,
      NINE_ROUTER_PROVIDER_ID,
      "cx/gpt-5.5",
    );

    expect(providerSettings.provider).toBe(NINE_ROUTER_PROVIDER_ID);
    expect(providerSettings.model).toBe("cx/gpt-5.5");
    expect(providerSettings.providerModels[NINE_ROUTER_PROVIDER_ID]).toBe("cx/gpt-5.5");
    expect(chats.find((chat) => chat.id === "active-chat")).toMatchObject({
      model: "cx/gpt-5.5",
      provider: NINE_ROUTER_PROVIDER_ID,
    });
    expect(chats.find((chat) => chat.id === "stale-chat")).toMatchObject({
      model: "openrouter/auto",
      provider: "openrouter",
    });
  });
});
