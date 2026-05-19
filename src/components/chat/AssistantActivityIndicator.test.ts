import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantWorkTrace, createAssistantActivitySnapshot } from "./AssistantActivityIndicator";
import type { ChatMessage } from "../../types/chat";

function assistantMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    content: "",
    createdAt: "2026-05-14T00:00:00.000Z",
    id: "message-1",
    role: "assistant",
    ...overrides,
  };
}

describe("assistant activity indicator", () => {
  it("renders streamed work thinking inside the assistant work trace", () => {
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: null,
      responseStarted: false,
      thinkingContent: "Let me read the current state of the files to diagnose the visibility issue.",
      thinkingStreaming: true,
    }));

    expect(html).toContain("Thinking");
    expect(html).toContain("Let me read the current state");
    expect(html).toContain("assistant-work-paragraph");
  });

  it("leaves blank streaming thinking to the combined work trace", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({ isStreaming: true }));

    expect(snapshot).toBeNull();
  });

  it("estimates pending file writes before the tool result returns", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      isStreaming: true,
      toolCalls: [
        {
          id: "tool-1",
          input: JSON.stringify({
            content: "export const one = 1;\nexport const two = 2;\n",
            overwrite: false,
            path: "src/generated/example.ts",
          }),
          label: "Write workspace file",
          status: "active",
        },
      ],
    }));

    expect(snapshot?.label).toBe("Creating 1 file");
    expect(snapshot?.fileItems[0]).toMatchObject({
      additions: 2,
      deletions: 0,
      estimated: true,
      kind: "create",
      path: "src/generated/example.ts",
    });
    expect(snapshot?.fileStats).toMatchObject({
      additions: 2,
      creations: 1,
      fileCount: 1,
    });
  });

  it("shows active whole-file writes as writing instead of generic thinking", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      content: "I'll update the file now.",
      isStreaming: true,
      toolCalls: [
        {
          id: "tool-1",
          input: JSON.stringify({
            content: "export const one = 1;\nexport const two = 2;\n",
            path: "src/App.tsx",
          }),
          label: "Write workspace file",
          status: "active",
          toolId: "files_write",
        },
      ],
    }), { responseStarted: true });

    expect(snapshot?.label).toBe("Writing 1 file");
    expect(snapshot?.fileItems[0]).toMatchObject({
      estimated: true,
      kind: "write",
      path: "src/App.tsx",
      status: "active",
    });
  });

  it("estimates active batch writes from files_write_many input", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      isStreaming: true,
      toolCalls: [
        {
          id: "tool-1",
          input: JSON.stringify({
            files: [
              { content: "export const a = 1;\n", path: "src/a.ts" },
              { content: "export const b = 2;\n", path: "src/b.ts" },
            ],
          }),
          label: "Write many workspace files",
          status: "active",
          toolId: "files_write_many",
        },
      ],
    }));

    expect(snapshot?.label).toBe("Batch writing 2 files");
    expect(snapshot?.fileItems).toHaveLength(2);
    expect(snapshot?.fileItems.map((item) => item.path)).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("dedupes stale active batch rows when the completed batch row is present", () => {
    const input = JSON.stringify({
      files: [
        { content: "export const a = 1;\n", path: "src/a.ts" },
        { content: "export const b = 2;\n", path: "src/b.ts" },
      ],
    });
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      isStreaming: true,
      toolCalls: [
        {
          id: "local-tool-1-bridge-call-write-active",
          input,
          label: "Write many workspace files",
          status: "active",
          toolId: "files_write_many",
        },
        {
          batchFileResults: [
            { additions: 1, deletions: 0, kind: "create", path: "src/a.ts", status: "ok" },
            { additions: 1, deletions: 0, kind: "create", path: "src/b.ts", status: "ok" },
          ],
          batchSummary: {
            failureCount: 0,
            fileCount: 2,
            operation: "write",
            requestedCount: 2,
            skippedCount: 0,
            successCount: 2,
          },
          id: "local-tool-1-bridge-call-write-complete",
          input,
          label: "Write many workspace files",
          status: "complete",
          toolId: "files_write_many",
        },
      ],
    }), { responseStarted: true });

    expect(snapshot?.label).toBe("Batch wrote 2 files");
    expect(snapshot?.toolCalls).toHaveLength(1);
    expect(snapshot?.toolCalls[0]?.status).toBe("complete");
  });

  it("does not repeat the tool label as both title and detail for empty active batch rows", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      isStreaming: true,
      toolCalls: [
        {
          id: "tool-1",
          input: "{}",
          label: "Write many workspace files",
          status: "active",
          toolId: "files_write_many",
        },
      ],
    }));

    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: snapshot,
      responseStarted: false,
      thinkingContent: "",
      thinkingStreaming: true,
    }));

    expect(html.match(/Write many workspace files/g)).toHaveLength(1);
  });

  it("shows streamed structured edit calls before arguments are fully visible", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      content: "",
      isStreaming: true,
      toolCalls: [
        {
          id: "tool-1",
          input: "{}",
          label: "Write workspace file",
          status: "active",
          toolId: "files_write",
        },
      ],
    }));

    expect(snapshot?.label).toBe("Writing file");
    expect(snapshot?.live).toBe(true);
  });

  it("does not render empty streamed tool input or preparing placeholders as details", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      content: "",
      isStreaming: true,
      toolCalls: [
        {
          id: "tool-1",
          input: "{}",
          label: "Read workspace file",
          output: "Preparing tool call.",
          status: "active",
          toolId: "files_read",
        },
      ],
    }));

    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: snapshot,
      responseStarted: false,
      thinkingContent: "",
      thinkingStreaming: true,
    }));

    expect(html).toContain("Read workspace file");
    expect(html).not.toContain("Input");
    expect(html).not.toContain("Output");
    expect(html).not.toContain("Preparing tool call");
  });

  it("keeps completed work visible after the assistant response is done", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      content: "Done.",
      toolCalls: [
        {
          fileChanges: [
            {
              additions: 4,
              deletions: 1,
              kind: "update",
              path: "C:/repo/src/app/App.tsx",
            },
          ],
          id: "tool-1",
          label: "Edit file by exact replace",
          status: "complete",
        },
      ],
    }), { responseStarted: true });

    expect(snapshot?.label).toBe("Edited 1 file");
    expect(snapshot?.live).toBe(false);
    expect(snapshot?.fileItems[0]).toMatchObject({
      additions: 4,
      deletions: 1,
      estimated: false,
      kind: "update",
      path: "C:/repo/src/app/App.tsx",
    });

    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: snapshot,
      responseStarted: false,
      thinkingContent: "",
      thinkingStreaming: false,
    }));

    expect(html).toContain("Edit file by exact replace");
    expect(html).toContain("src/app/App.tsx");
  });

  it("shows batch edit success and failure in the work trace", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      content: "Done.",
      toolCalls: [
        {
          batchFileResults: [
            {
              additions: 4,
              deletions: 1,
              kind: "update",
              path: "C:/repo/src/app/App.tsx",
              status: "ok",
            },
            {
              additions: 0,
              deletions: 0,
              detail: "Exact text was not found.",
              path: "C:/repo/src/app/missing.ts",
              status: "error",
            },
          ],
          batchSummary: {
            failureCount: 1,
            fileCount: 2,
            operation: "edit",
            requestedCount: 2,
            skippedCount: 0,
            successCount: 1,
          },
          id: "tool-1",
          label: "Edit many workspace files",
          status: "complete",
          toolId: "files_edit_many",
        },
      ],
    }), { responseStarted: true });

    expect(snapshot?.label).toBe("Batch edited 1 of 2 files");
    expect(snapshot?.detail).toBe("1 OK, 1 failed");

    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: snapshot,
      responseStarted: false,
      thinkingContent: "",
      thinkingStreaming: false,
    }));

    expect(html).toContain("Batch edited 1 of 2 files");
    expect(html).toContain("OK +4 -1");
    expect(html).toContain("Failed");
    expect(html).toContain("src/app/missing.ts");
  });

  it("drops stale active tool progress once the assistant response is finished", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      content: "Done.",
      toolCalls: [
        {
          id: "tool-1",
          input: JSON.stringify({
            content: "export const one = 1;\n",
            path: "src/generated/example.ts",
          }),
          label: "Write workspace file",
          status: "active",
        },
      ],
    }), { responseStarted: true });

    expect(snapshot).toBeNull();
  });

  it("renders completed file changes while the response is still streaming", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      content: "Writing the final summary...",
      isStreaming: true,
      toolCalls: [
        {
          fileChanges: [
            {
              additions: 4,
              deletions: 1,
              kind: "update",
              path: "C:/repo/src/app/App.tsx",
            },
          ],
          id: "tool-1",
          label: "Edit file by exact replace",
          status: "complete",
        },
      ],
    }), { responseStarted: true });

    expect(snapshot?.label).toBe("Edited 1 file");
    expect(snapshot?.fileItems[0]).toMatchObject({
      additions: 4,
      deletions: 1,
      estimated: false,
      kind: "update",
    });
  });

  it("does not show a separate live row once plain response text is streaming", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      content: "Here is the answer",
      isStreaming: true,
    }), { responseStarted: true });

    expect(snapshot).toBeNull();
  });

  it("hides internal final-answer recovery progress from the work log", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      isStreaming: true,
      progress: [{
        detail: "Continuing from the work log",
        id: "final-answer-recovery",
        label: "Thinking",
        status: "active",
      }],
    }));

    expect(snapshot).toBeNull();
  });

  it("hides context compaction progress from the generic work log", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      isStreaming: true,
      progress: [{
        detail: "1 older message compacted. Active request is now 48.8k / 131k.",
        id: "context-compaction",
        label: "Automatically compacting context",
        status: "complete",
      }],
    }));

    expect(snapshot).toBeNull();
  });

  it("does not render completed provider thinking without a live work trace", () => {
    const startedAt = new Date("2026-05-14T12:00:00.000Z").toISOString();
    const completedAt = new Date("2026-05-14T12:00:12.000Z").toISOString();

    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: null,
      responseStarted: true,
      thinking: { effort: "medium", startedAt, completedAt },
      thinkingContent: "Considering the user's request before answering.",
      thinkingStreaming: false,
    }));

    expect(html).toBe("");
  });

  it("renders 'Thinking…' while the model is still actively thinking", () => {
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: null,
      responseStarted: false,
      thinkingContent: "",
      thinkingStreaming: true,
    }));

    expect(html).toContain("Thinking");
    expect(html).toContain("assistant-work-bars");
  });

  it("renders thinking work-trace entries alongside tool calls", () => {
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: null,
      responseStarted: false,
      thinkingContent: "",
      thinkingStreaming: true,
      workTrace: [
        {
          content: "I should inspect the component first.",
          id: "thinking-1",
          kind: "thinking",
          status: "complete",
        },
        {
          id: "tool-tool-1",
          kind: "tool",
          toolCall: {
            id: "tool-1",
            input: JSON.stringify({ path: "src/components/chat/ChatThread.tsx" }),
            label: "Read workspace file",
            status: "complete",
          },
        },
        {
          content: "Now I can patch the render path.",
          id: "thinking-2",
          kind: "thinking",
          status: "active",
        },
        {
          id: "tool-tool-2",
          kind: "tool",
          toolCall: {
            id: "tool-2",
            label: "Edit file by exact replace",
            status: "active",
          },
        },
      ],
    }));

    expect(html).toContain("I should inspect");
    expect(html).toContain("Read workspace file");
    expect(html).toContain("Now I can patch");
    expect(html).toContain("Edit file by exact replace");
    expect(html).toContain("assistant-work-tool-line");
    expect(html).toContain("assistant-work-paragraph");
    expect(html).not.toContain("assistant-work-activity");
    expect(html).not.toContain("assistant-activity");
  });

  it("collapses completed thinking entries after the answer starts", () => {
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: null,
      responseStarted: true,
      thinkingContent: "This live slot should not be required after finalization.",
      thinkingStreaming: false,
      workTrace: [
        {
          content: "First hidden work note should stay.",
          id: "thinking-1",
          kind: "thinking",
          status: "complete",
        },
        {
          content: "Second hidden work note should also stay.",
          id: "thinking-2",
          kind: "thinking",
          status: "complete",
        },
      ],
    }));

    expect(html).toContain("data-expanded=\"false\"");
    expect(html).toContain("Thinking");
    expect(html).not.toContain("First hidden work note should stay.");
    expect(html).not.toContain("Second hidden work note should also stay.");
    expect(html).not.toContain("This live slot should not be required");
  });

  it("renders without timeline markers or old activity cards", () => {
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: null,
      responseStarted: false,
      thinkingContent: "First paragraph.\n\nSecond paragraph.",
      thinkingStreaming: true,
    }));

    expect(html).not.toContain("assistant-work-timeline");
    expect(html).not.toContain("assistant-work-marker");
    expect(html).not.toContain("assistant-activity");
    expect(html).toContain("assistant-work-paragraph");
    expect(html).toContain("First paragraph.");
    expect(html).toContain("Second paragraph.");
  });

  it("estimates multi-file patch additions and deletions while running", () => {
    const snapshot = createAssistantActivitySnapshot(assistantMessage({
      isStreaming: true,
      toolCalls: [
        {
          id: "tool-1",
          input: JSON.stringify({
            patch: [
              "--- a/src/a.ts",
              "+++ b/src/a.ts",
              "@@ -1 +1,2 @@",
              "-old",
              "+new",
              "+extra",
              "--- /dev/null",
              "+++ b/src/b.ts",
              "@@ -0,0 +1 @@",
              "+created",
            ].join("\n"),
          }),
          label: "Apply workspace patch",
          status: "active",
        },
      ],
    }));

    expect(snapshot?.fileStats).toMatchObject({
      additions: 3,
      creations: 1,
      deletions: 1,
      fileCount: 2,
      updates: 1,
    });
  });
});
