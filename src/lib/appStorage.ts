import { createEmptyChat, DEFAULT_PROJECT } from "./chatUtils";
import { DEFAULT_CHAT_MODEL } from "./models";
import type { ChatAttachment, ChatFileAttachment, ChatImageAttachment, ChatMessage, ChatSummary } from "../types/chat";
import type { ProjectSummary } from "../types/project";
import type { AppearanceMode, ProviderSettings, ReasoningEffort, ThinkingSettings } from "../types/settings";

const CHATS_KEY = "gilbert-codex.chats.v1";
const PROJECTS_KEY = "gilbert-codex.projects.v1";
const SETTINGS_KEY = "gilbert-codex.provider-settings.v1";
const THINKING_KEY = "gilbert-codex.thinking-settings.v1";
const APPEARANCE_KEY = "gilbert-codex.appearance.v1";
const ACTIVE_CHAT_KEY = "gilbert-codex.active-chat.v1";

export const defaultProviderSettings: ProviderSettings = {
  maxTokens: 2048,
  model: DEFAULT_CHAT_MODEL,
  openRouterApiKey: "",
  systemPrompt: "You are Gilbert Codex, a careful local coding assistant. Be concise, practical, and honest about limitations.",
  thinking: {
    effort: "high",
    enabled: true,
    showReasoning: false,
  },
  temperature: 0.35,
};

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

  return {
    ...defaultProviderSettings,
    ...storedSettings,
    maxTokens: normalizeNumber(storedSettings?.maxTokens, defaultProviderSettings.maxTokens),
    model: normalizeModel(storedSettings?.model),
    thinking: normalizeThinkingSettings(storedThinking ?? storedSettings?.thinking),
    temperature: normalizeNumber(storedSettings?.temperature, defaultProviderSettings.temperature),
  };
}

export function saveProviderSettings(settings: ProviderSettings) {
  const normalizedSettings = {
    ...settings,
    thinking: normalizeThinkingSettings(settings.thinking),
  };

  writeJson(SETTINGS_KEY, normalizedSettings);
  writeJson(THINKING_KEY, normalizedSettings.thinking);
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

function readJson<T>(key: string): T | null {
  try {
    const rawValue = window.localStorage.getItem(key);
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
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return;
  }
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
    showReasoning: typeof storedThinking.showReasoning === "boolean" ? storedThinking.showReasoning : defaultProviderSettings.thinking.showReasoning,
  };
}

function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
    return value;
  }

  return defaultProviderSettings.thinking.effort;
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
