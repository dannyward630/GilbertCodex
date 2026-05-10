import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { ChatMessage, ChatToolCall } from "../types/chat";
import { isTauriDesktopRuntime } from "./tauriClient";

interface AgentNotification {
  body: string;
  title: string;
}

interface NotifyAgentRunOptions {
  message?: ChatMessage;
  notification?: AgentNotification;
}

let notificationPermissionPromise: Promise<boolean> | null = null;

export function prepareDesktopNotifications() {
  if (!canUseDesktopNotifications()) {
    return Promise.resolve(false);
  }

  return ensureNotificationPermission();
}

export function notifyAgentRunStatus({ message, notification }: NotifyAgentRunOptions) {
  if (!canUseDesktopNotifications() || isAppForeground()) {
    return;
  }

  const resolvedNotification = notification ?? createNotificationFromMessage(message);

  if (!resolvedNotification) {
    return;
  }

  void ensureNotificationPermission().then((permissionGranted) => {
    if (!permissionGranted || isAppForeground()) {
      return;
    }

    try {
      sendNotification({
        autoCancel: true,
        body: formatNotificationBody(resolvedNotification.body),
        group: "agent-runs",
        id: createNotificationId(),
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
      body: "A local action was blocked and may need your approval in the Activity panel.",
      title: "Gilbert needs approval",
    };
  }

  return {
    body: "Your latest response is ready to review.",
    title: "Response completed",
  };
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

function formatNotificationBody(body: string) {
  const parts = [body, "Open Gilbert Codex to review."];
  return parts.join("\n").slice(0, 220);
}

function createNotificationId() {
  return Math.floor(Date.now() % 2_000_000_000);
}
