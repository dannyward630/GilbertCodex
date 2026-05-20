import { afterEach, describe, expect, it, vi } from "vitest";

const notificationMocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  onAction: vi.fn(async () => ({ unregister: vi.fn(async () => undefined) })),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => notificationMocks);

import { configureDesktopNotifications, notifyAgentRunStatus } from "./desktopNotifications";
import type { ChatMessage } from "../types/chat";

function installDesktopWindow() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {},
    },
  });
}

describe("desktop notifications", () => {
  afterEach(() => {
    notificationMocks.isPermissionGranted.mockClear();
    notificationMocks.onAction.mockClear();
    notificationMocks.requestPermission.mockClear();
    notificationMocks.sendNotification.mockClear();
    configureDesktopNotifications({
      permissionNotifications: true,
      questionNotifications: true,
      turnCompletion: "unfocused",
    });
    Reflect.deleteProperty(globalThis, "window");
  });

  it("shows the chat title, completed response preview, and click target", async () => {
    installDesktopWindow();
    configureDesktopNotifications({
      permissionNotifications: true,
      questionNotifications: true,
      turnCompletion: "always",
    });

    const message: ChatMessage = {
      content: "Updated the notification routing so completion alerts open the exact chat.",
      createdAt: "2026-05-20T18:45:00.000Z",
      id: "message-1",
      role: "assistant",
    };

    notifyAgentRunStatus({
      context: {
        chatId: "chat-1",
        chatTitle: "General settings polish",
      },
      message,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(notificationMocks.sendNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Chat: General settings polish"),
        extra: expect.objectContaining({ chatId: "chat-1", kind: "completion" }),
        title: "Response ready: General settings polish",
      }),
    );
    expect(notificationMocks.sendNotification.mock.calls[0]?.[0].body).toContain("Completed: Updated the notification routing");
    expect(notificationMocks.sendNotification.mock.calls[0]?.[0].body).toContain("Click to open this chat.");
  });
});
