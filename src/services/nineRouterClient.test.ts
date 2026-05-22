import { describe, expect, it } from "vitest";
import { NINE_ROUTER_ALWAYS_FREE_MODEL } from "../lib/models";
import { chooseNineRouterConnectedAccountProvider, chooseNineRouterModelForAccount, chooseNineRouterModelForConnectedAccounts, getNineRouterAccountProviderForModel, shouldShowNineRouterCodexContextSettings } from "./nineRouterClient";

describe("nineRouterClient model selection", () => {
  it("prefers Codex subscription models after Codex sign-in instead of free routing", () => {
    expect(chooseNineRouterModelForAccount("codex", "", [
      NINE_ROUTER_ALWAYS_FREE_MODEL,
      "gh/gpt-5-mini",
      "cx/gpt-5.5",
      "cx/gpt-5.4",
    ])).toBe("cx/gpt-5.5");
  });

  it("keeps a saved model only when it belongs to the connected subscription provider", () => {
    expect(chooseNineRouterModelForAccount("codex", NINE_ROUTER_ALWAYS_FREE_MODEL, [
      NINE_ROUTER_ALWAYS_FREE_MODEL,
      "cx/gpt-5.4",
    ])).toBe("cx/gpt-5.4");
    expect(chooseNineRouterModelForAccount("github", "gh/gpt-4o", [
      "gh/gpt-5-mini",
      "gh/gpt-4o",
    ])).toBe("gh/gpt-4o");
  });

  it("chooses another signed-in subscription provider after sign-out", () => {
    expect(chooseNineRouterConnectedAccountProvider([
      { id: "codex-1", provider: "codex", testStatus: "active" },
      { id: "github-1", provider: "github", testStatus: "active" },
    ], "codex")?.id).toBe("github");
    expect(chooseNineRouterConnectedAccountProvider([
      { id: "codex-1", provider: "codex", testStatus: "active" },
    ], "codex")).toBeNull();
  });

  it("chooses subscription routes from connected accounts only", () => {
    expect(getNineRouterAccountProviderForModel("cc/claude-opus-4-7")).toBe("claude");
    expect(chooseNineRouterModelForConnectedAccounts("cc/claude-opus-4-7", [
      "cc/claude-opus-4-7",
      "cx/gpt-5.5",
    ], [
      { id: "codex-1", provider: "codex", testStatus: "active" },
    ])).toBe("cx/gpt-5.5");
    expect(chooseNineRouterModelForConnectedAccounts("cc/claude-opus-4-7", [
      "cc/claude-opus-4-7",
    ], [])).toBe("");
  });

  it("shows Codex context controls only for connected Codex routes", () => {
    expect(shouldShowNineRouterCodexContextSettings([
      { id: "claude-1", provider: "claude", testStatus: "active" },
    ], "cc/claude-opus-4-7")).toBe(false);
    expect(shouldShowNineRouterCodexContextSettings([
      { id: "codex-1", provider: "codex", testStatus: "active" },
    ], "cc/claude-opus-4-7")).toBe(false);
    expect(shouldShowNineRouterCodexContextSettings([], "cx/gpt-5.5")).toBe(false);
    expect(shouldShowNineRouterCodexContextSettings([
      { id: "codex-1", provider: "codex", testStatus: "active" },
    ], "cx/gpt-5.5")).toBe(true);
  });
});
