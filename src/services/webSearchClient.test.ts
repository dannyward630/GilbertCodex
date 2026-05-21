import { describe, expect, it } from "vitest";
import {
  createChatSourcesFromWebResults,
  MAX_WEB_SEARCH_RESULTS,
  shouldUseDuckDuckGoFallbackForBraveError,
} from "./webSearchClient";

describe("Brave web search fallback policy", () => {
  it("keeps Brave configuration and API errors visible instead of silently falling back", () => {
    expect(shouldUseDuckDuckGoFallbackForBraveError("Add a Brave Search API key in Settings > Brave Search.")).toBe(false);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 401: Check the Brave Search API key.")).toBe(false);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 422: Check the Brave Search query and filter settings.")).toBe(false);
  });

  it("allows DuckDuckGo fallback for transient Brave failures and empty source sets", () => {
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search returned no usable sources.")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search search timed out after 22 seconds.")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search request failed: network error")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 429: Brave Search rate limit reached.")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 429: subscription token quota exceeded.")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Could not parse Brave Search response: expected value at line 1 column 1")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 503: unavailable")).toBe(true);
  });
});

describe("web search source normalization", () => {
  it("dedupes, caps, and preserves source card metadata", () => {
    const sources = createChatSourcesFromWebResults([
      {
        snippet: "Primary docs",
        sourceType: "web",
        title: "  Official Docs  ",
        url: "https://example.com/docs",
      },
      {
        snippet: "Duplicate",
        title: "Duplicate Docs",
        url: "https://example.com/docs",
      },
      {
        imageUrl: "https://images.example.com/a.png",
        sourceType: "image",
        thumbnailUrl: "https://images.example.com/a-thumb.png",
        title: "Image Result",
        url: "https://images.example.com/a",
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        snippet: `Extra ${index}`,
        title: `Extra ${index}`,
        url: `https://extra.example.com/${index}`,
      })),
    ]);

    expect(sources).toHaveLength(MAX_WEB_SEARCH_RESULTS);
    expect(sources[0]).toMatchObject({
      detail: "example.com - Primary docs",
      sourceType: "web",
      title: "Official Docs",
      url: "https://example.com/docs",
    });
    expect(sources.filter((source) => source.url === "https://example.com/docs")).toHaveLength(1);
    expect(sources.some((source) => source.thumbnailUrl === "https://images.example.com/a-thumb.png")).toBe(true);
  });
});
