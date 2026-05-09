import { useEffect, useRef, useState } from "react";
import { Info, Trash2 } from "lucide-react";
import { AuthPage } from "../pages/AuthPage";
import { ConfirmDialog, NoticeDialog, TextInputDialog } from "../components/dialogs/AppDialog";
import { AppShell } from "../components/layout/AppShell";
import { ChatPage } from "../pages/ChatPage";
import { SettingsPage } from "../pages/SettingsPage";
import { ToolboxPage } from "../pages/ToolboxPage";
import { WorkflowsPage } from "../pages/WorkflowsPage";
import {
  loadActiveChatId,
  loadAppearanceMode,
  loadChats,
  loadLocalWorkspaceSettings,
  loadProjects,
  loadProviderSettings,
  saveActiveChatId,
  saveAppearanceMode,
  saveChats,
  saveLocalWorkspaceSettings,
  saveProjects,
  saveProviderSettings,
  setStorageNamespace,
} from "../lib/appStorage";
import { createEmptyChat, createId, createMessage, DEFAULT_PROJECT, sortChatsByUpdatedAt, titleFromMessage } from "../lib/chatUtils";
import {
  AUTO_COMPACT_CONTEXT_THRESHOLD,
  compactMessagesForContext,
  getFallbackContextWindowTokens,
  getFallbackModelContextWindow,
  getFallbackModelContextWindows,
  type ContextWindowUsage,
  type ModelContextWindowMap,
} from "../lib/contextWindow";
import { CHAT_MODEL_OPTIONS } from "../lib/models";
import {
  clampPlanningPasses,
  createPlanningInputRequest,
  createPlanningProgress,
  DEFAULT_PLANNING_MAX_PASSES,
  runPlanningMode,
} from "../services/planningClient";
import { fetchOpenRouterModelContextLengths, isOpenRouterEmptyResponseError, streamOpenRouterMessage } from "../services/openRouterClient";
import { applyOpenRouterUsageToContextEstimate, estimateOpenRouterProviderContextUsage } from "../services/openRouterUsage";
import { createLocalWorkspaceContext, getComputerFileIndexSummary, resolveLocalWorkspaceRoots } from "../tools/computer/files";
import {
  createLocalComputerProgress,
  hasLocalComputerToolCalls,
  runLocalComputerToolCalls,
  sanitizeLocalToolCallsForDisplay,
} from "../tools/computer/localToolExecutor";
import {
  createActiveLocalToolCalls,
  createLocalToolFinalInstruction,
  createPlanningAnswerMessages,
  getLatestUserPrompt,
  getPendingPlanningInputRequest,
  getPlanningInputRequests,
  isAbortError,
  looksLikeOnlyToolPrelude,
  markPlanningInputAnswered,
  mergeChatSources,
  stampLocalToolCallIds,
  withLocalComputerProgress,
  withWebSearchProgress,
} from "./chatRuntime";
import { mergeProjectsWithChats, sameLocalWorkspaceSettings, samePathSet, sortProjectsByUpdatedAt } from "./projectState";
import { createChatSourcesFromWebResults, createWebSearchContextMessage, MAX_WEB_SEARCH_RESULTS, searchDuckDuckGo } from "../services/webSearchClient";
import { getAppInfo, isTauriDesktopRuntime } from "./tauriClient";
import { getAuthState, logoutLocalAccount } from "./authClient";
import type { AppInfo } from "../types/app";
import type { AuthSession } from "../types/auth";
import type {
  ChatComposerDraft,
  ChatMessage,
  ChatPlanningInputAnswer,
  ChatProgressItem,
  ChatSendInput,
  ChatSource,
  ChatSummary,
  ChatToolCall,
  ChatWebSearch,
} from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { PrimaryRoute } from "../types/navigation";
import type { ProjectSummary } from "../types/project";
import type { AppearanceMode, ProviderSettings } from "../types/settings";
import { normalizeToolRegistrySettings } from "../types/tools";
import type { ToolRegistrySettings } from "../types/tools";

interface ActiveGeneration {
  controller: AbortController;
  previousChat: ChatSummary;
  previousChatExisted: boolean;
  requestId: number;
  restoreDraft?: ChatComposerDraft;
}

const MAX_PLANNING_INPUT_ROUNDS = 3;
const PINNED_MODEL_IDS = CHAT_MODEL_OPTIONS.map((option) => option.value);
const LOCAL_TOOL_FINAL_MIN_TOKENS = 4096;
const CHAT_PERSIST_DEBOUNCE_MS = 700;

export function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authHasAccounts, setAuthHasAccounts] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    void getAuthState()
      .then((state) => {
        if (!mounted) {
          return;
        }

        if (state.session) {
          setStorageNamespace(state.session.user.id);
        }

        setAuthSession(state.session);
        setAuthHasAccounts(state.hasAccounts);
        setAuthError(null);
      })
      .catch((error) => {
        if (!mounted) {
          return;
        }

        setAuthError(error instanceof Error ? error.message : "Local auth is not available yet.");
      })
      .finally(() => {
        if (mounted) {
          setAuthLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  async function handleLogout() {
    await logoutLocalAccount();
    setStorageNamespace(null);
    setAuthSession(null);
    setAuthHasAccounts(true);
  }

  if (authLoading || !authSession) {
    return (
      <AuthPage
        hasAccounts={authHasAccounts}
        initialError={authError}
        loading={authLoading}
        onAuthenticated={(session) => {
          setStorageNamespace(session.user.id);
          setAuthSession(session);
          setAuthHasAccounts(true);
          setAuthError(null);
        }}
      />
    );
  }

  return <WorkspaceApp key={authSession.user.id} authSession={authSession} onLogout={handleLogout} />;
}

interface WorkspaceAppProps {
  authSession: AuthSession;
  onLogout: () => void;
}

function WorkspaceApp({ authSession, onLogout }: WorkspaceAppProps) {
  const [activeRoute, setActiveRoute] = useState<PrimaryRoute>("chat");
  const [chats, setChats] = useState<ChatSummary[]>(() => sortChatsByUpdatedAt(loadChats()));
  const [projects, setProjects] = useState<ProjectSummary[]>(() => mergeProjectsWithChats(loadProjects(), loadChats()));
  const [activeChatId, setActiveChatId] = useState(() => loadActiveChatId() || "");
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings());
  const [localWorkspace, setLocalWorkspace] = useState<LocalWorkspaceSettings>(() => loadLocalWorkspaceSettings());
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => loadAppearanceMode());
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: "Gilbert Codex",
    phase: "Local workspace",
    runtime: isTauriDesktopRuntime() ? "Tauri desktop" : "Frontend preview",
    version: "0.1.0",
  });
  const [sendingChatId, setSendingChatId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(284);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [noticeDialog, setNoticeDialog] = useState<{ description?: string; title: string } | null>(null);
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState("");
  const [projectNameError, setProjectNameError] = useState<string | null>(null);
  const [composerDraftToRestore, setComposerDraftToRestore] = useState<ChatComposerDraft | null>(null);
  const [contextWindow, setContextWindow] = useState<{ source: "estimate" | "openrouter"; tokens: number }>(() => ({
    source: "estimate",
    tokens: getFallbackContextWindowTokens(providerSettings.model),
  }));
  const [modelContextWindows, setModelContextWindows] = useState<ModelContextWindowMap>(() =>
    getFallbackModelContextWindows([...PINNED_MODEL_IDS, providerSettings.model]),
  );
  const [lastProviderContextUsage, setLastProviderContextUsage] = useState<{ chatId: string; usage: ContextWindowUsage } | null>(null);
  const isDesktopRuntime = isTauriDesktopRuntime() || appInfo.runtime.toLowerCase().includes("tauri");
  const toolSettings = normalizeToolRegistrySettings(providerSettings.tools);
  const activeSendRef = useRef(0);
  const activeGenerationRef = useRef<ActiveGeneration | null>(null);
  const pendingChatsRef = useRef<ChatSummary[]>(chats);
  const sendingRequestRef = useRef<number | null>(null);

  useEffect(() => {
    void getAppInfo().then(setAppInfo);
  }, []);

  useEffect(() => {
    pendingChatsRef.current = chats;

    if (!sendingChatId) {
      saveChats(chats);
      return;
    }

    const saveTimer = window.setTimeout(() => {
      saveChats(pendingChatsRef.current);
    }, CHAT_PERSIST_DEBOUNCE_MS);

    return () => window.clearTimeout(saveTimer);
  }, [chats, sendingChatId]);

  useEffect(() => {
    function savePendingChats() {
      saveChats(pendingChatsRef.current);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        savePendingChats();
      }
    }

    window.addEventListener("pagehide", savePendingChats);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", savePendingChats);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    saveProviderSettings(providerSettings);
  }, [providerSettings]);

  useEffect(() => {
    saveLocalWorkspaceSettings(localWorkspace);
  }, [localWorkspace]);

  useEffect(() => {
    if (!toolSettings.terminal && terminalOpen) {
      setTerminalOpen(false);
    }
  }, [terminalOpen, toolSettings.terminal]);

  useEffect(() => {
    const selectedModel = providerSettings.model.trim();
    const modelIds = Array.from(new Set([...PINNED_MODEL_IDS, selectedModel].filter(Boolean)));
    const fallbackWindows = getFallbackModelContextWindows(modelIds);
    const controller = new AbortController();
    const selectedFallbackWindow = selectedModel ? fallbackWindows[selectedModel] ?? getFallbackModelContextWindow(selectedModel) : getFallbackModelContextWindow("");

    setModelContextWindows(fallbackWindows);
    setContextWindow(selectedFallbackWindow);

    void fetchOpenRouterModelContextLengths(providerSettings, modelIds, {
      signal: controller.signal,
    })
      .then((contextLengths) => {
        if (controller.signal.aborted) {
          return;
        }

        const openRouterWindows = Object.entries(contextLengths).reduce<ModelContextWindowMap>((windows, [model, tokens]) => {
          windows[model] = {
            source: "openrouter",
            tokens,
          };

          return windows;
        }, {});
        const nextWindows = {
          ...fallbackWindows,
          ...openRouterWindows,
        };
        const selectedWindow = selectedModel ? nextWindows[selectedModel] ?? selectedFallbackWindow : selectedFallbackWindow;

        setModelContextWindows(nextWindows);
        setContextWindow(selectedWindow);
      })
      .catch(() => {
        return;
      });

    return () => controller.abort();
  }, [providerSettings.model, providerSettings.openRouterApiKey]);

  useEffect(() => {
    saveAppearanceMode(appearanceMode);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    function applyAppearance() {
      const resolvedTheme = appearanceMode === "system" ? (mediaQuery.matches ? "light" : "dark") : appearanceMode;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themePreference = appearanceMode;
      document.documentElement.style.colorScheme = resolvedTheme;
    }

    applyAppearance();
    mediaQuery.addEventListener("change", applyAppearance);

    return () => mediaQuery.removeEventListener("change", applyAppearance);
  }, [appearanceMode]);

  useEffect(() => {
    if (activeChatId) {
      saveActiveChatId(activeChatId);
    }
  }, [activeChatId]);

  useEffect(() => {
    if (chats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      return;
    }

    const nextProject = projects[0]?.name ?? DEFAULT_PROJECT;
    const nextChat = chats.find((chat) => !chat.archived) ?? createEmptyChat(nextProject);

    if (!chats.some((chat) => chat.id === nextChat.id)) {
      setChats([nextChat]);
    }

    setActiveChatId(nextChat.id);
  }, [activeChatId, chats, projects]);

  const activeChat =
    chats.find((chat) => chat.id === activeChatId && !chat.archived) ??
    chats.find((chat) => !chat.archived) ??
    createEmptyChat(projects[0]?.name ?? DEFAULT_PROJECT);

  useEffect(() => {
    const projectWorkspace = projects.find((project) => project.name.toLowerCase() === activeChat.project.toLowerCase())?.localWorkspace;

    if (projectWorkspace && !sameLocalWorkspaceSettings(projectWorkspace, localWorkspace)) {
      setLocalWorkspace(projectWorkspace);
    }
  }, [activeChat.project, localWorkspace, projects]);

  function handleNewChat(project = activeChat.project || DEFAULT_PROJECT) {
    const nextChat = createEmptyChat(project);

    restoreProjectLocalWorkspace(project);
    setChats((currentChats) => sortChatsByUpdatedAt([nextChat, ...currentChats]));
    touchProject(project);
    setActiveChatId(nextChat.id);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

  function handleSelectChat(chatId: string) {
    const selectedChat = chats.find((chat) => chat.id === chatId);

    if (selectedChat) {
      restoreProjectLocalWorkspace(selectedChat.project);
    }

    setActiveChatId(chatId);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

  function handleSelectProject(project: string) {
    const projectChat = sortChatsByUpdatedAt(chats).find((chat) => !chat.archived && chat.project === project);

    if (projectChat) {
      handleSelectChat(projectChat.id);
      return;
    }

    handleNewChat(project);
  }

  function openCreateProjectDialog() {
    setSearchOpen(false);
    setProjectNameDraft("");
    setProjectNameError(null);
    setProjectDialogOpen(true);
  }

  function closeCreateProjectDialog() {
    setProjectDialogOpen(false);
    setProjectNameDraft("");
    setProjectNameError(null);
  }

  function confirmCreateProject() {
    const projectName = projectNameDraft.trim();

    if (!projectName) {
      setProjectNameError("Enter a project name.");
      return;
    }

    const existingProject = projects.find((project) => project.name.toLowerCase() === projectName.toLowerCase());

    if (existingProject) {
      setProjectNameError("A project with this name already exists.");
      return;
    }

    const now = new Date().toISOString();
    const nextProject: ProjectSummary = {
      createdAt: now,
      id: createId("project"),
      name: projectName,
      updatedAt: now,
    };
    const nextChat = createEmptyChat(projectName);

    setProjects((currentProjects) => sortProjectsByUpdatedAt([nextProject, ...currentProjects]));
    setChats((currentChats) => sortChatsByUpdatedAt([nextChat, ...currentChats]));
    setActiveChatId(nextChat.id);
    setActiveRoute("chat");
    setSearchOpen(false);
    closeCreateProjectDialog();
  }

  function handleLocalWorkspaceChange(nextWorkspace: LocalWorkspaceSettings) {
    setLocalWorkspace(nextWorkspace);
    saveWorkspaceForProject(activeChat.project, nextWorkspace);
  }

  function handleToolSettingsChange(nextSettings: ToolRegistrySettings) {
    setProviderSettings((settings) => ({
      ...settings,
      tools: normalizeToolRegistrySettings(nextSettings),
    }));
  }

  function handleToggleTerminal() {
    if (!toolSettings.terminal) {
      return;
    }

    setTerminalOpen((open) => !open);
  }

  function handleTogglePin(chatId: string) {
    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === chatId
            ? {
                ...chat,
                pinned: !chat.pinned,
                updatedAt: new Date().toISOString(),
              }
            : chat,
        ),
      ),
    );
  }

  function touchProject(projectName: string) {
    const now = new Date().toISOString();

    setProjects((currentProjects) => {
      const projectExists = currentProjects.some((project) => project.name.toLowerCase() === projectName.toLowerCase());

      if (!projectExists) {
        return sortProjectsByUpdatedAt([
          {
            createdAt: now,
            id: createId("project"),
            name: projectName,
            updatedAt: now,
          },
          ...currentProjects,
        ]);
      }

      return sortProjectsByUpdatedAt(
        currentProjects.map((project) =>
          project.name.toLowerCase() === projectName.toLowerCase()
            ? {
                ...project,
                updatedAt: now,
              }
            : project,
        ),
      );
    });
  }

  function restoreProjectLocalWorkspace(projectName: string) {
    const projectWorkspace = projects.find((project) => project.name.toLowerCase() === projectName.toLowerCase())?.localWorkspace;

    if (projectWorkspace) {
      setLocalWorkspace(projectWorkspace);
    }
  }

  function saveWorkspaceForProject(projectName: string, nextWorkspace: LocalWorkspaceSettings) {
    const now = new Date().toISOString();

    setProjects((currentProjects) => {
      const projectExists = currentProjects.some((project) => project.name.toLowerCase() === projectName.toLowerCase());

      if (!projectExists) {
        return sortProjectsByUpdatedAt([
          {
            createdAt: now,
            id: createId("project"),
            localWorkspace: nextWorkspace,
            name: projectName,
            updatedAt: now,
          },
          ...currentProjects,
        ]);
      }

      return sortProjectsByUpdatedAt(
        currentProjects.map((project) =>
          project.name.toLowerCase() === projectName.toLowerCase()
            ? {
                ...project,
                localWorkspace: nextWorkspace,
                updatedAt: now,
              }
            : project,
        ),
      );
    });
  }

  function handleDeleteChat(chatId: string) {
    const chatToDelete = chats.find((chat) => chat.id === chatId);

    if (!chatToDelete) {
      return;
    }

    if (chatId === sendingChatId) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the chat from the sidebar menu.",
        title: "Chat is still responding",
      });
      return;
    }

    setPendingDeleteChatId(chatId);
  }

  function confirmDeleteChat() {
    const chatToDelete = chats.find((chat) => chat.id === pendingDeleteChatId);

    if (!chatToDelete) {
      setPendingDeleteChatId(null);
      return;
    }

    if (chatToDelete.id === sendingChatId) {
      setPendingDeleteChatId(null);
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the chat from the sidebar menu.",
        title: "Chat is still responding",
      });
      return;
    }

    const nextChats = sortChatsByUpdatedAt(chats.filter((chat) => chat.id !== chatToDelete.id));

    if (chatToDelete.id === activeChatId) {
      const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(chatToDelete.project || projects[0]?.name || DEFAULT_PROJECT);

      if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
        nextChats.unshift(nextActiveChat);
      }

      setActiveChatId(nextActiveChat.id);
    }

    setChats(nextChats);
    setPendingDeleteChatId(null);
  }

  function createActiveGeneration(previousChat: ChatSummary, previousChatExisted: boolean, restoreDraft?: ChatComposerDraft) {
    const requestId = activeSendRef.current + 1;
    const controller = new AbortController();

    activeSendRef.current = requestId;
    sendingRequestRef.current = requestId;
    activeGenerationRef.current = {
      controller,
      previousChat,
      previousChatExisted,
      requestId,
      restoreDraft,
    };

    return { controller, requestId };
  }

  function isRequestInactive(requestId: number, controller: AbortController) {
    return controller.signal.aborted || sendingRequestRef.current !== requestId;
  }

  function finishActiveGeneration(requestId: number) {
    if (sendingRequestRef.current === requestId) {
      sendingRequestRef.current = null;
      activeGenerationRef.current = null;
      setSendingChatId(null);
    }
  }

  function handleStopGeneration() {
    const activeGeneration = activeGenerationRef.current;

    if (!activeGeneration) {
      return;
    }

    activeGeneration.controller.abort();

    if (activeGeneration.restoreDraft) {
      setComposerDraftToRestore(activeGeneration.restoreDraft);
    }

    restoreChatSnapshot(activeGeneration.previousChat, activeGeneration.previousChatExisted);

    if (sendingRequestRef.current === activeGeneration.requestId) {
      sendingRequestRef.current = null;
    }

    activeGenerationRef.current = null;
    setSendingChatId(null);
  }

  function restoreChatSnapshot(chatSnapshot: ChatSummary, existed: boolean) {
    setChats((currentChats) => {
      const otherChats = currentChats.filter((chat) => chat.id !== chatSnapshot.id);

      return sortChatsByUpdatedAt(existed ? [chatSnapshot, ...otherChats] : otherChats);
    });
  }

  async function createMessagesForProvider(
    existingMessages: ChatMessage[],
    userMessage: ChatMessage,
    workspaceSettings: LocalWorkspaceSettings,
    prompt: string,
    webContextMessages: ChatMessage[] = [],
  ) {
    const visibleMessages = existingMessages.filter((message) => message.status !== "error");
    const localContextMessages = await createLocalWorkspaceContextMessages(workspaceSettings, prompt);

    return compactProviderMessagesIfNeeded([...visibleMessages, ...localContextMessages, ...webContextMessages, userMessage]);
  }

  async function createLocalWorkspaceContextMessages(workspaceSettings: LocalWorkspaceSettings, prompt: string) {
    if (!workspaceSettings.enabled || !hasAnyLocalWorkspaceToolEnabled()) {
      return [];
    }

    try {
      const localContext = await createLocalWorkspaceContext(workspaceSettings, prompt, toolSettings);
      void syncLocalWorkspaceIndexSummary(workspaceSettings);
      return localContext.trim() ? [createMessage("user", localContext)] : [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Local computer file tool failed.";
      return [createMessage("user", `LOCAL COMPUTER FILE TOOL\nTool note: ${detail}\nContinue honestly and ask me to adjust local workspace access if needed.`)];
    }
  }

  function hasAnyLocalWorkspaceToolEnabled() {
    return toolSettings.fileBrowser || toolSettings.fileSearch || toolSettings.codeView || toolSettings.codeEdit;
  }

  async function syncLocalWorkspaceIndexSummary(workspaceSettings: LocalWorkspaceSettings) {
    try {
      const [roots, summary] = await Promise.all([resolveLocalWorkspaceRoots(workspaceSettings), getComputerFileIndexSummary()]);

      if (summary.entryCount <= 0 || !samePathSet(summary.roots, roots)) {
        return;
      }

      const nextWorkspace = {
        ...workspaceSettings,
        indexReason: undefined,
        indexSummary: summary,
        indexStatus: "idle" as const,
        indexUpdatedAt: new Date().toISOString(),
        lastError: undefined,
        roots: workspaceSettings.roots.length > 0 ? workspaceSettings.roots : roots,
      };

      setLocalWorkspace(nextWorkspace);
      saveWorkspaceForProject(activeChat.project, nextWorkspace);
    } catch {
      return;
    }
  }

  function compactProviderMessagesIfNeeded(messages: ChatMessage[], settingsOverride?: ProviderSettings, options: { target?: number; threshold?: number } = {}) {
    const effectiveSettings = createToolAwareProviderSettings(settingsOverride);
    const compaction = compactMessagesForContext({
      contextWindowTokens: contextWindow.tokens,
      maxOutputTokens: effectiveSettings.maxTokens,
      messages,
      model: effectiveSettings.model,
      source: contextWindow.source,
      systemPrompt: effectiveSettings.systemPrompt,
      target: options.target,
      threshold: options.threshold ?? AUTO_COMPACT_CONTEXT_THRESHOLD,
      usageEstimator: (candidateMessages) =>
        estimateOpenRouterProviderContextUsage({
          contextWindowTokens: contextWindow.tokens,
          messages: candidateMessages,
          settings: effectiveSettings,
          source: contextWindow.source,
        }),
    });

    return compaction.messages;
  }

  function recordProviderContextUsage(chatId: string, messages: ChatMessage[], settings: ProviderSettings) {
    setLastProviderContextUsage({
      chatId,
      usage: estimateProviderContextUsageForDisplay(messages, settings),
    });
  }

  function recordOpenRouterActualUsage(chatId: string, messages: ChatMessage[], settings: ProviderSettings, usage: Awaited<ReturnType<typeof streamOpenRouterMessage>>["usage"]) {
    setLastProviderContextUsage({
      chatId,
      usage: applyOpenRouterUsageToContextEstimate(estimateProviderContextUsageForDisplay(messages, settings), usage),
    });
  }

  function estimateProviderContextUsageForDisplay(messages: ChatMessage[], settings: ProviderSettings) {
    return estimateOpenRouterProviderContextUsage({
      contextWindowTokens: contextWindow.tokens,
      messages,
      settings,
      source: contextWindow.source,
    });
  }

  function createToolAwareProviderSettings(overrides: Partial<ProviderSettings> = {}): ProviderSettings {
    const mergedSettings = {
      ...providerSettings,
      ...overrides,
      thinking: {
        ...providerSettings.thinking,
        ...overrides.thinking,
      },
      tools: normalizeToolRegistrySettings(overrides.tools ?? providerSettings.tools),
    };

    return {
      ...mergedSettings,
      thinking: {
        ...mergedSettings.thinking,
        enabled: mergedSettings.tools.thinking && mergedSettings.thinking.enabled,
      },
    };
  }

  async function streamAssistantWithLocalTools({
    chatId,
    controller,
    messageId,
    messagesForProvider,
    prompt,
    requestId,
    workspaceSettings,
  }: {
    chatId: string;
    controller: AbortController;
    messageId: string;
    messagesForProvider: ChatMessage[];
    prompt: string;
    requestId: number;
    workspaceSettings: LocalWorkspaceSettings;
  }) {
    let messages = messagesForProvider;
    let localProgress: ChatProgressItem | undefined;
    let finalResponse: { content: string; progress?: ChatProgressItem; reasoning?: string; toolCalls?: ChatToolCall[] } = {
      content: "",
      reasoning: undefined,
      toolCalls: undefined,
    };

    let totalExecutedToolCalls = 0;
    let allToolCalls: ChatToolCall[] = [];

    let passIndex = 0;

    while (!isRequestInactive(requestId, controller)) {
      const passSettings: ProviderSettings = localProgress
        ? {
            ...createToolAwareProviderSettings(),
            maxTokens: Math.max(providerSettings.maxTokens, LOCAL_TOOL_FINAL_MIN_TOKENS),
          }
        : createToolAwareProviderSettings();
      messages = compactProviderMessagesIfNeeded(messages, passSettings);
      const assistantResponse = await streamOpenRouterMessageWithRetry(
        chatId,
        passSettings,
        messages,
        (snapshot) => {
          if (isRequestInactive(requestId, controller)) {
            return;
          }

          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: sanitizeLocalToolCallsForDisplay(snapshot.content),
            progress: localProgress ? withLocalComputerProgress(localProgress, message.progress) : message.progress,
            reasoning: snapshot.reasoning,
            thinking:
              message.thinking && snapshot.content && !message.thinking.completedAt
                ? {
                    ...message.thinking,
                    completedAt: new Date().toISOString(),
                  }
                : message.thinking,
          }));
        },
        {
          signal: controller.signal,
        },
      );

      finalResponse = {
        content: sanitizeLocalToolCallsForDisplay(assistantResponse.content),
        reasoning: assistantResponse.reasoning,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };

      if (isRequestInactive(requestId, controller)) {
        return {
          ...finalResponse,
          progress: localProgress,
        };
      }

      if (!hasLocalComputerToolCalls(assistantResponse.content)) {
        if (localProgress && looksLikeOnlyToolPrelude(finalResponse.content)) {
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "Writing final answer from local tool results...",
            progress: withLocalComputerProgress(localProgress, message.progress),
            toolCalls: allToolCalls,
          }));
          messages = [
            ...messages,
            createMessage("assistant", assistantResponse.content),
            createMessage("user", createLocalToolFinalInstruction(prompt)),
          ];
          passIndex += 1;
          continue;
        }

        return {
          ...finalResponse,
          progress: localProgress,
        };
      }

      const activeProgress = createLocalComputerProgress("active", "Running requested agent tools");
      const activeToolCalls = createActiveLocalToolCalls(assistantResponse.content, passIndex);

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "Using agent tools...",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? [...allToolCalls, ...activeToolCalls] : message.toolCalls,
      }));

      const toolRun = await runLocalComputerToolCalls({
        assistantContent: assistantResponse.content,
        settings: workspaceSettings,
        toolSettings,
        userPrompt: prompt,
        webSearchMaxResults: providerSettings.webSearch.maxResults,
      });

      totalExecutedToolCalls += toolRun.executedCount;
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, passIndex);
      allToolCalls = [...allToolCalls, ...completedToolCalls];
      localProgress = createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.toolCalls = allToolCalls;

      if (toolRun.requestedCount === 0) {
        return {
          ...finalResponse,
          progress: localProgress,
        };
      }

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "Reading tool results...",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));

      messages = [...messages, createMessage("assistant", assistantResponse.content), createMessage("user", toolRun.contextMessage)];

      passIndex += 1;
    }

    return {
      ...finalResponse,
      progress: localProgress,
    };
  }

  async function streamOpenRouterMessageWithRetry(
    chatId: string,
    settings: ProviderSettings,
    messages: ChatMessage[],
    onUpdate: Parameters<typeof streamOpenRouterMessage>[2],
    options: Parameters<typeof streamOpenRouterMessage>[3] = {},
  ) {
    recordProviderContextUsage(chatId, messages, settings);

    try {
      const response = await streamOpenRouterMessage(settings, messages, onUpdate, options);
      recordOpenRouterActualUsage(chatId, messages, settings, response.usage);
      return response;
    } catch (error) {
      if (!isOpenRouterEmptyResponseError(error) || options.signal?.aborted) {
        throw error;
      }

      const retrySettings = createEmptyResponseRetrySettings(settings);
      const compactedMessages = compactProviderMessagesIfNeeded(messages, retrySettings, {
        target: 0.5,
        threshold: 0,
      });
      const retryInstruction = createMessage(
        "user",
        [
          "RETRY AFTER EMPTY OPENROUTER RESPONSE",
          "The previous stream returned reasoning or transport activity but no final answer text.",
          "Answer the latest real user request above now. Keep hidden reasoning brief and produce visible final text.",
        ].join("\n\n"),
      );
      const retryMessages = [...compactedMessages, retryInstruction];

      recordProviderContextUsage(chatId, retryMessages, retrySettings);

      const response = await streamOpenRouterMessage(retrySettings, retryMessages, onUpdate, options);
      recordOpenRouterActualUsage(chatId, retryMessages, retrySettings, response.usage);
      return response;
    }
  }

  function createEmptyResponseRetrySettings(settings: ProviderSettings): ProviderSettings {
    if (!settings.thinking.enabled) {
      return settings;
    }

    return {
      ...settings,
      temperature: Math.min(settings.temperature, 0.25),
      thinking: {
        ...settings.thinking,
        effort: "low",
      },
    };
  }

  function updateGeneratedMessage(chatId: string, messageId: string, updateMessage: (message: ChatMessage) => ChatMessage, sortByUpdatedAt = false) {
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: chat.messages.map((message) => (message.id === messageId ? updateMessage(message) : message)),
              updatedAt: sortByUpdatedAt ? new Date().toISOString() : chat.updatedAt,
            }
          : chat,
      );

      return sortByUpdatedAt ? sortChatsByUpdatedAt(nextChats) : nextChats;
    });
  }

  async function prepareWebSearchForGeneration({
    chatId,
    controller,
    maxResults,
    messageId,
    query,
    requestId,
  }: {
    chatId: string;
    controller: AbortController;
    maxResults: number;
    messageId: string;
    query: string;
    requestId: number;
  }): Promise<{ contextMessages: ChatMessage[]; sources: ChatSource[] }> {
    const activeWebSearch: ChatWebSearch = {
      enabled: true,
      maxResults,
      provider: "duckduckgo",
      query,
      status: "active",
    };

    updateGeneratedMessage(chatId, messageId, (message) => ({
      ...message,
      progress: withWebSearchProgress(activeWebSearch, message.progress),
      webSearch: activeWebSearch,
    }));

    try {
      const results = await searchDuckDuckGo(query, {
        maxResults,
        signal: controller.signal,
      });

      if (isRequestInactive(requestId, controller)) {
        return {
          contextMessages: [],
          sources: [],
        };
      }

      const sources = createChatSourcesFromWebResults(results);
      if (sources.length === 0) {
        throw new Error("DuckDuckGo returned no usable sources.");
      }
      const completedWebSearch: ChatWebSearch = {
        ...activeWebSearch,
        resultCount: sources.length,
        searchedAt: new Date().toISOString(),
        status: "complete",
      };

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        progress: withWebSearchProgress(completedWebSearch, message.progress),
        sources: sources.length > 0 ? sources : undefined,
        webSearch: completedWebSearch,
      }));

      return {
        contextMessages: createWebSearchContextMessage(query, sources),
        sources,
      };
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return {
          contextMessages: [],
          sources: [],
        };
      }

      const detail = error instanceof Error ? error.message : "DuckDuckGo search failed.";
      const failedWebSearch: ChatWebSearch = {
        ...activeWebSearch,
        error: detail,
        resultCount: 0,
        searchedAt: new Date().toISOString(),
        status: "error",
      };

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        progress: withWebSearchProgress(failedWebSearch, message.progress),
        webSearch: failedWebSearch,
      }));

      return {
        contextMessages: createWebSearchContextMessage(query, [], detail),
        sources: [],
      };
    }
  }

  function completeWebSearchUnavailable(chatId: string, messageId: string, query: string) {
    updateGeneratedMessage(
      chatId,
      messageId,
      (message) => {
        const detail = message.webSearch?.error || "DuckDuckGo returned no usable sources.";
        const completedAt = new Date().toISOString();

        return {
          ...message,
          content: [
            `DuckDuckGo web search did not return usable sources for "${query}", so I did not answer from memory.`,
            detail,
          ].join("\n\n"),
          isStreaming: false,
          planning: message.planning
            ? {
                ...message.planning,
                completedAt,
              }
            : undefined,
          progress: withWebSearchProgress(message.webSearch, message.progress),
          reasoning: undefined,
          status: "error",
          thinking: message.thinking
            ? {
                ...message.thinking,
                completedAt: message.thinking.completedAt ?? completedAt,
              }
            : undefined,
        };
      },
      true,
    );
  }

  function createStoredWebSearchContext(message: ChatMessage, fallbackQuery: string) {
    if (!message.webSearch?.enabled) {
      return [];
    }

    return createWebSearchContextMessage(message.webSearch.query || fallbackQuery, message.sources ?? [], message.webSearch.error);
  }

  async function handleSendMessage(input: ChatSendInput) {
    if (sendingRequestRef.current !== null) {
      return;
    }

    const content = input.content.trim();
    const attachments = input.attachments;

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Toolbox before sending a chat request.",
        title: "Model Provider is off",
      });
      return;
    }

    const isPlanningMode = toolSettings.planning && input.mode === "plan";
    const planningMaxPasses = clampPlanningPasses(input.planning?.maxPasses ?? 10);
    const webSearchEnabled = Boolean(toolSettings.webSearch && input.webSearch?.enabled && content);
    const webSearchMaxResults = Math.min(input.webSearch?.maxResults ?? providerSettings.webSearch.maxResults, MAX_WEB_SEARCH_RESULTS);
    const currentChat = activeChat ?? createEmptyChat(DEFAULT_PROJECT);
    const currentChatExisted = chats.some((chat) => chat.id === currentChat.id);
    const restoreDraft: ChatComposerDraft = { attachments, content };
    const { controller, requestId } = createActiveGeneration(currentChat, currentChatExisted, restoreDraft);
    const now = new Date().toISOString();
    const userMessage = createMessage("user", content, undefined, undefined, attachments);
    const initialWebSearch: ChatWebSearch | undefined = webSearchEnabled
      ? {
          enabled: true,
          maxResults: webSearchMaxResults,
          provider: "duckduckgo",
          query: content,
          status: "active",
        }
      : undefined;
    const assistantMessage: ChatMessage = {
      ...createMessage("assistant", ""),
      isStreaming: true,
      mode: isPlanningMode ? "plan" : "chat",
      planning: isPlanningMode
        ? {
            maxPasses: planningMaxPasses,
            passCount: 0,
            startedAt: now,
          }
        : undefined,
      progress: withWebSearchProgress(initialWebSearch, isPlanningMode ? createPlanningProgress(0, planningMaxPasses, "input") : undefined),
      thinking: toolSettings.thinking && (isPlanningMode || providerSettings.thinking.enabled)
        ? {
            effort: isPlanningMode ? "high" : providerSettings.thinking.effort,
            startedAt: now,
          }
        : undefined,
      webSearch: initialWebSearch,
    };
    const workspaceSettings = input.localWorkspace ?? localWorkspace;

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setSendingChatId(currentChat.id);

    setChats((currentChats) => {
      const hasCurrentChat = currentChats.some((chat) => chat.id === currentChat.id);
      const updatedChat: ChatSummary = {
        ...currentChat,
        messages: [...currentChat.messages, userMessage, assistantMessage],
        title: currentChat.messages.length === 0 ? titleFromMessage(content, attachments) : currentChat.title,
        updatedAt: now,
      };

      const nextChats = hasCurrentChat ? currentChats.map((chat) => (chat.id === currentChat.id ? updatedChat : chat)) : [updatedChat, ...currentChats];

      return sortChatsByUpdatedAt(nextChats);
    });
    touchProject(currentChat.project);

    try {
      const webContext = webSearchEnabled
        ? await prepareWebSearchForGeneration({
            chatId: currentChat.id,
            controller,
            maxResults: webSearchMaxResults,
            messageId: assistantMessage.id,
            query: content,
            requestId,
          })
        : {
            contextMessages: [],
            sources: [],
          };

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      if (webSearchEnabled && webContext.sources.length === 0) {
        completeWebSearchUnavailable(currentChat.id, assistantMessage.id, content);
        touchProject(currentChat.project);
        return;
      }

      const messagesForProvider = await createMessagesForProvider(currentChat.messages, userMessage, workspaceSettings, content, webContext.contextMessages);

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      if (isPlanningMode) {
        const inputRequest = await createPlanningInputRequest(createToolAwareProviderSettings(), messagesForProvider, {
          signal: controller.signal,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        if (inputRequest) {
          setChats((currentChats) =>
            sortChatsByUpdatedAt(
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? {
                              ...message,
                              isStreaming: false,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    inputRequest,
                                    inputRequests: [inputRequest],
                                  }
                                : undefined,
                              progress: withWebSearchProgress(message.webSearch, createPlanningProgress(0, planningMaxPasses, "input")),
                              reasoning: inputRequest.detail || inputRequest.title,
                            }
                          : message,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : chat,
              ),
            ),
          );
          touchProject(currentChat.project);
          return;
        }

        const assistantResponse = await runPlanningMode({
          maxPasses: planningMaxPasses,
          messages: messagesForProvider,
          signal: controller.signal,
          settings: createToolAwareProviderSettings(),
          onUpdate: (snapshot) => {
            if (isRequestInactive(requestId, controller)) {
              return;
            }

            setChats((currentChats) =>
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? {
                              ...message,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    passCount: snapshot.passCount,
                                  }
                                : undefined,
                              progress: withWebSearchProgress(message.webSearch, snapshot.progress),
                              reasoning: snapshot.trace,
                            }
                          : message,
                      ),
                    }
                  : chat,
              ),
            );
          },
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === assistantMessage.id
                        ? {
                            ...message,
                            content: assistantResponse.content,
                            isStreaming: false,
                            planning: message.planning
                              ? {
                                  ...message.planning,
                                  completedAt: new Date().toISOString(),
                                  passCount: assistantResponse.passCount,
                                }
                              : undefined,
                            progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                            reasoning: assistantResponse.trace,
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          }
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
      } else {
        const assistantResponse = await streamAssistantWithLocalTools({
          chatId: currentChat.id,
          controller,
          messageId: assistantMessage.id,
          messagesForProvider,
          prompt: content,
          requestId,
          workspaceSettings,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === assistantMessage.id
                        ? {
                            ...message,
                            content: assistantResponse.content,
                            isStreaming: false,
                            progress: withLocalComputerProgress(assistantResponse.progress, message.progress),
                            reasoning: assistantResponse.reasoning,
                            toolCalls: assistantResponse.toolCalls ?? message.toolCalls,
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          }
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
      }
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The OpenRouter request failed.";

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? {
                          ...message,
                          content: errorContent,
                          isStreaming: false,
                          reasoning: undefined,
                          status: "error",
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  async function handleSubmitPlanningInput(messageId: string, answers: ChatPlanningInputAnswer[]) {
    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Toolbox before continuing a planning run.",
        title: "Model Provider is off",
      });
      return;
    }

    if (sendingRequestRef.current !== null) {
      return;
    }

    const currentChat = activeChat;
    const assistantMessageIndex = currentChat.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
    const assistantMessage = assistantMessageIndex >= 0 ? currentChat.messages[assistantMessageIndex] : undefined;
    const inputRequest = getPendingPlanningInputRequest(assistantMessage?.planning);

    if (!assistantMessage || !inputRequest) {
      return;
    }

    const planningMaxPasses = clampPlanningPasses(assistantMessage.planning?.maxPasses ?? DEFAULT_PLANNING_MAX_PASSES);
    const { controller, requestId } = createActiveGeneration(currentChat, true);
    const now = new Date().toISOString();
    const planningInputRequests = getPlanningInputRequests(assistantMessage.planning);
    const answeredInputRequests = markPlanningInputAnswered(planningInputRequests, inputRequest.id, answers, now);
    const webContextMessages = createStoredWebSearchContext(assistantMessage, getLatestUserPrompt(currentChat.messages.slice(0, assistantMessageIndex)));
    const messagesForProvider = compactProviderMessagesIfNeeded([
      ...currentChat.messages.slice(0, assistantMessageIndex).filter((message) => message.status !== "error"),
      ...webContextMessages,
      ...createPlanningAnswerMessages(answeredInputRequests),
    ]);

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setSendingChatId(currentChat.id);

    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.id === currentChat.id
          ? {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      isStreaming: true,
                      planning: message.planning
                        ? {
                            ...message.planning,
                            inputRequest: {
                              ...inputRequest,
                              answeredAt: now,
                              answers,
                            },
                            inputRequests: answeredInputRequests,
                          }
                        : undefined,
                      progress: withWebSearchProgress(message.webSearch, createPlanningProgress(1, planningMaxPasses, "active")),
                      reasoning: undefined,
                      status: undefined,
                    }
                  : message,
              ),
              updatedAt: now,
            }
          : chat,
      ),
    );

    try {
      if (answeredInputRequests.length < MAX_PLANNING_INPUT_ROUNDS) {
        const followUpInputRequest = await createPlanningInputRequest(createToolAwareProviderSettings(), messagesForProvider, {
          signal: controller.signal,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        if (followUpInputRequest) {
          setChats((currentChats) =>
            sortChatsByUpdatedAt(
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === messageId
                          ? {
                              ...message,
                              isStreaming: false,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    inputRequest: followUpInputRequest,
                                    inputRequests: [...answeredInputRequests, followUpInputRequest],
                                  }
                                : undefined,
                              progress: withWebSearchProgress(message.webSearch, createPlanningProgress(0, planningMaxPasses, "input")),
                              reasoning: followUpInputRequest.detail || followUpInputRequest.title,
                            }
                          : message,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : chat,
              ),
            ),
          );
          touchProject(currentChat.project);
          return;
        }
      }

      const assistantResponse = await runPlanningMode({
        maxPasses: planningMaxPasses,
        messages: messagesForProvider,
        signal: controller.signal,
        settings: createToolAwareProviderSettings(),
        onUpdate: (snapshot) => {
          if (isRequestInactive(requestId, controller)) {
            return;
          }

          setChats((currentChats) =>
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === messageId
                        ? {
                            ...message,
                            planning: message.planning
                              ? {
                                  ...message.planning,
                                  passCount: snapshot.passCount,
                                }
                              : undefined,
                            progress: withWebSearchProgress(message.webSearch, snapshot.progress),
                            reasoning: snapshot.trace,
                          }
                        : message,
                    ),
                  }
                : chat,
            ),
          );
        },
      });

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === messageId
                      ? {
                          ...message,
                          content: assistantResponse.content,
                          isStreaming: false,
                          planning: message.planning
                            ? {
                                ...message.planning,
                                completedAt: new Date().toISOString(),
                                passCount: assistantResponse.passCount,
                              }
                            : undefined,
                          progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                          reasoning: assistantResponse.trace,
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The planning request failed.";

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === messageId
                      ? {
                          ...message,
                          content: errorContent,
                          isStreaming: false,
                          reasoning: undefined,
                          status: "error",
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  async function handleRegenerateResponse(messageId: string) {
    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Toolbox before regenerating a response.",
        title: "Model Provider is off",
      });
      return;
    }

    if (sendingRequestRef.current !== null) {
      return;
    }

    const currentChat = activeChat;
    const assistantMessageIndex = currentChat.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
    const assistantMessage = assistantMessageIndex >= 0 ? currentChat.messages[assistantMessageIndex] : undefined;

    if (!assistantMessage || assistantMessage.isStreaming) {
      return;
    }

    const priorMessages = currentChat.messages.slice(0, assistantMessageIndex);
    const hasUserContext = priorMessages.some((message) => message.role === "user");

    if (!hasUserContext) {
      return;
    }

    const isPlanningMode = toolSettings.planning && (assistantMessage.mode === "plan" || Boolean(assistantMessage.planning));
    const planningMaxPasses = clampPlanningPasses(assistantMessage.planning?.maxPasses ?? DEFAULT_PLANNING_MAX_PASSES);
    const answeredPlanningInputRequests = getPlanningInputRequests(assistantMessage.planning).filter((request) => request.answeredAt && request.answers?.length);
    const regeneratePrompt = getLatestUserPrompt(priorMessages);
    const webSearchEnabled = Boolean(toolSettings.webSearch && (assistantMessage.webSearch?.enabled ?? providerSettings.webSearch.enabled) && regeneratePrompt);
    const webSearchMaxResults = Math.min(assistantMessage.webSearch?.maxResults ?? providerSettings.webSearch.maxResults, MAX_WEB_SEARCH_RESULTS);
    const { controller, requestId } = createActiveGeneration(currentChat, true);
    const now = new Date().toISOString();
    const initialWebSearch: ChatWebSearch | undefined = webSearchEnabled
      ? {
          enabled: true,
          maxResults: webSearchMaxResults,
          provider: "duckduckgo",
          query: regeneratePrompt,
          status: "active",
        }
      : undefined;
    const regeneratedAssistantMessage: ChatMessage = {
      ...assistantMessage,
      artifacts: undefined,
      content: "",
      createdAt: now,
      isStreaming: true,
      mode: isPlanningMode ? "plan" : "chat",
      planning: isPlanningMode
        ? {
            inputRequest: answeredPlanningInputRequests[answeredPlanningInputRequests.length - 1],
            inputRequests: answeredPlanningInputRequests,
            maxPasses: planningMaxPasses,
            passCount: 0,
            startedAt: now,
          }
        : undefined,
      progress: withWebSearchProgress(initialWebSearch, isPlanningMode ? createPlanningProgress(1, planningMaxPasses, "active") : undefined),
      reasoning: undefined,
      sources: undefined,
      status: undefined,
      thinking: toolSettings.thinking && (isPlanningMode || providerSettings.thinking.enabled)
        ? {
            effort: isPlanningMode ? "high" : providerSettings.thinking.effort,
            startedAt: now,
          }
        : undefined,
      webSearch: initialWebSearch,
    };

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setSendingChatId(currentChat.id);
    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === currentChat.id
            ? {
                ...chat,
                messages: [...currentChat.messages.slice(0, assistantMessageIndex), regeneratedAssistantMessage],
                updatedAt: now,
              }
            : chat,
        ),
      ),
    );

    try {
      const webContext = webSearchEnabled
        ? await prepareWebSearchForGeneration({
            chatId: currentChat.id,
            controller,
            maxResults: webSearchMaxResults,
            messageId,
            query: regeneratePrompt,
            requestId,
          })
        : {
            contextMessages: [],
            sources: [],
          };

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      if (webSearchEnabled && webContext.sources.length === 0) {
        completeWebSearchUnavailable(currentChat.id, messageId, regeneratePrompt);
        touchProject(currentChat.project);
        return;
      }

      const localContextMessages = await createLocalWorkspaceContextMessages(localWorkspace, regeneratePrompt);
      const messagesForProvider = compactProviderMessagesIfNeeded([
        ...priorMessages.filter((message) => message.status !== "error"),
        ...localContextMessages,
        ...webContext.contextMessages,
        ...createPlanningAnswerMessages(answeredPlanningInputRequests),
      ]);

      if (isPlanningMode) {
        const assistantResponse = await runPlanningMode({
          maxPasses: planningMaxPasses,
          messages: messagesForProvider,
          signal: controller.signal,
          settings: createToolAwareProviderSettings(),
          onUpdate: (snapshot) => {
            if (isRequestInactive(requestId, controller)) {
              return;
            }

            setChats((currentChats) =>
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === messageId
                          ? {
                              ...message,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    passCount: snapshot.passCount,
                                  }
                                : undefined,
                              progress: withWebSearchProgress(message.webSearch, snapshot.progress),
                              reasoning: snapshot.trace,
                            }
                          : message,
                      ),
                    }
                  : chat,
              ),
            );
          },
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === messageId
                        ? {
                            ...message,
                            content: assistantResponse.content,
                            isStreaming: false,
                            planning: message.planning
                              ? {
                                  ...message.planning,
                                  completedAt: new Date().toISOString(),
                                  passCount: assistantResponse.passCount,
                                }
                              : undefined,
                            progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                            reasoning: assistantResponse.trace,
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          }
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
      } else {
        const assistantResponse = await streamAssistantWithLocalTools({
          chatId: currentChat.id,
          controller,
          messageId,
          messagesForProvider,
          prompt: regeneratePrompt,
          requestId,
          workspaceSettings: localWorkspace,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === messageId
                        ? {
                            ...message,
                            content: assistantResponse.content,
                            isStreaming: false,
                            progress: withLocalComputerProgress(assistantResponse.progress, message.progress),
                            reasoning: assistantResponse.reasoning,
                            toolCalls: assistantResponse.toolCalls ?? message.toolCalls,
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          }
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
      }
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The regeneration request failed.";

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === messageId
                      ? {
                          ...message,
                          content: errorContent,
                          isStreaming: false,
                          reasoning: undefined,
                          status: "error",
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  function renderPage() {
    if (activeRoute === "toolbox") {
      return <ToolboxPage settings={toolSettings} onSettingsChange={handleToolSettingsChange} />;
    }

    if (activeRoute === "workflows") {
      return <WorkflowsPage />;
    }

    if (activeRoute === "settings") {
      return (
        <SettingsPage
          appInfo={appInfo}
          appearanceMode={appearanceMode}
          settings={providerSettings}
          onAppearanceModeChange={setAppearanceMode}
          onSettingsChange={setProviderSettings}
        />
      );
    }

    return (
      <ChatPage
        appInfo={appInfo}
        chat={activeChat}
        browserPreviewEnabled={toolSettings.browserPreview}
        composerDraft={composerDraftToRestore}
        contextWindowSource={contextWindow.source}
        contextWindowTokens={contextWindow.tokens}
        hasApiKey={Boolean(providerSettings.openRouterApiKey.trim())}
        isSending={Boolean(sendingChatId)}
        localWorkspace={localWorkspace}
        maxOutputTokens={providerSettings.maxTokens}
        model={providerSettings.model}
        modelContextWindows={modelContextWindows}
        onComposerDraftApplied={() => setComposerDraftToRestore(null)}
        onLocalWorkspaceChange={handleLocalWorkspaceChange}
        onModelChange={(nextModel) => setProviderSettings((settings) => ({ ...settings, model: nextModel }))}
        onRegenerateResponse={handleRegenerateResponse}
        onSendMessage={handleSendMessage}
        onStopGeneration={handleStopGeneration}
        onSubmitPlanningInput={handleSubmitPlanningInput}
        lastProviderContextUsage={lastProviderContextUsage?.chatId === activeChat.id ? lastProviderContextUsage.usage : null}
        providerSettings={createToolAwareProviderSettings()}
        onThinkingChange={(nextThinking) => setProviderSettings((settings) => ({ ...settings, thinking: nextThinking }))}
        onWebSearchChange={(nextWebSearch) => setProviderSettings((settings) => ({ ...settings, webSearch: nextWebSearch }))}
        systemPrompt={providerSettings.systemPrompt}
        thinking={providerSettings.thinking}
        webSearch={providerSettings.webSearch}
        onTogglePin={() => activeChat && handleTogglePin(activeChat.id)}
        onToggleTerminal={handleToggleTerminal}
        terminalEnabled={toolSettings.terminal}
        terminalOpen={terminalOpen}
      />
    );
  }

  const pendingDeleteChat = pendingDeleteChatId ? chats.find((chat) => chat.id === pendingDeleteChatId) : undefined;

  return (
    <>
      <AppShell
        activeChatId={activeChatId}
        activeRoute={activeRoute}
        appInfo={appInfo}
        authUser={authSession.user}
        chats={chats}
        desktopRuntime={isDesktopRuntime}
        projects={projects}
        searchOpen={searchOpen}
        sidebarOpen={sidebarOpen}
        onCreateProject={openCreateProjectDialog}
        onCloseSearch={() => setSearchOpen(false)}
        onDeleteChat={handleDeleteChat}
        onNewChat={handleNewChat}
        onOpenSearch={() => setSearchOpen(true)}
        onLogout={onLogout}
        onRouteChange={setActiveRoute}
        onShowAbout={() => setAboutOpen(true)}
        onCloseTerminal={() => setTerminalOpen(false)}
        onSelectChat={handleSelectChat}
        onSelectProject={handleSelectProject}
        onTerminalHeightChange={setTerminalHeight}
        onToggleTerminal={handleToggleTerminal}
        onTogglePin={handleTogglePin}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        terminalHeight={terminalHeight}
        terminalOpen={terminalOpen}
        terminalWorkingDirectory={localWorkspace.roots[0]}
      >
        {renderPage()}
      </AppShell>

      <TextInputDialog
        confirmLabel="Create project"
        description="Create a project and start its first chat."
        error={projectNameError}
        label="Project name"
        open={projectDialogOpen}
        placeholder="Project name"
        title="New project"
        value={projectNameDraft}
        onChange={(value) => {
          setProjectNameDraft(value);
          setProjectNameError(null);
        }}
        onClose={closeCreateProjectDialog}
        onSubmit={confirmCreateProject}
      />

      <ConfirmDialog
        confirmLabel="Delete chat"
        description="This removes the chat from local history."
        icon={Trash2}
        open={Boolean(pendingDeleteChat)}
        title="Delete chat?"
        tone="danger"
        onClose={() => setPendingDeleteChatId(null)}
        onConfirm={confirmDeleteChat}
      >
        {pendingDeleteChat ? (
          <dl className="dialog-detail-list">
            <div>
              <dt>Chat</dt>
              <dd>{pendingDeleteChat.title}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{pendingDeleteChat.project}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{pendingDeleteChat.messages.length}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>

      <NoticeDialog
        description={noticeDialog?.description}
        open={Boolean(noticeDialog)}
        title={noticeDialog?.title ?? ""}
        onClose={() => setNoticeDialog(null)}
      />

      <NoticeDialog
        buttonLabel="Close"
        description="Desktop agent workspace"
        icon={Info}
        open={aboutOpen}
        title={appInfo.name}
        onClose={() => setAboutOpen(false)}
      >
        <dl className="dialog-detail-list">
          <div>
            <dt>Version</dt>
            <dd>{appInfo.version}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>{appInfo.phase}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{appInfo.runtime}</dd>
          </div>
        </dl>
      </NoticeDialog>
    </>
  );
}
