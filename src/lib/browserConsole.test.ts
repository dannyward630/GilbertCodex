import { beforeEach, describe, expect, it } from "vitest";
import {
  clearBrowserConsoleEntries,
  getBrowserConsoleSnapshot,
  installBrowserConsoleMessageBridge,
  recordBrowserConsoleEntry,
} from "./browserConsole";

describe("browserConsole", () => {
  beforeEach(() => {
    clearBrowserConsoleEntries();
  });

  it("records, filters, and clears browser console entries", () => {
    recordBrowserConsoleEntry({
      level: "warning",
      message: "CSS warning",
      source: "Preview page",
      url: "http://localhost:5173/",
    });
    recordBrowserConsoleEntry({
      level: "error",
      message: new Error("Render failed"),
      source: "Preview page",
      url: "http://localhost:5173/",
    });

    expect(getBrowserConsoleSnapshot()).toMatchObject({
      counts: {
        error: 1,
        total: 2,
        warning: 1,
      },
      filteredCount: 2,
      retainedCount: 2,
    });
    expect(getBrowserConsoleSnapshot({ level: "error" }).entries).toHaveLength(1);

    clearBrowserConsoleEntries();

    expect(getBrowserConsoleSnapshot().counts.total).toBe(0);
  });

  it("keeps the full retained console unless a caller asks for recent entries only", () => {
    recordBrowserConsoleEntry({ level: "log", message: "one", source: "Preview page" });
    recordBrowserConsoleEntry({ level: "log", message: "two", source: "Preview page" });
    recordBrowserConsoleEntry({ level: "log", message: "three", source: "Preview page" });

    expect(getBrowserConsoleSnapshot().entries.map((entry) => entry.message)).toEqual(["one", "two", "three"]);
    expect(getBrowserConsoleSnapshot({ maxEntries: 2 })).toMatchObject({
      entries: [
        expect.objectContaining({ message: "two" }),
        expect.objectContaining({ message: "three" }),
      ],
      filteredCount: 3,
      truncated: true,
    });
  });

  it("accepts console messages from the browser postMessage bridge", () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    const fakeWindow = {
      addEventListener: (_eventName: string, listener: (event: MessageEvent) => void) => listeners.add(listener),
      removeEventListener: (_eventName: string, listener: (event: MessageEvent) => void) => listeners.delete(listener),
    } as unknown as Window;
    const uninstall = installBrowserConsoleMessageBridge(fakeWindow);

    for (const listener of listeners) {
      listener({
        data: {
          level: "error",
          message: ["Hydration failed", { component: "Header" }],
          source: "gilbert-browser-console",
          url: "http://localhost:5173/",
        },
        origin: "http://localhost:5173",
      } as MessageEvent);
    }

    expect(getBrowserConsoleSnapshot()).toMatchObject({
      counts: {
        error: 1,
        total: 1,
      },
      entries: [
        expect.objectContaining({
          level: "error",
          message: expect.stringContaining("Hydration failed"),
          url: "http://localhost:5173/",
        }),
      ],
    });

    uninstall();
    expect(listeners.size).toBe(0);
  });
});
