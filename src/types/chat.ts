import type { ReasoningEffort } from "./settings";
import type { LocalWorkspaceSettings } from "./localWorkspace";
import type { WebSearchProvider } from "./settings";

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

export type ChatMessageMode = "chat" | "plan";

export interface ChatPlanningQuestionOption {
  description?: string;
  id: string;
  label: string;
}

export interface ChatPlanningQuestion {
  id: string;
  options?: ChatPlanningQuestionOption[];
  placeholder?: string;
  question: string;
  required?: boolean;
}

export interface ChatPlanningInputAnswer {
  optionId?: string;
  questionId: string;
  value: string;
}

export interface ChatPlanningInputRequest {
  answeredAt?: string;
  answers?: ChatPlanningInputAnswer[];
  detail?: string;
  id: string;
  questions: ChatPlanningQuestion[];
  requestedAt: string;
  title: string;
}

export interface ChatPlanning {
  completedAt?: string;
  inputRequest?: ChatPlanningInputRequest;
  inputRequests?: ChatPlanningInputRequest[];
  maxPasses: number;
  passCount: number;
  startedAt: string;
}

export type ChatProgressStatus = "active" | "complete" | "pending";

export interface ChatProgressItem {
  detail?: string;
  id?: string;
  label: string;
  status: ChatProgressStatus;
}

export type ChatArtifactKind = "code" | "document" | "file" | "image" | "other" | "preview";

export interface ChatArtifact {
  detail?: string;
  id?: string;
  kind?: ChatArtifactKind;
  title: string;
  url?: string;
}

export interface ChatSource {
  detail?: string;
  id?: string;
  title: string;
  url: string;
}

export type ChatToolCallStatus = "active" | "complete" | "error" | "skipped";

export interface ChatToolCall {
  detail?: string;
  id: string;
  input?: string;
  label: string;
  output?: string;
  status: ChatToolCallStatus;
}

export type ChatWebSearchStatus = "active" | "complete" | "error";

export interface ChatWebSearch {
  enabled: boolean;
  error?: string;
  maxResults?: number;
  provider: WebSearchProvider;
  query?: string;
  resultCount?: number;
  searchedAt?: string;
  status?: ChatWebSearchStatus;
}

export interface ChatMessage {
  attachments?: ChatAttachment[];
  artifacts?: ChatArtifact[];
  content: string;
  createdAt: string;
  id: string;
  isStreaming?: boolean;
  mode?: ChatMessageMode;
  planning?: ChatPlanning;
  progress?: ChatProgressItem[];
  reasoning?: string;
  role: ChatRole;
  sources?: ChatSource[];
  status?: "error";
  thinking?: ChatThinking;
  toolCalls?: ChatToolCall[];
  webSearch?: ChatWebSearch;
}

export interface ChatSendInput {
  attachments: ChatAttachment[];
  content: string;
  localWorkspace?: LocalWorkspaceSettings;
  mode?: ChatMessageMode;
  planning?: {
    maxPasses: number;
  };
  webSearch?: {
    enabled: boolean;
    maxResults?: number;
    provider: WebSearchProvider;
  };
}

export interface ChatComposerDraft {
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
