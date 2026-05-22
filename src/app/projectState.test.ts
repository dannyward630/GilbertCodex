import { describe, expect, it } from "vitest";

import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import { createNoProjectWorkspace } from "./projectState";

describe("createNoProjectWorkspace", () => {
  it("drops the previous focused project root when full-computer mode is active", () => {
    const previousProjectWorkspace: LocalWorkspaceSettings = {
      enabled: true,
      indexReason: "ready",
      indexSummary: {
        entryCount: 1200,
        ignoredEntries: 4,
        roots: [String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`],
        scannedDirectories: 80,
        skippedEntries: 2,
        truncated: false,
      },
      indexStatus: "idle",
      indexUpdatedAt: "2026-05-22T12:00:00.000Z",
      permissionMode: "full-access",
      roots: [String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`],
      scope: "full-computer",
    };

    const workspace = createNoProjectWorkspace(previousProjectWorkspace);

    expect(workspace).toMatchObject({
      enabled: true,
      permissionMode: "full-access",
      roots: [],
      scope: "full-computer",
    });
    expect(workspace.indexSummary).toBeUndefined();
    expect(workspace.indexReason).toBeUndefined();
    expect(workspace.indexUpdatedAt).toBeUndefined();
  });

  it("keeps ordinary no-project chats detached from local workspace context", () => {
    const workspace = createNoProjectWorkspace({
      enabled: true,
      permissionMode: "auto-review",
      roots: [String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`],
      scope: "selected-folder",
    });

    expect(workspace).toMatchObject({
      enabled: false,
      permissionMode: "auto-review",
      roots: [],
      scope: "selected-folder",
    });
  });
});
