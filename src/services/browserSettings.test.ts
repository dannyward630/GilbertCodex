import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BROWSER_SETTINGS,
  addBrowserDomain,
  clearBrowserHistory,
  evaluateBrowserNavigationPolicy,
  loadBrowserHistory,
  normalizeBrowserDomain,
  recordBrowserHistoryVisit,
  removeBrowserDomain,
  saveBrowserSettings,
} from "./browserSettings";

function createLocalStorageMock() {
  const values = new Map<string, string>();

  return {
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
    get length() {
      return values.size;
    },
  } satisfies Storage;
}

describe("browser settings", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { localStorage: createLocalStorageMock() },
    });
    clearBrowserHistory();
    saveBrowserSettings(DEFAULT_BROWSER_SETTINGS);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("normalizes domains from common user input", () => {
    expect(normalizeBrowserDomain("https://www.example.com/search?q=test")).toBe("www.example.com");
    expect(normalizeBrowserDomain("*.example.com")).toBe("example.com");
    expect(normalizeBrowserDomain("localhost:5173")).toBe("localhost");
    expect(normalizeBrowserDomain("not-a-domain")).toBe("");
  });

  it("lets blocked domains win over allowed domains", () => {
    const settings = {
      ...DEFAULT_BROWSER_SETTINGS,
      allowedDomains: addBrowserDomain([], "example.com"),
      blockedDomains: addBrowserDomain([], "docs.example.com"),
    };

    expect(evaluateBrowserNavigationPolicy("https://docs.example.com/a", settings).decision).toBe("block");
    expect(evaluateBrowserNavigationPolicy("https://www.example.com/a", settings).decision).toBe("allow");
  });

  it("records history only when normal browsing can save history", () => {
    const normalSettings = { ...DEFAULT_BROWSER_SETTINGS, saveHistory: true };
    recordBrowserHistoryVisit("https://example.com/docs", "Docs", normalSettings);
    recordBrowserHistoryVisit("https://example.com/docs", "Docs", normalSettings);
    recordBrowserHistoryVisit("https://www.google.com/search?q=weather%20radar", "Google Search", normalSettings);

    expect(loadBrowserHistory().entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Google Search",
        url: "https://www.google.com/search?q=weather%20radar",
        visitCount: 1,
      }),
    ]));
    expect(loadBrowserHistory().entries.find((entry) => entry.url === "https://example.com/docs")).toMatchObject({
      title: "Docs",
      url: "https://example.com/docs",
      visitCount: 2,
    });

    clearBrowserHistory();
    recordBrowserHistoryVisit("https://example.com/incognito", "Secret", {
      ...normalSettings,
      incognitoEnabled: true,
    });

    expect(loadBrowserHistory().entries).toHaveLength(0);
  });

  it("can remove a domain without disturbing the rest of the list", () => {
    const domains = addBrowserDomain(addBrowserDomain([], "example.com"), "github.com");

    expect(removeBrowserDomain(domains, "example.com")).toEqual(["github.com"]);
  });
});
