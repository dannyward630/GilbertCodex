import { describe, expect, it } from "vitest";
import { sanitizeLocalToolCallsForDisplay } from "../localWorkspace/localToolRuntimeDisabled";
import {
  createCompletedToolFallbackSummary,
  looksLikeInternalToolRecoveryAnswer,
  looksLikeToolProtocolNarration,
  shouldSynthesizeEmptyFinalFromToolResults,
  withLocalComputerProgress,
} from "./chatRuntime";

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

describe("final answer recovery guards", () => {
  it("does not reject normal final answers just because they mention tools or verification", () => {
    const content = [
      "Fixed. The read tool now recovers stale module paths such as `src/toolBridge/adapters.ts` to `src/toolBridge/adapters/index.ts`.",
      "",
      "Verified with `npm.cmd run test:tool-bridge`, `tsc --noEmit`, and the full app check.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(false);
  });

  it("does not reject a normal explanation of the app finalization loop", () => {
    const content = [
      "The app was treating a valid visible answer as if it were internal tool-result recovery text.",
      "That made it blank the assistant message and ask the provider to rewrite the answer again.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(false);
  });

  it("still rejects explicit app fallback prose", () => {
    expect(looksLikeInternalToolRecoveryAnswer("I completed the tool work. Here are the saved results:")).toBe(true);
  });

  it("rejects latest-completed-result fallback summaries so they can be continued", () => {
    const content = [
      "Latest completed result: Read workspace file",
      "",
      "Read C:\\Users\\Kobe Work\\Documents\\GilbertCodex\\src-tauri\\src\\app.rs successfully.",
      "The full file content is saved in Activity and was not pasted into chat.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
  });

  it("rejects read fallback summaries even without the legacy latest-result prefix", () => {
    const content = [
      "Read C:\\Users\\Kobe Work\\Documents\\HelloWorld\\skyline-ridge.html successfully.",
      "Content size: 18,029 characters across 189 lines.",
      "The full file content is saved in Activity and was not pasted into chat.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
  });

  it("rejects raw workspace tree summaries so they can be synthesized", () => {
    const content = [
      "Workspace tree summary for C:\\Users\\Kobe Work\\Documents\\GilbertBusiness",
      "Scanned 2 directories and 6 files to depth 4.",
      "Top file types: jsx 2; css 1; html 1; js 1; json 1.",
      "GilbertBusiness/ (3 files)",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
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

  it("honors result finalizer metadata when deciding whether blank content needs synthesis", () => {
    expect(shouldSynthesizeEmptyFinalFromToolResults("", [
      {
        id: "tool-smoke",
        label: "Run tool smoke test",
        output: "Tool smoke test passed.",
        resultPolicy: {
          mode: "safe_summary",
          resultKind: "diagnostic",
          synthesizeAfterwards: false,
        },
        status: "complete",
        toolId: "tool_smoke_test",
      },
    ])).toBe(false);

    expect(shouldSynthesizeEmptyFinalFromToolResults("", [
      {
        id: "tool-read",
        label: "Read workspace file",
        output: "full file body",
        resultPolicy: {
          mode: "synthesize",
          resultKind: "file_content",
          synthesizeAfterwards: true,
        },
        status: "complete",
        toolId: "files_read",
      },
    ])).toBe(true);
  });
});

describe("local progress rows", () => {
  it("replaces legacy and current local-tool progress rows instead of stacking them", () => {
    const progress = withLocalComputerProgress(
      {
        detail: "1 bridge tool ran",
        id: "local-computer-tools",
        label: "Tool activity",
        status: "complete",
      },
      [
        {
          detail: "Stopped when the app reloaded.",
          id: "local-tools-disabled",
          label: "Local tools disabled",
          status: "complete",
        },
        {
          detail: "0 bridge tools ran",
          id: "local-computer-tools",
          label: "Tool activity",
          status: "complete",
        },
        {
          detail: "1 source",
          id: "web-search",
          label: "Search DuckDuckGo",
          status: "complete",
        },
      ],
    );

    expect(progress).toEqual([
      {
        detail: "1 source",
        id: "web-search",
        label: "Search DuckDuckGo",
        status: "complete",
      },
      {
        detail: "1 bridge tool ran",
        id: "local-computer-tools",
        label: "Tool activity",
        status: "complete",
      },
    ]);
  });
});
