import { createEmptyChat, DEFAULT_PROJECT, isNoProjectName, normalizeProjectName, titleFromMessage } from "./chatUtils";
import {
  DEFAULT_LOCAL_MAX_TOKENS,
  DEFAULT_LOCAL_TEMPERATURE,
  DEFAULT_LOCAL_TOP_K,
  DEFAULT_LOCAL_TOP_P,
  normalizeMaxTokens,
  normalizeTemperature,
  normalizeTopK,
  normalizeTopP,
} from "./generationSettings";
import { isTerminalShellId } from "./terminalShells";
import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_PROVIDER_ID,
  getDefaultBaseUrlForProvider,
  getDefaultProviderBaseUrls,
  getDefaultProviderModels,
  isModelProviderId,
  normalizeProviderBaseUrl,
  normalizeProviderModelId,
} from "./models";
import { DEFAULT_WEB_SEARCH_MAX_RESULTS, MAX_WEB_SEARCH_RESULTS } from "../services/webSearchClient";
import { DEFAULT_DISCORD_BRIDGE_SETTINGS, normalizeDiscordBridgeSettings } from "../types/discord";
import { DEFAULT_TOOL_REGISTRY_SETTINGS, normalizeToolRegistrySettings } from "../types/tools";
import { cleanupLegacyDeviceStorage, isDeviceDatabaseAvailable, loadDeviceDatabaseNamespace, saveDeviceDatabaseValue, type DeviceDatabaseSeed } from "./deviceDatabase";
import type {
  ChatAttachment,
  ChatContextCompaction,
  ChatFileAttachment,
  ChatImageAttachment,
  ChatMessage,
  ChatProgressItem,
  ChatSummary,
  ChatToolCall,
} from "../types/chat";
import type { AgentApproval } from "../types/agentRun";
import type { LocalPermissionMode, LocalWorkspaceIndexStatus, LocalWorkspaceScope, LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProjectSummary } from "../types/project";
import type { DiscordBridgeSettings } from "../types/discord";
import type { AppearanceMode, ProviderSettings, ReasoningEffort, ThinkingSettings, WebSearchSettings } from "../types/settings";

const CHATS_KEY = "gilbert-codex.chats.v1";
const PROJECTS_KEY = "gilbert-codex.projects.v1";
const SETTINGS_KEY = "gilbert-codex.provider-settings.v1";
const THINKING_KEY = "gilbert-codex.thinking-settings.v1";
const APPEARANCE_KEY = "gilbert-codex.appearance.v1";
const ACTIVE_CHAT_KEY = "gilbert-codex.active-chat.v1";
const LOCAL_WORKSPACE_KEY = "gilbert-codex.local-workspace.v1";
const TOOL_REGISTRY_KEY = "gilbert-codex.tool-registry.v1";
const GITHUB_OAUTH_CLIENT_ID_KEY = "gilbert-codex.github-oauth-client-id.v1";
const DISCORD_BRIDGE_KEY = "gilbert-codex.discord-bridge.v1";
const BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v2";
const LEGACY_BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v1";
const BROWSER_AUTH_DB_KEY = "gilbert-codex.local-auth-db.v1";
const BROWSER_AGENT_RUNS_KEY = "gilbert-codex.agent-runs.v1";
const PERSISTED_STORAGE_KEYS = [
  CHATS_KEY,
  PROJECTS_KEY,
  SETTINGS_KEY,
  THINKING_KEY,
  APPEARANCE_KEY,
  ACTIVE_CHAT_KEY,
  LOCAL_WORKSPACE_KEY,
  TOOL_REGISTRY_KEY,
  GITHUB_OAUTH_CLIENT_ID_KEY,
  DISCORD_BRIDGE_KEY,
  BROWSER_PREVIEW_SESSION_KEY,
  LEGACY_BROWSER_PREVIEW_SESSION_KEY,
  BROWSER_AGENT_RUNS_KEY,
];
const LEGACY_BROWSER_ONLY_KEYS = [BROWSER_AUTH_DB_KEY];
let storageNamespace = "legacy";
let deviceDatabasePath: string | null = null;
let deviceStorageInitialized = false;
let deviceStorageValues = new Map<string, string>();
let storageInitializationToken = 0;
const deviceStorageWriteQueues = new Map<string, Promise<void>>();
const deviceStoragePendingWrites = new Map<string, { key: string; namespace: string; value: string }>();

export const defaultProviderSettings: ProviderSettings = {
  apiKeys: {},
  baseUrls: getDefaultProviderBaseUrls(),
  maxTokens: DEFAULT_LOCAL_MAX_TOKENS,
  model: DEFAULT_CHAT_MODEL,
  openRouterApiKey: "",
  provider: DEFAULT_PROVIDER_ID,
  providerModels: getDefaultProviderModels(),
  systemPrompt: "You are Gilbert Codex, a careful local coding assistant. Be concise, practical, and honest about limitations.",
  thinking: {
    effort: "high",
    enabled: true,
  },
  temperature: DEFAULT_LOCAL_TEMPERATURE,
  topK: DEFAULT_LOCAL_TOP_K,
  topP: DEFAULT_LOCAL_TOP_P,
  tools: DEFAULT_TOOL_REGISTRY_SETTINGS,
  userInstructions: "",
  webSearch: {
    enabled: false,
    maxResults: DEFAULT_WEB_SEARCH_MAX_RESULTS,
    provider: "duckduckgo",
  },
  workspaceDependencies: {
    enabled: true,
  },
};

export function setStorageNamespace(userId: string | null) {
  const nextNamespace = userId ? `user.${sanitizeStorageScope(userId)}` : "legacy";

  if (nextNamespace === storageNamespace) {
    return;
  }

  storageNamespace = nextNamespace;
  storageInitializationToken += 1;
  deviceDatabasePath = null;
  deviceStorageInitialized = false;
  deviceStorageValues = new Map();
}

export async function initializeDeviceStorage(userId: string | null) {
  setStorageNamespace(userId);

  const initializationToken = ++storageInitializationToken;
  const namespace = storageNamespace;
  deviceDatabasePath = null;
  deviceStorageInitialized = false;
  deviceStorageValues = new Map();

  if (!isDeviceDatabaseAvailable()) {
    deviceStorageInitialized = true;
    return;
  }

  const snapshot = await loadDeviceDatabaseNamespace(namespace, collectLocalStorageSeeds());

  if (initializationToken !== storageInitializationToken || namespace !== storageNamespace) {
    return;
  }

  deviceDatabasePath = snapshot?.databasePath ?? null;
  deviceStorageValues = new Map(Object.entries(snapshot?.values ?? {}));
  deviceStorageInitialized = true;
  purgeLegacyBrowserStorage();
  void cleanupLegacyDeviceStorage().catch(() => undefined);
}

export function getDeviceDatabasePath() {
  return deviceDatabasePath;
}

export function loadChats(): ChatSummary[] {
  const storedChats = readJson<ChatSummary[]>(CHATS_KEY);

  if (!Array.isArray(storedChats) || storedChats.length === 0) {
    return [createEmptyChat(DEFAULT_PROJECT)];
  }

  return storedChats.map((chat) => {
    const messages = Array.isArray(chat.messages) ? chat.messages.map(normalizeChatMessage) : [];
    const project = normalizeProjectName(chat.project);
    const isLegacyDiscordChat = project.toLowerCase() === "discord" && messages.some((message) => message.source?.kind === "discord");
    const firstUserMessage = messages.find((message) => message.role === "user");

    return {
      ...chat,
      messages,
      project: isLegacyDiscordChat ? DEFAULT_PROJECT : project,
      title: isLegacyDiscordChat && firstUserMessage ? titleFromMessage(firstUserMessage.content) : chat.title || "New chat",
      updatedAt: chat.updatedAt || new Date().toISOString(),
    };
  });
}

export function saveChats(chats: ChatSummary[]) {
  writeJson(CHATS_KEY, chats);
}

export function loadProjects(): ProjectSummary[] {
  const storedProjects = readJson<ProjectSummary[]>(PROJECTS_KEY);

  if (!Array.isArray(storedProjects) || storedProjects.length === 0) {
    return [];
  }

  return storedProjects.flatMap((project) => {
    const name = normalizeProjectName(project.name);

    if (isNoProjectName(name) || (name.toLowerCase() === "discord" && !project.localWorkspace)) {
      return [];
    }

    return [
      {
        ...project,
        createdAt: project.createdAt || new Date().toISOString(),
        id: project.id || `project-${name}`,
        localWorkspace: project.localWorkspace ? normalizeLocalWorkspaceSettings(project.localWorkspace) : undefined,
        name,
        updatedAt: project.updatedAt || project.createdAt || new Date().toISOString(),
      },
    ];
  });
}

export function saveProjects(projects: ProjectSummary[]) {
  writeJson(PROJECTS_KEY, projects);
}

export function loadProviderSettings(): ProviderSettings {
  const storedSettings = readJson<Partial<ProviderSettings>>(SETTINGS_KEY);
  const storedThinking = readJson<Partial<ThinkingSettings>>(THINKING_KEY);
  const storedTools = readJson(TOOL_REGISTRY_KEY);
  const provider = normalizeModelProvider(storedSettings?.provider);
  const apiKeys = normalizeProviderSecretMap(storedSettings?.apiKeys);
  const baseUrls = normalizeProviderBaseUrls(storedSettings?.baseUrls);
  const providerModels = normalizeProviderModels(storedSettings?.providerModels);
  const legacyOpenRouterApiKey = typeof storedSettings?.openRouterApiKey === "string" ? storedSettings.openRouterApiKey : "";

  if (!apiKeys.openrouter && legacyOpenRouterApiKey) {
    apiKeys.openrouter = legacyOpenRouterApiKey;
  }

  const model = normalizeModel(storedSettings?.model, provider, providerModels);
  providerModels[provider] = model;

  return {
    ...defaultProviderSettings,
    ...storedSettings,
    apiKeys,
    baseUrls,
    maxTokens: normalizeMaxTokens(storedSettings?.maxTokens, defaultProviderSettings.maxTokens),
    model,
    openRouterApiKey: apiKeys.openrouter ?? "",
    provider,
    providerModels,
    thinking: normalizeThinkingSettings(storedThinking ?? storedSettings?.thinking),
    temperature: normalizeTemperature(storedSettings?.temperature, defaultProviderSettings.temperature),
    topK: normalizeTopK(storedSettings?.topK, defaultProviderSettings.topK),
    topP: normalizeTopP(storedSettings?.topP, defaultProviderSettings.topP),
    tools: normalizeToolRegistrySettings(storedTools ?? storedSettings?.tools),
    userInstructions: normalizeText(storedSettings?.userInstructions, defaultProviderSettings.userInstructions),
    webSearch: normalizeWebSearchSettings(storedSettings?.webSearch),
    workspaceDependencies: normalizeWorkspaceDependencySettings(storedSettings?.workspaceDependencies),
  };
}

export function saveProviderSettings(settings: ProviderSettings) {
  const apiKeys = normalizeProviderSecretMap({
    ...settings.apiKeys,
    openrouter: settings.apiKeys?.openrouter || settings.openRouterApiKey,
  });
  const baseUrls = normalizeProviderBaseUrls(settings.baseUrls);
  const providerModels = normalizeProviderModels({
    ...settings.providerModels,
    [settings.provider]: settings.model,
  });
  const normalizedSettings = {
    ...settings,
    apiKeys,
    baseUrls,
    openRouterApiKey: apiKeys.openrouter ?? "",
    providerModels,
    thinking: normalizeThinkingSettings(settings.thinking),
    tools: normalizeToolRegistrySettings(settings.tools),
    webSearch: normalizeWebSearchSettings(settings.webSearch),
    workspaceDependencies: normalizeWorkspaceDependencySettings(settings.workspaceDependencies),
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

export function loadGithubOAuthClientId(defaultClientId = "") {
  return readString(GITHUB_OAUTH_CLIENT_ID_KEY)?.trim() || defaultClientId.trim();
}

export function saveGithubOAuthClientId(clientId: string) {
  writeString(GITHUB_OAUTH_CLIENT_ID_KEY, clientId.trim());
}

export function loadDiscordBridgeSettings(): DiscordBridgeSettings {
  return normalizeDiscordBridgeSettings(readJson<Partial<DiscordBridgeSettings>>(DISCORD_BRIDGE_KEY) ?? DEFAULT_DISCORD_BRIDGE_SETTINGS);
}

export function saveDiscordBridgeSettings(settings: DiscordBridgeSettings) {
  writeJson(DISCORD_BRIDGE_KEY, normalizeDiscordBridgeSettings(settings));
}

export function loadPersistentString(key: string) {
  return readString(key);
}

export function savePersistentString(key: string, value: string) {
  writeString(key, value);
}

function readJson<T>(key: string): T | null {
  try {
    const rawValue = readString(key);
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
    if (deviceStorageInitialized && deviceStorageValues.has(key)) {
      return deviceStorageValues.get(key) ?? null;
    }

    return readRawStorageValue(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string) {
  if (deviceStorageInitialized && isDeviceDatabaseAvailable()) {
    deviceStorageValues.set(key, value);
    queueDeviceStorageWrite(storageNamespace, key, value);
    return;
  }

  try {
    window.localStorage.setItem(scopedStorageKey(key), value);
  } catch {
    return;
  }
}

function queueDeviceStorageWrite(namespace: string, key: string, value: string) {
  const queueKey = `${namespace}\0${key}`;
  deviceStoragePendingWrites.set(queueKey, { key, namespace, value });

  if (deviceStorageWriteQueues.has(queueKey)) {
    return;
  }

  const queuedWrite = drainDeviceStorageWriteQueue(queueKey).finally(() => {
    deviceStorageWriteQueues.delete(queueKey);

    if (deviceStoragePendingWrites.has(queueKey)) {
      queueDeviceStorageWrite(namespace, key, deviceStoragePendingWrites.get(queueKey)?.value ?? value);
    }
  });

  deviceStorageWriteQueues.set(queueKey, queuedWrite);
  void queuedWrite.catch(() => undefined);
}

async function drainDeviceStorageWriteQueue(queueKey: string) {
  while (deviceStoragePendingWrites.has(queueKey)) {
    const pendingWrite = deviceStoragePendingWrites.get(queueKey);
    deviceStoragePendingWrites.delete(queueKey);

    if (!pendingWrite) {
      return;
    }

    try {
      await saveDeviceDatabaseValue(pendingWrite.namespace, pendingWrite.key, pendingWrite.value);
    } catch {
      return;
    }
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

function readRawStorageValue(key: string) {
  try {
    if (storageNamespace !== "legacy") {
      return readRawString(scopedStorageKey(key));
    }

    return readRawString(key);
  } catch {
    return null;
  }
}

function collectLocalStorageSeeds(): DeviceDatabaseSeed[] {
  if (typeof window === "undefined") {
    return [];
  }

  return PERSISTED_STORAGE_KEYS.flatMap((key) => {
    const value = readRawStorageValue(key);

    return value === null ? [] : [{ key, value }];
  });
}

function purgeLegacyBrowserStorage() {
  if (typeof window === "undefined") {
    return;
  }

  const keysToRemove: string[] = [];
  const allLegacyKeys = [...PERSISTED_STORAGE_KEYS, ...LEGACY_BROWSER_ONLY_KEYS];
  const storageKeyPrefixes = allLegacyKeys.map((key) => `${key}.user.`);

  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);

      if (!key) {
        continue;
      }

      if (allLegacyKeys.includes(key) || storageKeyPrefixes.some((prefix) => key.startsWith(prefix))) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    return;
  }
}

function sanitizeStorageScope(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 80) || "local";
}

function normalizeNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function normalizeModel(value: unknown, provider: ProviderSettings["provider"], providerModels: ProviderSettings["providerModels"]) {
  if (typeof value === "string" && value.trim()) {
    return normalizeProviderModelId(provider, value.trim());
  }

  const providerModel = providerModels[provider];

  return normalizeProviderModelId(provider, typeof providerModel === "string" && providerModel.trim() ? providerModel.trim() : defaultProviderSettings.providerModels[provider] ?? defaultProviderSettings.model);
}

function normalizeModelProvider(value: unknown): ProviderSettings["provider"] {
  return isModelProviderId(value) ? value : defaultProviderSettings.provider;
}

function normalizeProviderSecretMap(value: unknown): ProviderSettings["apiKeys"] {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};

  return Object.entries(defaultProviderSettings.baseUrls).reduce<ProviderSettings["apiKeys"]>((map, [providerId]) => {
    const value = storedMap[providerId];

    if (typeof value === "string") {
      map[providerId as ProviderSettings["provider"]] = value;
    }

    return map;
  }, {});
}

function normalizeProviderBaseUrls(value: unknown): ProviderSettings["baseUrls"] {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};

  return Object.entries(defaultProviderSettings.baseUrls).reduce<ProviderSettings["baseUrls"]>((baseUrls, [providerId, fallbackUrl]) => {
    const value = storedMap[providerId];
    const provider = providerId as ProviderSettings["provider"];

    baseUrls[provider] = normalizeProviderBaseUrl(provider, typeof value === "string" && value.trim() ? value.trim() : fallbackUrl || getDefaultBaseUrlForProvider(provider));

    return baseUrls;
  }, {});
}

function normalizeProviderModels(value: unknown): ProviderSettings["providerModels"] {
  const storedMap = typeof value === "object" && value ? (value as Partial<Record<string, unknown>>) : {};

  return Object.entries(defaultProviderSettings.providerModels).reduce<ProviderSettings["providerModels"]>((models, [providerId, fallbackModel]) => {
    const value = storedMap[providerId];
    const provider = providerId as ProviderSettings["provider"];

    models[provider] = normalizeProviderModelId(provider, typeof value === "string" && value.trim() ? value.trim() : fallbackModel ?? defaultProviderSettings.model);

    return models;
  }, {});
}

function normalizeChatMessage(message: ChatMessage): ChatMessage {
  const legacyDiscordMessage = parseLegacyDiscordMessage(message.content);

  return {
    ...message,
    agentRunId: typeof message.agentRunId === "string" && message.agentRunId ? message.agentRunId : undefined,
    agentRunStatus: normalizeAgentRunStatus(message.agentRunStatus),
    approvals: normalizeAgentApprovals(message.approvals),
    attachments: normalizeAttachments(message.attachments),
    contextCompactions: normalizeContextCompactions(message.contextCompactions),
    content: legacyDiscordMessage?.content ?? (typeof message.content === "string" ? message.content : ""),
    createdAt: message.createdAt || new Date().toISOString(),
    id: message.id || `message-${Date.now()}`,
    isStreaming: false,
    progress: normalizeProgressItems(message.progress),
    role: message.role === "assistant" ? "assistant" : "user",
    source: normalizeChatMessageSource(message.source) ?? legacyDiscordMessage?.source,
    status: message.status === "error" ? "error" : undefined,
    toolCalls: normalizeToolCalls(message.toolCalls),
  };
}

function normalizeChatMessageSource(value: unknown): ChatMessage["source"] | undefined {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const source = value as Partial<NonNullable<ChatMessage["source"]>>;

  if (source.kind !== "discord") {
    return undefined;
  }

  return {
    channelId: normalizeOptionalText(source.channelId),
    commandName: normalizeOptionalText(source.commandName),
    guildId: normalizeOptionalText(source.guildId),
    kind: "discord",
    receivedAt: normalizeOptionalText(source.receivedAt),
    userId: normalizeOptionalText(source.userId),
    username: normalizeOptionalText(source.username),
  };
}

function parseLegacyDiscordMessage(content: unknown): { content: string; source: NonNullable<ChatMessage["source"]> } | null {
  if (typeof content !== "string" || !content.startsWith("DISCORD SLASH COMMAND")) {
    return null;
  }

  const lines = content.split(/\r?\n/);
  const command = findLegacyDiscordValue(lines, "Command:");
  const from = findLegacyDiscordValue(lines, "From:");
  const promptIndex = lines.findIndex((line) => line.trim().toLowerCase() === "user prompt:");
  const prompt = promptIndex >= 0 ? lines.slice(promptIndex + 1).join("\n").trim() : content.replace(/^DISCORD SLASH COMMAND\s*/i, "").trim();
  const fromParts = from ? from.split(/\s+/).filter(Boolean) : [];
  const possibleUserId = fromParts.find((part) => /^\d{10,}$/.test(part));
  const username = fromParts.filter((part) => part !== possibleUserId).join(" ");

  return {
    content: prompt || content,
    source: {
      channelId: findLegacyDiscordValue(lines, "Channel ID:"),
      commandName: command?.replace(/^\//, ""),
      guildId: findLegacyDiscordValue(lines, "Guild ID:"),
      kind: "discord",
      userId: possibleUserId,
      username: username || undefined,
    },
  };
}

function findLegacyDiscordValue(lines: string[], label: string) {
  const line = lines.find((candidate) => candidate.trim().startsWith(label));
  return line?.slice(line.indexOf(label) + label.length).trim() || undefined;
}

function normalizeOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeContextCompactions(value: unknown): ChatContextCompaction[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const compacted = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const compaction = item as Partial<ChatContextCompaction>;

    if (typeof compaction.compactedAt !== "string") {
      return [];
    }

    return [
      {
        afterTokens: normalizeNumber(compaction.afterTokens, 0),
        beforeTokens: normalizeNumber(compaction.beforeTokens, 0),
        compactedAt: compaction.compactedAt,
        compactedMessageCount: normalizeNumber(compaction.compactedMessageCount, 0),
        contextWindowTokens: typeof compaction.contextWindowTokens === "number" ? compaction.contextWindowTokens : undefined,
        forcedByProviderUsage: Boolean(compaction.forcedByProviderUsage),
        thresholdTokens: typeof compaction.thresholdTokens === "number" ? compaction.thresholdTokens : undefined,
      } satisfies ChatContextCompaction,
    ];
  });

  return compacted.length > 0 ? compacted : undefined;
}

function normalizeProgressItems(value: unknown): ChatProgressItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const progress = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const progressItem = item as Partial<ChatProgressItem>;

    if (typeof progressItem.label !== "string" || !progressItem.label.trim()) {
      return [];
    }

    return [
      {
        detail: progressItem.status === "active" ? "Stopped when the app reloaded." : progressItem.detail,
        id: typeof progressItem.id === "string" ? progressItem.id : undefined,
        label: progressItem.label,
        status: progressItem.status === "pending" ? "pending" : "complete",
      } satisfies ChatProgressItem,
    ];
  });

  return progress.length > 0 ? progress : undefined;
}

function normalizeToolCalls(value: unknown): ChatToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const toolCalls = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const toolCall = item as Partial<ChatToolCall>;

    if (typeof toolCall.label !== "string" || !toolCall.label.trim()) {
      return [];
    }

    return [
      {
        detail: typeof toolCall.detail === "string" ? toolCall.detail : undefined,
        id: typeof toolCall.id === "string" && toolCall.id ? toolCall.id : `tool-call-${Date.now()}`,
        input: typeof toolCall.input === "string" ? toolCall.input : undefined,
        label: toolCall.label,
        output: toolCall.status === "active" ? "This tool run was interrupted before it returned a result." : toolCall.output,
        status: toolCall.status === "active" ? "error" : normalizeToolCallStatus(toolCall.status),
        terminal: normalizeToolCallTerminal(toolCall.terminal),
      } satisfies ChatToolCall,
    ];
  });

  return toolCalls.length > 0 ? toolCalls : undefined;
}

function normalizeToolCallTerminal(value: unknown): ChatToolCall["terminal"] {
  if (typeof value !== "object" || !value) {
    return undefined;
  }

  const terminal = value as NonNullable<ChatToolCall["terminal"]>;
  const shell = isTerminalShellId(terminal.shell) ? terminal.shell : undefined;

  return {
    command: typeof terminal.command === "string" ? terminal.command : undefined,
    exitCode: typeof terminal.exitCode === "number" || terminal.exitCode === null ? terminal.exitCode : undefined,
    live: typeof terminal.live === "boolean" ? terminal.live : undefined,
    outputTruncated: typeof terminal.outputTruncated === "boolean" ? terminal.outputTruncated : undefined,
    shell,
    timedOut: typeof terminal.timedOut === "boolean" ? terminal.timedOut : undefined,
    workingDirectory: typeof terminal.workingDirectory === "string" ? terminal.workingDirectory : undefined,
  };
}

function normalizeToolCallStatus(status: unknown): ChatToolCall["status"] {
  if (status === "complete" || status === "error" || status === "skipped" || status === "waiting_approval") {
    return status;
  }

  return "skipped";
}

function normalizeAgentRunStatus(status: unknown): ChatMessage["agentRunStatus"] {
  if (status === "queued" || status === "running" || status === "waiting_for_approval" || status === "completed" || status === "failed" || status === "cancelled") {
    return status;
  }

  return undefined;
}

function normalizeAgentApprovals(value: unknown): AgentApproval[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const approvals = value.flatMap((item) => {
    if (typeof item !== "object" || !item) {
      return [];
    }

    const approval = item as Partial<AgentApproval>;
    const id = typeof approval.id === "string" && approval.id ? approval.id : `approval-${Date.now()}`;
    const status = normalizeAgentApprovalStatus(approval.status);

    return [
      {
        args: isRecord(approval.args) ? approval.args : undefined,
        command: typeof approval.command === "string" ? approval.command : undefined,
        createdAt: typeof approval.createdAt === "string" ? approval.createdAt : new Date().toISOString(),
        detail: typeof approval.detail === "string" ? approval.detail : undefined,
        editedArgs: isRecord(approval.editedArgs) ? approval.editedArgs : undefined,
        id,
        kind: normalizeAgentApprovalKind(approval.kind),
        messageId: typeof approval.messageId === "string" ? approval.messageId : undefined,
        path: typeof approval.path === "string" ? approval.path : undefined,
        preview: typeof approval.preview === "string" ? approval.preview : undefined,
        resolvedAt: typeof approval.resolvedAt === "string" ? approval.resolvedAt : undefined,
        resolutionNote: typeof approval.resolutionNote === "string" ? approval.resolutionNote : undefined,
        resumeToolCallContent: typeof approval.resumeToolCallContent === "string" ? approval.resumeToolCallContent : undefined,
        risk: approval.risk === "high" || approval.risk === "medium" || approval.risk === "low" ? approval.risk : "medium",
        runId: typeof approval.runId === "string" ? approval.runId : undefined,
        status,
        title: typeof approval.title === "string" && approval.title.trim() ? approval.title : "Approval required",
        tool: typeof approval.tool === "string" && approval.tool.trim() ? approval.tool : "local_tool",
        toolCallId: typeof approval.toolCallId === "string" ? approval.toolCallId : undefined,
      } satisfies AgentApproval,
    ];
  });

  return approvals.length > 0 ? approvals : undefined;
}

function normalizeAgentApprovalStatus(status: unknown): AgentApproval["status"] {
  if (status === "approved" || status === "denied" || status === "edited" || status === "expired") {
    return status;
  }

  return "pending";
}

function normalizeAgentApprovalKind(kind: unknown): AgentApproval["kind"] {
  if (kind === "browser" || kind === "custom_tool" || kind === "delete" || kind === "edit" || kind === "file_create" || kind === "terminal" || kind === "write" || kind === "other") {
    return kind;
  }

  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function normalizeWorkspaceDependencySettings(value: unknown) {
  const storedSettings = typeof value === "object" && value ? (value as Partial<ProviderSettings["workspaceDependencies"]>) : {};

  return {
    enabled: typeof storedSettings.enabled === "boolean" ? storedSettings.enabled : defaultProviderSettings.workspaceDependencies.enabled,
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
  if (value === "ask-first" || value === "gilbert-review" || value === "full-workspace" || value === "read-only") {
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
