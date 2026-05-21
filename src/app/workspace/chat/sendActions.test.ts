import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatSendInput, ChatSummary } from "../../../types/chat";
import { handleSendMessage, resolveStoredChatModelSelection, type SendActionsDeps } from "./sendActions";

const activeChat: ChatSummary = {
  id: "chat-1",
  messages: [],
  project: "No project",
  title: "Current chat",
  updatedAt: "2026-05-21T00:00:00.000Z",
};

const input: ChatSendInput = {
  attachments: [],
  content: "run the audit",
};

function createDeps(overrides: Partial<SendActionsDeps> = {}): SendActionsDeps {
  return {
    activeChat,
    enqueueChatSend: vi.fn(),
    handleSteerQueuedMessage: vi.fn(),
    isChatSending: vi.fn(() => false),
    startSendMessage: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as SendActionsDeps;
}

describe("handleSendMessage", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a send immediately when the chat is idle", async () => {
    const deps = createDeps();

    await handleSendMessage(deps, input);

    expect(deps.startSendMessage).toHaveBeenCalledWith(input);
    expect(deps.enqueueChatSend).not.toHaveBeenCalled();
  });

  it("queues steering text while the chat is already sending", async () => {
    vi.useFakeTimers();
    const steerInput: ChatSendInput = {
      ...input,
      content: "actually check provider retries too",
      followUpBehavior: "steer",
    };
    const deps = createDeps({
      enqueueChatSend: vi.fn(() => "queued-message-1"),
      isChatSending: vi.fn(() => true),
    });

    await handleSendMessage(deps, steerInput);
    vi.runAllTimers();

    expect(deps.startSendMessage).not.toHaveBeenCalled();
    expect(deps.enqueueChatSend).toHaveBeenCalledWith(steerInput);
    expect(deps.handleSteerQueuedMessage).toHaveBeenCalledWith("queued-message-1", steerInput.content);
  });
});

describe("resolveStoredChatModelSelection", () => {
  it("keeps the user's chat model when a task run uses a request-scoped override", () => {
    expect(
      resolveStoredChatModelSelection(
        { model: "openrouter/free", provider: "openrouter" },
        { model: "cx/gpt-5.5", provider: "9router" },
        { preserveChatModelSelection: true },
      ),
    ).toEqual({ model: "openrouter/free", provider: "openrouter" });
  });

  it("stores the effective model for normal chat sends", () => {
    expect(
      resolveStoredChatModelSelection(
        { model: "openrouter/free", provider: "openrouter" },
        { model: "cx/gpt-5.5", provider: "9router" },
      ),
    ).toEqual({ model: "cx/gpt-5.5", provider: "9router" });
  });
});
