import type { ChatSummary } from "../types/chat";
import type { ComputerFileIndexSummary, ComputerFileKind, LocalWorkspaceSettings } from "../types/localWorkspace";

export const CHAT_MEMORY_STORAGE_PREFIX = "gilbert-codex.chat-memory.v1.";
export const PROJECT_MEMORY_STORAGE_PREFIX = "gilbert-codex.project-memory.v1.";
export const MEMORY_EMBEDDING_MODEL = "gilbert-local-hash-v1";
export const MEMORY_EMBEDDING_DIMENSIONS = 128;

export interface MemoryStorageAdapter {
  read: (key: string) => string | null | undefined;
  write: (key: string, value: string) => void;
}

export interface DurableMemoryScope {
  chatId?: string;
  chatTitle?: string;
  label: string;
  projectKey: string;
  projectName: string;
  workspaceRoots: string[];
}

export type DurableMemoryEventKind =
  | "assistant-message"
  | "project-map"
  | "tool-call"
  | "tool-error"
  | "user-message";

export interface DurableMemoryEvent {
  chatId?: string;
  chatTitle?: string;
  contentHash: string;
  createdAt: string;
  id: string;
  kind: DurableMemoryEventKind;
  messageId?: string;
  metadata?: Record<string, unknown>;
  projectKey: string;
  projectName: string;
  role?: ChatSummary["messages"][number]["role"];
  status?: string;
  summary: string;
  toolCallId?: string;
  updatedAt: string;
}

export interface DurableMemoryVector {
  dimensions: number;
  model: string;
  values: number[];
}

export type DurableMemoryRecordSource =
  | "assistant"
  | "project-map"
  | "tool"
  | "tool-error"
  | "user";

export interface DurableMemoryRecord {
  chatId?: string;
  chatTitle?: string;
  chunkId: string;
  content: string;
  contentHash: string;
  createdAt: string;
  eventId: string;
  id: string;
  metadata?: Record<string, unknown>;
  projectKey: string;
  projectName: string;
  source: DurableMemoryRecordSource;
  summary: string;
  updatedAt: string;
  vector: DurableMemoryVector;
}

export interface ProjectFileMapEntry {
  firstSeenAt: string;
  kind?: ComputerFileKind;
  lastSeenAt: string;
  modifiedAt?: number;
  path: string;
  size?: number;
  source: "index" | "root" | "tool";
  toolIds?: string[];
}

export interface DurableProjectFileMap {
  capturedAt?: string;
  indexSummary?: ComputerFileIndexSummary;
  knownFiles: ProjectFileMapEntry[];
  roots: string[];
  updatedAt: string;
}

export interface DurableChatMemoryState {
  chatId: string;
  chatTitle: string;
  createdAt: string;
  events: DurableMemoryEvent[];
  projectKey: string;
  projectName: string;
  records: DurableMemoryRecord[];
  updatedAt: string;
  version: 1;
  workspaceRoots: string[];
}

export interface DurableProjectMemoryState {
  createdAt: string;
  events: DurableMemoryEvent[];
  fileMap: DurableProjectFileMap;
  projectKey: string;
  projectName: string;
  records: DurableMemoryRecord[];
  updatedAt: string;
  version: 1;
  workspaceRoots: string[];
}

export interface DurableMemoryContextOptions {
  includeProjectMap?: boolean;
  includeRecentEvents?: boolean;
  maxChars?: number;
  maxRecords?: number;
  now?: string;
  prompt?: string;
}

export interface DurableMemoryUpdateOptions {
  indexSummary?: ComputerFileIndexSummary;
  now?: string;
}

export interface CreateDurableMemoryScopeOptions {
  chatId?: string;
  chatTitle?: string;
  projectName: string;
  workspaceRoots?: string[];
}

export interface DurableMemoryPersistResult {
  chatChanged: boolean;
  chatState: DurableChatMemoryState;
  projectChanged: boolean;
  projectState: DurableProjectMemoryState;
}

export interface DurableMemoryFromChatOptions extends DurableMemoryUpdateOptions {
  chat: ChatSummary;
  workspaceSettings: LocalWorkspaceSettings;
}
