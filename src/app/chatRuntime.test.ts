import { describe, expect, it } from "vitest";
import { sanitizeLocalToolCallsForDisplay } from "../localWorkspace/localToolRuntimeDisabled";
import { createCompletedToolFallbackSummary, looksLikeToolProtocolNarration, shouldSynthesizeEmptyFinalFromToolResults } from "./chatRuntime";

describe("tool protocol leak guards", () => {
  it("detects unterminated XML-style tool call fragments", () => {
    const content = String.raw`<tool_call>files_read <arg_key>path</arg_key> <arg_value>C:\Users\Kobe Work\Documents\GilbertCodex\src\toolBridge/permissions.ts</arg_value`;

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
  });

  it("strips unterminated XML-style tool call blocks from visible assistant content", () => {
    const content = [
      "Let me read that file.",
      String.raw`<tool_call>files_read <arg_key>path</arg_key> <arg_value>C:\Users\Kobe Work\Documents\GilbertCodex\src\toolBridge/permissions.ts</arg_value`,
    ].join("\n\n");

    expect(sanitizeLocalToolCallsForDisplay(content)).toBe("Let me read that file.");
  });
});

describe("completed tool fallback summaries", () => {
  it("summarizes large directory listings instead of returning a generic raw-output warning", () => {
    const output = [
      String.raw`Recursive directory tree C:\repo (5 entries):`,
      String.raw`[dir] C:\repo\src`,
      String.raw`[dir] C:\repo\src\app`,
      String.raw`[file] C:\repo\src\app\App.tsx`,
      String.raw`[file] C:\repo\src\app\chatRuntime.ts`,
      String.raw`[file] C:\repo\README.md`,
    ].join("\n");

    const summary = createCompletedToolFallbackSummary(
      {
        id: "1",
        input: JSON.stringify({ path: String.raw`C:\repo`, recursive: true }),
        label: "List workspace directory",
        output,
        status: "complete",
      },
      output,
    );

    expect(summary).toContain(String.raw`Listed 5 directory entries in C:\repo`);
    expect(summary).toContain("Directories: 2. Files: 3.");
    expect(summary).toContain(".tsx 1");
    expect(summary).toContain(".ts 1");
    expect(summary).toContain("The full listing is saved in Activity");
    expect(summary).not.toContain("model did not produce");
  });
});

describe("empty final answer recovery", () => {
  it("requests synthesis when a provider returns blank content after completed tools", () => {
    expect(shouldSynthesizeEmptyFinalFromToolResults("", [
      {
        id: "tool-1",
        label: "Read workspace file",
        output: "file content",
        status: "complete",
      },
    ])).toBe(true);
  });

  it("does not request synthesis while a tool is still waiting", () => {
    expect(shouldSynthesizeEmptyFinalFromToolResults("", [
      {
        id: "tool-1",
        label: "Read workspace file",
        status: "waiting_approval",
      },
    ])).toBe(false);
  });
});
