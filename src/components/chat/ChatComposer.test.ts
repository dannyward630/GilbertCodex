import { describe, expect, it } from "vitest";
import { shouldLoadLiveModelCatalogProvider } from "./ChatComposer";

describe("chat composer live model catalogs", () => {
  it("loads subscription models even when another provider is active", () => {
    expect(shouldLoadLiveModelCatalogProvider("9router", "openrouter")).toBe(true);
  });
});
