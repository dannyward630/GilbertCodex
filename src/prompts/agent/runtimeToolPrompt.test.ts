import { describe, expect, it } from "vitest";

import { defaultProviderSettings } from "../../lib/appStorage";
import { DEEP_RESEARCH_REASONING_EFFORT } from "../../types/settings";
import { createRuntimeToolPrompt } from "./runtimeToolPrompt";

describe("createRuntimeToolPrompt", () => {
  it("lets Deep Research use focused web_search calls when web search is enabled", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "deep research the latest Brave Search API docs",
      selectedChunkIds: new Set(),
      settings: {
        ...defaultProviderSettings,
        thinking: {
          enabled: true,
          effort: DEEP_RESEARCH_REASONING_EFFORT,
        },
        tools: {
          ...defaultProviderSettings.tools,
          webSearch: true,
        },
      },
    });

    expect(prompt).toContain("Deep Research may run multiple focused web_search calls");
    expect(prompt).toContain("Use separate searches for distinct subquestions");
    expect(prompt).not.toContain("do not attempt iterative tool loops");
  });

  it("keeps Deep Research honest when web_search is disabled", () => {
    const prompt = createRuntimeToolPrompt({
      hasLocalComputerContext: true,
      hasWebContext: false,
      latestUserPrompt: "deep research the latest Brave Search API docs",
      selectedChunkIds: new Set(),
      settings: {
        ...defaultProviderSettings,
        thinking: {
          enabled: true,
          effort: DEEP_RESEARCH_REASONING_EFFORT,
        },
        tools: {
          ...defaultProviderSettings.tools,
          webSearch: false,
        },
      },
    });

    expect(prompt).toContain("If web_search is disabled and attached web context is insufficient");
    expect(prompt).toContain("say what could not be verified");
  });
});
