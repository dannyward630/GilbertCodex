import { describe, expect, it } from "vitest";

import { createForkedChat } from "./workspaceHelpers";
import type { ChatSummary } from "../../types/chat";

function createSourceChat(): ChatSummary {
  return {
    id: "chat-source",
    messages: [
      {
        content: "First prompt",
        createdAt: "2026-05-20T15:00:00.000Z",
        id: "message-user-1",
        role: "user",
      },
      {
        content: "First response",
        createdAt: "2026-05-20T15:00:01.000Z",
        feedback: "liked",
        id: "message-assistant-1",
        role: "assistant",
      },
      {
        content: "Second prompt",
        createdAt: "2026-05-20T15:01:00.000Z",
        id: "message-user-2",
        role: "user",
      },
      {
        content: "Second response",
        createdAt: "2026-05-20T15:01:01.000Z",
        id: "message-assistant-2",
        role: "assistant",
      },
    ],
    project: "GilbertCodex",
    title: "Original chat",
    updatedAt: "2026-05-20T15:01:01.000Z",
  };
}

describe("createForkedChat", () => {
  it("creates a new chat that continues through the selected assistant response", () => {
    const sourceChat = createSourceChat();
    const forkedChat = createForkedChat(sourceChat, sourceChat.project, "Fork: Original chat", {
      throughMessageId: "message-assistant-1",
    });

    expect(forkedChat.id).not.toBe(sourceChat.id);
    expect(forkedChat.project).toBe(sourceChat.project);
    expect(forkedChat.title).toBe("Fork: Original chat");
    expect(forkedChat.messages).toHaveLength(2);
    expect(forkedChat.messages.map((message) => message.content)).toEqual(["First prompt", "First response"]);
    expect(forkedChat.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(forkedChat.messages[0]?.id).not.toBe("message-user-1");
    expect(forkedChat.messages[1]?.id).not.toBe("message-assistant-1");
    expect(forkedChat.messages[1]?.feedback).toBe("liked");
  });
});
