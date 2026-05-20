import { isPermissionGranted, onAction, requestPermission, sendNotification, type Options as TauriNotificationOptions } from "@tauri-apps/plugin-notification";
import type { PluginListener } from "@tauri-apps/api/core";
import type { ChatMessage, ChatToolCall } from "../types/chat";
import type { AppNotificationSettings } from "../types/settings";
import { isTauriDesktopRuntime } from "./tauriClient";

interface AgentNotification {
  body: string;
  title: string;
}

export type NotificationKind = "completion" | "permission" | "question";

export interface DesktopNotificationActivation {
  chatId?: string;
  kind?: NotificationKind;
}

interface NotifyAgentRunOptions {
  chatId?: string;
  message?: ChatMessage;
  notification?: AgentNotification;
}

let notificationPermissionPromise: Promise<boolean> | null = null;
let notificationActionListenerPromise: Promise<PluginListener | null> | null = null;
let notificationActivationHandler: ((activation: DesktopNotificationActivation) => void) | null = null;
let notificationSettings: AppNotificationSettings = {
  permissionNotifications: true,
  questionNotifications: true,
  turnCompletion: "unfocused",
};

export function configureDesktopNotifications(settings: AppNotificationSettings) {
  notificationSettings = {
    permissionNotifications: settings.permissionNotifications,
    questionNotifications: settings.questionNotifications,
    turnCompletion: settings.turnCompletion,
  };
}

export function configureDesktopNotificationActivation(handler: ((activation: DesktopNotificationActivation) => void) | null) {
  notificationActivationHandler = handler;

  if (handler && canUseDesktopNotifications()) {
    void ensureNotificationActionListener();
  }

  return () => {
    if (notificationActivationHandler === handler) {
      notificationActivationHandler = null;
    }
  };
}

export function prepareDesktopNotifications() {
  if (!canUseDesktopNotifications() || !hasAnyNotificationEnabled()) {
    return Promise.resolve(false);
  }

  void ensureNotificationActionListener();
  return ensureNotificationPermission();
}

export function notifyAgentRunStatus({ chatId, message, notification }: NotifyAgentRunOptions) {
  if (!canUseDesktopNotifications()) {
    return;
  }

  const resolvedNotification = notification ?? createNotificationFromMessage(message);

  if (!resolvedNotification) {
    return;
  }

  const kind = classifyNotification(resolvedNotification, message);

  if (!shouldSendNotification(kind)) {
    return;
  }

  void ensureNotificationPermission().then((permissionGranted) => {
    if (!permissionGranted || !shouldSendNotification(kind)) {
      return;
    }

    try {
      const id = createNotificationId();
      sendNotification({
        autoCancel: true,
        body: formatNotificationBody(resolvedNotification.body),
        extra: createNotificationExtra(chatId, kind),
        group: "agent-runs",
        id,
        title: resolvedNotification.title,
      });
    } catch {
      return;
    }
  });
}

export function createNeedsInputNotification(detail?: string): AgentNotification {
  return {
    body: detail || "Gilbert is waiting for your input before continuing.",
    title: "Gilbert needs your input",
  };
}

export function createNeedsAttentionNotification(detail?: string): AgentNotification {
  return {
    body: detail || "Gilbert needs you to review the latest response.",
    title: "Gilbert needs attention",
  };
}

function createNotificationFromMessage(message?: ChatMessage): AgentNotification | null {
  if (!message) {
    return null;
  }

  if (message.status === "error") {
    return createNeedsAttentionNotification("The latest response needs attention before it can continue.");
  }

  if (hasPendingPlanningInput(message)) {
    return createNeedsInputNotification(message.planning?.inputRequest?.title);
  }

  if (hasApprovalBlockedTool(message.toolCalls)) {
    return {
      body: "A local action was blocked and may need your approval.",
      title: "Gilbert needs approval",
    };
  }

  return {
    body: "Your latest response is ready to review.",
    title: "Response completed",
  };
}

function classifyNotification(notification: AgentNotification, message?: ChatMessage): NotificationKind {
  const title = notification.title.toLowerCase();
  const body = notification.body.toLowerCase();

  if (title.includes("input") || (message ? hasPendingPlanningInput(message) : false)) {
    return "question";
  }

  if (title.includes("approval") || body.includes("approval") || hasApprovalBlockedTool(message?.toolCalls)) {
    return "permission";
  }

  return "completion";
}

function shouldSendNotification(kind: NotificationKind) {
  if (kind === "question") {
    return notificationSettings.questionNotifications && !isAppForeground();
  }

  if (kind === "permission") {
    return notificationSettings.permissionNotifications && !isAppForeground();
  }

  if (notificationSettings.turnCompletion === "off") {
    return false;
  }

  if (notificationSettings.turnCompletion === "always") {
    return true;
  }

  return !isAppForeground();
}

function hasAnyNotificationEnabled() {
  return (
    notificationSettings.permissionNotifications ||
    notificationSettings.questionNotifications ||
    notificationSettings.turnCompletion !== "off"
  );
}

function hasPendingPlanningInput(message: ChatMessage) {
  const requests = message.planning?.inputRequests?.length ? message.planning.inputRequests : message.planning?.inputRequest ? [message.planning.inputRequest] : [];

  return requests.some((request) => !request.answeredAt);
}

function hasApprovalBlockedTool(toolCalls?: ChatToolCall[]) {
  return Boolean(
    toolCalls?.some((toolCall) => {
      if (toolCall.status !== "skipped" && toolCall.status !== "error") {
        return false;
      }

      const text = `${toolCall.detail ?? ""}\n${toolCall.output ?? ""}`.toLowerCase();
      return (
        text.includes("ask first mode") ||
        text.includes("explicit user confirmation") ||
        text.includes("requires confirm") ||
        text.includes("blocked")
      );
    }),
  );
}

function isAppForeground() {
  if (typeof document === "undefined") {
    return true;
  }

  return document.visibilityState === "visible" && document.hasFocus();
}

function canUseDesktopNotifications() {
  return typeof window !== "undefined" && isTauriDesktopRuntime();
}

function ensureNotificationPermission() {
  notificationPermissionPromise ??= requestNotificationPermission();
  return notificationPermissionPromise;
}

async function requestNotificationPermission() {
  try {
    if (await isPermissionGranted()) {
      return true;
    }

    return (await requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function ensureNotificationActionListener() {
  notificationActionListenerPromise ??= registerNotificationActionListener();
  return notificationActionListenerPromise;
}

async function registerNotificationActionListener() {
  try {
    return await onAction((notification) => {
      const activation = parseNotificationActivation(notification);
      notificationActivationHandler?.(activation);
    });
  } catch {
    notificationActionListenerPromise = null;
    return null;
  }
}

function createNotificationExtra(chatId: string | undefined, kind: NotificationKind) {
  return {
    chatId: chatId ?? "",
    kind,
    source: "gilbert-agent-run",
  };
}

function parseNotificationActivation(notification: TauriNotificationOptions): DesktopNotificationActivation {
  const extra = typeof notification.extra === "object" && notification.extra ? notification.extra : {};
  const chatId = typeof extra.chatId === "string" ? extra.chatId : "";
  const kind = isNotificationKind(extra.kind) ? extra.kind : undefined;

  return {
    chatId: chatId.trim() || undefined,
    kind,
  };
}

function isNotificationKind(value: unknown): value is NotificationKind {
  return value === "completion" || value === "permission" || value === "question";
}

function formatNotificationBody(body: string) {
  const parts = [body, "Open Gilbert Codex to review."];
  return parts.join("\n").slice(0, 220);
}

function createNotificationId() {
  return Math.floor(Date.now() % 2_000_000_000);
}
