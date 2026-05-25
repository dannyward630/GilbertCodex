import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BrowserPreviewPanel,
  activateBrowserPreviewSessionTab,
  closeBrowserPreviewSessionTab,
  createBrowserPreviewFrameKey,
  createBrowserPreviewNavigationUrl,
  formatBrowserPreviewTitle,
  shouldCloseBrowserPreviewPanelAfterTabClose,
  type BrowserPreviewSession,
} from "./BrowserPreviewPanel";

const now = "2026-05-16T12:00:00.000Z";

function makeSession(): BrowserPreviewSession {
  return {
    activeTabId: "tab-one",
    tabs: [
      {
        createdAt: now,
        history: ["http://localhost:5173/"],
        historyIndex: 0,
        id: "tab-one",
        reloadKey: 0,
        updatedAt: now,
        url: "http://localhost:5173/",
      },
      {
        createdAt: now,
        history: ["https://example.com/"],
        historyIndex: 0,
        id: "tab-two",
        reloadKey: 2,
        updatedAt: now,
        url: "https://example.com/",
      },
    ],
  };
}

describe("browser preview navigation", () => {
  it("treats tab activation as a selection change without changing reload keys", () => {
    const session = makeSession();
    const nextSession = activateBrowserPreviewSessionTab(session, "tab-two");

    expect(nextSession.activeTabId).toBe("tab-two");
    expect(nextSession.tabs.map((tab) => [tab.id, tab.url, tab.reloadKey])).toEqual([
      ["tab-one", "http://localhost:5173/", 0],
      ["tab-two", "https://example.com/", 2],
    ]);
  });

  it("selects a neighbor when closing the active tab", () => {
    const session = makeSession();
    const nextSession = closeBrowserPreviewSessionTab(session, "tab-one");

    expect(nextSession.activeTabId).toBe("tab-two");
    expect(nextSession.tabs).toHaveLength(1);
    expect(nextSession.tabs[0].id).toBe("tab-two");
  });

  it("treats closing the final tab as closing the browser panel", () => {
    const session = makeSession();

    expect(shouldCloseBrowserPreviewPanelAfterTabClose(session, "tab-one")).toBe(false);
    expect(shouldCloseBrowserPreviewPanelAfterTabClose({ activeTabId: "tab-one", tabs: [session.tabs[0]] }, "tab-one")).toBe(true);
    expect(shouldCloseBrowserPreviewPanelAfterTabClose({ activeTabId: "tab-one", tabs: [session.tabs[0]] }, "missing-tab")).toBe(false);
  });

  it("keeps iframe keys stable until an intentional reload or navigation", () => {
    const tab = makeSession().tabs[0];

    expect(createBrowserPreviewFrameKey(tab)).toBe("tab-one-0-http://localhost:5173/");
    expect(createBrowserPreviewFrameKey({ ...tab, reloadKey: 1 })).toBe("tab-one-1-http://localhost:5173/");
  });

  it("normalizes URLs and sends searches to the hidden default search provider", () => {
    expect(createBrowserPreviewNavigationUrl("localhost:5173")).toBe("http://localhost:5173/");
    expect(createBrowserPreviewNavigationUrl("github.com/UrbanWafflezz/GilbertCodex")).toBe("https://github.com/UrbanWafflezz/GilbertCodex");
    expect(createBrowserPreviewNavigationUrl("YouTube.com")).toBe("https://youtube.com/");
    expect(createBrowserPreviewNavigationUrl("weather radar")).toBe("https://www.google.com/search?q=weather%20radar");
    expect(createBrowserPreviewNavigationUrl("")).toBeNull();
  });

  it("formats stable, compact tab titles", () => {
    expect(formatBrowserPreviewTitle("http://localhost:5173/settings")).toBe("Local site/settings");
    expect(formatBrowserPreviewTitle("https://github.com/UrbanWafflezz/GilbertCodex")).toBe("github.com/UrbanWafflezz/GilbertCodex");
    expect(formatBrowserPreviewTitle()).toBe("New tab");
  });
});

describe("BrowserPreviewPanel", () => {
  it("opens the browser on a single Google tab by default", () => {
    const html = renderToStaticMarkup(createElement(BrowserPreviewPanel, {
      expanded: false,
      previewWidth: 560,
      resizeMaxWidth: 1120,
      resizeMinWidth: 320,
      onClose: () => undefined,
      onResizeKeyDown: () => undefined,
      onResizeStart: () => undefined,
      onToggleExpanded: () => undefined,
    }));

    expect(html).toContain("https://www.google.com/");
    expect(html).toContain("www.google.com");
    expect(html).toContain("Open browser console");
    expect(html).not.toContain("http://localhost:8787/");
    expect(html).not.toContain("YouTube");
    expect(html).not.toContain("GitHub");
    expect(html).not.toContain("<select");
  });
});
