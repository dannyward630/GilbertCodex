import { describe, expect, it } from "vitest";
import { DEFAULT_CASH_APP_URL, normalizeSupportConfig, normalizeSupportUrl } from "./supportConfig";

describe("support config", () => {
  it("hides unconfigured funding links except PayPal", () => {
    const config = normalizeSupportConfig({});

    expect(config.configuredCount).toBe(0);
    expect(config.links).toHaveLength(4);
    expect(config.primaryLinks).toHaveLength(1);
    expect(config.primaryLinks[0]).toMatchObject({
      enabled: false,
      id: "cashApp",
      providerLabel: "Cash App",
      url: DEFAULT_CASH_APP_URL,
    });
    expect(config.visiblePrimaryLinks.map((link) => link.id)).toEqual([]);
    expect(config.visibleSecondaryLinks.map((link) => link.id)).toEqual(["paypal"]);
  });

  it("keeps Cash App disabled when the env value is blank", () => {
    const config = normalizeSupportConfig({
      VITE_SUPPORT_CASHAPP_URL: "  ",
    });

    expect(config.primaryLinks[0]).toMatchObject({
      enabled: false,
      id: "cashApp",
      url: DEFAULT_CASH_APP_URL,
    });
  });

  it("normalizes valid hosted funding URLs", () => {
    const config = normalizeSupportConfig({
      VITE_SUPPORT_CASHAPP_URL: "https://cash.app/$projecthandle",
      VITE_SUPPORT_PAYPAL_URL: " https://paypal.me/projectmaintainer ",
      VITE_SUPPORT_STRIPE_MONTHLY_URL: "https://buy.stripe.com/monthly_123",
      VITE_SUPPORT_STRIPE_ONE_TIME_URL: "https://buy.stripe.com/once_123",
    });

    expect(config.configuredCount).toBe(4);
    expect(config.primaryLinks.map((link) => link.enabled)).toEqual([true]);
    expect(config.secondaryLinks.map((link) => link.enabled)).toEqual([true, true, true]);
    expect(config.visibleSecondaryLinks.map((link) => link.id)).toEqual(["stripeOneTime", "stripeMonthly", "paypal"]);
    expect(config.links.map((link) => link.url)).toContain("https://buy.stripe.com/once_123");
  });

  it("rejects unsupported protocols and malformed URLs", () => {
    expect(normalizeSupportUrl("javascript:alert(1)")).toBe("");
    expect(normalizeSupportUrl("file:///C:/Users/Example/secrets.txt")).toBe("");
    expect(normalizeSupportUrl("not-a-url")).toBe("");
  });

  it("rejects secret-like values instead of exposing them as funding links", () => {
    const config = normalizeSupportConfig({
      VITE_SUPPORT_CASHAPP_URL: "https://cash.app/$projecthandle?access_token=abc",
      VITE_SUPPORT_PAYPAL_URL: "https://paypal.me/projectmaintainer?client_secret=sk_live_123",
      VITE_SUPPORT_STRIPE_MONTHLY_URL: "whsec_live_123",
      VITE_SUPPORT_STRIPE_ONE_TIME_URL: "sk_live_123",
    });

    expect(config.configuredCount).toBe(0);
    expect(config.links.every((link) => !link.enabled && link.url === "")).toBe(true);
    expect(config.visibleSecondaryLinks.map((link) => link.id)).toEqual(["paypal"]);
  });
});
