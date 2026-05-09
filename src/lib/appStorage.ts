import { createEmptyChat, DEFAULT_PROJECT } from "./chatUtils";
import { DEFAULT_CHAT_MODEL } from "./models";
import { DEFAULT_WEB_SEARCH_MAX_RESULTS, MAX_WEB_SEARCH_RESULTS } from "../services/webSearchClient";
import { DEFAULT_TOOL_REGISTRY_SETTINGS, normalizeToolRegistrySettings } from "../types/tools";
import type { ChatAttachment, ChatFileAttachment, ChatImageAttachment, ChatMessage, ChatSummary } from "../types/chat";
import type { LocalPermissionMode, LocalWorkspaceIndexStatus, LocalWorkspaceScope, LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProjectSummary } from "../types/project";
import type { AppearanceMode, ProviderSettings, ReasoningEffort, ThinkingSettings, WebSearchSettings } from "../types/settings";

const CHATS_KEY = "gilbert-codex.chats.v1";
const PROJECTS_KEY = "gilbert-codex.projects.v1";
const SETTINGS_KEY = "gilbert-codex.provider-settings.v1";
const THINKING_KEY = "gilbert-codex.thinking-settings.v1";
const APPEARANCE_KEY = "gilbert-codex.appearance.v1";
const ACTIVE_CHAT_KEY = "gilbert-codex.active-chat.v1";
const LOCAL_WORKSPACE_KEY = "gilbert-codex.local-workspace.v1";
const TOOL_REGISTRY_KEY = "gilbert-codex.tool-registry.v1";
let storageNamespace = "legacy";

export const defaultProviderSettings: ProviderSettings = {
  maxTokens: 4096,
  model: DEFAULT_CHAT_MODEL,
  openRouterApiKey: "",
  systemPrompt: "You are Gilbert Codex, a careful local coding assistant. Be concise, practical, and honest about limitations.",
  thinking: {
    effort: "high",
    enabled: true,
  },
  temperature: 0.35,
  tools: DEFAULT_TOOL_REGISTRY_SETTINGS,
  webSearch: {
    enabled: false,
    maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
    provider: "duckduckgo",
  },
};

export function setStorageNamespace(userId: string | null) {
  storageNamespace = userId ? `user.${sanitizeStorageScope(userId)}` : "legacy";
}

export function loadChats(): ChatSummary[] {
  const storedChats = readJson<ChatSummary[]>(CHATS_KEY);

  if (!Array.isArray(storedChats) || storedChats.length === 0) {
    return [createEmptyChat(DEFAULT_PROJECT)];
  }

  return storedChats.map((chat) => ({
    ...chat,
    messages: Array.isArray(chat.messages) ? chat.messages.map(normalizeChatMessage) : [],
    project: chat.project || DEFAULT_PROJECT,
    title: chat.title || "New chat",
    updatedAt: chat.updatedAt || new Date().toISOString(),
  }));
}

export function saveChats(chats: ChatSummary[]) {
  writeJson(CHATS_KEY, chats);
}

export function loadProjects(): ProjectSummary[] {
  const storedProjects = readJson<ProjectSummary[]>(PROJECTS_KEY);

  if (!Array.isArray(storedProjects) || storedProjects.length === 0) {
    return [createDefaultProject()];
  }

  return storedProjects.map((project) => ({
    ...project,
    createdAt: project.createdAt || new Date().toISOString(),
    id: project.id || `project-${project.name}`,
    localWorkspace: project.localWorkspace ? normalizeLocalWorkspaceSettings(project.localWorkspace) : undefined,
    name: project.name || DEFAULT_PROJECT,
    updatedAt: project.updatedAt || project.createdAt || new Date().toISOString(),
  }));
}

export function saveProjects(projects: ProjectSummary[]) {
  writeJson(PROJECTS_KEY, projects);
}

export function loadProviderSettings(): ProviderSettings {
  const storedSettings = readJson<Partial<ProviderSettings>>(SETTINGS_KEY);
  const storedThinking = readJson<Partial<ThinkingSettings>>(THINKING_KEY);
  const storedTools = readJson(TOOL_REGISTRY_KEY);

  return {
    ...defaultProviderSettings,
    ...storedSettings,
    maxTokens: normalizeNumber(storedSettings?.maxTokens, defaultProviderSettings.maxTokens),
    model: normalizeModel(storedSettings?.model),
    thinking: normalizeThinkingSettings(storedThinking ?? storedSettings?.thinking),
    temperature: normalizeNumber(storedSettings?.temperature, defaultProviderSettings.temperature),
    tools: normalizeToolRegistrySettings(storedTools ?? storedSettings?.tools),
    webSearch: normalizeWebSearchSettings(storedSettings?.webSearch),
  };
}

export function saveProviderSettings(settings: ProviderSettings) {
  const normalizedSettings = {
    ...settings,
    thinking: normalizeThinkingSettings(settings.thinking),
    tools: normalizeToolRegistrySettings(settings.tools),
    webSearch: normalizeWebSearchSettings(settings.webSearch),
  };

  const { tools, ...providerSettingsWithoutTools } = normalizedSettings;

  writeJson(SETTINGS_KEY, providerSettingsWithoutTools);
  writeJson(THINKING_KEY, normalizedSettings.thinking);
  writeJson(TOOL_REGISTRY_KEY, tools);
}

export function loadAppearanceMode(): AppearanceMode {
  const storedMode = readString(APPEARANCE_KEY);

  if (storedMode === "light" || storedMode === "dark" || storedMode === "system") {
    return storedMode;
  }

  return "system";
}

export function saveAppearanceMode(mode: AppearanceMode) {
  writeString(APPEARANCE_KEY, mode);
}

export function loadActiveChatId() {
  return readString(ACTIVE_CHAT_KEY);
}

export function saveActiveChatId(chatId: string) {
  writeString(ACTIVE_CHAT_KEY, chatId);
}

export function loadLocalWorkspaceSettings(): LocalWorkspaceSettings {
  return normalizeLocalWorkspaceSettings(readJson<Partial<LocalWorkspaceSettings>>(LOCAL_WORKSPACE_KEY));
}

export function saveLocalWorkspaceSettings(settings: LocalWorkspaceSettings) {
  writeJson(LOCAL_WORKSPACE_KEY, normalizeLocalWorkspaceSettings(settings));
}

function readJson<T>(key: string): T | null {
  try {
    const rawValue = readRawString(scopedStorageKey(key));
    return rawValue ? (JSON.parse(rawValue) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  writeString(key, JSON.stringify(value));
}

function readString(key: string) {
  try {
    return readRawString(scopedStorageKey(key));
  } catch {
    return null;
  }
}

function writeString(key: string, value: string) {
  try {
    window.localStorage.setItem(scopedStorageKey(key), value);
  } catch {
    return;
  }
}

function scopedStorageKey(key: string) {
  if (storageNamespace === "legacy") {
    return key;
  }

  return `${key}.${storageNamespace}`;
}

function readRawString(key: string) {
  return window.localStorage.getItem(key);
}

function sanitizeStorageScope(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80) || "local";
}

function normalizeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeModel(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return defaultProviderSettings.model;
  }

  return value.toLowerCase().includes("gpt") ? defaultProviderSettings.model : value;
}

function normalizeChatMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    attachments: normalizeAttachments(message.attachments),
    content: typeof message.content === "string" ? message.content : "",
    createdAt: message.createdAt || new Date().toISOString(),
    id: message.id || `message-${Date.now()}`,
    role: message.role === "assistant" ? "assistant" : "user",
  };
}

function normalizeAttachments(value: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const attachments = value.flatMap((attachment) => {
    const normalized = normalizeAttachment(attachment);
    return normalized ? [normalized] : [];
  });

  return attachments.length > 0 ? attachments : undefined;
}

function normalizeAttachment(value: unknown): ChatAttachment | null {
  if (typeof value !== "object" || !value) {
    return null;
  }

  const attachment = value as Partial<ChatAttachment>;
  const kind = attachment.kind;
  const name = typeof attachment.name === "string" && attachment.name.trim() ? attachment.name : "Attachment";
  const mimeType = typeof attachment.mimeType === "string" && attachment.mimeType.trim() ? attachment.mimeType : "application/octet-stream";
  const size = normalizeNumber(attachment.size, 0);
  const base = {
    createdAt: typeof attachment.createdAt === "string" && attachment.createdAt ? attachment.createdAt : new Date().toISOString(),
    id: typeof attachment.id === "string" && attachment.id ? attachment.id : `attachment-${Date.now()}-${Math.round(Math.random() * 100000)}`,
    mimeType,
    name,
    size,
  };

  if (kind === "image") {
    const image = attachment as Partial<ChatImageAttachment>;

    if (typeof image.dataUrl !== "string" || !image.dataUrl.startsWith("data:image/")) {
      return null;
    }

    return {
      ...base,
      dataUrl: image.dataUrl,
      height: normalizeOptionalNumber(image.height),
      kind: "image",
      width: normalizeOptionalNumber(image.width),
    };
  }

  if (kind === "file") {
    return {
      ...base,
      kind: "file",
    } satisfies ChatFileAttachment;
  }

  return null;
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizeThinkingSettings(value: unknown): ThinkingSettings {
  const storedThinking = typeof value === "object" && value ? (value as Partial<ThinkingSettings>) : {};

  return {
    ...defaultProviderSettings.thinking,
    ...storedThinking,
    effort: normalizeReasoningEffort(storedThinking.effort),
    enabled: typeof storedThinking.enabled === "boolean" ? storedThinking.enabled : defaultProviderSettings.thinking.enabled,
  };
}

function normalizeWebSearchSettings(value: unknown): WebSearchSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<WebSearchSettings>) : {};
  const maxResults = normalizeNumber(storedSettings.maxResults, defaultProviderSettings.webSearch.maxResults);

  return {
    enabled: typeof storedSettings.enabled === "boolean" ? storedSettings.enabled : defaultProviderSettings.webSearch.enabled,
    maxResults: Math.min(Math.max(Math.round(maxResults), 1), MAX_WEB_SEARCH_RESULTS),
    provider: storedSettings.provider === "duckduckgo" ? storedSettings.provider : "duckduckgo",
  };
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }

  return defaultProviderSettings.thinking.effort;
}

function normalizeLocalWorkspaceSettings(value: unknown): LocalWorkspaceSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<LocalWorkspaceSettings>) : {};
  const roots = Array.isArray(storedSettings.roots)
    ? storedSettings.roots.filter((root): root is string => typeof root === "string" && Boolean(root.trim()))
    : [];

  return {
    enabled: typeof storedSettings.enabled === "boolean" ? storedSettings.enabled : false,
    indexReason: typeof storedSettings.indexReason === "string" ? storedSettings.indexReason : undefined,
    indexSummary: storedSettings.indexSummary,
    indexStatus: normalizeLocalWorkspaceIndexStatus(storedSettings.indexStatus),
    indexUpdatedAt: typeof storedSettings.indexUpdatedAt === "string" ? storedSettings.indexUpdatedAt : undefined,
    lastError: typeof storedSettings.lastError === "string" ? storedSettings.lastError : undefined,
    permissionMode: normalizeLocalPermissionMode(storedSettings.permissionMode),
    roots,
    scope: normalizeLocalWorkspaceScope(storedSettings.scope),
  };
}

function normalizeLocalWorkspaceIndexStatus(value: unknown): LocalWorkspaceIndexStatus {
  return value === "error" ? "error" : "idle";
}

function normalizeLocalPermissionMode(value: unknown): LocalPermissionMode {
  if (value === "ask-first" || value === "gilbert-review" || value === "full-workspace") {
    return value;
  }

  return "gilbert-review";
}

function normalizeLocalWorkspaceScope(value: unknown): LocalWorkspaceScope {
  if (value === "current-folder" || value === "selected-folder" || value === "full-computer") {
    return value;
  }

  return "current-folder";
}

function createDefaultProject(): ProjectSummary {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    id: "project-gilbert-codex",
    name: DEFAULT_PROJECT,
    updatedAt: now,
  };
}
