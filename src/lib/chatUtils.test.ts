import { describe, expect, it } from "vitest";
import type { ChatSummary } from "../types/chat";
import { DEFAULT_PROJECT, isDiscardableEmptyChat, isPlainResearchChat } from "./chatUtils";

const MESSAGE = {
  content: "research notes",
  createdAt: "2026-05-15T12:00:00.000Z",
  id: "message-1",
  role: "user" as const,
};

function chat(overrides: Partial<ChatSummary>): ChatSummary {
  return {
    id: "chat-1",
    messages: [MESSAGE],
    project: DEFAULT_PROJECT,
    title: "Research notes",
    updatedAt: "2026-05-15T12:00:00.000Z",
    ...overrides,
  };
}

describe("isPlainResearchChat", () => {
  it("allows regular chats and excludes project-owned chats", () => {
    expect(isPlainResearchChat(chat({ id: "regular", project: DEFAULT_PROJECT }), "active-project-chat")).toBe(true);
    expect(isPlainResearchChat(chat({ id: "blank-project", project: " " }), "active-project-chat")).toBe(true);
    expect(isPlainResearchChat(chat({ id: "project-chat", project: "GilbertCodex" }), "active-project-chat")).toBe(false);
  });

  it("excludes the current chat, archived chats, and empty drafts", () => {
    expect(isPlainResearchChat(chat({ id: "active" }), "active")).toBe(false);
    expect(isPlainResearchChat(chat({ archived: true, id: "archived" }), "active")).toBe(false);
    expect(isPlainResearchChat(chat({ id: "empty", messages: [] }), "active")).toBe(false);
  });
});

describe("isDiscardableEmptyChat", () => {
  it("keeps empty chats that have an unsent composer draft", () => {
    expect(isDiscardableEmptyChat(chat({ messages: [] }))).toBe(true);
    expect(
      isDiscardableEmptyChat(
        chat({
          composerDraft: {
            attachments: [],
            content: "Do not lose this draft.",
          },
          messages: [],
        }),
      ),
    ).toBe(false);
  });
});
