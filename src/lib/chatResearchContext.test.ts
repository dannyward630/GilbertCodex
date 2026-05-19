import { describe, expect, it } from "vitest";
import type { ChatSummary } from "../types/chat";
import { contentReferencesChatTitle, createChatResearchContextContent } from "./chatResearchContext";
import { DEFAULT_PROJECT } from "./chatUtils";

describe("contentReferencesChatTitle", () => {
  it("matches typed chat titles after a hashtag", () => {
    expect(contentReferencesChatTitle("use #Chat Context Deep Dive here", "Chat Context Deep Dive")).toBe(true);
    expect(contentReferencesChatTitle("use #Chat   Context   Deep   Dive.", "Chat Context Deep Dive")).toBe(true);
    expect(contentReferencesChatTitle("use #Chat Context", "Chat Context Deep Dive")).toBe(false);
  });

  it("does not match placeholder new-chat titles", () => {
    expect(contentReferencesChatTitle("#New chat", "New chat")).toBe(false);
  });
});

describe("createChatResearchContextContent", () => {
  it("includes the referenced chat conversation and supporting context", () => {
    const chat: ChatSummary = {
      id: "chat-research",
      messages: [
        {
          attachments: [
            {
              createdAt: "2026-05-15T12:00:00.000Z",
              id: "attachment-notes",
              kind: "file",
              mimeType: "text/plain",
              name: "notes.txt",
              size: 24,
              text: "important attachment text",
            },
          ],
          content: "research question",
          createdAt: "2026-05-15T12:00:00.000Z",
          id: "message-user",
          role: "user",
        },
        {
          artifacts: [
            {
              kind: "document",
              sourceText: "artifact source body",
              title: "Research artifact",
            },
          ],
          content: "research answer",
          createdAt: "2026-05-15T12:01:00.000Z",
          id: "message-assistant",
          role: "assistant",
          sources: [
            {
              detail: "Primary source",
              title: "Example source",
              url: "https://example.com/source",
            },
          ],
          toolCalls: [
            {
              id: "tool-read",
              input: "path: notes.md",
              label: "Read notes",
              output: "tool output body",
              status: "complete",
              toolId: "files_read",
            },
          ],
          webSearch: {
            enabled: true,
            provider: "duckduckgo",
            query: "example research",
            resultCount: 1,
            resultProvider: "duckduckgo",
            status: "complete",
          },
        },
      ],
      project: DEFAULT_PROJECT,
      title: "Chat Context Deep Dive",
      updatedAt: "2026-05-15T12:02:00.000Z",
    };

    const context = createChatResearchContextContent([chat]);

    expect(context).toContain("CHAT RESEARCH NOTES");
    expect(context).toContain("## Chat Context Deep Dive");
    expect(context).toContain("research question");
    expect(context).toContain("research answer");
    expect(context).toContain("important attachment text");
    expect(context).toContain("https://example.com/source");
    expect(context).toContain("artifact source body");
    expect(context).toContain("tool output body");
    expect(context).toContain("example research");
  });
});
