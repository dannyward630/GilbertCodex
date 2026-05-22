import { isPermissionGranted, onAction, requestPermission, sendNotification, type Options as TauriNotificationOptions } from "@tauri-apps/plugin-notification";
import type { ChatMessage, ChatToolCall } from "../types/chat";
import type { AppNotificationSettings } from "../types/settings";
import { isTauriDesktopRuntime, listenForDesktopNotificationActivations, showNativeDesktopNotification } from "./tauriClient";

interface AgentNotification {
  body: string;
  title: string;
}

export interface AgentNotificationContext {
  chatId?: string;
  chatTitle?: string;
  project?: string;
}

export type NotificationKind = "completion" | "permission" | "question";

export interface DesktopNotificationActivation {
  chatId?: string;
  kind?: NotificationKind;
}

interface NotifyAgentRunOptions {
  chatId?: string;
  context?: AgentNotificationContext;
  message?: ChatMessage;
  notification?: AgentNotification;
}

let notificationPermissionPromise: Promise<boolean> | null = null;
let notificationActionListenerPromise: Promise<NotificationActivationListener | null> | null = null;
let notificationActivationHandler: ((activation: DesktopNotificationActivation) => void) | null = null;
let appWindowFocused = true;
let focusTrackingInstalled = false;
let notificationSettings: AppNotificationSettings = {
  permissionNotifications: true,
  questionNotifications: true,
  turnCompletion: "unfocused",
};

interface NotificationActivationListener {
  unregister: () => Promise<void> | void;
}

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

export function notifyAgentRunStatus({ chatId, context, message, notification }: NotifyAgentRunOptions) {
  if (!canUseDesktopNotifications()) {
    return;
  }

  const resolvedContext: AgentNotificationContext = {
    ...context,
    chatId: context?.chatId ?? chatId,
  };
  const resolvedNotification = notification ?? createNotificationFromMessage(message, resolvedContext);

  if (!resolvedNotification) {
    return;
  }

  const kind = classifyNotification(resolvedNotification, message);

  if (!shouldSendNotification(kind)) {
    return;
  }

  void ensureNotificationPermission().then(async (permissionGranted) => {
    if (!permissionGranted || !shouldSendNotification(kind)) {
      return;
    }

    try {
      const id = createNotificationId();
      const payload = {
        autoCancel: true,
        body: formatNotificationBody(resolvedNotification.body, { includeClickHint: true }),
        extra: createNotificationExtra(resolvedContext.chatId, kind),
        group: "agent-runs",
        id,
        title: resolvedNotification.title,
      };

      if (
        await showNativeDesktopNotification({
          body: payload.body,
          chatId: resolvedContext.chatId,
          id,
          kind,
          title: payload.title,
        })
      ) {
        return;
      }

      sendNotification({
        autoCancel: payload.autoCancel,
        body: formatNotificationBody(resolvedNotification.body, { includeClickHint: false }),
        extra: payload.extra,
        group: payload.group,
        id: payload.id,
        title: payload.title,
      });
    } catch {
      return;
    }
  });
}

export function createNeedsInputNotification(detail?: string, context?: AgentNotificationContext): AgentNotification {
  const chatTitle = formatNotificationChatTitle(context?.chatTitle);

  return {
    body: formatNotificationLines([
      chatTitle ? `Chat: ${chatTitle}` : "",
      detail || "Gilbert is waiting for your input before continuing.",
    ]),
    title: chatTitle ? `Input needed: ${chatTitle}` : "Gilbert needs your input",
  };
}

export function createNeedsAttentionNotification(detail?: string, context?: AgentNotificationContext): AgentNotification {
  const chatTitle = formatNotificationChatTitle(context?.chatTitle);

  return {
    body: formatNotificationLines([
      chatTitle ? `Chat: ${chatTitle}` : "",
      detail || "Gilbert needs you to review the latest response.",
    ]),
    title: chatTitle ? `Review needed: ${chatTitle}` : "Gilbert needs attention",
  };
}

function createNotificationFromMessage(message?: ChatMessage, context?: AgentNotificationContext): AgentNotification | null {
  if (!message) {
    return null;
  }

  const chatTitle = formatNotificationChatTitle(context?.chatTitle);

  if (message.status === "error") {
    return createNeedsAttentionNotification("The latest response needs attention before it can continue.", context);
  }

  if (hasPendingPlanningInput(message)) {
    return createNeedsInputNotification(message.planning?.inputRequest?.title, context);
  }

  if (hasApprovalBlockedTool(message.toolCalls)) {
    return {
      body: formatNotificationLines([
        chatTitle ? `Chat: ${chatTitle}` : "",
        "A local action was blocked and may need your approval.",
      ]),
      title: chatTitle ? `Approval needed: ${chatTitle}` : "Gilbert needs approval",
    };
  }

  return {
    body: formatNotificationLines([
      chatTitle ? `Chat: ${chatTitle}` : "",
      formatCompletedResponsePreview(message.content),
    ]),
    title: chatTitle ? `Response ready: ${chatTitle}` : "Response completed",
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

  installFocusTracking();

  return document.visibilityState === "visible" && (appWindowFocused || document.hasFocus());
}

function installFocusTracking() {
  if (focusTrackingInstalled || typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return;
  }

  focusTrackingInstalled = true;
  appWindowFocused = typeof document === "undefined" ? true : document.hasFocus();

  window.addEventListener("focus", () => {
    appWindowFocused = true;
  });
  window.addEventListener("blur", () => {
    appWindowFocused = false;
  });
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
  const listeners: NotificationActivationListener[] = [];
  const handleActivation = (activation: DesktopNotificationActivation) => {
    notificationActivationHandler?.(activation);
  };

  try {
    const unregisterNative = await listenForDesktopNotificationActivations(handleActivation);
    listeners.push({ unregister: unregisterNative });
  } catch {
    // Keep the plugin listener as a fallback for platforms that emit it.
  }

  try {
    const pluginListener = await onAction((notification) => {
      handleActivation(parseNotificationActivation(notification));
    });
    listeners.push(pluginListener);
  } catch {
    // Desktop click support is handled by the native bridge on Windows.
  }

  if (!listeners.length) {
    notificationActionListenerPromise = null;
    return null;
  }

  return {
    unregister: async () => {
      await Promise.all(listeners.map((listener) => Promise.resolve(listener.unregister()).catch(() => undefined)));
    },
  };
}

export function resetDesktopNotificationTestState() {
  notificationPermissionPromise = null;
  notificationActionListenerPromise = null;
  notificationActivationHandler = null;
  appWindowFocused = true;
  focusTrackingInstalled = false;
  notificationSettings = {
    permissionNotifications: true,
    questionNotifications: true,
    turnCompletion: "unfocused",
  };
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

function formatNotificationBody(body: string, options: { includeClickHint: boolean }) {
  const parts = options.includeClickHint ? [body, "Click to open this chat."] : [body];
  return parts.join("\n").slice(0, 220);
}

function createNotificationId() {
  return Math.floor(Date.now() % 2_000_000_000);
}

function formatNotificationLines(lines: string[]) {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function formatNotificationChatTitle(title?: string) {
  const trimmed = title?.trim();

  if (!trimmed || /^new chat$/i.test(trimmed) || /^naming chat/i.test(trimmed)) {
    return "";
  }

  return trimmed.slice(0, 72);
}

function formatCompletedResponsePreview(content: string) {
  const preview = stripNotificationMarkdown(content);

  if (!preview) {
    return "The latest response finished.";
  }

  return `Completed: ${preview}`;
}

function stripNotificationMarkdown(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, " code block ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_~>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}
