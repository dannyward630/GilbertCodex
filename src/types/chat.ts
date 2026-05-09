import type { ReasoningEffort } from "./settings";

export type ChatRole = "assistant" | "user";

export interface ChatAttachmentBase {
  createdAt: string;
  id: string;
  mimeType: string;
  name: string;
  size: number;
}

export interface ChatFileAttachment extends ChatAttachmentBase {
  kind: "file";
}

export interface ChatImageAttachment extends ChatAttachmentBase {
  dataUrl: string;
  height?: number;
  kind: "image";
  width?: number;
}

export type ChatAttachment = ChatFileAttachment | ChatImageAttachment;

export interface ChatThinking {
  completedAt?: string;
  effort: ReasoningEffort;
  startedAt: string;
}

export interface ChatMessage {
  attachments?: ChatAttachment[];
  content: string;
  createdAt: string;
  id: string;
  isStreaming?: boolean;
  reasoning?: string;
  role: ChatRole;
  status?: "error";
  thinking?: ChatThinking;
}

export interface ChatSendInput {
  attachments: ChatAttachment[];
  content: string;
}

export interface ChatSummary {
  archived?: boolean;
  id: string;
  isDraft?: boolean;
  messages: ChatMessage[];
  pinned?: boolean;
  project: string;
  title: string;
  updatedAt: string;
}
