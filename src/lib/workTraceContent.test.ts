import { describe, expect, it } from "vitest";
import { cleanVisibleWorkTraceContent } from "./workTraceContent";

describe("visible work trace content", () => {
  it("keeps safe Codex-style progress updates", () => {
    expect(cleanVisibleWorkTraceContent("Reading workspace files: src/app/App.tsx.")).toBe("Reading workspace files: src/app/App.tsx.");
    expect(cleanVisibleWorkTraceContent("Applying file changes in src/components/chat.")).toBe("Applying file changes in src/components/chat.");
    expect(cleanVisibleWorkTraceContent("Working through concrete actions for tool output.")).toBe("Working through concrete actions for tool output.");
    expect(cleanVisibleWorkTraceContent("Edit file by exact replace finished: updated the render path.")).toBe("Edit file by exact replace finished: updated the render path.");
  });

  it("drops private reasoning and provider scratchpad text", () => {
    expect(cleanVisibleWorkTraceContent("<analysis>I should inspect the file first.</analysis>")).toBe("");
    expect(cleanVisibleWorkTraceContent("Reasoning: private scratchpad")).toBe("");
    expect(cleanVisibleWorkTraceContent("Let me read the current state before patching.")).toBe("");
    expect(cleanVisibleWorkTraceContent("I have the file context now for src/toolBridge, so I can connect the next step to the actual code.")).toBe("");
    expect(cleanVisibleWorkTraceContent('{"tool_calls":[{"name":"files_read"}]}')).toBe("");
    expect(cleanVisibleWorkTraceContent("Read terminal session needs attention: Could not read that terminal session.")).toBe("");
  });
});
