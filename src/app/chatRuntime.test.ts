import { describe, expect, it } from "vitest";
import { sanitizeLocalToolCallsForDisplay } from "../localWorkspace/localToolRuntimeDisabled";
import {
  createCompletedToolFallbackSummary,
  createFreshLocalToolEvidenceInstruction,
  createLocalToolFinalInstruction,
  createNeutralToolSynthesisFailureMessage,
  createToolProtocolNarrationRecoveryInstruction,
  isInterruptedAssistantMessage,
  isFileReadSynthesisToolCall,
  looksLikeInFlightToolPlanning,
  looksLikeOnlyToolPrelude,
  looksLikeInternalToolRecoveryAnswer,
  looksLikeToolProtocolNarration,
  looksLikePrivateThinkingNarration,
  stripLeadingToolPreludeForDisplay,
  looksLikeUnnecessaryLocalActionConfirmation,
  looksLikeUnappliedFileEditAnswer,
  looksLikeUnexecutedToolActionPromise,
  looksLikeCapabilityInventoryQuestion,
  needsFreshLocalToolEvidence,
  requiresWorkspaceToolCallForPrompt,
  createWebSearchProgress,
  shouldSynthesizeEmptyFinalFromToolResults,
  shouldHoldStreamingContentForToolCalls,
  withLocalComputerProgress,
} from "./chatRuntime";

describe("tool protocol leak guards", () => {
  it("detects unterminated XML-style tool call fragments", () => {
    const content = String.raw`<tool_call>files_read <arg_key>path</arg_key> <arg_value>C:\Users\Example User\Documents\GilbertCodex\src\toolBridge/permissions.ts</arg_value`;

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
  });

  it("detects provider-native tool_calls JSON printed as visible text", () => {
    const content = String.raw`I'll continue examining more parts of this codebase to provide a comprehensive deep dive.

{ "tool_calls": [ { "id": "chatcmpl-tool-new1", "function": "files_read", "parameters": { "path": "C:\Users\Example User\Documents\GilbertCodex\src\localWorkspace\files.ts" } }, { "id": "chatcmpl-tool-new2", "function": "files_read", "parameters": { "path": "C:\Users\Example User\Documents\GilbertCodex\src\services\modelProviderClient.ts" } } ] }`;

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
    expect(isInterruptedAssistantMessage({
      content,
      createdAt: new Date().toISOString(),
      id: "assistant-tool-json",
      role: "assistant",
    })).toBe(true);
  });

  it("detects fenced provider-native tool_calls JSON printed as visible text", () => {
    const content = [
      "```json",
      `{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"files_read","arguments":"{\\"path\\":\\"src/app/App.tsx\\"}"}}]}`,
      "```",
    ].join("\n");

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
  });

  it("tells recovery turns not to emit JSON envelopes or whole-response fences", () => {
    const instruction = createToolProtocolNarrationRecoveryInstruction("inspect files", `{"tool_calls":[]}`);

    expect(instruction).toContain("Do not emit visible tool-call syntax");
    expect(instruction).toContain("provider tool_calls");
    expect(instruction).toContain("whole-response code fence");
  });

  it("keeps final synthesis focused on the user request and evidence-backed claims", () => {
    const instruction = createLocalToolFinalInstruction("fix the app and verify it");

    expect(instruction).toContain("The original user request is the success condition");
    expect(instruction).toContain("do not substitute a recap, plan, or adjacent task");
    expect(instruction).toContain("Claim completed work only when current tool results prove it");
  });

  it("detects OpenAI-style function tool_calls JSON printed as visible text", () => {
    const content = String.raw`{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"files_read","arguments":"{\"path\":\"src/app/App.tsx\"}"}}]}`;

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
  });

  it("detects direct XML-style bridge tool tags printed as visible text", () => {
    const content = String.raw`<files_read_range> <path>src/App.jsx</path> <startLine>195</startLine> <endLine>280</endLine> </files_read_range>`;

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
    expect(sanitizeLocalToolCallsForDisplay(content)).toBe("");
  });

  it("detects and strips DSML bridge tool calls printed as visible text", () => {
    const content = [
      "I need to read the file.",
      `< | DSML | tool_calls>`,
      `< | DSML | invoke name="files_read_range">`,
      `< | DSML | parameter name="path" string="true">src/App.jsx</ | DSML | parameter>`,
      `< | DSML | parameter name="startLine" string="false">195</ | DSML | parameter>`,
      `< | DSML | parameter name="endLine" string="false">280</ | DSML | parameter>`,
      `</ | DSML | invoke>`,
      `</ | DSML | tool_calls>`,
    ].join("\n");

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
    expect(sanitizeLocalToolCallsForDisplay(content)).toBe("I need to read the file.");
  });

  it("strips unterminated DSML tool-call blocks while streaming", () => {
    const content = [
      "Thinking before the call.",
      `< | DSML | tool_calls>`,
      `< | DSML | invoke name="files_read_range">`,
      `< | DSML | parameter name="path" string="true">src/App.jsx`,
    ].join("\n");

    expect(looksLikeToolProtocolNarration(content)).toBe(true);
    expect(sanitizeLocalToolCallsForDisplay(content)).toBe("Thinking before the call.");
  });

  it("strips unterminated XML-style tool call blocks from visible assistant content", () => {
    const content = [
      "Let me read that file.",
      String.raw`<tool_call>files_read <arg_key>path</arg_key> <arg_value>C:\Users\Example User\Documents\GilbertCodex\src\toolBridge/permissions.ts</arg_value`,
    ].join("\n\n");

    expect(sanitizeLocalToolCallsForDisplay(content)).toBe("Let me read that file.");
  });

  it("holds streamed content attached to active provider tool calls out of the answer bubble", () => {
    const content = "Looking at the tool results, I can see there are still UI issues that need fixing.";

    expect(shouldHoldStreamingContentForToolCalls(content, true)).toBe(true);
    expect(shouldHoldStreamingContentForToolCalls(content, false)).toBe(false);
  });

  it("detects screenshot-style in-flight tool planning as thinking, not a public answer", () => {
    const content = [
      "Looking at the tool results, I can see there are still UI issues that need fixing. Let me analyze the current state:",
      "",
      "Issues Found:",
      "",
      "1. favicon.svg - Already created",
      "2. Gradient animation not optimized - The animation runs continuously",
      "3. Missing type=\"button\" on theme toggle - The button element lacks this attribute",
      "",
      "Let me fix the remaining issues in `App.tsx`:",
    ].join("\n");

    expect(looksLikeInFlightToolPlanning(content)).toBe(true);
  });

  it("detects compact-composer narration after reads as in-flight tool planning", () => {
    const content = [
      "Now I can see the current CSS. The composer is the pill-shaped input box with `border-radius: 28px`, generous padding, and a tall context ring.",
      "Let me make it more compact - reducing padding, rounding, and button sizes.",
    ].join("\n\n");

    expect(looksLikeInFlightToolPlanning(content)).toBe(true);
  });

  it("detects plain first-person coding promises as unfinished tool work", () => {
    const content = "Now I need to update the database service to add message update/delete support:";

    expect(looksLikeUnexecutedToolActionPromise(content)).toBe(true);
    expect(looksLikeInFlightToolPlanning(content)).toBe(true);
    expect(looksLikeOnlyToolPrelude(content)).toBe(true);
  });

  it("detects curly-apostrophe coding promises as unfinished tool work", () => {
    const content = "To connect the chat into the app so you can see the UI, I\u2019ll update App.jsx to include a router and nav that reaches ChatPage.";

    expect(looksLikeUnexecutedToolActionPromise(content)).toBe(true);
  });

  it("rejects confirmation questions for ordinary requested local edits", () => {
    const content = [
      "To connect the chat into the app so you can see the UI, I\u2019ll update App.jsx to include a router and nav that reaches the ChatPage already created at src/pages/Chat/ChatPage.tsx.",
      "",
      "Proposed change (verifiable edit to src/App.jsx):",
      "",
      "Before I apply this, please confirm:",
      "",
      "Do you want me to install react-router-dom and apply this edit to src/App.jsx now?",
    ].join("\n");

    expect(looksLikeUnnecessaryLocalActionConfirmation(content)).toBe(true);
    expect(looksLikeOnlyToolPrelude(content)).toBe(true);
  });

  it("detects line-edit narration with bridge tool names as thinking, not visible response", () => {
    const content = [
      "You're right, the edits never took effect. Let me actually make them now with a proper targeted edit.",
      "",
      "First, here's what's currently on disk and what needs to change:",
      "",
      "Current `App.jsx` lines 212-213:",
      "",
      "```js",
      "const size = 32;",
      "const strokeWidth = 2.5;",
      "```",
      "",
      "Let me apply that edit now.",
      "",
      "One precise change to `App.jsx` using `files_replace_range`:",
      "",
      "Replace lines 212-213 with:",
      "",
      "```js",
      "const size = 28;",
      "const strokeWidth = 2.2;",
      "```",
      "",
      "Wait - I don't have files_replace_range available. Let me check what tools I do have attached.",
    ].join("\n");

    expect(looksLikeUnexecutedToolActionPromise(content)).toBe(true);
    expect(looksLikeInFlightToolPlanning(content)).toBe(true);
    expect(looksLikeOnlyToolPrelude(content)).toBe(true);
  });

  it("detects explicit private reasoning labels as non-public scratchpad", () => {
    const content = [
      "Analysis: The user is reporting thinking leakage in the app.",
      "I need to inspect the streaming path before answering.",
    ].join("\n");

    expect(looksLikePrivateThinkingNarration(content)).toBe(true);
  });

  it("does not classify unlabeled answer-like project text as private thinking", () => {
    const content = [
      "The runtime orchestrates tool execution with:",
      "",
      "## Rust Backend Integration",
      "",
      "- Type safety: Rust provides compile-time guarantees",
      "- Async execution: Tools run asynchronously",
    ].join("\n");

    expect(looksLikePrivateThinkingNarration(content)).toBe(false);
  });

  it("does not treat normal recommendation text as private thinking", () => {
    const content = "We need to update the timeout to 30 seconds in Settings so slow providers do not fail early.";

    expect(looksLikePrivateThinkingNarration(content)).toBe(false);
  });

  it("strips only a leading tool prelude when a substantive answer follows", () => {
    const content = [
      "Let me read the tool bridge files to explain how the system works.",
      "",
      "## Tool Bridge",
      "",
      "The tool bridge registers tools, validates arguments, and executes approved calls.",
    ].join("\n");

    expect(stripLeadingToolPreludeForDisplay(content)).toBe([
      "## Tool Bridge",
      "",
      "The tool bridge registers tools, validates arguments, and executes approved calls.",
    ].join("\n"));
  });

  it("requires fresh workspace evidence for provider configuration follow-ups", () => {
    expect(needsFreshLocalToolEvidence("what providers does it work with", true)).toBe(true);
    expect(needsFreshLocalToolEvidence("what providers does it work with", false)).toBe(false);
    expect(needsFreshLocalToolEvidence("thanks", true)).toBe(false);
  });

  it("answers plain tool and plugin inventory questions without requiring workspace tools", () => {
    expect(looksLikeCapabilityInventoryQuestion("what tools do you have and plugins")).toBe(true);
    expect(needsFreshLocalToolEvidence("what tools do you have and plugins", true)).toBe(false);
    expect(requiresWorkspaceToolCallForPrompt("what tools do you have and plugins", true)).toBe(false);
  });

  it("still requires workspace evidence when the user asks to inspect the app tooling implementation", () => {
    const prompt = "look into our app tools and plugins in the codebase and explain how they work";

    expect(looksLikeCapabilityInventoryQuestion(prompt)).toBe(false);
    expect(needsFreshLocalToolEvidence(prompt, true)).toBe(true);
    expect(requiresWorkspaceToolCallForPrompt(prompt, true)).toBe(true);
  });

  it("requires fresh workspace evidence for local change review follow-ups", () => {
    const prompt = "Based on the files read, explain what changed and what the fixes appear to be.";

    expect(needsFreshLocalToolEvidence(prompt, true)).toBe(true);
    expect(requiresWorkspaceToolCallForPrompt(prompt, true)).toBe(true);
    expect(needsFreshLocalToolEvidence(prompt, false)).toBe(false);
    expect(requiresWorkspaceToolCallForPrompt(prompt, false)).toBe(false);
  });

  it("requires real workspace tools for short UI edit prompts", () => {
    expect(requiresWorkspaceToolCallForPrompt("make it better more readable better design and more party like", true)).toBe(true);
    expect(requiresWorkspaceToolCallForPrompt([
      "do the job",
      "Local-code conversation context for tool selection only:",
      "user: make it better more readable better design and more party like",
      "assistant: I see the files tool isn't attached.",
    ].join("\n"), true)).toBe(true);
    expect(requiresWorkspaceToolCallForPrompt("make it better more readable better design and more party like", false)).toBe(false);
    expect(requiresWorkspaceToolCallForPrompt("thanks", true)).toBe(false);
  });

  it("does not ask for the provider tool-call channel when capability planning found no attached tools", () => {
    const instruction = createFreshLocalToolEvidenceInstruction("inspect our app", "I checked it from memory.", {
      blockedReasons: ["required_family_unavailable: None of the required tool families are provider-visible for this pass."],
      canUseProviderTools: false,
    });

    expect(instruction).toContain("No provider workspace tools are attached for this retry");
    expect(instruction).toContain("required_family_unavailable");
    expect(instruction).not.toContain("Use the real provider tool-call channel now");
    expect(instruction).not.toContain("call git_status");
  });

  it("rejects updated-file code dumps when no mutating edit tool succeeded", () => {
    const content = [
      "\u4e0b\u9762\u662f\u4e00\u6b21\u76f4\u63a5\u3001\u5b89\u5168\u5730\u5c06\u804a\u5929\u9875\u6574\u5408\u5230\u73b0\u6709\u5e94\u7528\u7684\u65b9\u6848\u3002\u6211\u53ea\u4fee\u6539 src/App.jsx \u548c src/App.css \u4e24\u4e2a\u6587\u4ef6\u3002",
      "",
      "\u66f4\u65b0\u540e\u7684 App.jsx",
      "",
      "import { useState } from 'react';",
      "import ChatPage from './pages/Chat/ChatPage';",
      "import './App.css';",
      "",
      "function App() {",
      "  const [view, setView] = useState('home');",
      "  return view === 'chat' ? <ChatPage /> : <main />;",
      "}",
      "",
      "export default App;",
      "",
      "\u66f4\u65b0\u540e\u7684 App.css",
      "",
      ".app-nav { display: flex; gap: 8px; }",
      "",
      "\u6539\u52a8\u8bf4\u660e",
      "App.jsx \u73b0\u5728\u5305\u542b\u4e00\u4e2a\u7b80\u5355\u7684\u9876\u90e8\u5bfc\u822a\u3002",
    ].join("\n");

    expect(looksLikeUnappliedFileEditAnswer(content, [
      {
        id: "read-app",
        label: "Read workspace file",
        status: "complete",
        toolId: "files_read",
      },
      {
        id: "read-css",
        label: "Read workspace file",
        status: "complete",
        toolId: "files_read",
      },
    ])).toBe(true);
  });

  it("allows updated-file summaries after a mutating edit tool succeeds", () => {
    const content = "Updated `src/App.jsx` and `src/App.css` to add the chat route.";

    expect(looksLikeUnappliedFileEditAnswer(content, [
      {
        fileChanges: [{ additions: 1, deletions: 1, kind: "update", path: "src/App.jsx" }],
        id: "edit-app",
        label: "Edit many workspace files",
        status: "complete",
        toolId: "files_edit_many",
      },
    ])).toBe(false);
  });

  it("does not classify a completed edit summary as in-flight tool planning", () => {
    const content = [
      "Fixed. I changed `App.jsx` lines 212-213 to use `size = 28` and `strokeWidth = 2.2`.",
      "",
      "Verified the composer still renders cleanly after the change.",
    ].join("\n");

    expect(looksLikeUnexecutedToolActionPromise(content)).toBe(false);
    expect(looksLikeInFlightToolPlanning(content)).toBe(false);
  });

});

describe("createWebSearchProgress", () => {
  it("names the actual fallback provider instead of claiming Brave worked", () => {
    const progress = createWebSearchProgress({
      enabled: true,
      fallbackReason: "Brave Search failed with HTTP 429: Brave Search rate limit reached.",
      maxResults: 6,
      provider: "brave",
      resultCount: 6,
      resultProvider: "duckduckgo",
      status: "complete",
    });

    expect(progress).toMatchObject({
      detail: "Brave Search failed; 6 sources from DuckDuckGo",
      label: "Search DuckDuckGo fallback",
      status: "complete",
    });
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
      "Read C:\\Users\\Example User\\Documents\\GilbertCodex\\src-tauri\\src\\app.rs successfully.",
      "The full file content was kept with the tool result and was not pasted into chat.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
  });

  it("rejects read fallback summaries even without the legacy latest-result prefix", () => {
    const content = [
      "Read C:\\Users\\Example User\\Documents\\HelloWorld\\skyline-ridge.html successfully.",
      "Content size: 18,029 characters across 189 lines.",
      "The full file content was kept with the tool result and was not pasted into chat.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
  });

  it("rejects current file-read fallback summaries so they never become final answers", () => {
    const content = [
      "I read `C:\\Users\\Example User\\Documents\\HelloWorld\\src\\services\\database.js` successfully.",
      "It is 1,078 characters across 34 lines.",
      "The full file body was kept out of the visible chat so the response stays readable.",
    ].join("\n");

    expect(looksLikeInternalToolRecoveryAnswer(content)).toBe(true);
  });

  it("rejects result-finalizer fallback text so it cannot become the final answer", () => {
    const oldFallback = [
      "Read C:\\Users\\Example User\\Documents\\GilbertCodex\\src\\toolBridge\\adapters\\index.ts.",
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

  it("does not create a visible read summary for file-read tools that require synthesis", () => {
    const toolCall = {
      id: "tool-read",
      input: JSON.stringify({ path: "src/services/database.js" }),
      label: "Read workspace file",
      output: "const rows = [];",
      resultPolicy: {
        mode: "synthesize" as const,
        resultKind: "file_content" as const,
        synthesizeAfterwards: true,
      },
      status: "complete" as const,
      toolId: "files_read",
    };

    expect(isFileReadSynthesisToolCall(toolCall)).toBe(true);
    expect(createCompletedToolFallbackSummary(toolCall, toolCall.output)).toBeNull();
    expect(createNeutralToolSynthesisFailureMessage()).not.toContain("I read");
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
      "Workspace tree summary for C:\\Users\\Example User\\Documents\\GilbertBusiness",
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
