import { describe, expect, it } from "vitest";
import { shouldUseDuckDuckGoFallbackForBraveError } from "./webSearchClient";

describe("Brave web search fallback policy", () => {
  it("keeps Brave configuration and API errors visible instead of silently falling back", () => {
    expect(shouldUseDuckDuckGoFallbackForBraveError("Add a Brave Search API key in Settings > Brave Search.")).toBe(false);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 401: Check the Brave Search API key.")).toBe(false);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 422: Check the Brave Search query and filter settings.")).toBe(false);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 429: Brave Search rate limit reached.")).toBe(false);
  });

  it("allows DuckDuckGo fallback for transient Brave failures and empty source sets", () => {
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search returned no usable sources.")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search search timed out after 22 seconds.")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search request failed: network error")).toBe(true);
    expect(shouldUseDuckDuckGoFallbackForBraveError("Brave Search failed with HTTP 503: unavailable")).toBe(true);
  });
});
