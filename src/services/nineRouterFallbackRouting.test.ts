import { describe, expect, it } from "vitest";
import {
  buildNineRouterFallbackModels,
  getNineRouterOpenCodeFreeModels,
  hasUnusableNineRouterFallbackModels,
  NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS,
} from "./nineRouterFallbackRouting";

describe("9Router fallback routing", () => {
  it("uses OpenCode Free as the no-auth Always Free default", () => {
    expect(buildNineRouterFallbackModels("always-free", "", [])).toEqual([...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS]);
  });

  it("does not place bare OpenRouter free ids into 9Router combos", () => {
    const models = buildNineRouterFallbackModels("always-free", "", [
      "openai/gpt-oss-120b:free",
      "deepseek/deepseek-v4-flash:free",
      "openrouter/openai/gpt-oss-120b:free",
    ]);

    expect(models).toContain("openrouter/openai/gpt-oss-120b:free");
    expect(models).not.toContain("openai/gpt-oss-120b:free");
    expect(models).not.toContain("deepseek/deepseek-v4-flash:free");
  });

  it("keeps Smart Saver on connected routes before no-auth free routes", () => {
    expect(buildNineRouterFallbackModels("smart-saver", "cx/gpt-5.5", [
      "cx/gpt-5.5",
      "glm/glm-5.1",
      "oc/gpt-5.4-mini",
    ])).toEqual([
      "cx/gpt-5.5",
      "glm/glm-5.1",
      "oc/gpt-5.4-mini",
      ...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS.filter((model) => model !== "oc/gpt-5.4-mini"),
    ]);
  });

  it("flags old credential-bound fallback models that are not in the live catalog", () => {
    expect(hasUnusableNineRouterFallbackModels(["openai/gpt-oss-120b:free"], [])).toBe(true);
    expect(hasUnusableNineRouterFallbackModels(["kr/claude-sonnet-4.5"], [])).toBe(true);
    expect(hasUnusableNineRouterFallbackModels(["kr/claude-sonnet-4.5"], ["kr/claude-sonnet-4.5"])).toBe(false);
    expect(hasUnusableNineRouterFallbackModels(["oc/gpt-5.4-mini"], [])).toBe(false);
  });

  it("reports OpenCode defaults even when 9Router has not listed no-auth models yet", () => {
    expect(getNineRouterOpenCodeFreeModels([])).toEqual([...NINE_ROUTER_OPEN_CODE_FREE_FALLBACK_MODELS]);
  });
});
