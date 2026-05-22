import { afterEach, describe, expect, it, vi } from "vitest";

const notificationMocks = vi.hoisted(() => ({
  isPermissionGranted: vi.fn(async () => true),
  onAction: vi.fn(async () => ({ unregister: vi.fn(async () => undefined) })),
  requestPermission: vi.fn(async () => "granted"),
  sendNotification: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-notification", () => notificationMocks);

const tauriClientMocks = vi.hoisted(() => ({
  isTauriDesktopRuntime: vi.fn(() => true),
  listenForDesktopNotificationActivations: vi.fn(async (_handler: (activation: { chatId?: string; kind?: string }) => void) => () => undefined),
  showNativeDesktopNotification: vi.fn(async (_request: unknown) => false),
}));

vi.mock("./tauriClient", () => tauriClientMocks);

import { configureDesktopNotificationActivation, configureDesktopNotifications, notifyAgentRunStatus, resetDesktopNotificationTestState } from "./desktopNotifications";
import type { ChatMessage } from "../types/chat";

type NativeActivationHandler = (activation: { chatId?: string; kind?: string }) => void;

function installDesktopWindow() {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {},
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    },
  });
}

function installDocumentState({ focused, visibilityState = "visible" }: { focused: boolean; visibilityState?: DocumentVisibilityState }) {
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      hasFocus: vi.fn(() => focused),
      visibilityState,
    },
  });
}

function createCompletedMessage(content = "Updated the notification routing so completion alerts open the exact chat."): ChatMessage {
  return {
    content,
    createdAt: "2026-05-20T18:45:00.000Z",
    id: "message-1",
    role: "assistant",
  };
}

describe("desktop notifications", () => {
  afterEach(() => {
    notificationMocks.isPermissionGranted.mockClear();
    notificationMocks.onAction.mockClear();
    notificationMocks.requestPermission.mockClear();
    notificationMocks.sendNotification.mockClear();
    tauriClientMocks.isTauriDesktopRuntime.mockReset();
    tauriClientMocks.isTauriDesktopRuntime.mockReturnValue(true);
    tauriClientMocks.listenForDesktopNotificationActivations.mockReset();
    tauriClientMocks.listenForDesktopNotificationActivations.mockResolvedValue(() => undefined);
    tauriClientMocks.showNativeDesktopNotification.mockReset();
    tauriClientMocks.showNativeDesktopNotification.mockResolvedValue(false);
    resetDesktopNotificationTestState();
    Reflect.deleteProperty(globalThis, "window");
    Reflect.deleteProperty(globalThis, "document");
  });

  it("does not show completion notifications while the app is focused", async () => {
    installDesktopWindow();
    installDocumentState({ focused: true });
    configureDesktopNotifications({
      permissionNotifications: true,
      questionNotifications: true,
      turnCompletion: "unfocused",
    });

    notifyAgentRunStatus({
      context: {
        chatId: "chat-1",
        chatTitle: "General settings polish",
      },
      message: createCompletedMessage(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tauriClientMocks.showNativeDesktopNotification).not.toHaveBeenCalled();
    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });

  it("uses the native clickable bridge for background completion notifications", async () => {
    installDesktopWindow();
    installDocumentState({ focused: false });
    tauriClientMocks.showNativeDesktopNotification.mockResolvedValue(true);
    configureDesktopNotifications({
      permissionNotifications: true,
      questionNotifications: true,
      turnCompletion: "unfocused",
    });

    notifyAgentRunStatus({
      context: {
        chatId: "chat-1",
        chatTitle: "General settings polish",
      },
      message: createCompletedMessage(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(tauriClientMocks.showNativeDesktopNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Chat: General settings polish"),
        chatId: "chat-1",
        kind: "completion",
        title: "Response ready: General settings polish",
      }),
    );
    const nativeRequest = tauriClientMocks.showNativeDesktopNotification.mock.calls[0]?.[0] as
      | { body?: string }
      | undefined;
    expect(nativeRequest?.body).toContain("Click to open this chat.");
    expect(notificationMocks.sendNotification).not.toHaveBeenCalled();
  });

  it("falls back to the Tauri plugin with chat title and response preview", async () => {
    installDesktopWindow();
    installDocumentState({ focused: false });
    configureDesktopNotifications({
      permissionNotifications: true,
      questionNotifications: true,
      turnCompletion: "unfocused",
    });

    notifyAgentRunStatus({
      context: {
        chatId: "chat-1",
        chatTitle: "General settings polish",
      },
      message: createCompletedMessage(),
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
    expect(notificationMocks.sendNotification.mock.calls[0]?.[0].body).not.toContain("Click to open this chat.");
  });

  it("routes native notification activation events to the configured handler", async () => {
    installDesktopWindow();
    let nativeActivationHandler: NativeActivationHandler | null = null;
    tauriClientMocks.listenForDesktopNotificationActivations.mockImplementation(async (handler) => {
      nativeActivationHandler = handler;
      return () => undefined;
    });
    const handler = vi.fn();

    configureDesktopNotificationActivation(handler);

    await new Promise((resolve) => setTimeout(resolve, 0));
    (nativeActivationHandler as unknown as NativeActivationHandler)({ chatId: "chat-1", kind: "completion" });

    expect(handler).toHaveBeenCalledWith({ chatId: "chat-1", kind: "completion" });
  });
});
