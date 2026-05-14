import { describe, expect, it } from "vitest";
import { chatHasPendingRightRailAction, chatHasRightRailContent } from "./RightRail";
import type { ChatMessage, ChatSummary } from "../../types/chat";

function chatWith(message: ChatMessage): ChatSummary {
  return {
    id: "chat-1",
    messages: [message],
    project: "Gilbert Codex",
    title: "Test chat",
    updatedAt: "2026-05-14T00:00:00.000Z",
  };
}

function assistantMessage(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    content: "",
    createdAt: "2026-05-14T00:00:00.000Z",
    id: "message-1",
    role: "assistant",
    ...overrides,
  };
}

describe("right rail visibility", () => {
  it("keeps normal tool progress out of the side rail", () => {
    const chat = chatWith(assistantMessage({
      progress: [
        {
          detail: "Payload estimate jumped by +49.7k tokens to 70.5k tokens.",
          id: "provider-payload-guardrail",
          label: "Provider payload guardrail",
          status: "pending",
        },
        {
          detail: "0 bridge tools ran",
          id: "local-computer-tools",
          label: "Tool progress",
          status: "complete",
        },
      ],
      status: "error",
      toolCalls: [
        {
          id: "tool-1",
          input: JSON.stringify({ path: "src/toolBridge/adapters" }),
          label: "Read workspace file",
          output: "Could not read file.",
          status: "error",
        },
      ],
    }));

    expect(chatHasRightRailContent(chat)).toBe(false);
    expect(chatHasPendingRightRailAction(chat)).toBe(false);
  });

  it("does not show the rail for a provider payload guardrail alone", () => {
    const chat = chatWith(assistantMessage({
      progress: [
        {
          detail: "Payload estimate jumped by +49.7k tokens to 70.5k tokens.",
          id: "provider-payload-guardrail",
          label: "Provider payload guardrail",
          status: "pending",
        },
      ],
    }));

    expect(chatHasRightRailContent(chat)).toBe(false);
    expect(chatHasPendingRightRailAction(chat)).toBe(false);
  });

  it("keeps actionable approvals visible", () => {
    const chat = chatWith(assistantMessage({
      approvals: [
        {
          createdAt: "2026-05-14T00:00:00.000Z",
          id: "approval-1",
          kind: "edit",
          risk: "medium",
          status: "pending",
          title: "Edit file",
          tool: "files_apply_patch",
        },
      ],
      progress: [
        {
          detail: "1 bridge tool ran",
          id: "local-computer-tools",
          label: "Tool progress",
          status: "complete",
        },
      ],
    }));

    expect(chatHasRightRailContent(chat)).toBe(true);
    expect(chatHasPendingRightRailAction(chat)).toBe(true);
  });
});
