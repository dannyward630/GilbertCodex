import type { ChatAttachment, ChatMessage, ChatSummary } from "../types/chat";

export const DEFAULT_PROJECT = "GilbertCodex";

export function createId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

export function createEmptyChat(project = DEFAULT_PROJECT): ChatSummary {
  const now = new Date().toISOString();

  return {
    id: createId("chat"),
    messages: [],
    project,
    title: "New chat",
    updatedAt: now,
  };
}

export function createMessage(
  role: ChatMessage["role"],
  content: string,
  status?: ChatMessage["status"],
  reasoning?: string,
  attachments?: ChatAttachment[],
): ChatMessage {
  return {
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
    content,
    createdAt: new Date().toISOString(),
    id: createId("message"),
    reasoning,
    role,
    status,
  };
}

export function titleFromMessage(content: string, attachments: ChatAttachment[] = []) {
  const normalized = content
    .replace(/```[\s\S]*?```/g, " code ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    const firstAttachment = attachments[0];

    if (firstAttachment?.kind === "image") {
      return firstAttachment.name ? `Image: ${firstAttachment.name}` : "Image upload";
    }

    if (firstAttachment) {
      return firstAttachment.name ? `File: ${firstAttachment.name}` : "File upload";
    }

    return "New chat";
  }

  return normalized.length > 54 ? `${normalized.slice(0, 51).trim()}...` : normalized;
}

export function sortChatsByUpdatedAt(chats: ChatSummary[]) {
  return [...chats].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function formatChatAge(updatedAt: string) {
  const timestamp = Date.parse(updatedAt);

  if (Number.isNaN(timestamp)) {
    return "";
  }

  const diffMs = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) {
    return "now";
  }

  if (minutes < 60) {
    return `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return `${hours}h`;
  }

  const days = Math.floor(hours / 24);

  if (days < 7) {
    return `${days}d`;
  }

  const weeks = Math.floor(days / 7);

  if (weeks < 5) {
    return `${weeks}w`;
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(timestamp));
}
