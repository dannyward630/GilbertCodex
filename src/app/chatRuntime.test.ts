import { describe, expect, it } from "vitest";
import { sanitizeLocalToolCallsForDisplay } from "../localWorkspace/localToolRuntimeDisabled";
import {
  createCompletedToolFallbackSummary,
  isInterruptedAssistantMessage,
  looksLikeOnlyToolPrelude,
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

  it("detects provider-native tool_calls JSON printed as visible text", () => {
    const content = String.raw`I'll continue examining more parts of this codebase to provide a comprehensive deep dive.

{ "tool_calls": [ { "id": "chatcmpl-tool-new1", "function": "files_read", "parameters": { "path": "C:\Users\Kobe Work\Documents\GilbertCodex\src\localWorkspace\files.ts" } }, { "id": "chatcmpl-tool-new2", "function": "files_read", "parameters": { "path": "C:\Users\Kobe Work\Documents\GilbertCodex\src\services\modelProviderClient.ts" } } ] }`;

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
    expect(isInterruptedAssistantMessage({
      content,
      createdAt: new Date().toISOString(),
      id: "assistant-tool-json",
      role: "assistant",
    })).toBe(true);
  });

  it("detects OpenAI-style function tool_calls JSON printed as visible text", () => {
    const content = String.raw`{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"files_read","arguments":"{\"path\":\"src/app/App.tsx\"}"}}]}`;

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

  it("rejects unfinished read or deep-dive preludes as final answers", () => {
    const content = [
      "Let me read the core files that were truncated to build a complete picture of the architecture.",
      "",
      "Let me pull the remaining critical files to complete the deep dive analysis.",
    ].join("\n");

    expect(looksLikeOnlyToolPrelude(content)).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
    expect(isInterruptedAssistantMessage({
      content,
      createdAt: new Date().toISOString(),
      id: "assistant-prelude",
      role: "assistant",
    })).toBe(true);
  });

  it("does not reject normal answers that mention completed verification", () => {
    const content = "I found the issue in the bridge finalization path and verified it with the focused tests.";

    expect(looksLikeOnlyToolPrelude(content)).toBe(false);
    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(false);
  });

  it("rejects latest-completed-result fallback summaries so they can be continued", () => {
    const content = [
      "Latest completed result: Read workspace file",
      "",
      "Read C:\\Users\\Kobe Work\\Documents\\GilbertCodex\\src-tauri\\src\\app.rs successfully.",
      "The full file content was kept with the tool result and was not pasted into chat.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
  });

  it("rejects read fallback summaries even without the legacy latest-result prefix", () => {
    const content = [
      "Read C:\\Users\\Kobe Work\\Documents\\HelloWorld\\skyline-ridge.html successfully.",
      "Content size: 18,029 characters across 189 lines.",
      "The full file content was kept with the tool result and was not pasted into chat.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
  });

  it("rejects result-finalizer fallback text so it cannot become the final answer", () => {
    const oldFallback = [
      "Read C:\\Users\\Kobe Work\\Documents\\GilbertCodex\\src\\toolBridge\\adapters\\index.ts.",
      "1,968 characters across 49 lines.",
      "Use the saved tool result to answer the request; do not paste the raw file body unless the user explicitly asked for it.",
    ].join(" ");
    const newFallback = [
      "Read `src/app/App.tsx`.",
      "42,000 characters across 1,200 lines.",
      "The raw file body is tool evidence for the next synthesis pass, not a final chat answer.",
    ].join(" ");

    expect(looksLikeInternalToolRecoveryAnswer(oldFallback)).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer(newFallback)).toBe(true);
  });

  it("rejects inline tool evidence if a weak model parrots it back", () => {
    expect(looksLikeInternalToolRecoveryAnswer("TOOL RESULT EVIDENCE\nTool: files_read\nCall id: call-read\nOutput:\nbody")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("Tool: files_search\nCall id: call-search\nStatus: complete")).toBe(true);
  });

  it("rejects provider excerpt markers if a weak model parrots them back", () => {
    expect(looksLikeInternalToolRecoveryAnswer("Provider-visible tool output excerpt ended after 24,000 characters. The original tool result remains complete in the app record.")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("Tool output replay excerpt ended for provider context recovery. The original saved result was not changed.")).toBe(true);
  });

  it("rejects raw bridge schema and registration errors as final answers", () => {
    expect(looksLikeInternalToolRecoveryAnswer("arguments.maxBytes must be integer")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("arguments.offset is not allowed")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("No bridge tool is registered as files_edit.")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("Tool files_write received invalid JSON arguments. Could not parse tool arguments as JSON.")).toBe(true);
  });

  it("rejects raw missing-file read failures as final answers", () => {
    expect(looksLikeInternalToolRecoveryAnswer("I could not complete that action: Could not read C:\\repo\\tailwind.config.ts: The system cannot find the file specified. (os error 2)")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("Could not read C:\\repo\\missing.ts: No such file or directory (os error 2)")).toBe(true);
  });

  it("rejects leaked synthesis recovery scaffolding as final answers", () => {
    expect(looksLikeInternalToolRecoveryAnswer("I hit a recoverable tool error before the final answer finished. The tool result included suggested file paths, so the next pass should retry the closest suggested path instead of stopping on the error.")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("I gathered the tool result, but the final answer did not finish cleanly. The next pass should continue from the attached tool result instead of showing the tool recap as the answer.")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("RECOVERABLE TOOL ERROR\n\nRetry the same intent now by calling files_read.")).toBe(true);
  });

  it("rejects generic finalization failure fallbacks as final answers", () => {
    expect(looksLikeInternalToolRecoveryAnswer("I could not produce a clean final answer. Please retry the request.")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("I could not complete that action cleanly. Please retry the request.")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("The model finished without producing a final answer for this run. Try sending the prompt again.")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("Read workspace file did not complete cleanly. The tool call used an invalid argument shape.")).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer("Read workspace file did not complete cleanly.")).toBe(true);
  });

  it("does not reject a normal explanation of a bridge schema error", () => {
    expect(looksLikeInternalToolRecoveryAnswer("`arguments.maxBytes must be integer` means the model sent a string instead of a number.")).toBe(false);
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
    expect(summary).toContain("The full listing was kept with the tool result");
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
        label: "Tool progress",
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
          label: "Tool progress",
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
        label: "Tool progress",
        status: "complete",
      },
    ]);
  });
});
