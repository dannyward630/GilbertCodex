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
  it("renders generic thinking without numbered Note labels", () => {
    const html = renderToStaticMarkup(createElement(AssistantWorkTrace, {
      activitySnapshot: null,
      responseStarted: false,
      thinkingContent: "Let me read the current state of the files to diagnose the visibility issue.",
      thinkingStreaming: true,
    }));

    expect(html).toContain("Let me read the current state");
    expect(html).not.toContain("01");
    expect(html).not.toContain("Note");
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
      responseStarted: true,
      thinkingContent: "",
      thinkingStreaming: false,
    }));

    expect(html).toContain("Edited 1 file");
    expect(html).toContain("src/app/App.tsx");
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

    expect(snapshot?.label).toBe("Editing 1 file");
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
