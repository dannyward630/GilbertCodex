import { describe, expect, it } from "vitest";
import { getStructuredToolActivity } from "./toolActivity";
import type { ChatToolCall } from "../../types/chat";

function toolCall(overrides: Partial<ChatToolCall>): ChatToolCall {
  return {
    id: "tool-1",
    label: "Search workspace files",
    status: "complete",
    ...overrides,
  };
}

describe("tool activity display", () => {
  it("summarizes file search calls with query, path, and mode chips", () => {
    const activity = getStructuredToolActivity(toolCall({
      input: JSON.stringify({
        includeContent: false,
        path: "src/toolBridge",
        query: "permissions",
        regex: true,
      }),
      output: "Found 2 matching files for \"permissions\".\nC:/repo/src/toolBridge/permissions.ts",
    }));

    expect(activity.summaryParts).toEqual([
      'query "permissions"',
      "path src/toolBridge",
    ]);
    expect(activity.chips.map((chip) => chip.label)).toEqual(["search", "regex", "paths only"]);
    expect(activity.outputSummary).toBe('Found 2 matching files for "permissions".');
  });

  it("summarizes batch reads without pasting file content into the row", () => {
    const activity = getStructuredToolActivity(toolCall({
      input: JSON.stringify({
        maxBytes: 4096,
        paths: ["src/app/App.tsx", "src/toolBridge/index.ts", "src/toolBridge/permissions.ts"],
      }),
      label: "Read many workspace files",
      output: "Read 3 of 3 requested files.\n\n--- src/app/App.tsx\nfull content here",
    }));

    expect(activity.summaryParts).toEqual([
      "3 paths: src/app/App.tsx, src/toolBridge/index.ts, src/toolBridge/permissions.ts",
      "bounded to 4,096 bytes",
    ]);
    expect(activity.chips.map((chip) => chip.label)).toEqual(["batch read", "3 paths", "bounded"]);
    expect(activity.outputSummary).toBe("Read 3 of 3 requested files.");
  });

  it("does not use raw single-file content as the row summary", () => {
    const activity = getStructuredToolActivity(toolCall({
      input: JSON.stringify({ path: "src/app/App.tsx" }),
      label: "Read workspace file",
      output: "import { useEffect } from \"react\";\nexport function App() {}",
    }));

    expect(activity.summaryParts).toEqual(["path src/app/App.tsx"]);
    expect(activity.outputSummary).toBeUndefined();
    expect(activity.chips.map((chip) => chip.label)).toEqual(["read"]);
  });

  it("summarizes range reads with path and line chips", () => {
    const activity = getStructuredToolActivity(toolCall({
      input: JSON.stringify({
        endLine: 900,
        path: "src/app/App.tsx",
        startLine: 700,
      }),
      label: "Read workspace file range",
      output: "Read C:/repo/src/app/App.tsx lines 700-900 of 9000.\n700: code",
    }));

    expect(activity.summaryParts).toEqual(["path src/app/App.tsx", "lines 700-900"]);
    expect(activity.chips.map((chip) => chip.label)).toEqual(["range read", "line range"]);
    expect(activity.outputSummary).toBe("Read C:/repo/src/app/App.tsx lines 700-900 of 9000.");
  });

  it("summarizes tree summaries without expanding the whole tree in the row", () => {
    const activity = getStructuredToolActivity(toolCall({
      input: JSON.stringify({
        maxDepth: 4,
        path: "C:/repo",
      }),
      label: "Summarize workspace tree",
      output: "Workspace tree summary for C:/repo\nScanned 20 directories and 200 files.",
    }));

    expect(activity.summaryParts).toEqual(["path C:/repo"]);
    expect(activity.chips.map((chip) => chip.label)).toEqual(["tree"]);
    expect(activity.outputSummary).toBe("Workspace tree summary for C:/repo");
  });

  it("falls back to a compact output summary for generic completed tools", () => {
    const activity = getStructuredToolActivity(toolCall({
      label: "Bridge sum",
      output: "7\nextra detail that should stay in the expanded output",
    }));

    expect(activity.summaryParts).toEqual([]);
    expect(activity.chips).toEqual([]);
    expect(activity.outputSummary).toBe("7");
  });
});
