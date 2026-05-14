import { useEffect, useRef, useState } from "react";
import { Info, Trash2 } from "lucide-react";
import { AuthPage } from "../pages/AuthPage";
import { ConfirmDialog, DialogShell, NoticeDialog, TextInputDialog } from "../components/dialogs/AppDialog";
import { AppShell } from "../components/layout/AppShell";
import { OnboardingDialog } from "../components/onboarding/OnboardingDialog";
import { ChatPage } from "../pages/ChatPage";
import { SettingsPage } from "../pages/settings/SettingsPage";
import type { SettingsSectionId } from "../pages/settings/types";
import { WeatherRadarPage } from "../pages/WeatherRadarPage";
import {
  loadActiveChatId,
  loadAppearanceMode,
  loadChats,
  loadDiscordBridgeSettings,
  loadLocalWorkspaceSettings,
  loadPersistentString,
  loadProjects,
  loadProviderSettings,
  saveActiveChatId,
  saveAppearanceMode,
  saveChats,
  saveDiscordBridgeSettings,
  saveLocalWorkspaceSettings,
  savePersistentString,
  saveProjects,
  saveProviderSettings,
  initializeDeviceStorage,
  setStorageNamespace,
} from "../lib/appStorage";
import {
  createEmptyChat,
  createId,
  createMessage,
  DEFAULT_PROJECT,
  formatChatAge,
  isNoProjectName,
  normalizeProjectName,
  sortChatsByUpdatedAt,
  titleFromMessage,
} from "../lib/chatUtils";
import {
  AUTO_COMPACT_CONTEXT_THRESHOLD,
  compactMessagesForContext,
  formatTokenCount,
  getFallbackContextWindowTokens,
  getFallbackModelContextWindow,
  getFallbackModelContextWindows,
  type ContextCompactionNotice,
  type ContextWindowUsage,
  type ModelContextWindowMap,
} from "../lib/contextWindow";
import { getEffectiveMaxOutputTokens } from "../lib/generationSettings";
import { copyTextToClipboard } from "../lib/clipboard";
import { CHAT_MODEL_OPTIONS, getModelProvider, getProviderApiKey, supportsProviderThinking } from "../lib/models";
import { createPdfLibraryContextMessages, syncPdfLibraryFromChats } from "../lib/pdfLibrary";
import {
  createPlanningInputRequest,
  createPlanningProgress,
  runPlanningMode,
  type PlanningProviderRequest,
} from "../services/planningClient";
import { generateChatTitle } from "../services/chatTitleClient";
import { fetchProviderModelContextLengths, isProviderEmptyResponseError, sendProviderMessage, streamProviderMessage } from "../services/modelProviderClient";
import { applyProviderUsageToContextEstimate, estimateModelProviderPayloadUsage } from "../services/modelProviderUsage";
import { createDefaultToolRegistry, executeToolBridgeCalls } from "../toolBridge";
import type { ProviderToolBridgeOptions, ToolExecutionContext, ToolResultMessage } from "../toolBridge";
import { buildComputerFileIndex, createComputerGitWorktree, createLocalWorkspaceContext, getComputerFileIndexSummary, pickComputerFolder, resolveLocalWorkspaceRoots } from "../localWorkspace/files";
import {
  createLocalComputerProgress,
  createApprovalSessionDecisionKey,
  DEEP_RESEARCH_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  hasLocalComputerToolCalls,
  runLocalComputerToolCalls,
  sanitizeLocalToolCallsForDisplay,
  STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  type LocalComputerToolExecutionPolicy,
  type LocalSubagentResult,
  type LocalSubagentTask,
  routePrimitiveEvidenceBatchToWorkflow,
  serializeToolCallEnvelope,
} from "../localWorkspace/localToolRuntimeDisabled";
import {
  createActiveLocalToolCalls,
  createAssistantToolRequestContent,
  createCompletedToolFallbackSummary,
  createFabricatedToolActivityRecoveryInstruction,
  createFinalAnswerRecoveryInstruction,
  createInterruptedResponseContinuationInstruction,
  createLocalToolBudgetFinalInstruction,
  createLocalToolFinalInstruction,
  createMalformedToolCallRecoveryInstruction,
  createFreshLocalToolEvidenceInstruction,
  createRecoverableLocalEditRetryInstruction,
  createToolActionPromiseRecoveryInstruction,
  createToolProtocolNarrationRecoveryInstruction,
  createPlanningAnswerMessages,
  createSimpleLocalTaskCompletionAnswer,
  getLatestUserPrompt,
  getPendingPlanningInputRequest,
  getPlanningInputRequests,
  detectSimpleLocalTaskCompletion,
  isSimpleLocalScaffoldRequest,
  isEmptySelectedScaffoldProbe,
  isRecoverableLocalEditFailure,
  isAbortError,
  isInterruptedAssistantMessage,
  isToolResultFallbackAnswer,
  looksLikeFabricatedToolActivity,
  looksLikeInternalToolRecoveryAnswer,
  looksLikeOnlyToolPrelude,
  looksLikeToolProtocolNarration,
  looksLikeUnexecutedToolActionPromise,
  needsFreshLocalToolEvidence,
  shouldSynthesizeEmptyFinalFromToolResults,
  markPlanningInputAnswered,
  mergeChatSources,
  stampLocalToolCallIds,
  withLocalComputerProgress,
  withWebSearchProgress,
} from "./chatRuntime";
import { mergeProjectsWithChats, sameLocalWorkspaceSettings, samePathSet, sortProjectsByUpdatedAt } from "./projectState";
import { refreshWorkspaceContext } from "../localWorkspace/workspaceContext";
import { createChatSourcesFromWebResults, createWebSearchContextMessage, formatWebSearchProviderLabel, MAX_WEB_SEARCH_RESULTS, searchWebWithProvider } from "../services/webSearchClient";
import { requestAndRememberWeatherLocation } from "../services/weatherLocation";
import {
  createAgentPrimitiveToolContent,
  createAgentRunRequest,
  createAgentRunWorkflowToolContent,
  createAgentRuntimeDecisionInstruction,
  parseAgentRuntimeDecision,
  shouldStartAppAgentRun,
  summarizeAgentRuntimeDecision,
  type AgentRuntimeDecision,
} from "../agentRuntime/codingAgent";
import {
  getAppInfo,
  getDefaultTerminalWorkingDirectory,
  isTauriDesktopRuntime,
  listenForDiscordInteractions,
  openExternalUrl,
  sendDiscordInteractionResponse,
  startDiscordBridge,
  stopDiscordBridge,
  type DiscordInteractionEvent,
} from "./tauriClient";
import { listAgentRuns, saveAgentRun } from "./agentRunClient";
import { getAuthState, logoutLocalAccount } from "./authClient";
import { openChatWindow } from "./windowClient";
import {
  createNeedsAttentionNotification,
  createNeedsInputNotification,
  notifyAgentRunStatus,
  prepareDesktopNotifications,
} from "./desktopNotifications";
import type { AppInfo } from "../types/app";
import type { AgentApproval, AgentApprovalDecision, AgentRun } from "../types/agentRun";
import type { AuthSession } from "../types/auth";
import type {
  ChatArtifact,
  ChatAttachment,
  ChatContextCompaction,
  ChatComposerDraft,
  ChatMessage,
  ChatPlanningInputAnswer,
  ChatPlanningInputRequest,
  ChatProgressItem,
  ChatSendInput,
  ChatSource,
  ChatSummary,
  ChatToolCall,
  ChatWebSearch,
} from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { PrimaryRoute } from "../types/navigation";
import type { CreateProjectOptions, ProjectSummary } from "../types/project";
import type { DiscordBridgeSettings } from "../types/discord";
import type { TerminalAttachedSession } from "../types/terminal";
import { isDeepResearchThinking } from "../types/settings";
import type { AppearanceMode, ProviderSettings, WebSearchSettings } from "../types/settings";
import { normalizeToolRegistrySettings } from "../types/tools";
import type { ToolRegistrySettings } from "../types/tools";

interface ActiveGeneration {
  chatId: string;
  controller: AbortController;
  messageId?: string;
  previousChat: ChatSummary;
  previousChatExisted: boolean;
  requestId: number;
  restoreDraft?: ChatComposerDraft;
}

interface QueuedChatSend {
  chatId: string;
  held?: boolean;
  id: string;
  input: ChatSendInput;
  userMessageId: string;
}

interface DiscordReplyTarget {
  applicationId: string;
  channelId?: string | null;
  interactionId: string;
  token: string;
  username?: string | null;
}

interface StartSendMessageOptions {
  discordReply?: DiscordReplyTarget;
  sourceChat?: ChatSummary;
  userMessageSource?: ChatMessage["source"];
}

interface DiscordStreamUpdate {
  content?: string;
  progress?: ChatProgressItem;
  sources?: ChatSource[];
  status?: string;
  toolCall?: ChatToolCall;
}

interface AssistantToolResponse {
  approvalRequests?: AgentApproval[];
  artifacts?: ChatArtifact[];
  content: string;
  pendingToolCallContent?: string;
  progress?: ChatProgressItem;
  reasoning?: string;
  sources?: ChatSource[];
  toolCalls?: ChatToolCall[];
  waitingForApproval?: boolean;
}

type SessionApprovalDecisionMap = Record<string, AgentApprovalDecision>;
type SessionApprovalDecisionsByWorkspace = Record<string, SessionApprovalDecisionMap>;

const MAX_PLANNING_INPUT_ROUNDS = 3;
const PINNED_MODEL_IDS = CHAT_MODEL_OPTIONS.map((option) => option.value);
const LOCAL_TOOL_FINAL_MIN_TOKENS = 4096;
const DEEP_RESEARCH_MIN_TOKENS = 8192;
const MAX_LOCAL_TOOL_PASSES = 12;
const MAX_LOCAL_TOOL_EXECUTIONS = 48;
const MAX_DEEP_RESEARCH_TOOL_PASSES = 24;
const MAX_DEEP_RESEARCH_TOOL_EXECUTIONS = 96;
const MAX_TOOL_FINALIZATION_RETRIES = 3;
const MAX_MALFORMED_TOOL_RECOVERY_RETRIES = 2;
const MAX_RECOVERABLE_LOCAL_EDIT_RETRIES = 4;
const MESSAGE_RETRY_TIMEOUT_MS = 10_000;
const CONTEXT_COMPACTION_PROGRESS_ID = "context-compaction";
const DISCORD_NEW_CHAT_COMMAND = "gilbertnewchat";
const DISCORD_STREAM_UPDATE_INTERVAL_MS = 2_400;
const DISCORD_STREAM_MESSAGE_LIMIT = 1_850;
const STEERING_PROGRESS_ID = "response-steering";
const ONBOARDING_NEVER_SHOW_KEY = "gilbert-codex.onboarding.never-show.v1";
const INTERNAL_ASSISTANT_STATUS_MESSAGES = new Set([
  "Reading tool results...",
  "Using agent tools...",
  "Writing final answer from local tool results...",
]);
const CURRENT_INFORMATION_PROMPT_PATTERN =
  /\b(latest|current|currently|today|tonight|tomorrow|yesterday|now|right now|recent|newest|up[-\s]?to[-\s]?date|news|release|released|changelog|version|pricing|price|schedule|docs?|official|standard|api|model|verify|source|cite|look up|lookup|web|search)\b/i;
const RESEARCH_PROMPT_PATTERN = /\b(research|investigate|audit|compare|verify|source|cite|latest|current|docs?|official|standard|api|model|release|changelog)\b/i;
const SIMPLE_THINKING_PROMPT_MAX_WORDS = 18;
const SIMPLE_THINKING_PROMPT_PATTERN = /\b(?:answer|change|clean up|explain|fix typo|format|quick|rename|remove|rewrite|show|summarize|tell|translate|update)\b/i;
const COMPLEX_THINKING_PROMPT_PATTERN = /\b(?:all|architecture|audit|build|debug|deep|end[-\s]?to[-\s]?end|entire|every|investigate|migrate|plan|publish|refactor|release|research|review|security|test|verify)\b/i;
const WEATHER_DATA_PROMPT_PATTERN = /\b(weather|forecast|temperature|temp|rain|snow|storm|storms|thunderstorm|alerts?|warnings?|radar|current conditions?|hourly|nws|noaa)\b/i;
const WEATHER_WEB_DOCS_PROMPT_PATTERN = /\b(docs?|documentation|api|schema|endpoint|openapi|developer|source code|standard|spec)\b/i;
const PENDING_CHAT_TITLE = "Naming chat...";

function createNoProjectWorkspace(current?: LocalWorkspaceSettings): LocalWorkspaceSettings {
  if (current?.enabled && current.scope === "full-computer") {
    return current;
  }

  return {
    enabled: false,
    indexReason: undefined,
    indexSummary: undefined,
    indexStatus: "idle",
    indexUpdatedAt: undefined,
    lastError: undefined,
    permissionMode: current?.permissionMode ?? "default",
    roots: [],
    scope: "selected-folder",
  };
}

function createApprovalWorkspaceSessionKey(settings: LocalWorkspaceSettings) {
  const roots = settings.roots.map((root) => root.trim().replace(/[\\/]+$/, "")).filter(Boolean).sort();

  return JSON.stringify({
    enabled: settings.enabled,
    roots,
    scope: settings.scope,
  });
}

function shouldAttachWebSearchContext(input: ChatSendInput, prompt: string, settings: ProviderSettings, isDiscordRequest: boolean) {
  if (isWeatherDataPrompt(prompt) && normalizeToolRegistrySettings(settings.tools).weatherTools) {
    return false;
  }

  if (input.webSearch?.enabled) {
    return true;
  }

  if (!prompt.trim()) {
    return false;
  }

  if (CURRENT_INFORMATION_PROMPT_PATTERN.test(prompt)) {
    return true;
  }

  if (isDeepResearchThinking(settings.thinking) && RESEARCH_PROMPT_PATTERN.test(prompt)) {
    return true;
  }

  return isDiscordRequest && RESEARCH_PROMPT_PATTERN.test(prompt);
}

function isWeatherDataPrompt(prompt: string) {
  return WEATHER_DATA_PROMPT_PATTERN.test(prompt) && !WEATHER_WEB_DOCS_PROMPT_PATTERN.test(prompt);
}

function createDiscordRuntimeContextMessages(workspaceSettings: LocalWorkspaceSettings, webSearchEnabled: boolean, webSearchProvider: WebSearchSettings["provider"]) {
  const providerLabel = formatWebSearchProviderLabel(webSearchProvider);

  return [
    createMessage(
      "user",
      [
        "DISCORD REMOTE REQUEST CONTEXT",
        "The latest user message came from Discord through Gilbert's signed bridge. Treat it like a normal Gilbert Codex app request.",
        "Model-callable local tools have been removed from this build. Do not ask for GitHub, terminal, local file, code edit, browser preview, MCP, workflow, or weather actions.",
        workspaceSettings.enabled
          ? "Local workspace metadata may be attached as host-provided context, but it is not a model-callable file tool."
          : "No local folder is selected for this request.",
        webSearchEnabled
          ? `Live ${providerLabel} context is being attached for this request. Use it as current evidence and cite URLs when making web-supported claims.`
          : "If current, latest, date-sensitive, or source-backed facts are needed, say that web search was not attached for this turn instead of inventing a tool call.",
      ].join("\n"),
    ),
  ];
}

interface BulkDeleteChatsDialogProps {
  chats: ChatSummary[];
  onClearSelection: () => void;
  onClose: () => void;
  onConfirm: () => void;
  onSelectAll: () => void;
  onToggleChat: (chatId: string) => void;
  open: boolean;
  selectedChatIds: string[];
  sendingChatIds: string[];
}

function BulkDeleteChatsDialog({
  chats,
  onClearSelection,
  onClose,
  onConfirm,
  onSelectAll,
  onToggleChat,
  open,
  selectedChatIds,
  sendingChatIds,
}: BulkDeleteChatsDialogProps) {
  const visibleChats = sortChatsByUpdatedAt(chats.filter((chat) => !chat.archived));
  const selectedIds = new Set(selectedChatIds);
  const sendingIds = new Set(sendingChatIds);
  const selectableCount = visibleChats.filter((chat) => !sendingIds.has(chat.id)).length;
  const selectedCount = visibleChats.filter((chat) => selectedIds.has(chat.id) && !sendingIds.has(chat.id)).length;
  const allSelected = selectableCount > 0 && selectedCount === selectableCount;

  return (
    <DialogShell
      description="Select multiple chats and delete them together from local history."
      icon={Trash2}
      onClose={onClose}
      open={open}
      title="Delete chats"
      tone="danger"
      actions={
        <>
          <button className="dialog-button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="dialog-button dialog-button-primary" data-tone="danger" type="button" disabled={selectedCount === 0} onClick={onConfirm}>
            {selectedCount === 1 ? "Delete 1 chat" : `Delete ${selectedCount} chats`}
          </button>
        </>
      }
    >
      <div className="bulk-delete-toolbar">
        <span>
          {selectedCount} of {selectableCount} selected
        </span>
        <button type="button" disabled={selectableCount === 0} onClick={allSelected ? onClearSelection : onSelectAll}>
          {allSelected ? "Clear" : "Select all"}
        </button>
      </div>
      <div className="bulk-delete-chat-list" role="list" aria-label="Chats to delete">
        {visibleChats.length > 0 ? (
          visibleChats.map((chat) => {
            const disabled = sendingIds.has(chat.id);
            const selected = selectedIds.has(chat.id) && !disabled;
            const projectName = normalizeProjectName(chat.project);

            return (
              <label className="bulk-delete-chat-row" data-disabled={disabled} key={chat.id}>
                <input type="checkbox" checked={selected} disabled={disabled} onChange={() => onToggleChat(chat.id)} />
                <span>
                  <strong>{chat.title}</strong>
                  <small>
                    {projectName} - {chat.messages.length} {chat.messages.length === 1 ? "message" : "messages"} - {formatChatAge(chat.updatedAt)}
                  </small>
                </span>
                {disabled ? <em>Responding</em> : null}
              </label>
            );
          })
        ) : (
          <div className="bulk-delete-empty">There are no chats to delete.</div>
        )}
      </div>
    </DialogShell>
  );
}

function isUserExternalHref(href: string) {
  return /^(?:https?:|mailto:)/i.test(href);
}

export function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authHasAccounts, setAuthHasAccounts] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    function handleDocumentLinkClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || !(event.target instanceof Element)) {
        return;
      }

      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download")) {
        return;
      }

      const href = anchor.getAttribute("href")?.trim() ?? "";
      if (!isUserExternalHref(href)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      void openExternalUrl(href).catch((error) => {
        console.warn("Could not open external link", error);
      });
    }

    document.addEventListener("click", handleDocumentLinkClick, true);
    return () => document.removeEventListener("click", handleDocumentLinkClick, true);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function loadLocalSession() {
      try {
        const state = await getAuthState();

        if (!mounted) {
          return;
        }

        if (state.session) {
          await initializeDeviceStorage(state.session.user.id);
        }

        if (!mounted) {
          return;
        }

        setAuthSession(state.session);
        setAuthHasAccounts(state.hasAccounts);
        setAuthError(null);
      } catch (error) {
        if (!mounted) {
          return;
        }

        setAuthError(readErrorMessage(error, "Local auth is not available yet."));
      } finally {
        if (mounted) {
          setAuthLoading(false);
        }
      }
    }

    void loadLocalSession();

    return () => {
      mounted = false;
    };
  }, []);

  async function handleLogout() {
    if (isTauriDesktopRuntime()) {
      await stopDiscordBridge().catch(() => undefined);
    }

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
        onAuthenticated={async (session) => {
          setAuthLoading(true);
          try {
            await initializeDeviceStorage(session.user.id);
            setAuthSession(session);
            setAuthHasAccounts(true);
            setAuthError(null);
          } catch (error) {
            setAuthError(readErrorMessage(error, "The local database is not available yet."));
            throw error;
          } finally {
            setAuthLoading(false);
          }
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
  const [discordBridgeSettings, setDiscordBridgeSettings] = useState<DiscordBridgeSettings>(() => loadDiscordBridgeSettings());
  const [localWorkspace, setLocalWorkspace] = useState<LocalWorkspaceSettings>(() => loadLocalWorkspaceSettings());
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => loadAppearanceMode());
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: "Gilbert Codex",
    phase: "Public alpha",
    runtime: isTauriDesktopRuntime() ? "Tauri desktop" : "Frontend preview",
    version: "0.2.3",
  });
  const [sendingChatIds, setSendingChatIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("general");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalAttachedSession, setTerminalAttachedSession] = useState<TerminalAttachedSession | null>(null);
  const [browserPreviewTarget, setBrowserPreviewTarget] = useState<{ id: number; url: string } | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(284);
  const [defaultTerminalWorkingDirectory, setDefaultTerminalWorkingDirectory] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => loadPersistentString(ONBOARDING_NEVER_SHOW_KEY) !== "true");
  const [noticeDialog, setNoticeDialog] = useState<{ description?: string; title: string } | null>(null);
  const [renameChatId, setRenameChatId] = useState<string | null>(null);
  const [renameChatTitle, setRenameChatTitle] = useState("");
  const [renameChatError, setRenameChatError] = useState<string | null>(null);
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [pendingDeleteProjectName, setPendingDeleteProjectName] = useState<string | null>(null);
  const [bulkDeleteChatsOpen, setBulkDeleteChatsOpen] = useState(false);
  const [bulkDeleteChatIds, setBulkDeleteChatIds] = useState<string[]>([]);
  const [composerDraftToRestore, setComposerDraftToRestore] = useState<ChatComposerDraft | null>(null);
  const [contextWindow, setContextWindow] = useState<{ source: "estimate" | "openrouter" | "provider"; tokens: number }>(() => ({
    source: "estimate",
    tokens: getFallbackContextWindowTokens(providerSettings.model),
  }));
  const [modelContextWindows, setModelContextWindows] = useState<ModelContextWindowMap>(() =>
    getFallbackModelContextWindows([...PINNED_MODEL_IDS, providerSettings.model]),
  );
  const [lastProviderContextUsage, setLastProviderContextUsage] = useState<{ chatId: string; usage: ContextWindowUsage } | null>(null);
  const [lastContextCompaction, setLastContextCompaction] = useState<ContextCompactionNotice | null>(null);
  const [queuedChatSends, setQueuedChatSends] = useState<QueuedChatSend[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const isDesktopRuntime = isTauriDesktopRuntime() || appInfo.runtime.toLowerCase().includes("tauri");
  const toolSettings = normalizeToolRegistrySettings(providerSettings.tools);
  const activeSendRef = useRef(0);
  const activeGenerationsRef = useRef(new Map<string, ActiveGeneration>());
  const activeRequestChatIdsRef = useRef(new Map<number, string>());
  const discordAutoStartKeyRef = useRef<string | null>(null);
  const discordBridgeSettingsRef = useRef(discordBridgeSettings);
  const titleGenerationRequestsRef = useRef(new Map<string, AbortController>());
  const activeChatIdRef = useRef(activeChatId);
  const localWorkspaceRef = useRef(localWorkspace);
  const projectsRef = useRef<ProjectSummary[]>(projects);
  const pendingChatsRef = useRef<ChatSummary[]>(chats);
  const agentRunsRef = useRef<AgentRun[]>([]);
  const queuedChatSendsRef = useRef<QueuedChatSend[]>([]);
  const queuedStartersRef = useRef(new Set<string>());
  const sessionApprovalDecisionsRef = useRef<SessionApprovalDecisionsByWorkspace>({});
  const weatherLocationPromptRef = useRef(false);

  useEffect(() => {
    return () => {
      for (const activeGeneration of activeGenerationsRef.current.values()) {
        activeGeneration.controller.abort();
      }
      activeGenerationsRef.current.clear();
      activeRequestChatIdsRef.current.clear();
      queuedChatSendsRef.current = [];
      queuedStartersRef.current.clear();

      for (const controller of titleGenerationRequestsRef.current.values()) {
        controller.abort();
      }

      titleGenerationRequestsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    void getAppInfo().then(setAppInfo);
  }, []);

  useEffect(() => {
    if (weatherLocationPromptRef.current) {
      return;
    }

    weatherLocationPromptRef.current = true;
    void requestAndRememberWeatherLocation().catch(() => undefined);
  }, []);

  useEffect(() => {
    let mounted = true;

    void listAgentRuns().then(async (storedRuns) => {
      if (!mounted) {
        return;
      }

      const now = new Date().toISOString();
      const recoveredRuns = storedRuns.map((run) => recoverInterruptedAgentRun(run, now));
      agentRunsRef.current = recoveredRuns;
      setAgentRuns(recoveredRuns);

      await Promise.all(
        recoveredRuns
          .filter((run, index) => run !== storedRuns[index])
          .map((run) => saveAgentRun(run).catch(() => undefined)),
      );
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    agentRunsRef.current = agentRuns;
  }, [agentRuns]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    void prepareDesktopNotifications();
  }, [isDesktopRuntime]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let disposed = false;

    void getDefaultTerminalWorkingDirectory()
      .then((path) => {
        if (!disposed) {
          setDefaultTerminalWorkingDirectory(path);
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [isDesktopRuntime]);

  useEffect(() => {
    pendingChatsRef.current = chats;
    saveChats(chats);
    syncPdfLibraryFromChats(chats);
  }, [chats]);

  useEffect(() => {
    queuedChatSendsRef.current = queuedChatSends;
  }, [queuedChatSends]);

  useEffect(() => {
    if (queuedChatSends.length === 0 || !toolSettings.provider) {
      return;
    }

    const startingChatIds = new Set<string>();
    const queuedSendsToStart: QueuedChatSend[] = [];

    for (const queuedSend of queuedChatSends) {
      if (queuedSend.held || activeGenerationsRef.current.has(queuedSend.chatId) || startingChatIds.has(queuedSend.chatId) || queuedStartersRef.current.has(queuedSend.id)) {
        continue;
      }

      startingChatIds.add(queuedSend.chatId);
      queuedSendsToStart.push(queuedSend);
    }

    if (queuedSendsToStart.length === 0) {
      return;
    }

    const startingIds = new Set(queuedSendsToStart.map((queuedSend) => queuedSend.id));

    for (const queuedSend of queuedSendsToStart) {
      queuedStartersRef.current.add(queuedSend.id);
    }

    setQueuedChatSends((currentQueue) => {
      const nextQueue = currentQueue.filter((queuedSend) => !startingIds.has(queuedSend.id));
      queuedChatSendsRef.current = nextQueue;
      return nextQueue;
    });

    for (const queuedSend of queuedSendsToStart) {
      void startSendMessage(queuedSend.input, {
        chatId: queuedSend.chatId,
        queuedMessageId: queuedSend.userMessageId,
      }).finally(() => {
        queuedStartersRef.current.delete(queuedSend.id);
      });
    }
  }, [queuedChatSends, sendingChatIds, toolSettings.provider]);

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
    projectsRef.current = projects;
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    saveProviderSettings(providerSettings);
  }, [providerSettings]);

  useEffect(() => {
    discordBridgeSettingsRef.current = discordBridgeSettings;
    saveDiscordBridgeSettings(discordBridgeSettings);
  }, [discordBridgeSettings]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenForDiscordInteractions((interaction) => {
      if (!disposed) {
        void handleDiscordInteraction(interaction);
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }

      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [discordBridgeSettings.enabled, discordBridgeSettings.mode, isDesktopRuntime, localWorkspace, providerSettings, toolSettings.provider, toolSettings.webSearch]);

  useEffect(() => {
    if (!isDesktopRuntime || !discordBridgeSettings.enabled || !discordBridgeSettings.autoStartBridge || discordBridgeSettings.mode !== "interactions") {
      return;
    }

    if (!discordBridgeSettings.applicationId.trim() || !discordBridgeSettings.publicKey.trim()) {
      return;
    }

    const autoStartKey = [
      discordBridgeSettings.applicationId,
      discordBridgeSettings.publicKey,
      discordBridgeSettings.bridgePort,
      discordBridgeSettings.tunnelProvider,
      discordBridgeSettings.ngrokPath,
      discordBridgeSettings.ngrokAuthToken ? "token" : "no-token",
      discordBridgeSettings.responseStyle,
      discordBridgeSettings.allowedGuildIds,
      discordBridgeSettings.allowedChannelIds,
    ].join("|");

    if (discordAutoStartKeyRef.current === autoStartKey) {
      return;
    }

    discordAutoStartKeyRef.current = autoStartKey;

    void startDiscordBridge({
      allowedChannelIds: discordBridgeSettings.allowedChannelIds,
      allowedGuildIds: discordBridgeSettings.allowedGuildIds,
      applicationId: discordBridgeSettings.applicationId,
      localPort: discordBridgeSettings.bridgePort,
      ngrokAuthToken: discordBridgeSettings.ngrokAuthToken,
      ngrokPath: discordBridgeSettings.ngrokPath,
      publicKey: discordBridgeSettings.publicKey,
      responseStyle: discordBridgeSettings.responseStyle,
      tunnelProvider: discordBridgeSettings.tunnelProvider,
    })
      .then((status) => {
        if (!status.publicUrl) {
          return;
        }

        setDiscordBridgeSettings((currentSettings) => ({
          ...currentSettings,
          interactionsEndpointUrl: status.publicUrl ?? currentSettings.interactionsEndpointUrl,
          publicInteractionsUrl: status.publicUrl ?? currentSettings.publicInteractionsUrl,
        }));
      })
      .catch(() => {
        discordAutoStartKeyRef.current = null;
      });
  }, [discordBridgeSettings, isDesktopRuntime]);

  useEffect(() => {
    localWorkspaceRef.current = localWorkspace;
    saveLocalWorkspaceSettings(localWorkspace);
    void refreshWorkspaceContext(localWorkspace);
  }, [localWorkspace]);

  useEffect(() => {
    if (!toolSettings.terminal && terminalOpen) {
      setTerminalOpen(false);
    }
  }, [terminalOpen, toolSettings.terminal]);

  useEffect(() => {
    if (!toolSettings.browserPreview) {
      setBrowserPreviewTarget(null);
    }
  }, [toolSettings.browserPreview]);

  useEffect(() => {
    const selectedModel = providerSettings.model.trim();
    const modelIds = Array.from(new Set([...PINNED_MODEL_IDS, selectedModel].filter(Boolean)));
    const fallbackWindows = getFallbackModelContextWindows(modelIds);
    const controller = new AbortController();
    const selectedFallbackWindow = selectedModel ? fallbackWindows[selectedModel] ?? getFallbackModelContextWindow(selectedModel) : getFallbackModelContextWindow("");

    setModelContextWindows(fallbackWindows);
    setContextWindow(selectedFallbackWindow);

    void fetchProviderModelContextLengths(providerSettings, modelIds, {
      signal: controller.signal,
    })
      .then((contextLengths) => {
        if (controller.signal.aborted) {
          return;
        }

        const providerWindows = Object.entries(contextLengths).reduce<ModelContextWindowMap>((windows, [model, tokens]) => {
          const fallbackTokens = fallbackWindows[model]?.tokens ?? 0;

          windows[model] = {
            source: "provider",
            tokens: Math.max(tokens, fallbackTokens),
          };

          return windows;
        }, {});
        const nextWindows = {
          ...fallbackWindows,
          ...providerWindows,
        };
        const selectedWindow = selectedModel ? nextWindows[selectedModel] ?? selectedFallbackWindow : selectedFallbackWindow;

        setModelContextWindows(nextWindows);
        setContextWindow(selectedWindow);
      })
      .catch(() => {
        return;
      });

    return () => controller.abort();
  }, [providerSettings.model, providerSettings.provider, providerSettings.apiKeys, providerSettings.baseUrls]);

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
    activeChatIdRef.current = activeChatId;

    if (activeChatId) {
      saveActiveChatId(activeChatId);
    }
  }, [activeChatId]);

  useEffect(() => {
    if (chats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      return;
    }

    const nextChat = chats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

    if (!chats.some((chat) => chat.id === nextChat.id)) {
      setChats([nextChat]);
    }

    setActiveChatId(nextChat.id);
  }, [activeChatId, chats, projects]);

  const activeChat =
    chats.find((chat) => chat.id === activeChatId && !chat.archived) ??
    chats.find((chat) => !chat.archived) ??
    createEmptyChat(DEFAULT_PROJECT);

  useEffect(() => {
    function selectChatFromHash() {
      const chatId = getChatIdFromLocationHash();

      if (!chatId) {
        return;
      }

      const targetChat = pendingChatsRef.current.find((chat) => chat.id === chatId && !chat.archived);

      if (!targetChat) {
        return;
      }

      restoreProjectLocalWorkspace(targetChat.project);
      setActiveChatId(targetChat.id);
      setActiveRoute("chat");
    }

    selectChatFromHash();
    window.addEventListener("hashchange", selectChatFromHash);

    return () => window.removeEventListener("hashchange", selectChatFromHash);
  }, []);

  useEffect(() => {
    const activeProjectName = normalizeProjectName(activeChat.project);
    const currentWorkspace = localWorkspaceRef.current;

    if (isNoProjectName(activeProjectName)) {
      const noProjectWorkspace = createNoProjectWorkspace(currentWorkspace);

      if (!sameLocalWorkspaceSettings(noProjectWorkspace, currentWorkspace)) {
        localWorkspaceRef.current = noProjectWorkspace;
        setLocalWorkspace(noProjectWorkspace);
      }

      return;
    }

    const projectWorkspace = projects.find((project) => project.name.toLowerCase() === activeProjectName.toLowerCase())?.localWorkspace;

    if (projectWorkspace && !sameLocalWorkspaceSettings(projectWorkspace, currentWorkspace)) {
      localWorkspaceRef.current = projectWorkspace;
      setLocalWorkspace(projectWorkspace);
      return;
    }

    if (!projectWorkspace && currentWorkspace.enabled) {
      const noProjectWorkspace = createNoProjectWorkspace(currentWorkspace);
      localWorkspaceRef.current = noProjectWorkspace;
      setLocalWorkspace(noProjectWorkspace);
    }
  }, [activeChat.project, projects]);

  function resolveWorkspaceForChatProject(projectName: string, fallback: LocalWorkspaceSettings = localWorkspaceRef.current) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      return createNoProjectWorkspace(fallback);
    }

    const projectWorkspace = projectsRef.current.find((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase())?.localWorkspace;

    if (fallback.enabled && fallback.scope === "full-computer") {
      return fallback;
    }

    if (projectWorkspace) {
      return projectWorkspace;
    }

    return createNoProjectWorkspace(fallback);
  }

  function isActiveChatProject(projectName: string) {
    const activeChatId = activeChatIdRef.current;
    const activeProjectName = normalizeProjectName(pendingChatsRef.current.find((chat) => chat.id === activeChatId)?.project ?? activeChat.project);

    return activeProjectName.toLowerCase() === normalizeProjectName(projectName).toLowerCase();
  }

  function persistAgentRun(nextRun: AgentRun) {
    const normalizedRun: AgentRun = {
      ...nextRun,
      approvals: nextRun.approvals ?? [],
      artifacts: nextRun.artifacts ?? [],
      events: nextRun.events ?? [],
      sources: nextRun.sources ?? [],
      steps: nextRun.steps ?? [],
      toolCalls: nextRun.toolCalls ?? [],
      updatedAt: nextRun.updatedAt || new Date().toISOString(),
    };

    const nextRuns = [normalizedRun, ...agentRunsRef.current.filter((run) => run.id !== normalizedRun.id)].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );

    agentRunsRef.current = nextRuns;
    setAgentRuns(nextRuns);
    void saveAgentRun(normalizedRun);

    return normalizedRun;
  }

  function createAgentRunForMessage(params: {
    chatId: string;
    localWorkspace?: LocalWorkspaceSettings;
    messageId: string;
    mode: "chat" | "plan";
    prompt: string;
    title?: string;
  }) {
    const now = new Date().toISOString();
    const run: AgentRun = {
      approvals: [],
      artifacts: [],
      chatId: params.chatId,
      createdAt: now,
      events: [
        {
          at: now,
          id: createId("agent-event"),
          label: params.mode === "plan" ? "Planning run started" : "Agent run started",
          type: "status",
        },
      ],
      id: createId("agent-run"),
      localWorkspace: params.localWorkspace,
      messageId: params.messageId,
      mode: params.mode,
      prompt: params.prompt,
      sources: [],
      status: "running",
      steps: [
        {
          id: createId("agent-step"),
          label: params.mode === "plan" ? "Plan the work" : "Start the run",
          startedAt: now,
          status: "running",
          type: params.mode === "plan" ? "planning" : "model",
        },
      ],
      title: params.title ?? titleFromMessage(params.prompt, []),
      toolCalls: [],
      updatedAt: now,
    };

    return persistAgentRun(run);
  }

  function updateAgentRun(runId: string | undefined, updater: (run: AgentRun, now: string) => AgentRun) {
    if (!runId) {
      return undefined;
    }

    const existingRun = agentRunsRef.current.find((run) => run.id === runId);

    if (!existingRun) {
      return undefined;
    }

    return persistAgentRun(updater(existingRun, new Date().toISOString()));
  }

  function setAgentRunWaiting(runId: string | undefined, label: string, detail?: string, approvals: AgentApproval[] = [], pendingToolCallContent?: string) {
    updateAgentRun(runId, (run, now) => ({
      ...run,
      approvals: mergeAgentApprovals(run.approvals, approvals),
      events: [
        ...run.events,
        {
          at: now,
          detail,
          id: createId("agent-event"),
          label,
          type: "approval",
        },
      ],
      pendingToolCallContent: pendingToolCallContent ?? run.pendingToolCallContent,
      status: "waiting_for_approval",
      steps: run.steps.map((step, index) =>
        index === run.steps.length - 1 && step.status === "running"
          ? {
              ...step,
              completedAt: now,
              detail,
              status: "waiting_for_approval",
            }
          : step,
      ),
      updatedAt: now,
    }));
  }

  function setAgentRunCompleted(runId: string | undefined, message: ChatMessage) {
    updateAgentRun(runId, (run, now) => ({
      ...run,
      artifacts: message.artifacts ?? run.artifacts,
      completedAt: now,
      events: [
        ...run.events,
        {
          at: now,
          id: createId("agent-event"),
          label: "Agent run completed",
          type: "status",
        },
      ],
      pendingToolCallContent: undefined,
      sources: message.sources ?? run.sources,
      status: "completed",
      steps: run.steps.map((step) =>
        step.status === "running" || step.status === "waiting_for_approval"
          ? {
              ...step,
              completedAt: step.completedAt ?? now,
              status: "completed",
            }
          : step,
      ),
      toolCalls: message.toolCalls ?? run.toolCalls,
      updatedAt: now,
    }));
  }

  function setAgentRunFailed(runId: string | undefined, errorMessage: string) {
    updateAgentRun(runId, (run, now) => ({
      ...run,
      events: [
        ...run.events,
        {
          at: now,
          detail: errorMessage,
          id: createId("agent-event"),
          label: "Agent run failed",
          type: "error",
        },
      ],
      lastError: errorMessage,
      status: "failed",
      steps: run.steps.map((step) =>
        step.status === "running" || step.status === "waiting_for_approval"
          ? {
              ...step,
              completedAt: step.completedAt ?? now,
              detail: errorMessage,
              status: "failed",
            }
          : step,
      ),
      updatedAt: now,
    }));
  }

  function setAgentRunCancelled(runId: string | undefined, detail?: string) {
    updateAgentRun(runId, (run, now) => ({
      ...run,
      completedAt: now,
      events: [
        ...run.events,
        {
          at: now,
          detail,
          id: createId("agent-event"),
          label: "Agent run stopped",
          type: "status",
        },
      ],
      status: "cancelled",
      steps: run.steps.map((step) =>
        step.status === "running" || step.status === "queued" || step.status === "waiting_for_approval"
          ? {
              ...step,
              completedAt: step.completedAt ?? now,
              detail: detail ?? step.detail,
              status: "skipped",
            }
          : step,
      ),
      updatedAt: now,
    }));
  }

  function setAgentRunContinuing(runId: string | undefined, label: string, detail?: string) {
    updateAgentRun(runId, (run, now) => ({
      ...run,
      completedAt: undefined,
      events: [
        ...run.events,
        {
          at: now,
          detail,
          id: createId("agent-event"),
          label,
          type: "resume",
        },
      ],
      lastError: undefined,
      status: "running",
      steps: [
        ...run.steps,
        {
          detail,
          id: createId("agent-step"),
          label,
          startedAt: now,
          status: "running",
          type: "model",
        },
      ],
      updatedAt: now,
    }));
  }

  function createPlanningExecutionApproval(runId: string, messageId: string, planContent: string, prompt: string): AgentApproval {
    return {
      args: {
        plan: planContent,
        prompt,
      },
      createdAt: new Date().toISOString(),
      detail: "Review the plan, edit the task JSON if needed, then approve execution.",
      id: createId("approval-plan"),
      kind: "other",
      messageId,
      preview: planContent,
      risk: "medium",
      runId,
      status: "pending",
      title: "Approve plan execution",
      tool: "planning_handoff",
    };
  }

  function handleNewChat(project?: string) {
    const projectName = normalizeProjectName(project ?? activeChat.project);
    const nextChat = createEmptyChat(projectName);

    restoreProjectLocalWorkspace(projectName);
    const nextChats = sortChatsByUpdatedAt([nextChat, ...pendingChatsRef.current]);
    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    touchProject(projectName);
    setActiveChatId(nextChat.id);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

  function handleSelectChat(chatId: string) {
    const selectedChat = pendingChatsRef.current.find((chat) => chat.id === chatId);

    if (selectedChat) {
      restoreProjectLocalWorkspace(selectedChat.project);
    }

    setActiveChatId(chatId);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

  function handleSelectProject(project: string) {
    bindActiveChatToProject(project);
  }

  async function openCreateProjectDialog(options: CreateProjectOptions = {}): Promise<string | null> {
    setSearchOpen(false);

    try {
      const selectedPath = await pickComputerFolder(localWorkspaceRef.current.roots[0]);

      if (!selectedPath) {
        return null;
      }

      return createProjectFromFolder(selectedPath, options);
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, "Choose a readable folder from your computer."),
        title: "Could not add project folder",
      });
      return null;
    }
  }

  function createProjectFromFolder(folderPath: string, options: { bindToActiveChat?: boolean; projectNameHint?: string } = {}): string | null {
    const root = normalizeSelectedProjectPath(folderPath);
    const shouldBindToActiveChat = options.bindToActiveChat !== false;

    if (!root) {
      setNoticeDialog({
        description: "Choose a readable folder from your computer.",
        title: "Could not add project folder",
      });
      return null;
    }

    const existingProject = projectsRef.current.find((project) => samePathSet(project.localWorkspace?.roots ?? [], [root]));

    if (existingProject) {
      if (shouldBindToActiveChat) {
        bindActiveChatToProject(existingProject.name, existingProject.localWorkspace);
      } else if (existingProject.localWorkspace) {
        restoreProjectLocalWorkspace(existingProject.name, existingProject.localWorkspace);
      }

      return existingProject.name;
    }

    const now = new Date().toISOString();
    const baseProjectName = createProjectBaseName(options.projectNameHint ?? projectNameFromPath(root));
    const reusableProject = projectsRef.current.find(
      (project) => project.name.toLowerCase() === baseProjectName.toLowerCase() && (project.localWorkspace?.roots.length ?? 0) === 0,
    );
    const projectName = reusableProject?.name ?? createUniqueProjectName(baseProjectName, projectsRef.current);
    const indexingWorkspace: LocalWorkspaceSettings = {
      ...localWorkspaceRef.current,
      enabled: true,
      indexReason: "Indexing project folder",
      indexStatus: "indexing",
      indexSummary: undefined,
      indexUpdatedAt: undefined,
      lastError: undefined,
      roots: [root],
      scope: "selected-folder",
    };
    const nextProject: ProjectSummary = reusableProject
      ? {
          ...reusableProject,
          localWorkspace: indexingWorkspace,
          name: projectName,
          updatedAt: now,
        }
      : {
          createdAt: now,
          id: createId("project"),
          localWorkspace: indexingWorkspace,
          name: projectName,
          updatedAt: now,
        };
    localWorkspaceRef.current = indexingWorkspace;
    setLocalWorkspace(indexingWorkspace);
    const nextProjects = sortProjectsByUpdatedAt(
      reusableProject ? projectsRef.current.map((project) => (project.id === reusableProject.id ? nextProject : project)) : [nextProject, ...projectsRef.current],
    );
    projectsRef.current = nextProjects;
    setProjects(nextProjects);

    if (shouldBindToActiveChat) {
      bindActiveChatToProject(projectName, indexingWorkspace);
    }

    window.setTimeout(() => {
      void buildComputerFileIndex([root], "selected-folder")
        .then((summary) => {
          const indexedWorkspace: LocalWorkspaceSettings = {
            ...indexingWorkspace,
            indexReason: undefined,
            indexStatus: "idle",
            indexSummary: summary,
            indexUpdatedAt: new Date().toISOString(),
            lastError: undefined,
          };

          saveWorkspaceForProject(projectName, indexedWorkspace);
          setLocalWorkspace((currentWorkspace) => {
            const nextWorkspace = samePathSet(currentWorkspace.roots, [root]) ? indexedWorkspace : currentWorkspace;
            localWorkspaceRef.current = nextWorkspace;
            return nextWorkspace;
          });
        })
        .catch((error) => {
          const message = readErrorMessage(error, "Could not index this project folder.");
          const erroredWorkspace: LocalWorkspaceSettings = {
            ...indexingWorkspace,
            indexReason: undefined,
            indexStatus: "error",
            lastError: message,
          };

          saveWorkspaceForProject(projectName, erroredWorkspace);
          setLocalWorkspace((currentWorkspace) => {
            const nextWorkspace = samePathSet(currentWorkspace.roots, [root]) ? erroredWorkspace : currentWorkspace;
            localWorkspaceRef.current = nextWorkspace;
            return nextWorkspace;
          });
        });
    }, 0);

    return projectName;
  }

  function handleLocalWorkspaceChange(nextWorkspace: LocalWorkspaceSettings) {
    localWorkspaceRef.current = nextWorkspace;
    setLocalWorkspace(nextWorkspace);

    const activeProjectName = normalizeProjectName(activeChat.project);

    if (isNoProjectName(activeProjectName) && nextWorkspace.enabled && nextWorkspace.scope !== "full-computer" && nextWorkspace.roots[0]) {
      const root = normalizeSelectedProjectPath(nextWorkspace.roots[0]);

      if (root) {
        const projectWorkspace: LocalWorkspaceSettings = {
          ...nextWorkspace,
          roots: [root],
          scope: "selected-folder",
        };
        const existingProject = projectsRef.current.find((project) => samePathSet(project.localWorkspace?.roots ?? [], [root]));

        if (existingProject) {
          saveWorkspaceForProject(existingProject.name, projectWorkspace);
          bindActiveChatToProject(existingProject.name, projectWorkspace);
          return;
        }

        createProjectFromFolder(root);
        return;
      }
    }

    saveWorkspaceForProject(activeProjectName, nextWorkspace);
  }

  function bindActiveChatToProject(project: string, workspaceOverride?: LocalWorkspaceSettings) {
    const projectName = normalizeProjectName(project);
    const now = new Date().toISOString();
    const currentActiveChat = pendingChatsRef.current.find((chat) => chat.id === activeChatIdRef.current && !chat.archived);
    const currentProjectName = normalizeProjectName(currentActiveChat?.project);
    const sameProjectSelected = currentActiveChat && currentProjectName.toLowerCase() === projectName.toLowerCase();

    if (sameProjectSelected) {
      const projectWorkspace = isNoProjectName(projectName)
        ? createNoProjectWorkspace(localWorkspaceRef.current)
        : workspaceOverride ?? resolveWorkspaceForChatProject(projectName, localWorkspaceRef.current);
      localWorkspaceRef.current = projectWorkspace;
      setLocalWorkspace(projectWorkspace);
      setActiveRoute("chat");
      setSearchOpen(false);
      return;
    }

    const shouldStartFreshProjectChat =
      currentActiveChat &&
      currentActiveChat.messages.length > 0 &&
      currentProjectName.toLowerCase() !== projectName.toLowerCase();
    let targetChatId = shouldStartFreshProjectChat ? "" : activeChatIdRef.current;
    let updatedExistingChat = false;
    let nextChats = pendingChatsRef.current.map((chat) => {
      if (chat.id !== targetChatId || chat.archived) {
        return chat;
      }

      updatedExistingChat = true;
      return {
        ...chat,
        project: projectName,
        updatedAt: now,
      };
    });

    if (!updatedExistingChat) {
      const nextChat = createEmptyChat(projectName);
      targetChatId = nextChat.id;
      nextChats = [nextChat, ...nextChats];
    }

    nextChats = sortChatsByUpdatedAt(nextChats);
    pendingChatsRef.current = nextChats;
    activeChatIdRef.current = targetChatId;
    setChats(nextChats);
    setActiveChatId(targetChatId);

    if (isNoProjectName(projectName)) {
      const noProjectWorkspace = createNoProjectWorkspace(localWorkspaceRef.current);
      localWorkspaceRef.current = noProjectWorkspace;
      setLocalWorkspace(noProjectWorkspace);
    } else {
      const projectWorkspace = workspaceOverride ?? resolveWorkspaceForChatProject(projectName, localWorkspaceRef.current);
      localWorkspaceRef.current = projectWorkspace;
      setLocalWorkspace(projectWorkspace);
    }

    setActiveRoute("chat");
    setSearchOpen(false);
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

  function attachLiveTerminalSession(toolCalls?: ChatToolCall[]) {
    const liveTerminalCall = [...(toolCalls ?? [])].reverse().find((toolCall) => toolCall.terminal?.live && toolCall.terminal.sessionId);
    const terminal = liveTerminalCall?.terminal;

    if (!liveTerminalCall || !terminal?.sessionId) {
      return;
    }

    setTerminalAttachedSession({
      command: terminal.command ?? liveTerminalCall.label,
      initialOutput: liveTerminalCall.output,
      sessionId: terminal.sessionId,
      shell: terminal.shell,
      workingDirectory: terminal.workingDirectory,
    });
    setTerminalOpen(true);
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

  function handleOpenRenameChat(chat: ChatSummary) {
    setRenameChatId(chat.id);
    setRenameChatTitle(chat.title || "New chat");
    setRenameChatError(null);
  }

  function confirmRenameChat() {
    if (!renameChatId) {
      return;
    }

    const nextTitle = renameChatTitle.trim();

    if (!nextTitle) {
      setRenameChatError("Enter a chat name.");
      return;
    }

    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === renameChatId
            ? {
                ...chat,
                title: nextTitle,
                updatedAt: new Date().toISOString(),
              }
            : chat,
        ),
      ),
    );
    setRenameChatId(null);
    setRenameChatTitle("");
    setRenameChatError(null);
  }

  function handleArchiveActiveChat() {
    const chatToArchive = pendingChatsRef.current.find((chat) => chat.id === activeChat.id);

    if (!chatToArchive) {
      return;
    }

    if (isChatSending(chatToArchive.id)) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then archive the chat.",
        title: "Chat is still responding",
      });
      return;
    }

    const now = new Date().toISOString();
    let nextChats = sortChatsByUpdatedAt(
      pendingChatsRef.current.map((chat) =>
        chat.id === chatToArchive.id
          ? {
              ...chat,
              archived: true,
              updatedAt: now,
            }
          : chat,
      ),
    );
    const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

    if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
      nextChats = sortChatsByUpdatedAt([nextActiveChat, ...nextChats]);
    }

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => queuedSend.chatId !== chatToArchive.id));
    setActiveChatId(nextActiveChat.id);
    setActiveRoute("chat");
  }

  async function handleCopyWorkingDirectory() {
    const workingDirectory = getActiveWorkingDirectory();

    if (!workingDirectory) {
      setNoticeDialog({
        description: "Choose a local project folder or enable a workspace before copying a working directory.",
        title: "No working directory selected",
      });
      return;
    }

    await copyLabeledTextToClipboard("Working directory", workingDirectory);
  }

  async function handleCopySessionId() {
    await copyLabeledTextToClipboard("Session ID", activeChat.id);
  }

  async function handleCopyChatDeeplink() {
    await copyLabeledTextToClipboard("Deeplink", createChatDeeplink(activeChat.id));
  }

  async function handleCopyChatMarkdown() {
    await copyLabeledTextToClipboard("Chat Markdown", formatChatAsMarkdown(activeChat));
  }

  function handleForkActiveChatLocal() {
    const forkedChat = createForkedChat(activeChat, activeChat.project);
    activateForkedChat(forkedChat, resolveWorkspaceForChatProject(activeChat.project, localWorkspaceRef.current));
    setNoticeDialog({
      description: `${forkedChat.title} is ready in ${forkedChat.project}.`,
      title: "Chat forked locally",
    });
  }

  async function handleForkActiveChatWorktree() {
    const sourceWorkspace = resolveWorkspaceForChatProject(activeChat.project, localWorkspaceRef.current);
    const sourceRoot = sourceWorkspace.enabled ? sourceWorkspace.roots[0] : localWorkspaceRef.current.roots[0];

    if (!sourceRoot) {
      setNoticeDialog({
        description: "Choose a Git-backed project folder before forking into a new worktree.",
        title: "No project folder selected",
      });
      return;
    }

    try {
      const worktree = await createComputerGitWorktree(sourceRoot, {
        title: activeChat.title,
      });
      const projectName = createProjectFromFolder(worktree.path, {
        bindToActiveChat: false,
        projectNameHint: `${projectNameFromPath(worktree.path)} worktree`,
      });

      if (!projectName) {
        return;
      }

      const worktreeWorkspace = resolveWorkspaceForChatProject(projectName, {
        ...sourceWorkspace,
        enabled: true,
        roots: [worktree.path],
        scope: "selected-folder",
      });
      const forkedChat = createForkedChat(activeChat, projectName, `Worktree: ${activeChat.title}`);

      activateForkedChat(forkedChat, worktreeWorkspace);
      setNoticeDialog({
        description: `${worktree.branchName} was created at ${worktree.path}.`,
        title: "Worktree fork ready",
      });
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, "Could not create a Git worktree for this chat."),
        title: "Worktree fork failed",
      });
    }
  }

  function handleAddAutomation() {
    setSearchOpen(false);
    setNoticeDialog({
      description: "Workflow automation was removed with the tool runtime cleanup. Web search remains available from chat.",
      title: "Workflows removed",
    });
  }

  async function handleOpenActiveChatInNewWindow() {
    try {
      await openChatWindow(activeChat.id, activeChat.title);
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, "Could not open this chat in a new window."),
        title: "Could not open window",
      });
    }
  }

  function getActiveWorkingDirectory() {
    const workspace = resolveWorkspaceForChatProject(activeChat.project, localWorkspaceRef.current);

    return workspace.roots[0] || localWorkspaceRef.current.roots[0] || defaultTerminalWorkingDirectory;
  }

  async function copyLabeledTextToClipboard(label: string, text: string) {
    try {
      const copied = await copyTextToClipboard(text);

      if (!copied) {
        throw new Error(`Could not copy ${label.toLowerCase()}.`);
      }

      setNoticeDialog({
        description: label,
        title: "Copied",
      });
    } catch (error) {
      setNoticeDialog({
        description: readErrorMessage(error, `Could not copy ${label.toLowerCase()}.`),
        title: "Copy failed",
      });
    }
  }

  function activateForkedChat(forkedChat: ChatSummary, workspace: LocalWorkspaceSettings) {
    const nextChats = sortChatsByUpdatedAt([forkedChat, ...pendingChatsRef.current]);

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    restoreProjectLocalWorkspace(forkedChat.project, workspace);
    touchProject(forkedChat.project);
    setActiveChatId(forkedChat.id);
    setActiveRoute("chat");
    setSearchOpen(false);
  }

  function notifyPlanningInputNeeded(inputRequest: ChatPlanningInputRequest) {
    notifyAgentRunStatus({
      notification: createNeedsInputNotification(inputRequest.detail || inputRequest.title),
    });
  }

  function notifyRunNeedsAttention(detail?: string) {
    notifyAgentRunStatus({
      notification: createNeedsAttentionNotification(detail),
    });
  }

  function notifyRunComplete(message: ChatMessage) {
    notifyAgentRunStatus({
      message,
    });
  }

  function touchProject(projectName: string) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      return;
    }

    const now = new Date().toISOString();

    setProjects((currentProjects) => {
      const projectExists = currentProjects.some((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase());

      if (!projectExists) {
        const nextProjects = sortProjectsByUpdatedAt([
          {
            createdAt: now,
            id: createId("project"),
            name: normalizedProjectName,
            updatedAt: now,
          },
          ...currentProjects,
        ]);
        projectsRef.current = nextProjects;
        return nextProjects;
      }

      const nextProjects = sortProjectsByUpdatedAt(
        currentProjects.map((project) =>
          project.name.toLowerCase() === normalizedProjectName.toLowerCase()
            ? {
                ...project,
                updatedAt: now,
              }
            : project,
        ),
      );
      projectsRef.current = nextProjects;
      return nextProjects;
    });
  }

  function restoreProjectLocalWorkspace(projectName: string, workspaceOverride?: LocalWorkspaceSettings) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      const noProjectWorkspace = createNoProjectWorkspace(localWorkspaceRef.current);
      localWorkspaceRef.current = noProjectWorkspace;
      setLocalWorkspace(noProjectWorkspace);
      return;
    }

    const projectWorkspace = workspaceOverride ?? projectsRef.current.find((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase())?.localWorkspace;

    if (projectWorkspace) {
      localWorkspaceRef.current = projectWorkspace;
      setLocalWorkspace(projectWorkspace);
      return;
    }

    const noProjectWorkspace = createNoProjectWorkspace(localWorkspaceRef.current);
    localWorkspaceRef.current = noProjectWorkspace;
    setLocalWorkspace(noProjectWorkspace);
  }

  function saveWorkspaceForProject(projectName: string, nextWorkspace: LocalWorkspaceSettings) {
    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      return;
    }

    const now = new Date().toISOString();

    setProjects((currentProjects) => {
      const projectExists = currentProjects.some((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase());

      if (!projectExists) {
        const nextProjects = sortProjectsByUpdatedAt([
          {
            createdAt: now,
            id: createId("project"),
            localWorkspace: nextWorkspace,
            name: normalizedProjectName,
            updatedAt: now,
          },
          ...currentProjects,
        ]);
        projectsRef.current = nextProjects;
        return nextProjects;
      }

      const nextProjects = sortProjectsByUpdatedAt(
        currentProjects.map((project) =>
          project.name.toLowerCase() === normalizedProjectName.toLowerCase()
            ? {
                ...project,
                localWorkspace: nextWorkspace,
                updatedAt: now,
              }
            : project,
        ),
      );
      projectsRef.current = nextProjects;
      return nextProjects;
    });
  }

  function handleDeleteChat(chatId: string) {
    const chatToDelete = chats.find((chat) => chat.id === chatId);

    if (!chatToDelete) {
      return;
    }

    if (isChatSending(chatId)) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the chat from the sidebar menu.",
        title: "Chat is still responding",
      });
      return;
    }

    setPendingDeleteChatId(chatId);
  }

  function handleDeleteProject(projectName: string) {
    const projectToDelete = projects.find((project) => project.name.toLowerCase() === projectName.toLowerCase());

    if (!projectToDelete || isNoProjectName(projectToDelete.name)) {
      return;
    }

    const projectChatIds = new Set(chats.filter((chat) => chat.project.toLowerCase() === projectToDelete.name.toLowerCase()).map((chat) => chat.id));

    if (isAnyChatSending(projectChatIds)) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the project from the sidebar menu.",
        title: "Project is still responding",
      });
      return;
    }

    setPendingDeleteProjectName(projectToDelete.name);
  }

  function handleOpenBulkDeleteChats() {
    setBulkDeleteChatIds([]);
    setBulkDeleteChatsOpen(true);
    setSearchOpen(false);
  }

  function handleToggleBulkDeleteChat(chatId: string) {
    if (isChatSending(chatId)) {
      return;
    }

    setBulkDeleteChatIds((currentIds) => (currentIds.includes(chatId) ? currentIds.filter((id) => id !== chatId) : [...currentIds, chatId]));
  }

  function handleSelectAllBulkDeleteChats() {
    setBulkDeleteChatIds(sortChatsByUpdatedAt(chats.filter((chat) => !chat.archived && !isChatSending(chat.id))).map((chat) => chat.id));
  }

  function handleClearBulkDeleteChats() {
    setBulkDeleteChatIds([]);
  }

  function confirmDeleteChat() {
    const chatToDelete = chats.find((chat) => chat.id === pendingDeleteChatId);

    if (!chatToDelete) {
      setPendingDeleteChatId(null);
      return;
    }

    if (isChatSending(chatToDelete.id)) {
      setPendingDeleteChatId(null);
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the chat from the sidebar menu.",
        title: "Chat is still responding",
      });
      return;
    }

    const nextChats = sortChatsByUpdatedAt(chats.filter((chat) => chat.id !== chatToDelete.id));

    if (chatToDelete.id === activeChatId) {
      const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

      if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
        nextChats.unshift(nextActiveChat);
      }

      setActiveChatId(nextActiveChat.id);
    }

    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => queuedSend.chatId !== chatToDelete.id));
    setPendingDeleteChatId(null);
  }

  function confirmDeleteProject() {
    if (!pendingDeleteProjectName) {
      return;
    }

    const projectToDelete = projects.find((project) => project.name.toLowerCase() === pendingDeleteProjectName.toLowerCase());

    if (!projectToDelete) {
      setPendingDeleteProjectName(null);
      return;
    }

    const projectKey = projectToDelete.name.toLowerCase();
    const deletedChatIds = new Set(chats.filter((chat) => chat.project.toLowerCase() === projectKey).map((chat) => chat.id));

    if (isAnyChatSending(deletedChatIds)) {
      setPendingDeleteProjectName(null);
      setNoticeDialog({
        description: "Wait for the current response to finish, then delete the project from the sidebar menu.",
        title: "Project is still responding",
      });
      return;
    }

    const nextProjects = sortProjectsByUpdatedAt(projects.filter((project) => project.name.toLowerCase() !== projectKey));
    let nextChats = sortChatsByUpdatedAt(chats.filter((chat) => chat.project.toLowerCase() !== projectKey));

    const activeChatWasDeleted = deletedChatIds.has(activeChatId);

    if (!nextChats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

      if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
        nextChats = sortChatsByUpdatedAt([nextActiveChat, ...nextChats]);
      }

      setActiveChatId(nextActiveChat.id);
    }

    projectsRef.current = nextProjects;
    setProjects(nextProjects);
    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => !deletedChatIds.has(queuedSend.chatId)));
    setPendingDeleteProjectName(null);
    setSearchOpen(false);
    if (activeChatWasDeleted) {
      setActiveRoute("chat");
    }
  }

  function confirmBulkDeleteChats() {
    const selectedIds = new Set(bulkDeleteChatIds);

    if (selectedIds.size === 0) {
      return;
    }

    const selectedSendingChatIds = getSendingChatIds(selectedIds);

    if (selectedSendingChatIds.length > 0) {
      setNoticeDialog({
        description: "Wait for the current response to finish, then include that chat in a bulk delete.",
        title: "A selected chat is still responding",
      });
      setBulkDeleteChatIds((currentIds) => currentIds.filter((id) => !selectedSendingChatIds.includes(id)));
      return;
    }

    let nextChats = sortChatsByUpdatedAt(chats.filter((chat) => !selectedIds.has(chat.id)));

    if (!nextChats.some((chat) => !chat.archived)) {
      nextChats = [createEmptyChat(DEFAULT_PROJECT)];
    }

    if (!nextChats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      const nextActiveChat = nextChats.find((chat) => !chat.archived) ?? createEmptyChat(DEFAULT_PROJECT);

      if (!nextChats.some((chat) => chat.id === nextActiveChat.id)) {
        nextChats = sortChatsByUpdatedAt([nextActiveChat, ...nextChats]);
      }

      setActiveChatId(nextActiveChat.id);
      setActiveRoute("chat");
    }

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((queuedSend) => !selectedIds.has(queuedSend.chatId)));
    setBulkDeleteChatsOpen(false);
    setBulkDeleteChatIds([]);
    setSearchOpen(false);
  }

  function isChatSending(chatId: string | undefined) {
    return Boolean(chatId && activeGenerationsRef.current.has(chatId));
  }

  function isAnyChatSending(chatIds: Iterable<string>) {
    for (const chatId of chatIds) {
      if (isChatSending(chatId)) {
        return true;
      }
    }

    return false;
  }

  function getSendingChatIds(chatIds: Iterable<string>) {
    return [...new Set([...chatIds].filter((chatId) => isChatSending(chatId)))];
  }

  function setChatSending(chatId: string, sending: boolean) {
    setSendingChatIds((currentIds) => {
      const hasChatId = currentIds.includes(chatId);

      if (sending) {
        return hasChatId ? currentIds : [...currentIds, chatId];
      }

      return hasChatId ? currentIds.filter((id) => id !== chatId) : currentIds;
    });
  }

  function getActiveGenerationByRequest(requestId: number) {
    const chatId = activeRequestChatIdsRef.current.get(requestId);

    return chatId ? activeGenerationsRef.current.get(chatId) : undefined;
  }

  function getActiveGenerationByMessage(messageId: string | undefined) {
    if (!messageId) {
      return undefined;
    }

    for (const activeGeneration of activeGenerationsRef.current.values()) {
      if (activeGeneration.messageId === messageId) {
        return activeGeneration;
      }
    }

    return undefined;
  }

  function createActiveGeneration(chatId: string, previousChat: ChatSummary, previousChatExisted: boolean, restoreDraft?: ChatComposerDraft, target?: { messageId: string }) {
    const requestId = activeSendRef.current + 1;
    const controller = new AbortController();

    activeSendRef.current = requestId;
    activeRequestChatIdsRef.current.set(requestId, chatId);
    activeGenerationsRef.current.set(chatId, {
      chatId,
      controller,
      messageId: target?.messageId,
      previousChat,
      previousChatExisted,
      requestId,
      restoreDraft,
    });
    setChatSending(chatId, true);

    return { controller, requestId };
  }

  function setActiveGenerationTarget(requestId: number, chatId: string, messageId: string) {
    const activeGeneration = getActiveGenerationByRequest(requestId);

    if (!activeGeneration || activeGeneration.chatId !== chatId || activeGeneration.requestId !== requestId) {
      return;
    }

    activeGeneration.messageId = messageId;
  }

  function isRequestInactive(requestId: number, controller: AbortController) {
    const activeGeneration = getActiveGenerationByRequest(requestId);

    return controller.signal.aborted || !activeGeneration || activeGeneration.requestId !== requestId;
  }

  function finishActiveGeneration(requestId: number) {
    const activeGeneration = getActiveGenerationByRequest(requestId);

    if (activeGeneration?.requestId === requestId) {
      activeGenerationsRef.current.delete(activeGeneration.chatId);
      activeRequestChatIdsRef.current.delete(requestId);
      setChatSending(activeGeneration.chatId, false);
    }
  }

  function handleStopGeneration(messageId?: unknown) {
    const requestedMessageId = typeof messageId === "string" ? messageId : undefined;
    const activeGeneration = requestedMessageId ? getActiveGenerationByMessage(requestedMessageId) : activeGenerationsRef.current.get(activeChat.id);
    const targetMessageId = requestedMessageId ?? activeGeneration?.messageId;
    stopActiveGeneration({ activeGeneration, messageId: targetMessageId, restoreDraft: !targetMessageId });
  }

  function stopActiveGeneration({ activeGeneration, messageId, restoreDraft }: { activeGeneration?: ActiveGeneration; messageId?: string; restoreDraft: boolean }) {
    const generationToStop = activeGeneration ?? getActiveGenerationByMessage(messageId);

    if (!generationToStop) {
      if (messageId) {
        stopStreamingMessage(messageId);
      } else {
        stopStaleStreamingMessages(activeChat.id);
      }
      return;
    }

    const isTargetedStop = Boolean(messageId);
    const stopMatchesActiveGeneration = !messageId || !generationToStop.messageId || generationToStop.messageId === messageId;

    if (!stopMatchesActiveGeneration) {
      stopStreamingMessage(messageId);
      return;
    }

    generationToStop.controller.abort();

    if (restoreDraft && generationToStop.restoreDraft) {
      setComposerDraftToRestore(generationToStop.restoreDraft);
    }

    if (isTargetedStop && messageId) {
      stopStreamingMessage(messageId);
    } else {
      restoreChatSnapshot(preserveQueuedMessagesForSnapshot(generationToStop.previousChat), generationToStop.previousChatExisted);
    }

    activeGenerationsRef.current.delete(generationToStop.chatId);
    activeRequestChatIdsRef.current.delete(generationToStop.requestId);
    setChatSending(generationToStop.chatId, false);
  }

  function stopStreamingMessage(messageId: string) {
    const stoppedRunId = pendingChatsRef.current.flatMap((chat) => chat.messages).find((message) => message.id === messageId && message.role === "assistant" && message.isStreaming)?.agentRunId;

    setChats((currentChats) => {
      let changed = false;
      const stoppedAt = new Date().toISOString();
      const nextChats = currentChats.map((chat) => {
        let chatChanged = false;
        const nextMessages = chat.messages.map((message) => {
          if (message.id !== messageId || message.role !== "assistant" || !message.isStreaming) {
            return message;
          }

          changed = true;
          chatChanged = true;
          return stopStreamingAssistantMessage(message, stoppedAt);
        });

        return chatChanged
          ? {
              ...chat,
              messages: nextMessages,
              updatedAt: stoppedAt,
            }
          : chat;
      });

      if (!changed) {
        return currentChats;
      }

      pendingChatsRef.current = nextChats;
      return nextChats;
    });

    setAgentRunCancelled(stoppedRunId, "Response stopped.");
  }

  function stopStaleStreamingMessages(chatId: string, exceptMessageId?: string) {
    const stoppedRunIds = new Set(
      pendingChatsRef.current
        .filter((chat) => chat.id === chatId)
        .flatMap((chat) => chat.messages)
        .filter((message) => message.role === "assistant" && message.isStreaming && message.id !== exceptMessageId && message.agentRunId)
        .map((message) => message.agentRunId!),
    );

    setChats((currentChats) => {
      let changed = false;
      const stoppedAt = new Date().toISOString();
      const nextChats = currentChats.map((chat) => {
        if (chat.id !== chatId) {
          return chat;
        }

        let chatChanged = false;
        const nextMessages = chat.messages.map((message) => {
          if (message.role !== "assistant" || !message.isStreaming || message.id === exceptMessageId) {
            return message;
          }

          changed = true;
          chatChanged = true;
          return stopStreamingAssistantMessage(message, stoppedAt);
        });

        return chatChanged
          ? {
              ...chat,
              messages: nextMessages,
              updatedAt: stoppedAt,
            }
          : chat;
      });

      if (!changed) {
        return currentChats;
      }

      pendingChatsRef.current = nextChats;
      return nextChats;
    });

    stoppedRunIds.forEach((runId) => setAgentRunCancelled(runId, "Stale response stopped before starting the next message."));
  }

  function stopStreamingAssistantMessage(message: ChatMessage, stoppedAt: string): ChatMessage {
    return {
      ...message,
      agentRunStatus: message.agentRunStatus === "running" || message.agentRunStatus === "queued" ? "cancelled" : message.agentRunStatus,
      isStreaming: false,
      progress: completeActiveProgress(message.progress),
      thinking: message.thinking
        ? {
            ...message.thinking,
            completedAt: message.thinking.completedAt ?? stoppedAt,
          }
        : undefined,
      toolCalls: message.toolCalls?.map((toolCall) =>
        toolCall.status === "active"
          ? {
              ...toolCall,
              detail: toolCall.detail ?? "Stopped.",
              status: "error",
              terminal: toolCall.terminal
                ? {
                    ...toolCall.terminal,
                    live: false,
                  }
                : toolCall.terminal,
            }
          : toolCall,
      ),
    };
  }

  function completeActiveProgress(progress: ChatProgressItem[] | undefined) {
    const nextProgress = (progress ?? []).map((item) =>
      item.status === "active"
        ? {
            ...item,
            detail: item.detail ?? "Stopped.",
            status: "complete" as const,
          }
        : item,
    );

    return nextProgress.length > 0 ? nextProgress : undefined;
  }

  function preserveQueuedMessagesForSnapshot(chatSnapshot: ChatSummary) {
    const queuedMessageIds = new Set(queuedChatSendsRef.current.filter((queuedSend) => queuedSend.chatId === chatSnapshot.id).map((queuedSend) => queuedSend.userMessageId));

    if (queuedMessageIds.size === 0) {
      return chatSnapshot;
    }

    const snapshotMessageIds = new Set(chatSnapshot.messages.map((message) => message.id));
    const liveChat = pendingChatsRef.current.find((chat) => chat.id === chatSnapshot.id);
    const queuedMessagesToKeep = liveChat?.messages.filter((message) => queuedMessageIds.has(message.id) && !snapshotMessageIds.has(message.id)) ?? [];

    if (queuedMessagesToKeep.length === 0) {
      return chatSnapshot;
    }

    return {
      ...chatSnapshot,
      messages: [...chatSnapshot.messages, ...queuedMessagesToKeep],
      updatedAt: new Date().toISOString(),
    };
  }

  function restoreChatSnapshot(chatSnapshot: ChatSummary, existed: boolean) {
    setChats((currentChats) => {
      const otherChats = currentChats.filter((chat) => chat.id !== chatSnapshot.id);

      const nextChats = sortChatsByUpdatedAt(existed ? [chatSnapshot, ...otherChats] : otherChats);
      pendingChatsRef.current = nextChats;
      return nextChats;
    });
  }

  function updateQueuedChatSends(updater: (currentQueue: QueuedChatSend[]) => QueuedChatSend[]) {
    setQueuedChatSends((currentQueue) => {
      const nextQueue = updater(currentQueue);
      queuedChatSendsRef.current = nextQueue;
      return nextQueue;
    });
  }

  function scheduleGeneratedChatTitle({
    attachments,
    chatId,
    content,
    fallbackTitle,
    settings,
    userMessageId,
  }: {
    attachments: ChatAttachment[];
    chatId: string;
    content: string;
    fallbackTitle: string;
    settings: ProviderSettings;
    userMessageId: string;
  }) {
    titleGenerationRequestsRef.current.get(chatId)?.abort();

    const controller = new AbortController();
    titleGenerationRequestsRef.current.set(chatId, controller);

    void generateChatTitle(settings, { attachments, content }, { signal: controller.signal })
      .then((generatedTitle) => {
        if (controller.signal.aborted || titleGenerationRequestsRef.current.get(chatId) !== controller) {
          return;
        }

        applyGeneratedChatTitle({
          chatId,
          fallbackTitle,
          title: generatedTitle,
          userMessageId,
        });
      })
      .catch(() => {
        if (controller.signal.aborted || titleGenerationRequestsRef.current.get(chatId) !== controller) {
          return;
        }

        applyGeneratedChatTitle({
          chatId,
          fallbackTitle,
          title: fallbackTitle,
          userMessageId,
        });
      })
      .finally(() => {
        if (titleGenerationRequestsRef.current.get(chatId) === controller) {
          titleGenerationRequestsRef.current.delete(chatId);
        }
      });
  }

  function applyGeneratedChatTitle({
    chatId,
    fallbackTitle,
    title,
    userMessageId,
  }: {
    chatId: string;
    fallbackTitle: string;
    title: string;
    userMessageId: string;
  }) {
    const cleanTitle = title.trim();

    if (!cleanTitle) {
      return;
    }

    setChats((currentChats) => {
      let changed = false;
      const nextChats = currentChats.map((chat) => {
        if (chat.id !== chatId || chat.archived) {
          return chat;
        }

        const firstUserMessage = chat.messages.find((message) => message.role === "user");

        if (firstUserMessage?.id !== userMessageId) {
          return chat;
        }

        if (chat.title !== PENDING_CHAT_TITLE && chat.title !== fallbackTitle && chat.title !== "New chat") {
          return chat;
        }

        if (chat.title === cleanTitle) {
          return chat;
        }

        changed = true;
        return {
          ...chat,
          title: cleanTitle,
        };
      });

      if (!changed) {
        return currentChats;
      }

      pendingChatsRef.current = nextChats;
      return nextChats;
    });
  }

  function enqueueChatSend(input: ChatSendInput) {
    const content = input.content.trim();
    const attachments = input.attachments;

    if (!content && attachments.length === 0) {
      return;
    }

    const currentChat = activeChat ?? createEmptyChat(DEFAULT_PROJECT);
    const now = new Date().toISOString();
    const userMessage = {
      ...createMessage("user", content, "queued", undefined, attachments),
      createdAt: now,
    };
    const queuedSend: QueuedChatSend = {
      chatId: currentChat.id,
      id: createId("queued-send"),
      input: {
        ...input,
        content,
      },
      userMessageId: userMessage.id,
    };

    updateQueuedChatSends((currentQueue) => [...currentQueue, queuedSend]);
    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setChats((currentChats) => {
      const chatForQueue = currentChats.find((chat) => chat.id === currentChat.id) ?? currentChat;
      const hasCurrentChat = currentChats.some((chat) => chat.id === currentChat.id);
      const shouldGenerateTitle = chatForQueue.messages.length === 0;
      const updatedChat: ChatSummary = {
        ...chatForQueue,
        messages: [...chatForQueue.messages, userMessage],
        title: shouldGenerateTitle ? PENDING_CHAT_TITLE : chatForQueue.title,
        updatedAt: now,
      };
      const nextChats = sortChatsByUpdatedAt(hasCurrentChat ? currentChats.map((chat) => (chat.id === currentChat.id ? updatedChat : chat)) : [updatedChat, ...currentChats]);

      pendingChatsRef.current = nextChats;
      return nextChats;
    });
    touchProject(currentChat.project);
  }

  function handleDeleteQueuedMessage(messageId: string) {
    const queuedSend = queuedChatSendsRef.current.find((candidate) => candidate.userMessageId === messageId);

    if (!queuedSend) {
      return;
    }

    updateQueuedChatSends((currentQueue) => currentQueue.filter((candidate) => candidate.userMessageId !== messageId));
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === queuedSend.chatId
          ? {
              ...chat,
              messages: chat.messages.filter((message) => message.id !== messageId),
              updatedAt: new Date().toISOString(),
            }
          : chat,
      );

      pendingChatsRef.current = nextChats;
      return nextChats;
    });
  }

  function handleHoldQueuedMessage(messageId: string, held: boolean) {
    updateQueuedChatSends((currentQueue) =>
      currentQueue.map((queuedSend) =>
        queuedSend.userMessageId === messageId
          ? {
              ...queuedSend,
              held,
            }
          : queuedSend,
      ),
    );
  }

  function handleUpdateQueuedMessage(messageId: string, content: string) {
    const trimmedContent = content.trim();
    const queuedSend = queuedChatSendsRef.current.find((candidate) => candidate.userMessageId === messageId);

    if (!queuedSend || !trimmedContent) {
      return;
    }

    updateQueuedChatSends((currentQueue) =>
      currentQueue.map((candidate) =>
        candidate.userMessageId === messageId
          ? {
              ...candidate,
              input: {
                ...candidate.input,
                content: trimmedContent,
              },
            }
          : candidate,
      ),
    );
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === queuedSend.chatId
          ? {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      content: trimmedContent,
                    }
                  : message,
              ),
              updatedAt: new Date().toISOString(),
            }
          : chat,
      );

      pendingChatsRef.current = nextChats;
      return nextChats;
    });
  }

  function handleSteerQueuedMessage(messageId: string, contentOverride?: string) {
    const queuedSend = queuedChatSendsRef.current.find((candidate) => candidate.userMessageId === messageId);
    const activeGeneration = queuedSend ? activeGenerationsRef.current.get(queuedSend.chatId) : undefined;

    if (!queuedSend || !activeGeneration) {
      if (queuedSend && contentOverride?.trim()) {
        handleUpdateQueuedMessage(messageId, contentOverride);
        handleHoldQueuedMessage(messageId, false);
      }
      return;
    }

    const currentChat = pendingChatsRef.current.find((chat) => chat.id === queuedSend.chatId && !chat.archived);
    const assistantMessageIndex = currentChat ? findActiveAssistantMessageIndex(currentChat.messages) : -1;

    if (!currentChat || assistantMessageIndex < 0) {
      return;
    }

    void steerActiveResponse({
      activeGeneration,
      assistantMessageIndex,
      contentOverride,
      currentChat,
      queuedSend,
    });
  }

  async function steerActiveResponse({
    activeGeneration,
    assistantMessageIndex,
    contentOverride,
    currentChat,
    queuedSend,
  }: {
    activeGeneration: ActiveGeneration;
    assistantMessageIndex: number;
    contentOverride?: string;
    currentChat: ChatSummary;
    queuedSend: QueuedChatSend;
  }) {
    const queuedMessage = currentChat.messages.find((message) => message.id === queuedSend.userMessageId);
    const assistantMessage = currentChat.messages[assistantMessageIndex];
    const steerContent = contentOverride?.trim() || queuedMessage?.content.trim() || queuedSend.input.content.trim();

    if (!assistantMessage || assistantMessage.role !== "assistant" || !steerContent) {
      return;
    }

    const now = new Date().toISOString();
    const visibleSteerMessage: ChatMessage = {
      ...(queuedMessage ?? createMessage("user", steerContent, undefined, undefined, queuedSend.input.attachments)),
      attachments: queuedSend.input.attachments.length > 0 ? queuedSend.input.attachments : queuedMessage?.attachments,
      content: steerContent,
      source: queuedMessage?.source,
      status: undefined,
    };
    const messagesWithoutQueuedSteer = currentChat.messages.filter((message) => message.id !== queuedSend.userMessageId);
    const nextAssistantMessageIndex = messagesWithoutQueuedSteer.findIndex((message) => message.id === assistantMessage.id);

    if (nextAssistantMessageIndex < 0) {
      return;
    }

    activeGeneration.controller.abort();
    activeGenerationsRef.current.delete(activeGeneration.chatId);
    activeRequestChatIdsRef.current.delete(activeGeneration.requestId);
    updateQueuedChatSends((currentQueue) => currentQueue.filter((candidate) => candidate.id !== queuedSend.id));

    const messagesBeforeAssistant = messagesWithoutQueuedSteer.slice(0, nextAssistantMessageIndex);
    const messagesAfterAssistant = messagesWithoutQueuedSteer.slice(nextAssistantMessageIndex + 1);
    const previousChatSnapshot = {
      ...currentChat,
      messages: [...messagesBeforeAssistant, visibleSteerMessage, ...messagesAfterAssistant],
      updatedAt: now,
    };
    const { controller, requestId } = createActiveGeneration(currentChat.id, previousChatSnapshot, true, undefined, {
      messageId: assistantMessage.id,
    });
    const latestPrompt = getLatestUserPrompt(messagesBeforeAssistant);
    const steeringPrompt = [latestPrompt, `Steer: ${steerContent}`].filter(Boolean).join("\n\n");
    const partialAssistantContent = assistantMessage.content.trim();
    const steeringInstruction = createMessage("user", createSteeringInstruction(steerContent, latestPrompt));
    const providerBaseMessages = [
      ...messagesBeforeAssistant.filter((message) => message.status !== "queued"),
      ...createStoredWebSearchContext(assistantMessage, latestPrompt),
      ...(partialAssistantContent ? [createMessage("assistant", partialAssistantContent, undefined, assistantMessage.reasoning)] : []),
    ];

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === currentChat.id
          ? {
              ...chat,
              messages: [
                ...messagesBeforeAssistant,
                visibleSteerMessage,
                {
                  ...assistantMessage,
                  isStreaming: true,
                  progress: withSteeringProgress(assistantMessage.progress),
                  status: undefined,
                  thinking: assistantMessage.thinking
                    ? {
                        ...assistantMessage.thinking,
                        completedAt: undefined,
                      }
                    : assistantMessage.thinking,
                } satisfies ChatMessage,
                ...messagesAfterAssistant,
              ],
              updatedAt: now,
            }
          : chat,
      );

      pendingChatsRef.current = nextChats;
      return nextChats;
    });

    const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, queuedSend.input.localWorkspace ?? localWorkspaceRef.current);

    try {
      const messagesForProvider = await createMessagesForProvider(
        providerBaseMessages,
        steeringInstruction,
        currentChat.project,
        workspaceSettings,
        steeringPrompt,
        [],
        (notice) => {
          const compactionProgress = {
            detail: `${notice.compactedMessageCount} older messages compacted. Active request is now ${formatTokenCount(notice.afterTokens)} / ${formatTokenCount(notice.contextWindowTokens)}.`,
            id: CONTEXT_COMPACTION_PROGRESS_ID,
            label: "Automatically compacting context",
            status: "complete",
          } satisfies ChatProgressItem;

          updateGeneratedMessage(currentChat.id, assistantMessage.id, (message) => ({
            ...withContextCompactionMarker(message, notice),
            progress: withContextCompactionProgress(compactionProgress, message.progress),
          }));
        },
      );

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      const assistantResponse = await streamAssistantWithLocalTools({
        chatId: currentChat.id,
        controller,
        messageId: assistantMessage.id,
        messagesForProvider,
        prompt: steeringPrompt,
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
                      ? preserveVisibleResponseThinking(message, {
                            ...message,
                            artifacts: mergeChatArtifacts(message.artifacts, assistantResponse.artifacts),
                            content: assistantResponse.content,
                          isStreaming: false,
                          progress: withLocalComputerProgress(assistantResponse.progress, removeSteeringProgress(message.progress)),
                          reasoning: assistantResponse.reasoning,
                          toolCalls: assistantResponse.toolCalls ?? message.toolCalls,
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        })
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      notifyRunComplete({
        ...assistantMessage,
        artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
        content: assistantResponse.content,
        isStreaming: false,
        progress: withLocalComputerProgress(assistantResponse.progress, removeSteeringProgress(assistantMessage.progress)),
        reasoning: assistantResponse.reasoning,
        toolCalls: assistantResponse.toolCalls ?? assistantMessage.toolCalls,
      });
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The steered response failed.";

      updateGeneratedMessage(
        currentChat.id,
        assistantMessage.id,
        (message) => ({
          ...message,
          content: errorContent,
          isStreaming: false,
          progress: removeSteeringProgress(message.progress),
          reasoning: undefined,
          status: "error",
          thinking: message.thinking
            ? {
                ...message.thinking,
                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
              }
            : undefined,
        }),
        true,
      );
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  async function createMessagesForProvider(
    existingMessages: ChatMessage[],
    userMessage: ChatMessage,
    projectName: string,
    workspaceSettings: LocalWorkspaceSettings,
    prompt: string,
    webContextMessages: ChatMessage[] = [],
    onCompaction?: (notice: ContextCompactionNotice) => void,
  ) {
    const visibleMessages = existingMessages.filter((message) => message.status !== "error");
    const sourceControlContextMessages = await createSourceControlContextMessages(prompt);
    const projectBoundaryMessages = [createActiveProjectBoundaryMessage(projectName, workspaceSettings)];
    const pdfContextMessages = createPdfLibraryContextMessages(projectName);
    const localContextMessages = shouldSkipLocalContextForGithub(prompt)
      ? []
      : await createLocalWorkspaceContextMessages(workspaceSettings, prompt, projectName);
    const compaction = compactProviderMessages([
      ...visibleMessages,
      ...sourceControlContextMessages,
      ...projectBoundaryMessages,
      ...pdfContextMessages,
      ...localContextMessages,
      ...webContextMessages,
      userMessage,
    ]);

    if (compaction.contextCompaction) {
      onCompaction?.(compaction.contextCompaction);
    }

    return compaction.messages;
  }

  function createActiveProjectBoundaryMessage(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    const normalizedProjectName = normalizeProjectName(projectName);
    const roots = workspaceSettings.enabled && workspaceSettings.roots.length > 0 ? workspaceSettings.roots.join(" | ") : "none";

    return createMessage(
      "user",
      [
        "ACTIVE PROJECT BOUNDARY",
        `Project: ${normalizedProjectName}`,
        `Workspace roots for this request: ${roots}`,
        workspaceSettings.enabled && workspaceSettings.roots.length > 0
          ? "The workspace roots above are the authoritative selected folder context for this request."
          : "No local folder is selected for this request; do not describe any other project as a substitute. PDF export requests may still return downloadable chat artifacts directly in this conversation.",
        "Use only this active chat, these workspace roots, and this request's tool/web evidence when describing or changing a project.",
        "Treat prior file listings, terminal output, sources, or project descriptions from any other project as stale unless the user explicitly asks to compare projects.",
      ].join("\n"),
    );
  }

  async function createSourceControlContextMessages(_prompt: string) {
    return [];
  }

  function shouldSkipLocalContextForGithub(_prompt: string) {
    return false;
  }

  async function createLocalWorkspaceContextMessages(workspaceSettings: LocalWorkspaceSettings, prompt: string, projectName: string) {
    if (!workspaceSettings.enabled || !hasAnyLocalWorkspaceToolEnabled()) {
      return [];
    }

    try {
      const localContext = await createLocalWorkspaceContext(workspaceSettings, prompt, toolSettings);
      void syncLocalWorkspaceIndexSummary(projectName, workspaceSettings);
      return localContext.trim() ? [createMessage("user", localContext)] : [];
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Local computer file tool failed.";
      return [createMessage("user", `LOCAL COMPUTER FILE TOOL\nTool note: ${detail}\nContinue honestly and ask me to adjust local workspace access if needed.`)];
    }
  }

  function hasAnyLocalWorkspaceToolEnabled() {
    return (
      toolSettings.fileBrowser ||
      toolSettings.fileSearch ||
      toolSettings.codeView ||
      toolSettings.codeEdit ||
      toolSettings.fileCreation ||
      toolSettings.fileSafety ||
      toolSettings.testingTools ||
      toolSettings.typescriptTools ||
      toolSettings.sqlTools ||
      toolSettings.reactNativeTools ||
      toolSettings.codeGeneration ||
      toolSettings.sourceControl
    );
  }

  async function syncLocalWorkspaceIndexSummary(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
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

      if (isActiveChatProject(projectName)) {
        setLocalWorkspace((currentWorkspace) => {
          if (!samePathSet(currentWorkspace.roots, workspaceSettings.roots)) {
            return currentWorkspace;
          }

          localWorkspaceRef.current = nextWorkspace;
          return nextWorkspace;
        });
      }
      saveWorkspaceForProject(projectName, nextWorkspace);
    } catch {
      return;
    }
  }

  function compactProviderMessages(messages: ChatMessage[], settingsOverride?: ProviderSettings, options: { target?: number; threshold?: number; toolBridge?: ProviderToolBridgeOptions } = {}) {
    const effectiveSettings = createToolAwareProviderSettings(settingsOverride);
    const requestedThreshold = options.threshold ?? AUTO_COMPACT_CONTEXT_THRESHOLD;
    const providerCompactionBaseline = options.threshold === undefined ? getProviderCompactionBaseline(requestedThreshold) : null;
    const threshold = providerCompactionBaseline ? 0 : requestedThreshold;

    const compaction = compactMessagesForContext({
      contextWindowTokens: contextWindow.tokens,
      maxOutputTokens: effectiveSettings.maxTokens,
      messages,
      model: effectiveSettings.model,
      source: contextWindow.source,
      systemPrompt: effectiveSettings.systemPrompt,
      target: options.target,
      threshold,
      usageEstimator: (candidateMessages) =>
        estimateModelProviderPayloadUsage({
          contextWindowTokens: contextWindow.tokens,
          messages: candidateMessages,
          settings: effectiveSettings,
          source: contextWindow.source,
          toolBridge: options.toolBridge,
        }),
    });

    const contextCompaction = compaction.compacted ? recordContextCompaction(compaction, providerCompactionBaseline) : undefined;

    return {
      ...compaction,
      contextCompaction,
    };
  }

  function createContextBoundLocalToolExecutionPolicy(basePolicy: LocalComputerToolExecutionPolicy): LocalComputerToolExecutionPolicy {
    const modelVisibleResultChars = getModelVisibleToolResultCharBudget(contextWindow.tokens);

    return {
      ...basePolicy,
      maxToolCallOutputChars: minNullableCharCap(basePolicy.maxToolCallOutputChars ?? null, Math.max(modelVisibleResultChars, 96_000)),
      maxToolResultsChars: minNullableCharCap(basePolicy.maxToolResultsChars ?? null, modelVisibleResultChars),
    };
  }

  function getModelVisibleToolResultCharBudget(contextWindowTokens: number) {
    const tokenBudget = Math.min(Math.max(Math.floor(contextWindowTokens * 0.2), 6_000), 60_000);

    return tokenBudget * 4;
  }

  function minNullableCharCap(cap: number | null, budget: number) {
    if (cap === null || !Number.isFinite(cap)) {
      return budget;
    }

    return Math.min(cap, budget);
  }

  function getProviderCompactionBaseline(threshold: number) {
    const usage = lastProviderContextUsage?.chatId === activeChat.id ? lastProviderContextUsage.usage : null;

    if (!usage || usage.tokenSource === "estimate") {
      return null;
    }

    return usage.totalTokens > Math.floor(contextWindow.tokens * threshold) ? usage : null;
  }

  function recordContextCompaction(compaction: ReturnType<typeof compactMessagesForContext>, providerBaseline: ContextWindowUsage | null): ContextCompactionNotice {
    const beforeTokens = providerBaseline?.inputTokens ?? compaction.beforeUsage.inputTokens;
    const notice = {
      afterTokens: compaction.afterUsage.inputTokens,
      beforeTokens,
      chatId: activeChat.id,
      compactedAt: new Date().toISOString(),
      compactedMessageCount: compaction.compactedMessageCount,
      contextWindowTokens: compaction.afterUsage.contextWindowTokens,
      forcedByProviderUsage: Boolean(providerBaseline),
      thresholdTokens: compaction.thresholdTokens,
    } satisfies ContextCompactionNotice;

    setLastContextCompaction(notice);

    return notice;
  }

  function createContextCompactionProgress(compaction: ReturnType<typeof compactMessagesForContext> & { contextCompaction?: ContextCompactionNotice }): ChatProgressItem {
    const notice = compaction.contextCompaction;
    const afterTokens = notice?.afterTokens ?? compaction.afterUsage.inputTokens;
    const contextTokens = notice?.contextWindowTokens ?? compaction.afterUsage.contextWindowTokens;
    const compactedMessageCount = notice?.compactedMessageCount ?? compaction.compactedMessageCount;

    return {
      detail: `${compactedMessageCount} older messages compacted. Active request is now ${formatTokenCount(afterTokens)} / ${formatTokenCount(contextTokens)}.`,
      id: CONTEXT_COMPACTION_PROGRESS_ID,
      label: "Automatically compacting context",
      status: "complete",
    };
  }

  function withContextCompactionProgress(compactionProgress: ChatProgressItem, progress: ChatProgressItem[] | undefined) {
    const progressWithoutCompaction = (progress ?? []).filter((item) => item.id !== CONTEXT_COMPACTION_PROGRESS_ID);

    return [compactionProgress, ...progressWithoutCompaction];
  }

  function withContextCompactionMarker(message: ChatMessage, notice: ContextCompactionNotice | undefined): ChatMessage {
    if (!notice) {
      return message;
    }

    const marker = createChatContextCompaction(notice);
    const contextCompactions = message.contextCompactions ?? [];

    if (contextCompactions.some((candidate) => candidate.compactedAt === marker.compactedAt)) {
      return message;
    }

    return {
      ...message,
      contextCompactions: [...contextCompactions, marker],
    };
  }

  function createChatContextCompaction(notice: ContextCompactionNotice): ChatContextCompaction {
    return {
      afterTokens: notice.afterTokens,
      beforeTokens: notice.beforeTokens,
      compactedAt: notice.compactedAt,
      compactedMessageCount: notice.compactedMessageCount,
      contextWindowTokens: notice.contextWindowTokens,
      forcedByProviderUsage: notice.forcedByProviderUsage,
      thresholdTokens: notice.thresholdTokens,
    };
  }

  function recordProviderContextUsage(chatId: string, messages: ChatMessage[], settings: ProviderSettings, options: { stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    setLastProviderContextUsage({
      chatId,
      usage: estimateProviderContextUsageForDisplay(messages, settings, options),
    });
  }

  function recordProviderActualUsage(chatId: string, messages: ChatMessage[], settings: ProviderSettings, usage: Awaited<ReturnType<typeof streamProviderMessage>>["usage"], options: { stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    setLastProviderContextUsage({
      chatId,
      usage: applyProviderUsageToContextEstimate(estimateProviderContextUsageForDisplay(messages, settings, options), usage),
    });
  }

  function estimateProviderContextUsageForDisplay(messages: ChatMessage[], settings: ProviderSettings, options: { stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return estimateModelProviderPayloadUsage({
      contextWindowTokens: contextWindow.tokens,
      messages,
      settings,
      source: contextWindow.source,
      stream: options.stream ?? true,
      toolBridge: options.toolBridge,
    });
  }

  function recordPlanningProviderRequest(chatId: string, request: PlanningProviderRequest) {
    recordProviderContextUsage(chatId, request.messages, request.settings, { stream: request.stream });
  }

  function recordPlanningProviderUsage(chatId: string, request: PlanningProviderRequest, usage: Awaited<ReturnType<typeof streamProviderMessage>>["usage"]) {
    recordProviderActualUsage(chatId, request.messages, request.settings, usage, { stream: request.stream });
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
    const maxTokens = getEffectiveMaxOutputTokens(mergedSettings, contextWindow.tokens);

    return {
      ...mergedSettings,
      maxTokens,
      thinking: {
        ...mergedSettings.thinking,
        enabled: mergedSettings.tools.thinking && mergedSettings.thinking.enabled && supportsProviderThinking(mergedSettings.provider, mergedSettings.thinking.effort, mergedSettings.model),
      },
    };
  }

  function createPromptAwareProviderSettings(prompt: string, overrides: Partial<ProviderSettings> = {}): ProviderSettings {
    const settings = createToolAwareProviderSettings(overrides);

    return {
      ...settings,
      thinking: createPromptAwareThinkingSettings(settings.thinking, prompt),
    };
  }

  function createPromptAwareThinkingSettings(thinking: ProviderSettings["thinking"], prompt: string): ProviderSettings["thinking"] {
    if (!thinking.enabled || isDeepResearchThinking(thinking) || !shouldUseLighterThinkingForPrompt(prompt)) {
      return thinking;
    }

    if (thinking.effort === "high" || thinking.effort === "medium") {
      return {
        ...thinking,
        effort: "low",
      };
    }

    return thinking;
  }

  function shouldUseLighterThinkingForPrompt(prompt: string) {
    const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();

    if (!normalizedPrompt || COMPLEX_THINKING_PROMPT_PATTERN.test(normalizedPrompt)) {
      return false;
    }

    const wordCount = normalizedPrompt.split(/\s+/).filter(Boolean).length;

    return wordCount <= SIMPLE_THINKING_PROMPT_MAX_WORDS && SIMPLE_THINKING_PROMPT_PATTERN.test(normalizedPrompt);
  }

  function createFinalOnlyProviderSettings(prompt?: string): ProviderSettings {
    const tools = normalizeToolRegistrySettings(providerSettings.tools);

    const settings = createToolAwareProviderSettings({
      tools: {
        ...tools,
        browserPreview: false,
        codeEdit: false,
        codeGeneration: false,
        codeView: false,
        colorTools: false,
        desktopComputer: false,
        fileCreation: false,
        fileSafety: false,
        fileBrowser: false,
        fileSearch: false,
        mcpServers: false,
        pdfTools: false,
        permissions: false,
        planning: false,
        reactNativeTools: false,
        sourceControl: false,
        sqlTools: false,
        terminal: false,
        testingTools: false,
        typescriptTools: false,
        webSearch: false,
        weatherTools: false,
        workflowAutomation: false,
      },
    });

    return prompt
      ? {
          ...settings,
          thinking: createPromptAwareThinkingSettings(settings.thinking, prompt),
        }
      : settings;
  }

  function rememberSessionApprovalDecision(approval: AgentApproval, decision: AgentApprovalDecision, workspaceSettings: LocalWorkspaceSettings) {
    if (decision.scope !== "session" || decision.status === "denied" || approval.tool === "planning_handoff") {
      return;
    }

    const workspaceKey = createApprovalWorkspaceSessionKey(workspaceSettings);
    const workspaceDecisions = sessionApprovalDecisionsRef.current[workspaceKey] ?? {};
    const exactDecision: AgentApprovalDecision = {
      editedArgs: decision.editedArgs,
      note: decision.note,
      scope: "session",
      status: decision.status,
    };
    const reusableDecision: AgentApprovalDecision = {
      note: decision.note,
      scope: "session",
      status: "approved",
    };
    const reusableKey = createApprovalSessionDecisionKey(approval);
    const shouldReuseForToolSession = decision.status === "approved" && !decision.editedArgs;

    sessionApprovalDecisionsRef.current = {
      ...sessionApprovalDecisionsRef.current,
      [workspaceKey]: {
        ...workspaceDecisions,
        [approval.id]: exactDecision,
        ...(shouldReuseForToolSession ? { [reusableKey]: reusableDecision } : {}),
      },
    };
  }

  function createRuntimeApprovalDecisions(workspaceSettings: LocalWorkspaceSettings, approvalDecisions?: Record<string, AgentApprovalDecision>) {
    const sessionDecisions = sessionApprovalDecisionsRef.current[createApprovalWorkspaceSessionKey(workspaceSettings)] ?? {};

    if (Object.keys(sessionDecisions).length === 0) {
      return approvalDecisions;
    }

    return {
      ...sessionDecisions,
      ...(approvalDecisions ?? {}),
    };
  }

  function getRuntimeWebSearchMaxResults(settings: ProviderSettings, requestedMaxResults?: number) {
    const requested = requestedMaxResults ?? settings.webSearch.maxResults;
    const deepMinimum = isDeepResearchThinking(createToolAwareProviderSettings(settings).thinking) ? MAX_WEB_SEARCH_RESULTS : requested;

    return Math.min(Math.max(Math.round(Math.max(requested, deepMinimum)), 1), MAX_WEB_SEARCH_RESULTS);
  }

  function getRuntimeWebSearchSettings(settings: ProviderSettings, requestedWebSearch?: ChatSendInput["webSearch"] | ChatWebSearch): WebSearchSettings {
    return {
      ...settings.webSearch,
      maxResults: getRuntimeWebSearchMaxResults(settings, requestedWebSearch?.maxResults),
      provider: requestedWebSearch?.provider ?? settings.webSearch.provider,
    };
  }

  function shouldIncludeVisualWebResults(webSearchSettings: WebSearchSettings, workspaceSettings: LocalWorkspaceSettings, mode: ChatMessage["mode"] | undefined, discordReply: boolean) {
    return webSearchSettings.provider === "brave" && webSearchSettings.brave.showImageResults && mode !== "plan" && !workspaceSettings.enabled && !discordReply;
  }

  function createAppAgentToolCall(messageId: string, status: ChatToolCall["status"], detail: string, output?: string, fileChanges?: ChatToolCall["fileChanges"]): ChatToolCall {
    return {
      detail,
      fileChanges,
      id: `app-agent-run-${messageId}`,
      label: "Agent run",
      output,
      status,
    };
  }

  function appendAgentRuntimeStep(runId: string | undefined, type: AgentRun["steps"][number]["type"], label: string, detail?: string) {
    updateAgentRun(runId, (run, now) => ({
      ...run,
      steps: [
        ...run.steps.map((step) =>
          step.status === "running"
            ? {
                ...step,
                completedAt: step.completedAt ?? now,
                status: "completed" as const,
              }
            : step,
        ),
        {
          detail,
          id: createId("agent-step"),
          label,
          startedAt: now,
          status: "running",
          type,
        },
      ],
      updatedAt: now,
    }));
  }

  function completeLatestAgentRuntimeStep(runId: string | undefined, status: AgentRun["steps"][number]["status"], detail?: string) {
    updateAgentRun(runId, (run, now) => ({
      ...run,
      steps: run.steps.map((step, index) =>
        index === run.steps.length - 1 && step.status === "running"
          ? {
              ...step,
              completedAt: now,
              detail: detail ?? step.detail,
              status,
            }
          : step,
      ),
      updatedAt: now,
    }));
  }

  function mapAgentDecisionToStepType(decision: AgentRuntimeDecision): AgentRun["steps"][number]["type"] {
    if (decision.action === "read") return "read";
    if (decision.action === "edit") return "edit";
    if (decision.action === "create") return "create";
    if (decision.action === "terminal" || decision.action === "verify") return "terminal";
    if (decision.action === "git") return "git";
    return "synthesis";
  }

  async function runAppOwnedCodingAgent({
    chatId,
    controller,
    messageId,
    messagesForProvider,
    onExternalUpdate,
    prompt,
    requestId,
    runId,
    workspaceSettings,
  }: {
    chatId: string;
    controller: AbortController;
    messageId: string;
    messagesForProvider: ChatMessage[];
    onExternalUpdate?: (update: DiscordStreamUpdate) => void;
    prompt: string;
    requestId: number;
    runId?: string;
    workspaceSettings: LocalWorkspaceSettings;
  }): Promise<AssistantToolResponse> {
    const request = createAgentRunRequest({
      chatId,
      goal: prompt,
      messageId,
      mode: "execute",
      source: "auto",
      workspace: workspaceSettings,
    });
    const baseToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY;
    const toolExecutionPolicy = createContextBoundLocalToolExecutionPolicy(baseToolExecutionPolicy);
    const runtimeWebSearchMaxResults = getRuntimeWebSearchMaxResults(providerSettings);
    const runtimeWebSearchSettings: WebSearchSettings = {
      ...providerSettings.webSearch,
      maxResults: runtimeWebSearchMaxResults,
    };
    const agentToolCall = (status: ChatToolCall["status"], detail: string, output?: string, fileChanges?: ChatToolCall["fileChanges"]) =>
      createAppAgentToolCall(messageId, status, detail, output, fileChanges);
    const allArtifacts: ChatArtifact[] = [];
    const allSources: ChatSource[] = [];
    let visibleToolCall = agentToolCall("active", "Starting app-owned coding agent");
    let runtimeMessages = [...messagesForProvider];
    let localProgress = createLocalComputerProgress("active", "Starting app-owned coding agent");
    let executedCount = 0;

    updateGeneratedMessage(chatId, messageId, (message) => ({
      ...message,
      content: "",
      progress: withLocalComputerProgress(localProgress, message.progress),
      toolCalls: [visibleToolCall],
    }));
    onExternalUpdate?.({
      progress: localProgress,
      status: "Starting app-owned coding agent...",
      toolCall: visibleToolCall,
    });

    const executeInternalToolStep = async (toolContent: string, label: string, type: AgentRun["steps"][number]["type"]) => {
      if (!toolContent.trim()) {
        throw new Error(`${label} did not produce an executable internal action.`);
      }

      appendAgentRuntimeStep(runId, type, label);
      localProgress = createLocalComputerProgress("active", label);
      visibleToolCall = agentToolCall("active", label);
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        toolCalls: [visibleToolCall],
      }));
      onExternalUpdate?.({
        progress: localProgress,
        status: `${label}...`,
        toolCall: visibleToolCall,
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings),
        assistantContent: toolContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, runtimeMessages, prompt, controller.signal),
        settings: workspaceSettings,
        signal: controller.signal,
        toolSettings,
        userPrompt: prompt,
        webSearchSettings: runtimeWebSearchSettings,
        webSearchMaxResults: runtimeWebSearchMaxResults,
      });

      if (toolRun.browserPreviewUrl && toolSettings.browserPreview) {
        setBrowserPreviewTarget((currentTarget) => ({
          id: (currentTarget?.id ?? 0) + 1,
          url: toolRun.browserPreviewUrl!,
        }));
      }

      allArtifacts.push(...(toolRun.artifacts ?? []));
      allSources.push(...toolRun.sources);
      executedCount += toolRun.executedCount;
      attachLiveTerminalSession(toolRun.toolCalls);
      const fileChanges = toolRun.toolCalls.flatMap((toolCall) => toolCall.fileChanges ?? []);
      const stepStatus: AgentRun["steps"][number]["status"] = toolRun.waitingForApproval ? "waiting_for_approval" : toolRun.toolCalls.some((toolCall) => toolCall.status === "error") ? "failed" : "completed";
      completeLatestAgentRuntimeStep(runId, stepStatus, toolRun.progress.detail);
      runtimeMessages = [
        ...runtimeMessages,
        createMessage(
          "user",
          [
            "APP AGENT INTERNAL OBSERVATION",
            "Gilbert executed an app-owned internal action. Use this as real evidence. Do not expose internal tool syntax.",
            toolRun.contextMessage,
          ].join("\n\n"),
        ),
      ];

      visibleToolCall = agentToolCall(
        toolRun.waitingForApproval ? "waiting_approval" : stepStatus === "failed" ? "error" : "complete",
        label,
        limitFallbackToolOutput(toolRun.contextMessage),
        fileChanges.length > 0 ? fileChanges : undefined,
      );
      localProgress = toolRun.waitingForApproval
        ? toolRun.progress
        : createLocalComputerProgress(stepStatus === "failed" ? "complete" : "active", toolRun.waitingForApproval ? "Waiting for approval" : `${executedCount} internal action${executedCount === 1 ? "" : "s"} ran`);
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: [visibleToolCall],
      }));

      if (toolRun.waitingForApproval) {
        return {
          waiting: true as const,
          response: {
            approvalRequests: toolRun.approvalRequests.map((approval) => ({
              ...approval,
              messageId,
              resumeToolCallContent: toolContent,
            })),
            artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
            content: "",
            pendingToolCallContent: toolContent,
            progress: toolRun.progress,
            sources: allSources,
            toolCalls: [visibleToolCall],
            waitingForApproval: true,
          } satisfies AssistantToolResponse,
        };
      }

      return { waiting: false as const };
    };
    const sanitizeAppAgentFinalContent = (content: string) => {
      const sanitized = sanitizeLocalToolCallsForDisplay(content, toolExecutionPolicy).trim();

      if (
        !sanitized ||
        looksLikeOnlyToolPrelude(sanitized) ||
        looksLikeInternalToolRecoveryAnswer(sanitized) ||
        looksLikeToolProtocolNarration(sanitized) ||
        looksLikeUnexecutedToolActionPromise(sanitized)
      ) {
        return "";
      }

      return sanitized;
    };

    const initialWorkflow = await executeInternalToolStep(createAgentRunWorkflowToolContent(request), "Gathering workspace evidence", "search");
    if (initialWorkflow.waiting) {
      return initialWorkflow.response;
    }

    const seenDecisionSignatures = new Set<string>();
    const maxDecisionPasses = 5;

    for (let loopIndex = 0; loopIndex < maxDecisionPasses; loopIndex += 1) {
      if (isRequestInactive(requestId, controller)) {
        return {
          content: "",
          progress: localProgress,
          toolCalls: [visibleToolCall],
        };
      }

      appendAgentRuntimeStep(runId, "synthesis", "Choose next agent action");
      const decisionInstruction = createMessage("user", createAgentRuntimeDecisionInstruction({ goal: prompt, loopIndex }));
      const decisionSettings = {
        ...createFinalOnlyProviderSettings(prompt),
        maxTokens: Math.max(createFinalOnlyProviderSettings(prompt).maxTokens, 4096),
        temperature: Math.min(providerSettings.temperature, 0.2),
      };
      const decisionMessages = compactProviderMessages([...runtimeMessages, decisionInstruction], decisionSettings).messages;

      recordProviderContextUsage(chatId, decisionMessages, decisionSettings, { stream: false });
      const decisionResponse = await sendProviderMessage(decisionSettings, decisionMessages, {
        signal: controller.signal,
      });
      recordProviderActualUsage(chatId, decisionMessages, decisionSettings, decisionResponse.usage, { stream: false });
      completeLatestAgentRuntimeStep(runId, "completed");

      const decision = parseAgentRuntimeDecision(decisionResponse.content);

      if (!decision) {
        if (hasLocalComputerToolCalls(decisionResponse.content, toolExecutionPolicy)) {
          const recoveredStep = await executeInternalToolStep(decisionResponse.content, "Running recovered model action", "tool");
          if (recoveredStep.waiting) {
            return recoveredStep.response;
          }
          continue;
        }

        const sanitizedInvalidDecision = sanitizeAppAgentFinalContent(decisionResponse.content);
        runtimeMessages = [
          ...runtimeMessages,
          createMessage(
            "user",
            [
              "The previous action decision was invalid JSON and no executable internal action was found.",
              sanitizedInvalidDecision ? `Non-tool text from that invalid response:\n${sanitizedInvalidDecision.slice(0, 1200)}` : "",
              "Return one valid JSON action now, or use action=answer if enough evidence exists.",
            ].filter(Boolean).join("\n\n"),
          ),
        ];
        continue;
      }

      const decisionSignature = JSON.stringify({
        action: decision.action,
        command: decision.command,
        cwd: decision.cwd,
        edits: decision.edits,
        files: decision.files,
        paths: decision.paths,
        tool: decision.tool,
      });

      if (seenDecisionSignatures.has(decisionSignature)) {
        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: "I stopped the agent run because the same internal action repeated. The gathered evidence is in Activity; try a narrower request or adjust the target file/path.",
          progress: createLocalComputerProgress("complete", "Repeated internal action stopped"),
          sources: allSources,
          toolCalls: [agentToolCall("error", "Repeated internal action stopped", visibleToolCall.output, visibleToolCall.fileChanges)],
        };
      }

      seenDecisionSignatures.add(decisionSignature);

      if (decision.action === "answer") {
        const finalProgress = createLocalComputerProgress("complete", `${executedCount} internal action${executedCount === 1 ? "" : "s"} ran`);
        const finalToolCall = agentToolCall("complete", "Agent run complete", visibleToolCall.output, visibleToolCall.fileChanges);
        const finalContent = sanitizeAppAgentFinalContent(decision.answer ?? "");
        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: finalContent || "The app-owned agent run completed.",
          progress: finalProgress,
          sources: allSources,
          toolCalls: [finalToolCall],
        };
      }

      const primitiveContent = createAgentPrimitiveToolContent(decision);
      const stepResult = await executeInternalToolStep(primitiveContent, summarizeAgentRuntimeDecision(decision), mapAgentDecisionToStepType(decision));
      if (stepResult.waiting) {
        return stepResult.response;
      }
    }

    const fallbackSettings = createFinalOnlyProviderSettings(prompt);
    const fallbackMessages = compactProviderMessages([
      ...runtimeMessages,
      createMessage(
        "user",
        [
          "The app-owned agent runtime reached its decision-pass limit.",
          "Write the best final user-facing answer from the gathered evidence. Do not request more tools or mention internal protocol.",
        ].join("\n"),
      ),
    ], fallbackSettings).messages;
    const fallbackResponse = await sendProviderMessage(fallbackSettings, fallbackMessages, {
      signal: controller.signal,
    });
    let fallbackContent = sanitizeAppAgentFinalContent(fallbackResponse.content);

    if (!fallbackContent && hasLocalComputerToolCalls(fallbackResponse.content, toolExecutionPolicy)) {
      const recoveredStep = await executeInternalToolStep(fallbackResponse.content, "Running recovered final action", "tool");
      if (recoveredStep.waiting) {
        return recoveredStep.response;
      }

      const recoverySynthesisSettings = createFinalOnlyProviderSettings(prompt);
      const recoverySynthesisMessages = compactProviderMessages([
        ...runtimeMessages,
        createMessage(
          "user",
          [
            "A previous final response emitted an internal tool action. Gilbert executed it internally.",
            "Now write the final user-facing answer from the gathered evidence.",
            "Do not emit tool calls, function-call syntax, provider-native tool JSON, strict envelopes, or protocol discussion.",
          ].join("\n"),
        ),
      ], recoverySynthesisSettings).messages;
      const recoverySynthesisResponse = await sendProviderMessage(recoverySynthesisSettings, recoverySynthesisMessages, {
        signal: controller.signal,
      });
      fallbackContent = sanitizeAppAgentFinalContent(recoverySynthesisResponse.content);
    }

    return {
      artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      content: fallbackContent || "The app-owned agent run reached its step limit before producing a clean final answer. The gathered evidence is in Activity.",
      progress: createLocalComputerProgress("complete", `${executedCount} internal action${executedCount === 1 ? "" : "s"} ran`),
      reasoning: fallbackResponse.reasoning,
      sources: allSources,
      toolCalls: [agentToolCall("complete", "Agent run complete", visibleToolCall.output, visibleToolCall.fileChanges)],
    };
  }

  async function streamAssistantWithLocalTools({
    approvalDecisions,
    chatId,
    controller,
    messageId,
    messagesForProvider,
    onExternalUpdate,
    previousToolCalls,
    prompt,
    requestId,
    resumeToolCallContent,
    workspaceSettings,
  }: {
    approvalDecisions?: Record<string, AgentApprovalDecision>;
    chatId: string;
    controller: AbortController;
    messageId: string;
    messagesForProvider: ChatMessage[];
    onExternalUpdate?: (update: DiscordStreamUpdate) => void;
    previousToolCalls?: ChatToolCall[];
    prompt: string;
    requestId: number;
    resumeToolCallContent?: string;
    workspaceSettings: LocalWorkspaceSettings;
  }): Promise<AssistantToolResponse> {
    let messages = messagesForProvider;
    let localProgress: ChatProgressItem | undefined;
    let finalResponse: AssistantToolResponse = {
      content: "",
      reasoning: undefined,
      toolCalls: undefined,
    };

    let totalExecutedToolCalls = 0;
    let allArtifacts: ChatArtifact[] = [];
    let allToolCalls: ChatToolCall[] = [];
    let finalizationRetries = 0;
    let freshLocalToolEvidenceRetries = 0;
    let malformedToolRecoveryRetries = 0;
    let recoverableEditRetries = 0;
    let emptyScaffoldRecoveryUsed = false;

    let passIndex = 0;
    const baseRuntimeSettings = createPromptAwareProviderSettings(prompt);
    const deepResearch = isDeepResearchThinking(baseRuntimeSettings.thinking);
    const baseToolExecutionPolicy = deepResearch ? DEEP_RESEARCH_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY : STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY;
    const toolExecutionPolicy = createContextBoundLocalToolExecutionPolicy(baseToolExecutionPolicy);
    const runtimeWebSearchMaxResults = getRuntimeWebSearchMaxResults(providerSettings);
    const runtimeWebSearchSettings: WebSearchSettings = {
      ...providerSettings.webSearch,
      maxResults: runtimeWebSearchMaxResults,
    };
    const simpleLocalScaffoldRequest = isSimpleLocalScaffoldRequest(prompt) && !deepResearch;
    const maxToolPasses = deepResearch ? MAX_DEEP_RESEARCH_TOOL_PASSES : simpleLocalScaffoldRequest ? 5 : MAX_LOCAL_TOOL_PASSES;
    const maxToolExecutions = deepResearch ? MAX_DEEP_RESEARCH_TOOL_EXECUTIONS : simpleLocalScaffoldRequest ? 16 : MAX_LOCAL_TOOL_EXECUTIONS;
    const bridgeRegistry = createDefaultToolRegistry();
    const bridgeToolResultMessages: ToolResultMessage[] = [];

    function maybeFinishSimpleLocalScaffold(reasoning?: string): typeof finalResponse | null {
      if (!simpleLocalScaffoldRequest) {
        return null;
      }

      const completion = detectSimpleLocalTaskCompletion(prompt, allToolCalls);

      if (!completion) {
        return null;
      }

      const content = createSimpleLocalTaskCompletionAnswer(completion);
      const completedProgress = createLocalComputerProgress("complete", "Starter app verified");
      localProgress = completedProgress;
      finalResponse = {
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
        content,
        progress: completedProgress,
        reasoning,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: "completed",
        artifacts: allArtifacts.length > 0 ? mergeChatArtifacts(message.artifacts, allArtifacts) : message.artifacts,
        content,
        progress: withLocalComputerProgress(completedProgress, message.progress),
        toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        content,
        progress: completedProgress,
        status: "Starter app verified.",
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      return finalResponse;
    }

    function createSimpleScaffoldToolPlanContent() {
      return "";
    }

    async function recoverEmptySimpleScaffold(reasoning?: string): Promise<typeof finalResponse | null> {
      emptyScaffoldRecoveryUsed = true;
      const recoveryPassIndex = passIndex + 1;
      const recoveryToolContent = createSimpleScaffoldToolPlanContent();
      const activeProgress = createLocalComputerProgress("active", "Scaffolding empty starter app");
      const activeToolCalls = createActiveLocalToolCalls(recoveryToolContent, recoveryPassIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: "running",
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? [...allToolCalls, ...activeToolCalls] : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: "Scaffolding empty starter app...",
        toolCall: activeToolCalls[0],
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions),
        assistantContent: recoveryToolContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal),
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], recoveryPassIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: [...allToolCalls, ...liveToolCalls],
          }));
          onExternalUpdate?.({
            progress: activeProgress,
            status: formatDiscordToolStatus(stampedToolCall),
            toolCall: stampedToolCall,
          });
        },
        settings: workspaceSettings,
        signal: controller.signal,
        toolSettings,
        userPrompt: prompt,
        webSearchSettings: runtimeWebSearchSettings,
        webSearchMaxResults: runtimeWebSearchMaxResults,
      });

      if (toolRun.browserPreviewUrl && toolSettings.browserPreview) {
        setBrowserPreviewTarget((currentTarget) => ({
          id: (currentTarget?.id ?? 0) + 1,
          url: toolRun.browserPreviewUrl!,
        }));
      }

      totalExecutedToolCalls += toolRun.executedCount;
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, recoveryPassIndex);
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allToolCalls = [...allToolCalls, ...completedToolCalls];
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent: recoveryToolContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? recoveryToolContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: toolRun.waitingForApproval ? "waiting_for_approval" : "running",
        approvals: toolRun.waitingForApproval ? mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []) : message.approvals,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: toolRun.waitingForApproval ? "Tool approval is needed in Gilbert Codex." : `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (toolRun.waitingForApproval) {
        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      const completedResponse = maybeFinishSimpleLocalScaffold(reasoning);
      if (completedResponse) {
        return completedResponse;
      }

      messages = [
        ...messages,
        createMessage("assistant", recoveryToolContent),
        createMessage("user", toolRun.contextMessage),
        createMessage("user", createLocalToolFinalInstruction(prompt)),
      ];
      passIndex = recoveryPassIndex + 1;
      return null;
    }

    async function synthesizeAnswerFromSavedToolResults(
      synthesisMessages: ChatMessage[],
      detail: string,
      fallbackReasoning?: string,
      synthesisToolBridge?: ProviderToolBridgeOptions,
    ): Promise<typeof finalResponse | null> {
      if (isRequestInactive(requestId, controller)) {
        return null;
      }

      const activeProgress = createLocalComputerProgress("active", allToolCalls.length > 0 ? "Writing final answer from gathered tool results" : "Recovering final answer");
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: allToolCalls.length > 0 ? "Writing final answer from gathered tool results..." : "Recovering final answer...",
      });

      const baseSynthesisSettings = createFinalOnlyProviderSettings(prompt);
      const synthesisSettings: ProviderSettings = {
        ...baseSynthesisSettings,
        maxTokens: Math.max(baseSynthesisSettings.maxTokens, deepResearch ? DEEP_RESEARCH_MIN_TOKENS : LOCAL_TOOL_FINAL_MIN_TOKENS),
        thinking: {
          ...baseSynthesisSettings.thinking,
          enabled: false,
          effort: "minimal",
        },
        temperature: Math.min(baseSynthesisSettings.temperature, 0.25),
      };
      const synthesisRetries = [
        "",
        [
          "The previous final-answer attempt exposed internal runtime state instead of answering the user.",
          "Rewrite only the user-facing answer. Do not mention the app, provider, tool loop, tool calls, saved evidence, continuation, fallback, or recovery.",
        ].join("\n"),
      ];

      for (const retryInstruction of synthesisRetries) {
        const synthesisDetail = [
          allToolCalls.length > 0
            ? `The prior tool pass supplied ${totalExecutedToolCalls} observation${totalExecutedToolCalls === 1 ? "" : "s"} for this request.`
            : "Use the conversation, web-search, and local workspace context already provided above as evidence.",
          detail,
          "Use those observations silently and write only the visible answer the user asked for.",
          retryInstruction,
        ].filter(Boolean).join("\n");
        const synthesisInstruction = allToolCalls.length > 0
          ? createLocalToolBudgetFinalInstruction(prompt, synthesisDetail)
          : createFinalAnswerRecoveryInstruction(prompt, synthesisDetail);
        const synthesisCompaction = compactProviderMessages([...synthesisMessages, createMessage("user", synthesisInstruction)], synthesisSettings, {
          toolBridge: synthesisToolBridge,
        });

        if (synthesisCompaction.contextCompaction) {
          const compactionProgress = createContextCompactionProgress(synthesisCompaction);

          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...withContextCompactionMarker(message, synthesisCompaction.contextCompaction),
            progress: withContextCompactionProgress(compactionProgress, message.progress),
          }));
        }

        try {
          recordProviderContextUsage(chatId, synthesisCompaction.messages, synthesisSettings, { stream: false, toolBridge: synthesisToolBridge });
          const response = await sendProviderMessage(synthesisSettings, synthesisCompaction.messages, {
            signal: controller.signal,
            toolBridge: synthesisToolBridge,
          });
          recordProviderActualUsage(chatId, synthesisCompaction.messages, synthesisSettings, response.usage, { stream: false, toolBridge: synthesisToolBridge });

          if (isRequestInactive(requestId, controller)) {
            return null;
          }

          const content = sanitizeLocalToolCallsForDisplay(response.content, toolExecutionPolicy).trim();

          if (!content || looksLikeOnlyToolPrelude(content) || looksLikeInternalToolRecoveryAnswer(content) || looksLikeFabricatedToolActivity(content, allToolCalls)) {
            continue;
          }

          return {
            content,
            artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
            progress: localProgress,
            reasoning: response.reasoning ?? fallbackReasoning,
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          };
        } catch (error) {
          if (isAbortError(error) || isRequestInactive(requestId, controller)) {
            throw error;
          }

          return null;
        }
      }

      return null;
    }

    function createBridgeSynthesisToolBridgeOptions(): ProviderToolBridgeOptions | undefined {
      return bridgeToolResultMessages.length > 0
        ? {
            maxToolResultContentChars: getModelVisibleToolResultCharBudget(contextWindow.tokens),
            toolChoice: "none",
            toolResultMessages: bridgeToolResultMessages,
            tools: [],
          }
        : undefined;
    }

    if (resumeToolCallContent) {
      const activeProgress = createLocalComputerProgress("active", "Resuming approved tool action");
      const activeToolCalls = createActiveLocalToolCalls(resumeToolCallContent, passIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: "running",
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? activeToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: activeProgress.label,
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions),
        assistantContent: resumeToolCallContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal),
        previousToolCalls,
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: liveToolCalls,
          }));
          onExternalUpdate?.({
            progress: activeProgress,
            status: formatDiscordToolStatus(stampedToolCall),
            toolCall: stampedToolCall,
          });
        },
        settings: workspaceSettings,
        signal: controller.signal,
        toolSettings,
        userPrompt: prompt,
        webSearchSettings: runtimeWebSearchSettings,
        webSearchMaxResults: runtimeWebSearchMaxResults,
      });

      if (toolRun.browserPreviewUrl && toolSettings.browserPreview) {
        setBrowserPreviewTarget((currentTarget) => ({
          id: (currentTarget?.id ?? 0) + 1,
          url: toolRun.browserPreviewUrl!,
        }));
      }

      totalExecutedToolCalls += toolRun.executedCount;
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allToolCalls = stampLocalToolCallIds(toolRun.toolCalls, passIndex);
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? resumeToolCallContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: toolRun.waitingForApproval ? "waiting_for_approval" : "running",
        approvals: toolRun.waitingForApproval ? mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []) : message.approvals,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: toolRun.waitingForApproval ? "Tool approval is needed in Gilbert Codex." : `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (toolRun.waitingForApproval) {
        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      const simpleScaffoldResponse = maybeFinishSimpleLocalScaffold(undefined);
      if (simpleScaffoldResponse) {
        return simpleScaffoldResponse;
      }

      messages = [
        ...messages,
        createMessage("assistant", resumeToolCallContent),
        createMessage("user", toolRun.contextMessage),
      ];
      passIndex += 1;
    }

    while (!isRequestInactive(requestId, controller)) {
      const toolBudgetReached = passIndex >= maxToolPasses || totalExecutedToolCalls >= maxToolExecutions;
      const runtimeSettings = toolBudgetReached ? createFinalOnlyProviderSettings(prompt) : createPromptAwareProviderSettings(prompt);
      const minPassTokens = deepResearch ? DEEP_RESEARCH_MIN_TOKENS : localProgress ? LOCAL_TOOL_FINAL_MIN_TOKENS : 0;
      const passSettings: ProviderSettings = minPassTokens > 0
        ? {
            ...runtimeSettings,
            maxTokens: Math.max(runtimeSettings.maxTokens, minPassTokens),
          }
        : runtimeSettings;
      const bridgeContext: ToolExecutionContext = {
        model: passSettings.model,
        permissionMode: workspaceSettings.permissionMode,
        provider: passSettings.provider,
        signal: controller.signal,
        workspaceRoots: workspaceSettings.roots,
      };
      const bridgeTools = toolBudgetReached ? [] : bridgeRegistry.listForContext(bridgeContext);
      const bridgeOptions = bridgeTools.length > 0 || bridgeToolResultMessages.length > 0
        ? {
            maxToolResultContentChars: getModelVisibleToolResultCharBudget(contextWindow.tokens),
            toolChoice: toolBudgetReached ? "none" as const : "auto" as const,
            toolResultMessages: bridgeToolResultMessages,
            tools: bridgeTools,
          }
        : undefined;
      const passCompaction = compactProviderMessages(messages, passSettings, { toolBridge: bridgeOptions });
      if (passCompaction.compacted) {
        const compactionProgress = createContextCompactionProgress(passCompaction);

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withContextCompactionMarker(message, passCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
        onExternalUpdate?.({
          progress: compactionProgress,
          status: "Compacting local chat context...",
        });
      }
      messages = passCompaction.compacted && localProgress ? appendAutoCompactionContinuation(passCompaction.messages, prompt, totalExecutedToolCalls) : passCompaction.messages;
      let assistantResponse: Awaited<ReturnType<typeof streamProviderMessageWithRetry>>;

      try {
        assistantResponse = await streamProviderMessageWithRetry(
          chatId,
          passSettings,
          messages,
          (snapshot) => {
            if (isRequestInactive(requestId, controller)) {
              return;
            }

            const streamingToolRequestContent = routePrimitiveEvidenceBatchToWorkflow(
              createAssistantToolRequestContent(snapshot.content, snapshot.reasoning, toolExecutionPolicy),
              prompt,
              toolSettings,
              toolExecutionPolicy,
            );
            const hasStreamingLocalToolCalls = hasLocalComputerToolCalls(streamingToolRequestContent, toolExecutionPolicy);
            const streamingToolCalls = hasStreamingLocalToolCalls ? createActiveLocalToolCalls(streamingToolRequestContent, passIndex, toolExecutionPolicy) : [];
            const promisedToolAction = !hasStreamingLocalToolCalls && looksLikeUnexecutedToolActionPromise(snapshot.content);
            const streamingLocalProgress = hasStreamingLocalToolCalls
              ? createLocalComputerProgress("active", formatLocalToolPreviewProgress(streamingToolCalls))
              : promisedToolAction
                ? createLocalComputerProgress("active", "Preparing file changes")
                : localProgress;
            const sanitizedContent = hasStreamingLocalToolCalls ? "" : sanitizeLocalToolCallsForDisplay(snapshot.content, toolExecutionPolicy);
            const visibleContent = promisedToolAction || looksLikeFabricatedToolActivity(sanitizedContent, allToolCalls) || looksLikeToolProtocolNarration(sanitizedContent) ? "" : sanitizedContent;
            const visibleReasoning = hasStreamingLocalToolCalls && snapshot.reasoning
              ? sanitizeLocalToolCallsForDisplay(snapshot.reasoning, toolExecutionPolicy)
              : snapshot.reasoning;

            updateGeneratedMessage(chatId, messageId, (message) => ({
              ...message,
              content: visibleContent,
              progress: streamingLocalProgress ? withLocalComputerProgress(streamingLocalProgress, message.progress) : message.progress,
              reasoning: visibleReasoning || undefined,
              thinking: message.thinking,
              toolCalls: streamingToolCalls.length > 0 ? [...allToolCalls, ...streamingToolCalls] : message.toolCalls,
            }));
            onExternalUpdate?.({
              content: visibleContent,
              progress: streamingLocalProgress,
              status: hasStreamingLocalToolCalls ? "Preparing tool request..." : promisedToolAction ? "Preparing file changes..." : visibleContent ? "Streaming answer..." : "Thinking...",
            });
          },
          {
            signal: controller.signal,
            toolBridge: bridgeOptions,
          },
          messageId,
        );
      } catch (error) {
        if (isAbortError(error) || isRequestInactive(requestId, controller) || allToolCalls.length === 0) {
          throw error;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          messages,
          "The streaming final response failed after the app gathered tool results.",
          undefined,
          createBridgeSynthesisToolBridgeOptions(),
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          reasoning: undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (assistantResponse.toolCalls?.length) {
        const activeProgress = createLocalComputerProgress("active", "Running bridge diagnostic tools");
        let liveBridgeToolCalls: ChatToolCall[] = [];

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          content: "",
          progress: withLocalComputerProgress(activeProgress, message.progress),
          toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
        }));
        onExternalUpdate?.({
          progress: activeProgress,
          status: activeProgress.label,
        });

        const bridgeRun = await executeToolBridgeCalls({
          calls: assistantResponse.toolCalls,
          context: bridgeContext,
          onToolCallUpdate: (toolCall) => {
            const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

            if (!stampedToolCall) {
              return;
            }

            liveBridgeToolCalls = upsertToolCall(liveBridgeToolCalls, stampedToolCall);
            updateGeneratedMessage(chatId, messageId, (message) => ({
              ...message,
              content: "",
              progress: withLocalComputerProgress(activeProgress, message.progress),
              toolCalls: [...allToolCalls, ...liveBridgeToolCalls],
            }));
            onExternalUpdate?.({
              progress: activeProgress,
              status: formatDiscordToolStatus(stampedToolCall),
              toolCall: stampedToolCall,
            });
          },
          registry: bridgeRegistry,
        });
        const completedBridgeToolCalls = stampLocalToolCallIds(bridgeRun.toolCalls, passIndex);
        totalExecutedToolCalls += bridgeRun.executedCount;
        bridgeToolResultMessages.push(...bridgeRun.resultMessages);
        allToolCalls = [...allToolCalls, ...completedBridgeToolCalls];
        localProgress = createLocalComputerProgress("complete", `${bridgeRun.executedCount} bridge diagnostic tool${bridgeRun.executedCount === 1 ? "" : "s"} ran`);

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          content: "",
          progress: withLocalComputerProgress(localProgress, message.progress),
          toolCalls: allToolCalls,
        }));
        onExternalUpdate?.({
          progress: localProgress,
          status: `${bridgeRun.executedCount} bridge diagnostic tool${bridgeRun.executedCount === 1 ? "" : "s"} completed.`,
          toolCall: allToolCalls[allToolCalls.length - 1],
        });

        passIndex += 1;
        continue;
      }

      const assistantToolRequestContent = routePrimitiveEvidenceBatchToWorkflow(
        createAssistantToolRequestContent(assistantResponse.content, assistantResponse.reasoning, toolExecutionPolicy),
        prompt,
        toolSettings,
        toolExecutionPolicy,
      );
      const assistantHasLocalToolCalls = hasLocalComputerToolCalls(assistantToolRequestContent, toolExecutionPolicy);
      const assistantDisplayReasoning = assistantHasLocalToolCalls && assistantResponse.reasoning
        ? sanitizeLocalToolCallsForDisplay(assistantResponse.reasoning, toolExecutionPolicy) || undefined
        : assistantResponse.reasoning;

      finalResponse = {
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
        content: assistantHasLocalToolCalls ? "" : sanitizeLocalToolCallsForDisplay(assistantResponse.content, toolExecutionPolicy),
        reasoning: assistantDisplayReasoning,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };

      if (isRequestInactive(requestId, controller)) {
        return {
          ...finalResponse,
          progress: localProgress,
        };
      }

      if (!assistantHasLocalToolCalls && shouldSynthesizeEmptyFinalFromToolResults(finalResponse.content, allToolCalls)) {
        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          messages,
          "The provider returned no visible final answer after completed tool results. Use the attached tool result messages and write the requested answer now.",
          assistantResponse.reasoning,
          createBridgeSynthesisToolBridgeOptions(),
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          reasoning: assistantResponse.reasoning,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (toolBudgetReached && assistantHasLocalToolCalls) {
        finalizationRetries += 1;

        if (finalizationRetries <= MAX_TOOL_FINALIZATION_RETRIES) {
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(createLocalComputerProgress("active", "Synthesizing gathered tool results"), message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          onExternalUpdate?.({
            progress: createLocalComputerProgress("active", "Synthesizing gathered tool results"),
            status: "Synthesizing gathered tool results...",
          });
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage(
              "user",
              createLocalToolBudgetFinalInstruction(
                prompt,
                [
                  `The app already gathered ${totalExecutedToolCalls} local tool result${totalExecutedToolCalls === 1 ? "" : "s"} across ${passIndex} pass${passIndex === 1 ? "" : "es"}.`,
                  "The previous assistant response requested more tools, but the next step is to synthesize from the saved results unless user input is truly required.",
                ].join("\n"),
              ),
            ),
          ];
          passIndex += 1;
          continue;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent)],
          "The model requested more tools after the configured tool budget. Synthesize from the saved results instead of asking for more tools.",
          assistantResponse.reasoning,
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          reasoning: assistantResponse.reasoning,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (!assistantHasLocalToolCalls) {
        const fabricatedToolActivity = looksLikeFabricatedToolActivity(finalResponse.content, allToolCalls);
        const toolProtocolNarration = looksLikeToolProtocolNarration(finalResponse.content);
        const unexecutedToolActionPromise = looksLikeUnexecutedToolActionPromise(finalResponse.content);
        const localToolEvidenceRequired =
          allToolCalls.length === 0 &&
          freshLocalToolEvidenceRetries < 1 &&
          !toolBudgetReached &&
          needsFreshLocalToolEvidence(prompt, workspaceSettings.enabled);

        if (localToolEvidenceRequired || looksLikeOnlyToolPrelude(finalResponse.content) || looksLikeInternalToolRecoveryAnswer(finalResponse.content) || fabricatedToolActivity || toolProtocolNarration || unexecutedToolActionPromise) {
          if (localToolEvidenceRequired) {
            freshLocalToolEvidenceRetries += 1;
          }
          finalizationRetries += 1;

          if (finalizationRetries > MAX_TOOL_FINALIZATION_RETRIES) {
            const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
              [...messages, createMessage("assistant", assistantResponse.content)],
              fabricatedToolActivity
                ? "The previous finalization attempt claimed tool activity that was not backed by app tool-call records. Do not repeat that claim."
                : toolProtocolNarration
                  ? "The previous finalization attempt exposed tool-call protocol narration. Do not repeat it."
                : unexecutedToolActionPromise
                  ? "The previous finalization attempt promised a tool action without executing it. Do not repeat the promise."
                : "The previous finalization attempt exposed tool activity instead of a user-facing answer. Write the actual answer from the completed tool evidence.",
              assistantResponse.reasoning,
            );

            if (synthesizedResponse) {
              return synthesizedResponse;
            }

            return {
              artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
              content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
              progress: localProgress,
              reasoning: assistantResponse.reasoning,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            };
          }

          const recoveryProgress = localProgress ?? createLocalComputerProgress("active", "Recovering final answer");
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(recoveryProgress, message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          onExternalUpdate?.({
            progress: recoveryProgress,
            status: localToolEvidenceRequired ? "Requesting fresh tool evidence..." : localProgress ? "Synthesizing gathered tool results..." : "Recovering final answer...",
          });
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage(
              "user",
              localToolEvidenceRequired
                ? createFreshLocalToolEvidenceInstruction(prompt, finalResponse.content)
                : fabricatedToolActivity
                ? createFabricatedToolActivityRecoveryInstruction(prompt, finalResponse.content, allToolCalls)
                : toolProtocolNarration
                  ? createToolProtocolNarrationRecoveryInstruction(prompt, finalResponse.content)
                : unexecutedToolActionPromise
                  ? createToolActionPromiseRecoveryInstruction(prompt, finalResponse.content)
                : localProgress
                ? createLocalToolFinalInstruction(prompt)
                : createFinalAnswerRecoveryInstruction(
                    prompt,
                    "The previous response exposed internal continuation text instead of answering the user. Rewrite it as the actual final answer now.",
                  ),
            ),
          ];
          passIndex += 1;
          continue;
        }

        return {
          ...finalResponse,
          progress: localProgress,
        };
      }

      const activeProgress = createLocalComputerProgress("active", deepResearch ? "Running deep research tools" : "Running requested agent tools");
      const activeToolCalls = createActiveLocalToolCalls(assistantToolRequestContent, passIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? [...allToolCalls, ...activeToolCalls] : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: activeProgress.label,
        toolCall: activeToolCalls[0],
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions),
        assistantContent: assistantToolRequestContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal),
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: [...allToolCalls, ...liveToolCalls],
          }));
          onExternalUpdate?.({
            progress: activeProgress,
            status: formatDiscordToolStatus(stampedToolCall),
            toolCall: stampedToolCall,
          });
        },
        settings: workspaceSettings,
        signal: controller.signal,
        toolSettings,
        userPrompt: prompt,
        webSearchSettings: runtimeWebSearchSettings,
        webSearchMaxResults: runtimeWebSearchMaxResults,
      });

      if (toolRun.browserPreviewUrl && toolSettings.browserPreview) {
        setBrowserPreviewTarget((currentTarget) => ({
          id: (currentTarget?.id ?? 0) + 1,
          url: toolRun.browserPreviewUrl!,
        }));
      }

      totalExecutedToolCalls += toolRun.executedCount;
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, passIndex);
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allToolCalls = [...allToolCalls, ...completedToolCalls];
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", deepResearch ? `${totalExecutedToolCalls} deep research tools ran` : `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent: assistantToolRequestContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? assistantToolRequestContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      if (toolRun.waitingForApproval) {
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          agentRunStatus: "waiting_for_approval",
          approvals: mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []),
          artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
          content: "",
          progress: withLocalComputerProgress(toolRun.progress, message.progress),
          sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
          toolCalls: allToolCalls,
        }));
        onExternalUpdate?.({
          progress: toolRun.progress,
          sources: toolRun.sources,
          status: "Tool approval is needed in Gilbert Codex.",
          toolCall: allToolCalls[allToolCalls.length - 1],
        });

        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      if (toolRun.requestedCount === 0) {
        malformedToolRecoveryRetries += 1;

        if (malformedToolRecoveryRetries <= MAX_MALFORMED_TOOL_RECOVERY_RETRIES) {
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(createLocalComputerProgress("active", "Recovering tool request"), message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage("user", createMalformedToolCallRecoveryInstruction(prompt)),
          ];
          passIndex += 1;
          continue;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent)],
          "The previous assistant output looked like an unreadable tool request. Write the final answer from the completed tool evidence.",
          assistantResponse.reasoning,
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: sanitizeLocalToolCallsForDisplay(assistantResponse.content, toolExecutionPolicy) || createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          reasoning: assistantResponse.reasoning,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (!emptyScaffoldRecoveryUsed && isEmptySelectedScaffoldProbe(prompt, toolRun.contextMessage, completedToolCalls)) {
        const recoveredResponse = await recoverEmptySimpleScaffold(assistantResponse.reasoning);
        if (recoveredResponse) {
          return recoveredResponse;
        }
        continue;
      }

      const hasRecoverableToolFailure =
        toolRun.requestedCount > 0 &&
        isRecoverableLocalEditFailure(toolRun.contextMessage, completedToolCalls, toolRun.recoverableFailure);

      if (hasRecoverableToolFailure && recoverableEditRetries < MAX_RECOVERABLE_LOCAL_EDIT_RETRIES) {
        recoverableEditRetries += 1;
        const retryProgress = createLocalComputerProgress("active", "Recovering file change");

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          content: "",
          progress: withLocalComputerProgress(retryProgress, message.progress),
          sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
          toolCalls: allToolCalls,
        }));
        onExternalUpdate?.({
          progress: retryProgress,
          sources: toolRun.sources,
          status: "Recovering file change...",
          toolCall: allToolCalls[allToolCalls.length - 1],
        });

        messages = [
          ...messages,
          createMessage("assistant", assistantToolRequestContent),
          createMessage("user", toolRun.contextMessage),
          createMessage("user", createRecoverableLocalEditRetryInstruction(prompt, toolRun.contextMessage, toolRun.recoverableFailure)),
        ];
        passIndex += 1;
        continue;
      }

      if (toolRun.directAnswer) {
        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: toolRun.directAnswer,
          progress: localProgress,
          reasoning: finalResponse.reasoning,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (toolRun.requestedCount > 0 && toolRun.executedCount === 0) {
        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent), createMessage("user", toolRun.contextMessage)],
          createNoExecutedToolFinalInstruction(toolRun.contextMessage, hasRecoverableToolFailure),
          assistantResponse.reasoning,
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createNoExecutedToolFinalAnswer(toolRun.contextMessage),
          progress: localProgress,
          reasoning: assistantResponse.reasoning,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      const simpleScaffoldResponse = maybeFinishSimpleLocalScaffold(assistantResponse.reasoning);
      if (simpleScaffoldResponse) {
        return simpleScaffoldResponse;
      }

      const nextPassWillReachBudget = passIndex + 1 >= maxToolPasses || totalExecutedToolCalls >= maxToolExecutions;
      messages = [
        ...messages,
        createMessage("assistant", assistantToolRequestContent),
        createMessage("user", toolRun.contextMessage),
        ...(nextPassWillReachBudget
          ? [
              createMessage(
                "user",
                createLocalToolBudgetFinalInstruction(
                  prompt,
                  `The app has gathered ${totalExecutedToolCalls} local tool result${totalExecutedToolCalls === 1 ? "" : "s"} across ${passIndex + 1} pass${passIndex + 1 === 1 ? "" : "es"}. Synthesize the answer from those results now unless user input is required.`,
                ),
              ),
            ]
          : []),
      ];

      passIndex += 1;
    }

    return {
      ...finalResponse,
      progress: localProgress,
    };
  }

  function createToolFinalAnswerUnavailableMessage(toolCalls: ChatToolCall[] = [], originalPrompt = "") {
    const gitFallback = createGitToolFallbackAnswer(toolCalls, originalPrompt);

    if (gitFallback) {
      return gitFallback;
    }

    const latestIssueToolCall = [...toolCalls].reverse().find((toolCall) => toolCall.status !== "complete" && (toolCall.output || toolCall.detail));
    const latestToolCall = latestIssueToolCall ?? [...toolCalls].reverse().find((toolCall) => toolCall.output || toolCall.detail);

    if (!latestToolCall) {
      return "I could not finish a clean response from the available tool results. Please retry the last request.";
    }

    if (!latestToolCall) {
      return "The model finished without producing a final answer for this run. Try sending the prompt again — the tool runs above should make the next attempt faster.";
    }

    const rawLatestOutput = latestToolCall.output ? latestToolCall.output : latestToolCall.detail ? latestToolCall.detail : "";
    const fallbackOutput = latestToolCall.status === "complete"
      ? summarizeCompletedToolFallback(latestToolCall, rawLatestOutput)
      : summarizeUnsuccessfulToolSection(rawLatestOutput);

    if (latestToolCall.status === "complete") {
      return [
        `Latest completed result: ${latestToolCall.label}`,
        fallbackOutput,
      ].filter(Boolean).join("\n\n");
    }

    return [
      `The run stopped on this ${latestToolCall.label} result:`,
      latestToolCall.status ? `Status: ${latestToolCall.status}` : "",
      fallbackOutput,
    ].filter(Boolean).join("\n\n");

  }

  function summarizeCompletedToolFallback(toolCall: ChatToolCall, output: string) {
    const trimmed = output.trim();

    if (!trimmed) {
      return "The tool completed, but the model did not produce a final response. Open Activity for the saved run details.";
    }

    if (shouldKeepToolOutputOutOfChat(toolCall, trimmed)) {
      const structuredSummary = createCompletedToolFallbackSummary(toolCall, trimmed);

      if (structuredSummary) {
        return structuredSummary;
      }

      return [
        "The tool completed, but the model did not produce a final response.",
        `I kept the raw ${toolCall.label.toLowerCase()} output out of the chat because it is too large or file-content-like.`,
        "Open Activity for the exact result, or retry the request so the model can synthesize from the saved tool results.",
      ].join("\n");
    }

    return limitFallbackToolOutput(trimmed);
  }

  function shouldKeepToolOutputOutOfChat(toolCall: ChatToolCall, output: string) {
    if (/read (workspace )?file/i.test(toolCall.label)) {
      return true;
    }

    return output.length > 4_000 || countTextLines(output) > 120;
  }

  function countTextLines(value: string) {
    if (!value) {
      return 0;
    }

    const newlineCount = value.match(/\n/g)?.length ?? 0;
    return value.endsWith("\n") ? newlineCount : newlineCount + 1;
  }

  function limitFallbackToolOutput(output: string) {
    const trimmed = output.trim();
    const maxChars = Math.min(getModelVisibleToolResultCharBudget(contextWindow.tokens), 4_000);

    if (trimmed.length <= maxChars) {
      return trimmed;
    }

    return `${trimmed.slice(0, maxChars)}\n\n[Fallback output truncated for chat readability. Open Activity for the exact omitted output.]`;
  }

  function createGitToolFallbackAnswer(toolCalls: ChatToolCall[], originalPrompt: string) {
    const gitStatusOutputs = toolCalls
      .filter((toolCall) => /^git status$/i.test(toolCall.label) && toolCall.output)
      .map((toolCall) => toolCall.output ?? "");
    const gitDiffOutputs = toolCalls
      .filter((toolCall) => /^git diff$/i.test(toolCall.label) && toolCall.output)
      .map((toolCall) => toolCall.output ?? "");

    if (gitStatusOutputs.length === 0 && gitDiffOutputs.length === 0) {
      return "";
    }

    const statusFiles = parseGitStatusFallbackFiles(gitStatusOutputs.join("\n"));
    const diffStats = parseGitDiffStatFallbackFiles(gitDiffOutputs.join("\n"));
    const changedPathCount = statusFiles.length || diffStats.length;
    const grouped = groupGitStatusFallbackFiles(statusFiles);
    const diffOnly = diffStats.filter((stat) => !statusFiles.some((file) => file.path === stat.path));
    const wantsAll = /\b(all|every|everything|single|period|not miss|missing nothing|full|complete|deep)\b/i.test(originalPrompt);

    return [
      changedPathCount > 0
        ? `Here is a Git overview built from the tool output (${changedPathCount} changed path${changedPathCount === 1 ? "" : "s"}).`
        : "Git ran, but no changed paths could be parsed from the tool output.",
      wantsAll ? "Every parsed path is listed below." : "",
      formatGitStatusFallbackGroup("Modified", grouped.modified),
      formatGitStatusFallbackGroup("Added / untracked", grouped.added),
      formatGitStatusFallbackGroup("Deleted", grouped.deleted),
      formatGitStatusFallbackGroup("Renamed / copied", grouped.renamed),
      formatGitStatusFallbackGroup("Other changed", grouped.other),
      diffOnly.length > 0 ? ["Diff-stat-only paths:", ...diffOnly.map((file) => `- ${file.path}${formatGitStatSuffix(file)}`)].join("\n") : "",
      gitDiffOutputs.some((output) => /Output truncated:\s*yes/i.test(output))
        ? "Git output reported truncation. The next review pass should split by explicit file paths until every path is covered."
        : "",
    ].filter(Boolean).join("\n\n");
  }

  function parseGitStatusFallbackFiles(output: string) {
    const stdout = extractToolStdout(output);
    const files: Array<{ path: string; status: string }> = [];

    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trimEnd();

      if (!line || line.startsWith("##") || line.startsWith("warning:")) {
        continue;
      }

      const match = line.match(/^(.{1,2})\s+(.+)$/);

      if (!match) {
        continue;
      }

      const status = match[1].trim();
      const path = cleanGitFallbackPath(match[2]);

      if (status && path) {
        files.push({ path, status });
      }
    }

    return dedupeGitFallbackFiles(files);
  }

  function parseGitDiffStatFallbackFiles(output: string) {
    const stdout = extractToolStdout(output);
    const files: Array<{ additions: number; deletions: number; path: string }> = [];

    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trimEnd();

      if (!line || line.startsWith("diff --git ") || line.startsWith("UNTRACKED FILES") || line.startsWith("=====")) {
        continue;
      }

      const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)(?:\s+([+\-]+))?\s*$/);

      if (!match) {
        continue;
      }

      const path = cleanGitFallbackPath(match[1]);
      const markers = match[3] ?? "";

      if (path) {
        files.push({
          additions: Array.from(markers).filter((char) => char === "+").length,
          deletions: Array.from(markers).filter((char) => char === "-").length,
          path,
        });
      }
    }

    return files;
  }

  function extractToolStdout(output: string) {
    const stdoutIndex = output.indexOf("\nSTDOUT\n");

    if (stdoutIndex === -1) {
      return output;
    }

    const stderrIndex = output.indexOf("\nSTDERR", stdoutIndex + 8);
    return stderrIndex === -1 ? output.slice(stdoutIndex + 8) : output.slice(stdoutIndex + 8, stderrIndex);
  }

  function cleanGitFallbackPath(value: string) {
    return value.trim().replace(/^"|"$/g, "").replace(/\s+\([^)]+\)$/g, "");
  }

  function dedupeGitFallbackFiles(files: Array<{ path: string; status: string }>) {
    const seen = new Set<string>();
    const deduped: Array<{ path: string; status: string }> = [];

    for (const file of files) {
      if (seen.has(file.path)) {
        continue;
      }
      seen.add(file.path);
      deduped.push(file);
    }

    return deduped;
  }

  function groupGitStatusFallbackFiles(files: Array<{ path: string; status: string }>) {
    const grouped = {
      added: [] as Array<{ path: string; status: string }>,
      deleted: [] as Array<{ path: string; status: string }>,
      modified: [] as Array<{ path: string; status: string }>,
      other: [] as Array<{ path: string; status: string }>,
      renamed: [] as Array<{ path: string; status: string }>,
    };

    for (const file of files) {
      if (file.status === "??" || file.status.includes("A")) {
        grouped.added.push(file);
      } else if (file.status.includes("D")) {
        grouped.deleted.push(file);
      } else if (file.status.includes("R") || file.status.includes("C")) {
        grouped.renamed.push(file);
      } else if (file.status.includes("M")) {
        grouped.modified.push(file);
      } else {
        grouped.other.push(file);
      }
    }

    return grouped;
  }

  function formatGitStatusFallbackGroup(label: string, files: Array<{ path: string; status: string }>) {
    if (files.length === 0) {
      return "";
    }

    return [`${label} (${files.length}):`, ...files.map((file) => `- ${file.status} ${file.path}`)].join("\n");
  }

  function formatGitStatSuffix(file: { additions: number; deletions: number }) {
    const stats = [file.additions > 0 ? `+${file.additions}` : "", file.deletions > 0 ? `-${file.deletions}` : ""].filter(Boolean).join(" ");
    return stats ? ` (${stats})` : "";
  }

  function createNoExecutedToolFinalInstruction(contextMessage: string, retryBudgetExhausted = false) {
    const hasError = /\bTOOL\s+\d+\s+\[error\]:/i.test(contextMessage);
    const hasEditFailure = /\bedit_file\b/i.test(contextMessage);

    return [
      retryBudgetExhausted
        ? "A recoverable local edit/write failure still could not be completed within the retry budget."
        : "",
      hasError
        ? "At least one requested tool call failed before any successful tool result was produced."
        : "Every requested tool call in the last pass was skipped, blocked, or paused before any successful tool result was produced.",
      hasEditFailure
        ? "If this was a malformed or mismatched edit, state that no file was changed; do not present replacement code as if it was applied."
        : "",
      retryBudgetExhausted
        ? "Do not request more tools in this final synthesis pass because the bounded recovery loop has already been used."
        : "Do not request more tools in this final synthesis pass because the remaining blocker is not recoverable by changing tool arguments.",
      "Do not paste raw tool output, Activity blocks, stack traces, adaptation recommendations, or tool-loop wording.",
      "Do not claim success for an edit, command, file read, or web search unless the tool result says it completed.",
      "Explain the blocker in one concise user-facing sentence and give the best next step from the available evidence.",
    ].filter(Boolean).join(" ");
  }

  function createNoExecutedToolFinalAnswer(contextMessage: string) {
    const unsuccessfulSection = extractFirstUnsuccessfulToolSection(contextMessage);

    if (!unsuccessfulSection) {
      return "I could not complete that tool action, and no file changes were applied. Check Activity for the exact tool result.";
    }

    return [
      "I could not complete that tool action, and no file changes were applied.",
      summarizeUnsuccessfulToolSection(unsuccessfulSection),
    ].filter(Boolean).join("\n\n");
  }

  function extractFirstUnsuccessfulToolSection(contextMessage: string) {
    const match = contextMessage.match(/\n?TOOL\s+\d+\s+\[(?:skipped|error|waiting_approval)\]:[^\n]*(?:\n[\s\S]*?)(?=\nTOOL\s+\d+(?:\s+\[[^\]]+\])?:|\nAUTO SYNTAX CHECK\b|$)/i);

    if (!match) {
      return "";
    }

    return match[0].trim();
  }

  function summarizeUnsuccessfulToolSection(section: string) {
    const body = stripToolSectionHeader(stripToolAdaptationRecommendation(section));
    const normalized = body.replace(/\s+/g, " ").trim();

    if (!normalized) {
      return "";
    }

    if (/edit_file needs old_text\/new_text/i.test(normalized)) {
      return "The edit request was malformed: `edit_file` needs `old_text`/`new_text`, `start_line`/`end_line`/`content`, `insert_at_line`/`content`, or `start_char`/`end_char`/`content`.";
    }

    if (/\b(?:blocked|permission|approval|workspace roots?|read-only|outside the enabled workspace)\b/i.test(normalized)) {
      return normalized.slice(0, 500);
    }

    return normalized.slice(0, 500);
  }

  function stripToolSectionHeader(section: string) {
    return section.replace(/^\s*TOOL\s+\d+\s+\[(?:skipped|error|waiting_approval)\]:[^\n]*\n?/i, "").trim();
  }

  function stripToolAdaptationRecommendation(value: string) {
    const index = value.toLowerCase().indexOf("adaptation recommendation");
    if (index === -1) {
      return value.trim();
    }

    return value.slice(0, index).replace(/[^\w`"'./\\:()[\]{}]+$/g, "").trim();
  }

  function appendAutoCompactionContinuation(messages: ChatMessage[], prompt: string, executedToolCalls: number) {
    const lastMessage = messages[messages.length - 1];

    if (lastMessage?.content.includes("AUTO COMPACTION CONTINUATION")) {
      return messages;
    }

    return [
      ...messages,
      createMessage(
        "user",
        [
          "AUTO COMPACTION CONTINUATION",
          `Original user request: ${prompt}`,
          executedToolCalls > 0 ? `Completed tool calls so far: ${executedToolCalls}.` : "",
          "The app compacted older context to stay inside the provider context window.",
          "Continue the same response from the latest preserved tool results above. Do not restart, repeat old analysis, or ask the user to resend context.",
          "If a file edit, write, or command just completed, treat it as already completed and continue from that exact state.",
        ]
          .filter(Boolean)
          .join("\n\n"),
      ),
    ];
  }

  async function runParallelSubagents(tasks: LocalSubagentTask[], baseMessages: ChatMessage[], prompt: string, signal?: AbortSignal): Promise<LocalSubagentResult[]> {
    const baseSubagentSettings = createFinalOnlyProviderSettings();
    const subagentSettings: ProviderSettings = {
      ...baseSubagentSettings,
      maxTokens: Math.max(baseSubagentSettings.maxTokens, 2048),
      temperature: Math.min(baseSubagentSettings.temperature ?? 0.7, 0.3),
    };

    return Promise.all(
      tasks.map(async (task, index) => {
        const title = task.title || `Sub-agent ${index + 1}`;

        try {
          const response = await sendProviderMessage(
            subagentSettings,
            [
              ...baseMessages,
              createMessage(
                "user",
                [
                  "PARALLEL SUB-AGENT TASK",
                  `Main user request: ${prompt}`,
                  `Sub-agent title: ${title}`,
                  task.prompt,
                  "Return concise findings with evidence from the provided chat/tool context. Do not claim to edit files or run tools.",
                ].join("\n\n"),
              ),
            ],
            { signal },
          );

          return {
            content: response.content,
            id: task.id || `subagent-${index + 1}`,
            title,
          };
        } catch (error) {
          return {
            content: "",
            error: error instanceof Error ? error.message : "Sub-agent failed.",
            id: task.id || `subagent-${index + 1}`,
            title,
          };
        }
      }),
    );
  }

  async function streamProviderMessageWithRetry(
    chatId: string,
    settings: ProviderSettings,
    messages: ChatMessage[],
    onUpdate: Parameters<typeof streamProviderMessage>[2],
    options: Parameters<typeof streamProviderMessage>[3] = {},
    messageId?: string,
  ) {
    recordProviderContextUsage(chatId, messages, settings, { toolBridge: options.toolBridge });

    try {
      const response = await streamProviderMessage(settings, messages, onUpdate, options);
      recordProviderActualUsage(chatId, messages, settings, response.usage, { toolBridge: options.toolBridge });
      return response;
    } catch (error) {
      if (options.signal?.aborted || !isRetryableProviderMessageError(error)) {
        throw error;
      }

      const retrySettings = createEmptyResponseRetrySettings(settings);
      const retryCompaction = compactProviderMessages(messages, retrySettings, {
        target: 0.5,
        threshold: 0,
        toolBridge: options.toolBridge,
      });
      const compactedMessages = retryCompaction.messages;

      if (messageId && retryCompaction.contextCompaction) {
        const compactionProgress = createContextCompactionProgress(retryCompaction);

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withContextCompactionMarker(message, retryCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      }

      const retryInstruction = createMessage(
        "user",
        createProviderRetryInstruction(messages, isProviderEmptyResponseError(error)),
      );
      const retryMessages = [...compactedMessages, retryInstruction];

      recordProviderContextUsage(chatId, retryMessages, retrySettings, { toolBridge: options.toolBridge });

      const response = await runProviderRetryWithTimeout(options.signal, (signal) =>
        streamProviderMessage(retrySettings, retryMessages, onUpdate, {
          ...options,
          signal,
        }),
      );
      recordProviderActualUsage(chatId, retryMessages, retrySettings, response.usage, { toolBridge: options.toolBridge });
      return response;
    }
  }

  async function runProviderRetryWithTimeout<T>(parentSignal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) {
    const retryController = new AbortController();
    const abortRetry = () => retryController.abort();
    const timeoutId = window.setTimeout(abortRetry, MESSAGE_RETRY_TIMEOUT_MS);

    if (parentSignal?.aborted) {
      window.clearTimeout(timeoutId);
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    parentSignal?.addEventListener("abort", abortRetry, { once: true });

    try {
      return await run(retryController.signal);
    } catch (error) {
      if (retryController.signal.aborted && !parentSignal?.aborted) {
        throw new Error("The response retry did not finish within 10 seconds.");
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortRetry);
    }
  }

  function createProviderRetryInstruction(messages: ChatMessage[], emptyResponse: boolean) {
    return [
      emptyResponse ? "RETRY AFTER EMPTY PROVIDER RESPONSE" : "RETRY AFTER TRANSIENT PROVIDER FAILURE",
      emptyResponse ? "The previous stream produced no visible final answer." : "The previous provider request failed before a complete visible answer was produced.",
      hasLocalToolEvidence(messages)
        ? "Previously gathered observations are already present above. Use them silently: emit the next needed tool_call only if work is unfinished, or write the direct final answer if it is done."
        : "Answer the latest real user request above now.",
      "Keep hidden reasoning brief and produce visible text. Do not leave the visible answer blank.",
      "Do not mention provider behavior, app recovery, saved evidence, tool loops, continuation, fallback text, or retry attempts.",
    ].join("\n\n");
  }

  function isRetryableProviderMessageError(error: unknown) {
    if (isProviderEmptyResponseError(error)) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();

    return (
      /\bhttp\s+(?:408|409|425|429|500|502|503|504|520|521|522|523|524)\b/.test(message) ||
      /\b(max(?:imum)? context length|context length|context window|too many tokens|requested about \d+ tokens|reduce the length)\b/.test(message) ||
      /\b(fetch failed|failed to fetch|network|timeout|timed out|temporarily unavailable|connection reset|connection refused|econnreset|etimedout)\b/.test(message)
    );
  }

  function hasLocalToolEvidence(messages: ChatMessage[]) {
    return messages.some(
      (message) =>
        message.content.includes("AGENT TOOL RESULTS") ||
        message.content.includes("LOCAL COMPUTER TOOL RESULTS") ||
        message.toolCalls?.some((toolCall) => toolCall.status === "complete" || toolCall.status === "error" || toolCall.status === "skipped"),
    );
  }

  function createEmptyResponseRetrySettings(settings: ProviderSettings): ProviderSettings {
    const retrySettings: ProviderSettings = {
      ...settings,
      maxTokens: Math.max(settings.maxTokens, LOCAL_TOOL_FINAL_MIN_TOKENS),
      temperature: Math.min(settings.temperature, 0.25),
    };

    if (!settings.thinking.enabled) {
      return retrySettings;
    }

    return {
      ...retrySettings,
      thinking: {
        ...settings.thinking,
        enabled: false,
        effort: "minimal",
      },
    };
  }

  function updateGeneratedMessage(chatId: string, messageId: string, updateMessage: (message: ChatMessage) => ChatMessage, sortByUpdatedAt = false) {
    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: chat.messages.map((message) => (message.id === messageId ? preserveVisibleResponseThinking(message, updateMessage(message)) : message)),
              updatedAt: sortByUpdatedAt ? new Date().toISOString() : chat.updatedAt,
            }
          : chat,
      );

      return sortByUpdatedAt ? sortChatsByUpdatedAt(nextChats) : nextChats;
    });
  }

  function preserveVisibleResponseThinking(previousMessage: ChatMessage, nextMessage: ChatMessage): ChatMessage {
    if (previousMessage.role !== "assistant" || nextMessage.role !== "assistant") {
      return nextMessage;
    }

    const previousVisibleContent = previousMessage.content.trim();
    const nextVisibleContent = nextMessage.content.trim();
    const replacedVisibleContent = shouldPreserveResponseThinking(previousVisibleContent, nextVisibleContent);
    const responseThinking = mergeResponseThinking(
      mergeResponseThinking(previousMessage.responseThinking, nextMessage.responseThinking),
      replacedVisibleContent ? previousVisibleContent : undefined,
    );

    if (!responseThinking) {
      return nextMessage;
    }

    return {
      ...nextMessage,
      responseThinking,
    };
  }

  function shouldPreserveResponseThinking(previousContent: string, nextContent: string) {
    if (!previousContent || previousContent.length < 24 || INTERNAL_ASSISTANT_STATUS_MESSAGES.has(previousContent)) {
      return false;
    }

    if (looksLikeToolProtocolNarration(previousContent) || hasLocalComputerToolCalls(previousContent, STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY)) {
      return false;
    }

    if (nextContent && (nextContent.startsWith(previousContent) || previousContent.startsWith(nextContent))) {
      return false;
    }

    return true;
  }

  function mergeResponseThinking(existing: string | undefined, next: string | undefined) {
    const existingText = existing?.trim() ?? "";
    const nextText = next?.trim() ?? "";

    if (!nextText) {
      return existingText || undefined;
    }

    if (!existingText || nextText.startsWith(existingText)) {
      return nextText;
    }

    if (existingText.includes(nextText) || existingText.endsWith(nextText)) {
      return existingText;
    }

    if (nextText.includes(existingText)) {
      return nextText;
    }

    return `${existingText}\n\n${nextText}`;
  }

  async function prepareWebSearchForGeneration({
    chatId,
    controller,
    maxResults,
    messageId,
    query,
    requestId,
    webSearchSettings,
    includeVisualResults,
  }: {
    chatId: string;
    controller: AbortController;
    includeVisualResults: boolean;
    maxResults: number;
    messageId: string;
    query: string;
    requestId: number;
    webSearchSettings: WebSearchSettings;
  }): Promise<{ contextMessages: ChatMessage[]; sources: ChatSource[] }> {
    const providerLabel = formatWebSearchProviderLabel(webSearchSettings.provider);
    const activeWebSearch: ChatWebSearch = {
      enabled: true,
      maxResults,
      provider: webSearchSettings.provider,
      query,
      status: "active",
    };

    updateGeneratedMessage(chatId, messageId, (message) => ({
      ...message,
      progress: withWebSearchProgress(activeWebSearch, message.progress),
      webSearch: activeWebSearch,
    }));

    try {
      const searchResponse = await searchWebWithProvider(query, {
        ...webSearchSettings,
        maxResults,
      }, {
        includeVisualResults,
        maxResults,
        signal: controller.signal,
      });

      if (isRequestInactive(requestId, controller)) {
        return {
          contextMessages: [],
          sources: [],
        };
      }

      const sources = createChatSourcesFromWebResults(searchResponse.results);
      if (sources.length === 0) {
        throw new Error(`${providerLabel} returned no usable sources.`);
      }
      const usedFallback = searchResponse.provider !== searchResponse.primaryProvider;
      const fallbackReason = usedFallback ? searchResponse.fallbackError : undefined;
      const completedWebSearch: ChatWebSearch = {
        ...activeWebSearch,
        fallbackReason,
        resultCount: sources.length,
        resultProvider: usedFallback ? searchResponse.provider : undefined,
        searchedAt: new Date().toISOString(),
        status: "complete",
      };

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        progress: withWebSearchProgress(completedWebSearch, message.progress),
        sources: sources.length > 0 ? sources : undefined,
        webSearch: completedWebSearch,
      }));

      const contextProvider = searchResponse.provider;
      const contextNote = fallbackReason ? `${providerLabel} failed, so ${formatWebSearchProviderLabel(contextProvider)} fallback results were used: ${fallbackReason}` : undefined;

      return {
        contextMessages: createWebSearchContextMessage(query, sources, contextNote, contextProvider),
        sources,
      };
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return {
          contextMessages: [],
          sources: [],
        };
      }

      const detail = error instanceof Error ? error.message : `${providerLabel} search failed.`;
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
        contextMessages: createWebSearchContextMessage(query, [], detail, webSearchSettings.provider),
        sources: [],
      };
    }
  }

  function createStoredWebSearchContext(message: ChatMessage, fallbackQuery: string) {
    if (!message.webSearch?.enabled) {
      return [];
    }

    const contextProvider = message.webSearch.resultProvider ?? message.webSearch.provider;
    const fallbackNote =
      message.webSearch.fallbackReason && message.webSearch.resultProvider
        ? `${formatWebSearchProviderLabel(message.webSearch.provider)} failed, so ${formatWebSearchProviderLabel(message.webSearch.resultProvider)} fallback results were used: ${message.webSearch.fallbackReason}`
        : undefined;

    return createWebSearchContextMessage(message.webSearch.query || fallbackQuery, message.sources ?? [], message.webSearch.error ?? fallbackNote, contextProvider);
  }

  function createInterruptedResponseContextMessages(message: ChatMessage, prompt: string) {
    const content = message.content.includes("I reached the agent tool budget for this run") || isToolResultFallbackAnswer(message.content) ? "" : message.content;
    const assistantContext: ChatMessage = {
      ...message,
      agentRunStatus: undefined,
      content,
      id: createId("interrupted-response-context"),
      isStreaming: false,
      status: undefined,
    };

    return [assistantContext, createMessage("user", createInterruptedResponseContinuationInstruction(prompt, message))];
  }

  function createSteeringInstruction(steerContent: string, originalPrompt: string) {
    return [
      "USER STEERING MESSAGE",
      originalPrompt ? `Original user request: ${originalPrompt}` : "",
      "The user sent this while your response was in progress. Use it to steer the same response, not as a separate follow-up turn.",
      "Adjust course immediately and continue with one coherent answer.",
      steerContent,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  function withSteeringProgress(progress: ChatProgressItem[] | undefined) {
    const progressWithoutSteering = removeSteeringProgress(progress) ?? [];

    return [
      {
        detail: "Applying queued steering message to this response",
        id: STEERING_PROGRESS_ID,
        label: "Steer response",
        status: "active",
      } satisfies ChatProgressItem,
      ...progressWithoutSteering,
    ];
  }

  function removeSteeringProgress(progress: ChatProgressItem[] | undefined) {
    const nextProgress = (progress ?? []).filter((item) => item.id !== STEERING_PROGRESS_ID);

    return nextProgress.length > 0 ? nextProgress : undefined;
  }

  function findActiveAssistantMessageIndex(messages: ChatMessage[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (message?.role === "assistant" && message.isStreaming) {
        return index;
      }
    }

    return -1;
  }

  async function handleDiscordInteraction(interaction: DiscordInteractionEvent) {
    const settings = discordBridgeSettingsRef.current;
    const replyTarget: DiscordReplyTarget = {
      applicationId: interaction.applicationId,
      channelId: interaction.channelId,
      interactionId: interaction.id,
      token: interaction.token,
      username: interaction.username,
    };

    if (!settings.enabled || settings.mode !== "interactions") {
      await sendDiscordReply(replyTarget, "Gilbert received the command, but the Discord bridge is disabled in Settings.");
      return;
    }

    if (!toolSettings.provider) {
      await sendDiscordReply(replyTarget, "Gilbert's model provider is off. Turn it back on in Settings before using Discord chat.");
      return;
    }

    const sourceChat = resolveDiscordSourceChat(interaction);

    if (isChatSending(sourceChat.id)) {
      await sendDiscordReply(replyTarget, "Gilbert is already working in that Discord conversation. Try again after that response finishes.");
      return;
    }

    const input: ChatSendInput = {
      attachments: [],
      content: interaction.prompt,
      localWorkspace,
      mode: "chat",
      webSearch:
        toolSettings.webSearch && providerSettings.webSearch.enabled
          ? {
              enabled: true,
              maxResults: providerSettings.webSearch.maxResults,
              provider: providerSettings.webSearch.provider,
            }
          : undefined,
    };

    await startSendMessage(input, undefined, {
      discordReply: replyTarget,
      sourceChat,
      userMessageSource: createDiscordMessageSource(interaction),
    });
  }

  function resolveDiscordSourceChat(interaction: DiscordInteractionEvent) {
    if (isDiscordNewChatCommand(interaction)) {
      return createEmptyChat(resolveDiscordChatProject());
    }

    return findLatestDiscordConversationChat(interaction) ?? createEmptyChat(resolveDiscordChatProject());
  }

  function findLatestDiscordConversationChat(interaction: DiscordInteractionEvent) {
    return pendingChatsRef.current
      .filter((chat) => !chat.archived && chat.messages.some((message) => message.source?.kind === "discord" && discordSourceMatchesInteraction(message.source, interaction)))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  }

  function discordSourceMatchesInteraction(source: NonNullable<ChatMessage["source"]>, interaction: DiscordInteractionEvent) {
    if (source.channelId && interaction.channelId && source.channelId === interaction.channelId) {
      return true;
    }

    if (source.guildId && interaction.guildId && source.userId && interaction.userId) {
      return source.guildId === interaction.guildId && source.userId === interaction.userId;
    }

    if (source.userId && interaction.userId && !source.guildId && !interaction.guildId) {
      return source.userId === interaction.userId;
    }

    return false;
  }

  function createDiscordMessageSource(interaction: DiscordInteractionEvent): NonNullable<ChatMessage["source"]> {
    return {
      channelId: interaction.channelId ?? undefined,
      commandName: normalizeDiscordCommandName(interaction.commandName) || undefined,
      guildId: interaction.guildId ?? undefined,
      kind: "discord",
      receivedAt: new Date(interaction.receivedAt).toISOString(),
      userId: interaction.userId ?? undefined,
      username: interaction.username ?? undefined,
    };
  }

  function isDiscordNewChatCommand(interaction: DiscordInteractionEvent) {
    return normalizeDiscordCommandName(interaction.commandName) === DISCORD_NEW_CHAT_COMMAND;
  }

  function normalizeDiscordCommandName(commandName?: string | null) {
    return commandName?.trim().toLowerCase() ?? "";
  }

  function resolveDiscordChatProject() {
    return activeChat.project.toLowerCase() === "discord" ? DEFAULT_PROJECT : activeChat.project || DEFAULT_PROJECT;
  }

  async function sendDiscordReply(target: DiscordReplyTarget | undefined, content: string) {
    if (!target) {
      return;
    }

    try {
      await sendDiscordInteractionResponse({
        applicationId: target.applicationId,
        content: content.trim() || "Gilbert finished, but there was no visible response text.",
        token: target.token,
      });
    } catch (error) {
      console.warn("Could not send Discord interaction response", error);
    }
  }

  function createDiscordResponseStreamer(target: DiscordReplyTarget) {
    let latestUpdate: DiscordStreamUpdate = {
      status: "Gilbert received your Discord request.",
    };
    let latestText = formatDiscordStreamMessage(latestUpdate, false);
    let lastSentText = "";
    let lastSentAt = 0;
    let flushInFlight = false;
    let flushRequested = false;
    let timerId: number | null = null;

    function mergeUpdate(update: DiscordStreamUpdate) {
      latestUpdate = {
        ...latestUpdate,
        ...update,
        content: update.content ?? latestUpdate.content,
        progress: update.progress ?? latestUpdate.progress,
        sources: update.sources && update.sources.length > 0 ? update.sources : latestUpdate.sources,
        toolCall: update.toolCall ?? latestUpdate.toolCall,
      };
      latestText = formatDiscordStreamMessage(latestUpdate, false);
    }

    function update(update: DiscordStreamUpdate) {
      mergeUpdate(update);
      scheduleFlush(false);
    }

    function scheduleFlush(force: boolean) {
      if (force) {
        void flush(true);
        return;
      }

      if (timerId !== null) {
        return;
      }

      const delay = Math.max(DISCORD_STREAM_UPDATE_INTERVAL_MS - (Date.now() - lastSentAt), 250);
      timerId = window.setTimeout(() => {
        timerId = null;
        void flush(false);
      }, delay);
    }

    async function flush(force: boolean) {
      if (flushInFlight) {
        flushRequested = true;

        if (force) {
          await waitForDiscordFlushSlot();
          await flush(true);
        }

        return;
      }

      if (!force && latestText === lastSentText) {
        return;
      }

      flushInFlight = true;

      try {
        lastSentText = latestText;
        lastSentAt = Date.now();
        await sendDiscordInteractionResponse({
          applicationId: target.applicationId,
          content: latestText,
          token: target.token,
        });
      } catch (error) {
        console.warn("Could not stream Discord interaction response", error);
      } finally {
        flushInFlight = false;

        if (flushRequested) {
          flushRequested = false;
          scheduleFlush(false);
        }
      }
    }

    async function finish(content: string, update: DiscordStreamUpdate = {}) {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }

      mergeUpdate({
        ...update,
        content,
        status: "Complete",
      });
      latestText = formatDiscordStreamMessage(latestUpdate, true);
      await flush(true);
    }

    async function fail(content: string) {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }

      latestUpdate = {
        content,
        status: "Error",
      };
      latestText = formatDiscordStreamMessage(latestUpdate, true);
      await flush(true);
    }

    update(latestUpdate);

    return {
      fail,
      finish,
      update,
    };
  }

  async function handleSendMessage(input: ChatSendInput) {
    if (isChatSending(activeChat.id)) {
      enqueueChatSend(input);
      return;
    }

    await startSendMessage(input);
  }

  async function startSendMessage(input: ChatSendInput, queuedSend?: { chatId: string; queuedMessageId: string }, options: StartSendMessageOptions = {}) {
    const content = input.content.trim();
    const attachments = input.attachments;
    const sourceChat = queuedSend ? pendingChatsRef.current.find((chat) => chat.id === queuedSend.chatId && !chat.archived) : options.sourceChat ?? activeChat;
    const currentChat = sourceChat ?? createEmptyChat(DEFAULT_PROJECT);

    if (isChatSending(currentChat.id)) {
      await sendDiscordReply(options.discordReply, "Gilbert is already working in that conversation. Try again after that response finishes.");
      return;
    }

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before sending a chat request.",
        title: "Model Provider is off",
      });
      await sendDiscordReply(options.discordReply, "Gilbert's model provider is off. Turn it back on in Settings before using Discord chat.");
      return;
    }

    const isPlanningMode = toolSettings.planning && input.mode === "plan";
    const effectiveProviderSettings = createPromptAwareProviderSettings(content);
    const webSearchEnabled = Boolean(toolSettings.webSearch && content && shouldAttachWebSearchContext(input, content, effectiveProviderSettings, Boolean(options.discordReply)));
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(providerSettings, input.webSearch);
    const webSearchMaxResults = runtimeWebSearchSettings.maxResults;
    const webSearchProviderLabel = formatWebSearchProviderLabel(runtimeWebSearchSettings.provider);
    const discordStreamer = options.discordReply ? createDiscordResponseStreamer(options.discordReply) : undefined;
    const queuedMessageIndex = queuedSend ? currentChat.messages.findIndex((message) => message.id === queuedSend.queuedMessageId && message.role === "user") : -1;

    if (queuedSend && queuedMessageIndex < 0) {
      await discordStreamer?.fail("Gilbert could not find the queued Discord request in the local chat.");
      return;
    }

    const currentChatExisted = pendingChatsRef.current.some((chat) => chat.id === currentChat.id);
    const restoreDraft: ChatComposerDraft = { attachments, content };
    const messagesBeforeUser = queuedSend ? currentChat.messages.slice(0, queuedMessageIndex) : currentChat.messages;
    const messagesAfterUser = queuedSend ? currentChat.messages.slice(queuedMessageIndex + 1) : [];
    const shouldGenerateChatTitle = messagesBeforeUser.length === 0;
    const fallbackChatTitle = titleFromMessage(content, attachments);
    const previousChatSnapshot = queuedSend
      ? {
          ...currentChat,
          messages: [...messagesBeforeUser, ...messagesAfterUser],
          title: shouldGenerateChatTitle ? "New chat" : currentChat.title,
        }
      : currentChat;
    const { controller, requestId } = createActiveGeneration(currentChat.id, previousChatSnapshot, currentChatExisted, restoreDraft);
    const now = new Date().toISOString();
    const userMessage =
      queuedSend && currentChat.messages[queuedMessageIndex]
        ? {
            ...currentChat.messages[queuedMessageIndex],
            attachments: attachments.length > 0 ? attachments : undefined,
            content,
            source: options.userMessageSource ?? currentChat.messages[queuedMessageIndex].source,
            status: undefined,
          }
        : {
            ...createMessage("user", content, undefined, undefined, attachments),
            source: options.userMessageSource,
          };
    const initialWebSearch: ChatWebSearch | undefined = webSearchEnabled
      ? {
          enabled: true,
          maxResults: webSearchMaxResults,
          provider: runtimeWebSearchSettings.provider,
          query: content,
          status: "active",
        }
      : undefined;
    const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, input.localWorkspace ?? localWorkspaceRef.current);
    const effectiveThinkingSettings = effectiveProviderSettings.thinking;
    const discordContextMessages = options.discordReply ? createDiscordRuntimeContextMessages(workspaceSettings, webSearchEnabled, runtimeWebSearchSettings.provider) : [];
    const assistantMessage: ChatMessage = {
      ...createMessage("assistant", ""),
      isStreaming: true,
      mode: isPlanningMode ? "plan" : "chat",
      planning: isPlanningMode
        ? {
            maxPasses: 1,
            passCount: 0,
            startedAt: now,
          }
        : undefined,
      progress: withWebSearchProgress(initialWebSearch, isPlanningMode ? createPlanningProgress("input") : undefined),
      thinking: toolSettings.thinking && (isPlanningMode || effectiveThinkingSettings.enabled)
        ? {
            effort: isPlanningMode ? "high" : effectiveThinkingSettings.effort,
            startedAt: now,
          }
        : undefined,
      webSearch: initialWebSearch,
    };
    const agentRun = createAgentRunForMessage({
      chatId: currentChat.id,
      localWorkspace: workspaceSettings,
      messageId: assistantMessage.id,
      mode: isPlanningMode ? "plan" : "chat",
      prompt: content,
    });
    assistantMessage.agentRunId = agentRun.id;
    assistantMessage.agentRunStatus = agentRun.status;
    setActiveGenerationTarget(requestId, currentChat.id, assistantMessage.id);

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");

    setChats((currentChats) => {
      const hasCurrentChat = currentChats.some((chat) => chat.id === currentChat.id);
      const nextMessages = queuedSend ? [...messagesBeforeUser, userMessage, assistantMessage, ...messagesAfterUser] : [...currentChat.messages, userMessage, assistantMessage];
      const updatedChat: ChatSummary = {
        ...currentChat,
        messages: nextMessages,
        title: shouldGenerateChatTitle ? PENDING_CHAT_TITLE : currentChat.title,
        updatedAt: now,
      };

      const nextChats = hasCurrentChat ? currentChats.map((chat) => (chat.id === currentChat.id ? updatedChat : chat)) : [updatedChat, ...currentChats];

      const sortedChats = sortChatsByUpdatedAt(nextChats);
      pendingChatsRef.current = sortedChats;
      return sortedChats;
    });
    stopStaleStreamingMessages(currentChat.id, assistantMessage.id);
    touchProject(currentChat.project);

    if (shouldGenerateChatTitle) {
      scheduleGeneratedChatTitle({
        attachments,
        chatId: currentChat.id,
        content,
        fallbackTitle: fallbackChatTitle,
        settings: effectiveProviderSettings,
        userMessageId: userMessage.id,
      });
    }

    try {
      const webContext = webSearchEnabled
        ? await (async () => {
            discordStreamer?.update({
              status: `Searching the web with ${webSearchProviderLabel}...`,
            });
            const result = await prepareWebSearchForGeneration({
              chatId: currentChat.id,
              controller,
              includeVisualResults: shouldIncludeVisualWebResults(runtimeWebSearchSettings, workspaceSettings, assistantMessage.mode, Boolean(options.discordReply)),
              maxResults: webSearchMaxResults,
              messageId: assistantMessage.id,
              query: content,
              requestId,
              webSearchSettings: runtimeWebSearchSettings,
            });
            discordStreamer?.update({
              sources: result.sources,
              status: result.sources.length > 0 ? `Found ${result.sources.length} web result${result.sources.length === 1 ? "" : "s"}.` : "Web search finished with no usable sources.",
            });
            return result;
          })()
        : {
            contextMessages: [],
            sources: [],
          };

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      if (webSearchEnabled && webContext.sources.length === 0) {
        updateAgentRun(agentRun.id, (run, eventAt) => ({
          ...run,
          events: [
            ...run.events,
            {
              at: eventAt,
              detail: `${webSearchProviderLabel} returned no usable sources. The run continued with that tool note in context.`,
              id: createId("agent-event"),
              label: "Web search unavailable",
              type: "info",
            },
          ],
          updatedAt: eventAt,
        }));
      }

      const messagesForProvider = await createMessagesForProvider(messagesBeforeUser, userMessage, currentChat.project, workspaceSettings, content, [...discordContextMessages, ...webContext.contextMessages], (notice) => {
        const compactionProgress = {
          detail: `${notice.compactedMessageCount} older messages compacted. Active request is now ${formatTokenCount(notice.afterTokens)} / ${formatTokenCount(notice.contextWindowTokens)}.`,
          id: CONTEXT_COMPACTION_PROGRESS_ID,
          label: "Automatically compacting context",
          status: "complete",
        } satisfies ChatProgressItem;

        updateGeneratedMessage(currentChat.id, assistantMessage.id, (message) => ({
          ...withContextCompactionMarker(message, notice),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      });

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      if (isPlanningMode) {
        const inputRequest = await createPlanningInputRequest(createToolAwareProviderSettings(), messagesForProvider, {
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
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
                              agentRunStatus: "waiting_for_approval",
                              isStreaming: false,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    inputRequest,
                                    inputRequests: [inputRequest],
                                  }
                                : undefined,
                              progress: withWebSearchProgress(message.webSearch, createPlanningProgress("input")),
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
          setAgentRunWaiting(agentRun.id, "Planning input needed", inputRequest.detail || inputRequest.title);
          touchProject(currentChat.project);
          notifyPlanningInputNeeded(inputRequest);
          if (discordStreamer) {
            await discordStreamer.finish("Gilbert needs input inside the app before this Discord request can continue.");
          } else {
            await sendDiscordReply(options.discordReply, "Gilbert needs input inside the app before this Discord request can continue.");
          }
          return;
        }

        const researchInstruction = createMessage(
          "user",
          [
            "RESEARCH PHASE FOR PLAN MODE",
            `Original user request: ${content}`,
            "Model-callable local tools are disabled. Use only attached workspace context, project memory, conversation context, and host-managed web context.",
            "Do NOT emit tool calls, function-call JSON, terminal commands as actions, Git/GitHub/MCP/workflow calls, file reads, edits, deletes, tests, browser automation, or weather actions.",
            "Write a Markdown summary titled 'Research observations'. List the specific files, paths, functions, components, snippets, sources, and assumptions that are already present in the attached context.",
            "Do not write the plan itself this turn. The plan is produced in a later turn from these observations.",
          ].join("\n\n"),
        );

        const researchResponse = await streamAssistantWithLocalTools({
          chatId: currentChat.id,
          controller,
          messageId: assistantMessage.id,
          messagesForProvider: [...messagesForProvider, researchInstruction],
          prompt: content,
          requestId,
          workspaceSettings,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        if (researchResponse.waitingForApproval) {
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
                              agentRunStatus: "waiting_for_approval",
                              approvals: researchResponse.approvalRequests && researchResponse.approvalRequests.length > 0
                                ? mergeAgentApprovals(message.approvals ?? [], researchResponse.approvalRequests)
                                : message.approvals,
                              content: researchResponse.content,
                              isStreaming: false,
                              progress: withLocalComputerProgress(researchResponse.progress, message.progress),
                              reasoning: researchResponse.reasoning,
                              toolCalls: researchResponse.toolCalls ?? message.toolCalls,
                            }
                          : message,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : chat,
              ),
            ),
          );
          setAgentRunWaiting(
            agentRun.id,
            "Approval required during plan research",
            "A prior local-tool approval is still pending from saved chat state.",
            researchResponse.approvalRequests ?? [],
            researchResponse.pendingToolCallContent,
          );
          notifyRunNeedsAttention("An approval is waiting during plan research.");
          touchProject(currentChat.project);
          return;
        }

        const researchFindings = researchResponse.content?.trim() || "";

        setChats((currentChats) =>
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? preserveVisibleResponseThinking(message, {
                          ...message,
                          content: "",
                          isStreaming: true,
                          progress: withWebSearchProgress(message.webSearch, createPlanningProgress("drafting")),
                          toolCalls: researchResponse.toolCalls ?? message.toolCalls,
                        })
                      : message,
                  ),
                }
              : chat,
          ),
        );

        const assistantResponse = await runPlanningMode({
          messages: messagesForProvider,
          researchFindings,
          signal: controller.signal,
          settings: createToolAwareProviderSettings(),
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
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
                          ? preserveVisibleResponseThinking(message, {
                              ...message,
                              content: snapshot.content ?? message.content,
                              progress: withWebSearchProgress(message.webSearch, snapshot.progress),
                            })
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

        const planApproval = createPlanningExecutionApproval(agentRun.id, assistantMessage.id, assistantResponse.content, content);

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === assistantMessage.id
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: "waiting_for_approval",
                            approvals: mergeAgentApprovals(message.approvals ?? [], [planApproval]),
                            content: assistantResponse.content,
                            isStreaming: false,
                            planning: message.planning
                              ? {
                                  ...message.planning,
                                  completedAt: new Date().toISOString(),
                                  passCount: 1,
                                }
                              : undefined,
                            progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          })
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
        setAgentRunWaiting(agentRun.id, "Plan approval required", "Approve the plan to hand it into the executable agent loop.", [planApproval]);
        notifyRunNeedsAttention("A plan is ready for approval before execution.");
        touchProject(currentChat.project);
        if (discordStreamer) {
          await discordStreamer.finish("Gilbert made a plan, but it needs approval inside the app before execution.");
        } else {
          await sendDiscordReply(options.discordReply, "Gilbert made a plan, but it needs approval inside the app before execution.");
        }
        return;
      } else {
        const useAppAgentRuntime = shouldStartAppAgentRun({
          mode: "chat",
          prompt: content,
          toolSettings,
          workspace: workspaceSettings,
        });

        if (useAppAgentRuntime) {
          updateAgentRun(agentRun.id, (run, eventAt) => ({
            ...run,
            events: [
              ...run.events,
              {
                at: eventAt,
                detail: "Gilbert will run workspace actions through the app-owned agent runtime instead of model-facing primitive tools.",
                id: createId("agent-event"),
                label: "App-owned agent runtime selected",
                type: "status",
              },
            ],
            updatedAt: eventAt,
          }));
        }

        const assistantResponse = useAppAgentRuntime
          ? await runAppOwnedCodingAgent({
              chatId: currentChat.id,
              controller,
              messageId: assistantMessage.id,
              messagesForProvider,
              onExternalUpdate: discordStreamer?.update,
              prompt: content,
              requestId,
              runId: agentRun.id,
              workspaceSettings,
            })
          : await streamAssistantWithLocalTools({
              chatId: currentChat.id,
              controller,
              messageId: assistantMessage.id,
              messagesForProvider,
              onExternalUpdate: discordStreamer?.update,
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
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: assistantResponse.waitingForApproval ? "waiting_for_approval" : "completed",
                            approvals: assistantResponse.approvalRequests && assistantResponse.approvalRequests.length > 0
                              ? mergeAgentApprovals(message.approvals ?? [], assistantResponse.approvalRequests)
                              : message.approvals,
                            artifacts: mergeChatArtifacts(message.artifacts, assistantResponse.artifacts),
                            content: assistantResponse.content,
                            isStreaming: false,
                            progress: withLocalComputerProgress(assistantResponse.progress, message.progress),
                            reasoning: assistantResponse.reasoning,
                            sources: assistantResponse.sources && assistantResponse.sources.length > 0 ? mergeChatSources(message.sources, assistantResponse.sources) : message.sources,
                            toolCalls: assistantResponse.toolCalls ?? message.toolCalls,
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          })
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
        if (assistantResponse.waitingForApproval) {
          setAgentRunWaiting(
            agentRun.id,
            "Tool approval required",
            "Review the pending tool action, then allow, deny, or approve edited arguments to continue the same run.",
            assistantResponse.approvalRequests ?? [],
            assistantResponse.pendingToolCallContent,
          );
          notifyRunNeedsAttention("A tool action is waiting for your approval.");
          touchProject(currentChat.project);
          if (discordStreamer) {
            await discordStreamer.finish("Gilbert needs tool approval inside the app before this Discord request can finish.");
          } else {
            await sendDiscordReply(options.discordReply, "Gilbert needs tool approval inside the app before this Discord request can finish.");
          }
          return;
        }

        const completedAssistantMessage: ChatMessage = {
          ...assistantMessage,
          agentRunStatus: "completed",
          artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
          content: assistantResponse.content,
          isStreaming: false,
          reasoning: assistantResponse.reasoning,
          sources: assistantResponse.sources && assistantResponse.sources.length > 0 ? mergeChatSources(assistantMessage.sources, assistantResponse.sources) : assistantMessage.sources,
          toolCalls: assistantResponse.toolCalls,
        };
        setAgentRunCompleted(agentRun.id, completedAssistantMessage);
        notifyRunComplete(completedAssistantMessage);
        if (discordStreamer) {
          await discordStreamer.finish(assistantResponse.content, {
            sources: mergeChatSources(webContext.sources, assistantResponse.sources ?? []),
          });
        } else {
          await sendDiscordReply(options.discordReply, assistantResponse.content);
        }
      }
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The provider request failed.";

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
                          agentRunStatus: "failed",
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
      setAgentRunFailed(agentRun.id, errorContent);
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
      if (discordStreamer) {
        await discordStreamer.fail(`Gilbert hit an error while handling the Discord request: ${errorContent}`);
      } else {
        await sendDiscordReply(options.discordReply, `Gilbert hit an error while handling the Discord request: ${errorContent}`);
      }
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  async function handleResolveToolApproval(messageId: string, approvalId: string, decision: AgentApprovalDecision) {
    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before resuming an agent run.",
        title: "Model Provider is off",
      });
      return;
    }

    const currentChat = activeChat;

    if (isChatSending(currentChat.id)) {
      return;
    }

    const assistantMessageIndex = currentChat.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
    const assistantMessage = assistantMessageIndex >= 0 ? currentChat.messages[assistantMessageIndex] : undefined;
    const approval = assistantMessage?.approvals?.find((candidate) => candidate.id === approvalId);

    if (!assistantMessage || !approval) {
      return;
    }

    const run = agentRunsRef.current.find((candidate) => candidate.id === (approval.runId ?? assistantMessage.agentRunId));
    const resumeToolCallContent = approval.resumeToolCallContent ?? run?.pendingToolCallContent;

    if (!resumeToolCallContent && approval.tool !== "planning_handoff") {
      setNoticeDialog({
        description: "This approval does not have a resumable tool request saved with it.",
        title: "Cannot resume this run",
      });
      return;
    }

    const resolvedAt = new Date().toISOString();
    const resolvedApproval: AgentApproval = {
      ...approval,
      editedArgs: decision.editedArgs,
      resolutionNote: decision.note ?? (decision.scope === "session" ? "Allowed for this workspace session." : undefined),
      resolvedAt,
      status: decision.status,
    };
    const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, run?.localWorkspace ?? localWorkspaceRef.current);
    rememberSessionApprovalDecision(approval, decision, workspaceSettings);
    const prompt = run?.prompt ?? getLatestUserPrompt(currentChat.messages.slice(0, assistantMessageIndex));
    const { controller, requestId } = createActiveGeneration(currentChat.id, currentChat, true, undefined, {
      messageId,
    });

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    updateAgentRun(assistantMessage.agentRunId, (run, startedAt) => ({
      ...run,
      events: [
        ...run.events,
        {
          at: startedAt,
          id: createId("agent-event"),
          label: "Approval decision submitted",
          type: "resume",
        },
      ],
      status: "running",
      steps: [
        ...run.steps,
        {
          id: createId("agent-step"),
          label: "Resume after approval",
          startedAt,
          status: "running",
          type: "approval",
        },
      ],
      updatedAt: startedAt,
    }));

    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.id === currentChat.id
          ? {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      agentRunStatus: "running",
                      approvals: (message.approvals ?? []).map((candidate) => (candidate.id === approvalId ? resolvedApproval : candidate)),
                      isStreaming: true,
                      progress: withLocalComputerProgress(createLocalComputerProgress("active", "Resuming approved action"), message.progress),
                    }
                  : message,
              ),
              updatedAt: resolvedAt,
            }
          : chat,
      ),
    );

    updateAgentRun(approval.runId ?? assistantMessage.agentRunId, (existingRun, now) => ({
      ...existingRun,
      approvals: mergeAgentApprovals(existingRun.approvals, [resolvedApproval]),
      events: [
        ...existingRun.events,
        {
          at: now,
          detail: decision.status === "denied"
            ? "The user denied the pending tool action."
            : decision.scope === "session"
              ? "The user approved this tool for the current workspace session."
              : "The user approved the pending tool action.",
          id: createId("agent-event"),
          label: "Approval resolved",
          type: "resume",
        },
      ],
      status: "running",
      steps: [
        ...existingRun.steps,
        {
          approvalId,
          id: createId("agent-step"),
          label: decision.status === "denied" ? "Apply denied approval" : "Resume approved tool action",
          startedAt: now,
          status: "running",
          type: "approval",
        },
      ],
      updatedAt: now,
    }));

    try {
      const priorMessages = currentChat.messages.slice(0, assistantMessageIndex).filter((message) => message.status !== "error");
      const projectBoundaryMessage = createActiveProjectBoundaryMessage(currentChat.project, workspaceSettings);
      const localContextMessages = await createLocalWorkspaceContextMessages(workspaceSettings, prompt, currentChat.project);
      if (approval.tool === "planning_handoff" && decision.status === "denied") {
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
                            agentRunStatus: "cancelled",
                            isStreaming: false,
                          }
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
        updateAgentRun(approval.runId ?? assistantMessage.agentRunId, (existingRun, now) => ({
          ...existingRun,
          events: [
            ...existingRun.events,
            {
              at: now,
              detail: "The user denied plan execution.",
              id: createId("agent-event"),
              label: "Plan execution cancelled",
              type: "status",
            },
          ],
          status: "cancelled",
          updatedAt: now,
        }));
        touchProject(currentChat.project);
        return;
      }

      const planContent = typeof decision.editedArgs?.plan === "string"
        ? decision.editedArgs.plan
        : typeof approval.args?.plan === "string"
          ? approval.args.plan
          : assistantMessage.content;
      const messagesForProvider = approval.tool === "planning_handoff"
        ? compactProviderMessages([
            ...priorMessages,
            projectBoundaryMessage,
            ...localContextMessages,
            createMessage("assistant", `APPROVED PLAN\n${planContent}`),
            createMessage(
              "user",
              [
                "PLAN APPROVED FOR EXECUTION",
                `Original request: ${prompt}`,
                "Execute the approved task list now using available agent tools. Keep the same run going: execute steps, request approvals for risky actions, verify, then summarize what changed.",
              ].join("\n\n"),
            ),
          ]).messages
        : compactProviderMessages([...priorMessages, projectBoundaryMessage, ...localContextMessages]).messages;
      const assistantResponse = await streamAssistantWithLocalTools({
        approvalDecisions: {
          [approvalId]: decision,
        },
        chatId: currentChat.id,
        controller,
        messageId,
        messagesForProvider,
        previousToolCalls: approval.tool === "planning_handoff" ? undefined : assistantMessage.toolCalls,
        prompt,
        requestId,
        resumeToolCallContent: approval.tool === "planning_handoff" ? undefined : resumeToolCallContent,
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
                    message.id === messageId
                      ? preserveVisibleResponseThinking(message, {
                          ...message,
                          agentRunStatus: assistantResponse.waitingForApproval ? "waiting_for_approval" : "completed",
                          approvals: assistantResponse.approvalRequests && assistantResponse.approvalRequests.length > 0
                            ? mergeAgentApprovals(message.approvals ?? [], assistantResponse.approvalRequests)
                            : message.approvals,
                          artifacts: mergeChatArtifacts(message.artifacts, assistantResponse.artifacts),
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
                        })
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );

      if (assistantResponse.waitingForApproval) {
        setAgentRunWaiting(
          approval.runId ?? assistantMessage.agentRunId,
          "Tool approval required",
          "Review the next pending tool action to continue the same run.",
          assistantResponse.approvalRequests ?? [],
          assistantResponse.pendingToolCallContent,
        );
        notifyRunNeedsAttention("Another tool action is waiting for your approval.");
        touchProject(currentChat.project);
        return;
      }

      setAgentRunCompleted(approval.runId ?? assistantMessage.agentRunId, {
        ...assistantMessage,
        agentRunStatus: "completed",
        artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
        content: assistantResponse.content,
        isStreaming: false,
        reasoning: assistantResponse.reasoning,
        toolCalls: assistantResponse.toolCalls,
      });
      notifyRunComplete({
        ...assistantMessage,
        artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
        content: assistantResponse.content,
        isStreaming: false,
        reasoning: assistantResponse.reasoning,
        toolCalls: assistantResponse.toolCalls,
      });
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The provider request failed while resuming the approval.";

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
                          agentRunStatus: "failed",
                          content: errorContent,
                          isStreaming: false,
                          reasoning: undefined,
                          status: "error",
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      setAgentRunFailed(approval.runId ?? assistantMessage.agentRunId, errorContent);
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  async function handleSubmitPlanningInput(messageId: string, answers: ChatPlanningInputAnswer[]) {
    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before continuing a planning run.",
        title: "Model Provider is off",
      });
      return;
    }

    const currentChat = activeChat;

    if (isChatSending(currentChat.id)) {
      return;
    }

    const assistantMessageIndex = currentChat.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
    const assistantMessage = assistantMessageIndex >= 0 ? currentChat.messages[assistantMessageIndex] : undefined;
    const inputRequest = getPendingPlanningInputRequest(assistantMessage?.planning);

    if (!assistantMessage || !inputRequest) {
      return;
    }

    const { controller, requestId } = createActiveGeneration(currentChat.id, currentChat, true, undefined, {
      messageId,
    });
    const now = new Date().toISOString();
    const planningInputRequests = getPlanningInputRequests(assistantMessage.planning);
    const answeredInputRequests = markPlanningInputAnswered(planningInputRequests, inputRequest.id, answers, now);
    const webContextMessages = createStoredWebSearchContext(assistantMessage, getLatestUserPrompt(currentChat.messages.slice(0, assistantMessageIndex)));
    const providerCompaction = compactProviderMessages([
      ...currentChat.messages.slice(0, assistantMessageIndex).filter((message) => message.status !== "error"),
      ...webContextMessages,
      ...createPlanningAnswerMessages(answeredInputRequests),
    ]);
    const messagesForProvider = providerCompaction.messages;
    const compactionProgress = providerCompaction.contextCompaction ? createContextCompactionProgress(providerCompaction) : undefined;

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    updateAgentRun(assistantMessage.agentRunId, (run, startedAt) => ({
      ...run,
      events: [
        ...run.events,
        {
          at: startedAt,
          id: createId("agent-event"),
          label: "Planning input submitted",
          type: "resume",
        },
      ],
      status: "running",
      steps: [
        ...run.steps,
        {
          id: createId("agent-step"),
          label: "Continue planning",
          startedAt,
          status: "running",
          type: "planning",
        },
      ],
      updatedAt: startedAt,
    }));

    setChats((currentChats) =>
      currentChats.map((chat) =>
        chat.id === currentChat.id
          ? {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === messageId
                  ? {
                      ...withContextCompactionMarker(message, providerCompaction.contextCompaction),
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
                      progress: compactionProgress
                        ? withContextCompactionProgress(compactionProgress, withWebSearchProgress(message.webSearch, createPlanningProgress("drafting")))
                        : withWebSearchProgress(message.webSearch, createPlanningProgress("drafting")),
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
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
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
                              agentRunStatus: "waiting_for_approval",
                              isStreaming: false,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    inputRequest: followUpInputRequest,
                                    inputRequests: [...answeredInputRequests, followUpInputRequest],
                                  }
                                : undefined,
                              progress: withWebSearchProgress(message.webSearch, createPlanningProgress("input")),
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
          setAgentRunWaiting(assistantMessage.agentRunId, "Planning input needed", followUpInputRequest.detail || followUpInputRequest.title);
          touchProject(currentChat.project);
          notifyPlanningInputNeeded(followUpInputRequest);
          return;
        }
      }

      const assistantResponse = await runPlanningMode({
        messages: messagesForProvider,
        signal: controller.signal,
        settings: createToolAwareProviderSettings(),
        onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
        onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
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
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            content: snapshot.content ?? message.content,
                            progress: withWebSearchProgress(message.webSearch, snapshot.progress),
                          })
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

      const prompt = getLatestUserPrompt(currentChat.messages.slice(0, assistantMessageIndex));
      const planApproval = assistantMessage.agentRunId ? createPlanningExecutionApproval(assistantMessage.agentRunId, messageId, assistantResponse.content, prompt) : undefined;

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === messageId
                      ? preserveVisibleResponseThinking(message, {
                          ...message,
                          agentRunStatus: planApproval ? "waiting_for_approval" : "completed",
                          approvals: planApproval ? mergeAgentApprovals(message.approvals ?? [], [planApproval]) : message.approvals,
                          content: assistantResponse.content,
                          isStreaming: false,
                          planning: message.planning
                            ? {
                                ...message.planning,
                                completedAt: new Date().toISOString(),
                                passCount: 1,
                              }
                            : undefined,
                          progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        })
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      if (planApproval) {
        setAgentRunWaiting(assistantMessage.agentRunId, "Plan approval required", "Approve the plan to hand it into the executable agent loop.", [planApproval]);
        touchProject(currentChat.project);
        notifyRunNeedsAttention("A plan is ready for approval before execution.");
        return;
      }

      touchProject(currentChat.project);
      notifyRunComplete({
        ...assistantMessage,
        content: assistantResponse.content,
        isStreaming: false,
        planning: assistantMessage.planning
          ? {
              ...assistantMessage.planning,
              completedAt: new Date().toISOString(),
              passCount: 1,
            }
          : undefined,
      });
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
                          agentRunStatus: "failed",
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
      notifyRunNeedsAttention(errorContent);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  async function handleRequestPlanRevision(messageId: string, feedback: string) {
    const revisionFeedback = feedback.trim();

    if (!revisionFeedback) {
      return;
    }

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before revising a plan.",
        title: "Model Provider is off",
      });
      return;
    }

    const currentChat = activeChat;

    if (isChatSending(currentChat.id)) {
      return;
    }

    const assistantMessageIndex = currentChat.messages.findIndex((message) => message.id === messageId && message.role === "assistant");
    const assistantMessage = assistantMessageIndex >= 0 ? currentChat.messages[assistantMessageIndex] : undefined;

    if (!assistantMessage || assistantMessage.isStreaming || !(assistantMessage.mode === "plan" || assistantMessage.planning)) {
      return;
    }

    const originalPrompt = getLatestUserPrompt(currentChat.messages.slice(0, assistantMessageIndex));
    const revisionPrompt = [originalPrompt, revisionFeedback].filter(Boolean).join("\n\n");
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(providerSettings, assistantMessage.webSearch ?? providerSettings.webSearch);
    const webSearchMaxResults = runtimeWebSearchSettings.maxResults;
    const revisionWebSearchInput: ChatSendInput = {
      attachments: [],
      content: revisionPrompt,
      webSearch:
        assistantMessage.webSearch?.enabled || providerSettings.webSearch.enabled
          ? {
              enabled: true,
              maxResults: webSearchMaxResults,
              provider: runtimeWebSearchSettings.provider,
            }
          : undefined,
    };
    const webSearchEnabled = Boolean(toolSettings.webSearch && revisionPrompt && shouldAttachWebSearchContext(revisionWebSearchInput, revisionPrompt, createToolAwareProviderSettings(), false));
    const { controller, requestId } = createActiveGeneration(currentChat.id, currentChat, true);
    const now = new Date().toISOString();
    const revisionUserMessage = createMessage("user", revisionFeedback);
    const revisedAssistantMessage: ChatMessage = {
      ...createMessage("assistant", ""),
      agentRunStatus: "running",
      isStreaming: true,
      mode: "plan",
      planning: {
        maxPasses: 1,
        passCount: 0,
        startedAt: now,
      },
      progress: createPlanningProgress("drafting"),
      thinking: toolSettings.thinking
        ? {
            effort: "high",
            startedAt: now,
          }
        : undefined,
    };
    const agentRun = createAgentRunForMessage({
      chatId: currentChat.id,
      localWorkspace,
      messageId: revisedAssistantMessage.id,
      mode: "plan",
      prompt: originalPrompt || revisionFeedback,
      title: titleFromMessage(originalPrompt || revisionFeedback, []),
    });
    setActiveGenerationTarget(requestId, currentChat.id, revisedAssistantMessage.id);
    const supersededPlanMessage: ChatMessage = {
      ...assistantMessage,
      agentRunStatus: assistantMessage.agentRunStatus === "waiting_for_approval" ? "cancelled" : assistantMessage.agentRunStatus,
      approvals: assistantMessage.approvals?.map((approval) =>
        approval.tool === "planning_handoff" && approval.status === "pending"
          ? {
              ...approval,
              resolutionNote: "Replaced by revised plan feedback.",
              resolvedAt: now,
              status: "expired",
            }
          : approval,
      ),
    };

    updateAgentRun(assistantMessage.agentRunId, (run) => ({
      ...run,
      events: [
        ...run.events,
        {
          at: now,
          detail: revisionFeedback,
          id: createId("agent-event"),
          label: "Plan revision requested",
          type: "status",
        },
      ],
      status: run.status === "waiting_for_approval" ? "cancelled" : run.status,
      updatedAt: now,
    }));

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setChats((currentChats) =>
      sortChatsByUpdatedAt(
        currentChats.map((chat) =>
          chat.id === currentChat.id
            ? {
                ...chat,
                messages: [
                  ...currentChat.messages.slice(0, assistantMessageIndex),
                  supersededPlanMessage,
                  revisionUserMessage,
                  revisedAssistantMessage,
                  ...currentChat.messages.slice(assistantMessageIndex + 1),
                ],
                updatedAt: now,
              }
            : chat,
        ),
      ),
    );
    stopStaleStreamingMessages(currentChat.id, revisedAssistantMessage.id);

    try {
      const webContext = webSearchEnabled
        ? await prepareWebSearchForGeneration({
            chatId: currentChat.id,
            controller,
            includeVisualResults: false,
            maxResults: webSearchMaxResults,
            messageId: revisedAssistantMessage.id,
            query: [originalPrompt, revisionFeedback].filter(Boolean).join("\n"),
            requestId,
            webSearchSettings: runtimeWebSearchSettings,
          })
        : {
            contextMessages: [],
            sources: [],
          };

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, localWorkspaceRef.current);
      const projectBoundaryMessage = createActiveProjectBoundaryMessage(currentChat.project, workspaceSettings);
      const localContextMessages = await createLocalWorkspaceContextMessages(workspaceSettings, originalPrompt || revisionFeedback, currentChat.project);
      const revisionInstruction = createMessage(
        "user",
        [
          "PLAN REVISION REQUEST",
          originalPrompt ? `Original request: ${originalPrompt}` : "",
          "Revise the immediately preceding plan using this feedback. Return a complete new plan that can be accepted for execution.",
          revisionFeedback,
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
      const providerCompaction = compactProviderMessages([
        ...currentChat.messages.slice(0, assistantMessageIndex + 1).filter((message) => message.status !== "error"),
        projectBoundaryMessage,
        ...localContextMessages,
        ...webContext.contextMessages,
        revisionInstruction,
      ]);
      const messagesForProvider = providerCompaction.messages;

      if (providerCompaction.contextCompaction) {
        const compactionProgress = createContextCompactionProgress(providerCompaction);

        updateGeneratedMessage(currentChat.id, revisedAssistantMessage.id, (message) => ({
          ...withContextCompactionMarker(message, providerCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      }

      const assistantResponse = await runPlanningMode({
        messages: messagesForProvider,
        signal: controller.signal,
        settings: createToolAwareProviderSettings(),
        onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
        onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
        onUpdate: (snapshot) => {
          if (isRequestInactive(requestId, controller)) {
            return;
          }

          updateGeneratedMessage(currentChat.id, revisedAssistantMessage.id, (message) => ({
            ...message,
            content: snapshot.content ?? message.content,
            progress: withWebSearchProgress(message.webSearch, snapshot.progress),
          }));
        },
      });

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      const planApproval = createPlanningExecutionApproval(agentRun.id, revisedAssistantMessage.id, assistantResponse.content, originalPrompt || revisionFeedback);

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === revisedAssistantMessage.id
                      ? preserveVisibleResponseThinking(message, {
                          ...message,
                          agentRunStatus: "waiting_for_approval",
                          approvals: [planApproval],
                          content: assistantResponse.content,
                          isStreaming: false,
                          planning: message.planning
                            ? {
                                ...message.planning,
                                completedAt: new Date().toISOString(),
                                passCount: 1,
                              }
                            : undefined,
                          progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                          sources: webContext.sources.length > 0 ? webContext.sources : message.sources,
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        })
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      setAgentRunWaiting(agentRun.id, "Plan approval required", "Review the revised plan, then accept it or ask for another change.", [planApproval]);
      notifyRunNeedsAttention("A revised plan is ready for approval.");
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The plan revision request failed.";

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === revisedAssistantMessage.id
                      ? {
                          ...message,
                          agentRunStatus: "failed",
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
      setAgentRunFailed(agentRun.id, errorContent);
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  async function handleRegenerateResponse(messageId: string) {
    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before regenerating a response.",
        title: "Model Provider is off",
      });
      return;
    }

    const currentChat = activeChat;

    if (isChatSending(currentChat.id)) {
      return;
    }

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
    const answeredPlanningInputRequests = getPlanningInputRequests(assistantMessage.planning).filter((request) => request.answeredAt && request.answers?.length);
    const continueInterruptedResponse = isInterruptedAssistantMessage(assistantMessage);
    const regeneratePrompt = getLatestUserPrompt(priorMessages);
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(providerSettings, assistantMessage.webSearch ?? providerSettings.webSearch);
    const webSearchMaxResults = runtimeWebSearchSettings.maxResults;
    const webSearchProviderLabel = formatWebSearchProviderLabel(runtimeWebSearchSettings.provider);
    const regenerateWebSearchInput: ChatSendInput = {
      attachments: [],
      content: regeneratePrompt,
      webSearch:
        assistantMessage.webSearch?.enabled || providerSettings.webSearch.enabled
          ? {
              enabled: true,
              maxResults: webSearchMaxResults,
              provider: runtimeWebSearchSettings.provider,
            }
          : undefined,
    };
    const webSearchEnabled = Boolean(toolSettings.webSearch && regeneratePrompt && shouldAttachWebSearchContext(regenerateWebSearchInput, regeneratePrompt, createPromptAwareProviderSettings(regeneratePrompt), false));
    const { controller, requestId } = createActiveGeneration(currentChat.id, currentChat, true);
    const now = new Date().toISOString();
    const initialWebSearch: ChatWebSearch | undefined = webSearchEnabled
      ? {
          enabled: true,
          maxResults: webSearchMaxResults,
          provider: runtimeWebSearchSettings.provider,
          query: regeneratePrompt,
          status: "active",
        }
      : undefined;
    const effectiveThinkingSettings = createPromptAwareProviderSettings(regeneratePrompt).thinking;
    const regeneratedAssistantMessage: ChatMessage = {
      ...assistantMessage,
      artifacts: undefined,
      agentRunStatus: "running",
      approvals: continueInterruptedResponse ? assistantMessage.approvals : undefined,
      content: "",
      contextCompactions: undefined,
      createdAt: now,
      isStreaming: true,
      mode: isPlanningMode ? "plan" : "chat",
      planning: isPlanningMode
        ? {
            inputRequest: answeredPlanningInputRequests[answeredPlanningInputRequests.length - 1],
            inputRequests: answeredPlanningInputRequests,
            maxPasses: 1,
            passCount: 0,
            startedAt: now,
          }
        : undefined,
      progress: withWebSearchProgress(initialWebSearch, isPlanningMode ? createPlanningProgress("drafting") : undefined),
      reasoning: undefined,
      sources: continueInterruptedResponse ? assistantMessage.sources : undefined,
      status: undefined,
      thinking: toolSettings.thinking && (isPlanningMode || effectiveThinkingSettings.enabled)
        ? {
            effort: isPlanningMode ? "high" : effectiveThinkingSettings.effort,
            startedAt: now,
          }
        : undefined,
      toolCalls: continueInterruptedResponse ? assistantMessage.toolCalls : undefined,
      webSearch: initialWebSearch,
    };
    setActiveGenerationTarget(requestId, currentChat.id, regeneratedAssistantMessage.id);

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");
    setAgentRunContinuing(
      assistantMessage.agentRunId,
      continueInterruptedResponse ? "Continue interrupted response" : "Regenerate response",
      continueInterruptedResponse ? "Continuing from the saved partial response and tool results." : "Regenerating the assistant response.",
    );
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
    stopStaleStreamingMessages(currentChat.id, regeneratedAssistantMessage.id);

    try {
      const webContext = webSearchEnabled
        ? await prepareWebSearchForGeneration({
            chatId: currentChat.id,
            controller,
            includeVisualResults: shouldIncludeVisualWebResults(runtimeWebSearchSettings, resolveWorkspaceForChatProject(currentChat.project, localWorkspaceRef.current), regeneratedAssistantMessage.mode, false),
            maxResults: webSearchMaxResults,
            messageId,
            query: regeneratePrompt,
            requestId,
            webSearchSettings: runtimeWebSearchSettings,
          })
        : {
            contextMessages: [],
            sources: [],
          };

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      if (webSearchEnabled && webContext.sources.length === 0) {
        updateAgentRun(assistantMessage.agentRunId, (run, eventAt) => ({
          ...run,
          events: [
            ...run.events,
            {
              at: eventAt,
              detail: `${webSearchProviderLabel} returned no usable sources. The run continued with that tool note in context.`,
              id: createId("agent-event"),
              label: "Web search unavailable",
              type: "info",
            },
          ],
          updatedAt: eventAt,
        }));
      }

      const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, localWorkspaceRef.current);
      const projectBoundaryMessage = createActiveProjectBoundaryMessage(currentChat.project, workspaceSettings);
      const localContextMessages = await createLocalWorkspaceContextMessages(workspaceSettings, regeneratePrompt, currentChat.project);
      const interruptedResponseContextMessages = continueInterruptedResponse
        ? createInterruptedResponseContextMessages(assistantMessage, regeneratePrompt)
        : [];
      const providerCompaction = compactProviderMessages([
        ...priorMessages.filter((message) => message.status !== "error"),
        projectBoundaryMessage,
        ...localContextMessages,
        ...webContext.contextMessages,
        ...createPlanningAnswerMessages(answeredPlanningInputRequests),
        ...interruptedResponseContextMessages,
      ]);
      const messagesForProvider = providerCompaction.messages;

      if (providerCompaction.contextCompaction) {
        const compactionProgress = createContextCompactionProgress(providerCompaction);

        updateGeneratedMessage(currentChat.id, messageId, (message) => ({
          ...withContextCompactionMarker(message, providerCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      }

      if (isPlanningMode) {
        const assistantResponse = await runPlanningMode({
          messages: messagesForProvider,
          signal: controller.signal,
          settings: createToolAwareProviderSettings(),
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
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
                          ? preserveVisibleResponseThinking(message, {
                              ...message,
                              content: snapshot.content ?? message.content,
                              progress: withWebSearchProgress(message.webSearch, snapshot.progress),
                            })
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

        const planApproval = assistantMessage.agentRunId ? createPlanningExecutionApproval(assistantMessage.agentRunId, messageId, assistantResponse.content, regeneratePrompt) : undefined;

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === messageId
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: planApproval ? "waiting_for_approval" : "completed",
                            approvals: planApproval ? mergeAgentApprovals(message.approvals ?? [], [planApproval]) : message.approvals,
                            content: assistantResponse.content,
                            isStreaming: false,
                            planning: message.planning
                              ? {
                                  ...message.planning,
                                  completedAt: new Date().toISOString(),
                                  passCount: 1,
                                }
                              : undefined,
                            progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          })
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
        if (planApproval) {
          setAgentRunWaiting(assistantMessage.agentRunId, "Plan approval required", "Review the regenerated plan, then accept it or ask for another change.", [planApproval]);
          notifyRunNeedsAttention("A regenerated plan is ready for approval.");
          touchProject(currentChat.project);
          return;
        }

        setAgentRunCompleted(assistantMessage.agentRunId, {
          ...regeneratedAssistantMessage,
          agentRunStatus: "completed",
          content: assistantResponse.content,
          isStreaming: false,
          planning: regeneratedAssistantMessage.planning
            ? {
                ...regeneratedAssistantMessage.planning,
                completedAt: new Date().toISOString(),
                passCount: 1,
              }
            : undefined,
        });
        notifyRunComplete({
          ...regeneratedAssistantMessage,
          agentRunStatus: "completed",
          content: assistantResponse.content,
          isStreaming: false,
          planning: regeneratedAssistantMessage.planning
            ? {
                ...regeneratedAssistantMessage.planning,
                completedAt: new Date().toISOString(),
                passCount: 1,
              }
            : undefined,
        });
      } else {
        const assistantResponse = await streamAssistantWithLocalTools({
          chatId: currentChat.id,
          controller,
          messageId,
          messagesForProvider,
          prompt: regeneratePrompt,
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
                      message.id === messageId
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: assistantResponse.waitingForApproval ? "waiting_for_approval" : "completed",
                            approvals: assistantResponse.approvalRequests && assistantResponse.approvalRequests.length > 0
                              ? mergeAgentApprovals(message.approvals ?? [], assistantResponse.approvalRequests)
                              : message.approvals,
                            artifacts: mergeChatArtifacts(message.artifacts, assistantResponse.artifacts),
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
                          })
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
        if (assistantResponse.waitingForApproval) {
          setAgentRunWaiting(
            assistantMessage.agentRunId,
            "Tool approval required",
            "Review the pending tool action, then allow, deny, or approve edited arguments to continue the same run.",
            assistantResponse.approvalRequests ?? [],
            assistantResponse.pendingToolCallContent,
          );
          notifyRunNeedsAttention("A tool action is waiting for your approval.");
          touchProject(currentChat.project);
          return;
        }

        setAgentRunCompleted(assistantMessage.agentRunId, {
          ...regeneratedAssistantMessage,
          agentRunStatus: "completed",
          artifacts: mergeChatArtifacts(regeneratedAssistantMessage.artifacts, assistantResponse.artifacts),
          content: assistantResponse.content,
          isStreaming: false,
          reasoning: assistantResponse.reasoning,
          toolCalls: assistantResponse.toolCalls ?? regeneratedAssistantMessage.toolCalls,
        });
        notifyRunComplete({
          ...regeneratedAssistantMessage,
          agentRunStatus: "completed",
          artifacts: mergeChatArtifacts(regeneratedAssistantMessage.artifacts, assistantResponse.artifacts),
          content: assistantResponse.content,
          isStreaming: false,
          reasoning: assistantResponse.reasoning,
          toolCalls: assistantResponse.toolCalls ?? regeneratedAssistantMessage.toolCalls,
        });
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
      setAgentRunFailed(assistantMessage.agentRunId, errorContent);
      notifyRunNeedsAttention(errorContent);
      touchProject(currentChat.project);
    } finally {
      finishActiveGeneration(requestId);
    }
  }

  function renderUtilityPage() {
    if (activeRoute === "radar") {
      return (
        <WeatherRadarPage
          onBackToChat={() => setActiveRoute("chat")}
          onOpenMapboxSettings={() => {
            setActiveSettingsSection("mapbox");
            setActiveRoute("settings");
          }}
        />
      );
    }

    if (activeRoute === "settings") {
      return (
        <SettingsPage
          activeSection={activeSettingsSection}
          appInfo={appInfo}
          appearanceMode={appearanceMode}
          discordBridge={discordBridgeSettings}
          localWorkspace={localWorkspace}
          projects={projects}
          settings={providerSettings}
          onAppearanceModeChange={setAppearanceMode}
          onDiscordBridgeChange={setDiscordBridgeSettings}
          onLocalWorkspaceChange={handleLocalWorkspaceChange}
          onSettingsChange={setProviderSettings}
        />
      );
    }

    return null;
  }

  function renderChatPage() {
    return (
      <ChatPage
        appInfo={appInfo}
        chat={activeChat}
        browserPreviewEnabled={toolSettings.browserPreview}
        browserPreviewRequestId={browserPreviewTarget?.id ?? 0}
        browserPreviewUrl={browserPreviewTarget?.url ?? null}
        composerDraft={composerDraftToRestore}
        contextWindowSource={contextWindow.source}
        contextWindowTokens={contextWindow.tokens}
        hasApiKey={!getModelProvider(providerSettings.provider).requiresApiKey || Boolean(getProviderApiKey(providerSettings).trim())}
        isSending={isChatSending(activeChat.id)}
        lastContextCompaction={lastContextCompaction?.chatId === activeChat.id && lastContextCompaction.contextWindowTokens === contextWindow.tokens ? lastContextCompaction : null}
        localWorkspace={localWorkspace}
        model={providerSettings.model}
        modelContextWindows={modelContextWindows}
        onComposerDraftApplied={() => setComposerDraftToRestore(null)}
        onAddAutomation={handleAddAutomation}
        onArchiveChat={handleArchiveActiveChat}
        onCopyChatDeeplink={() => void handleCopyChatDeeplink()}
        onCopyChatMarkdown={() => void handleCopyChatMarkdown()}
        onCopySessionId={() => void handleCopySessionId()}
        onCopyWorkingDirectory={() => void handleCopyWorkingDirectory()}
        onForkChatLocal={handleForkActiveChatLocal}
        onForkChatWorktree={handleForkActiveChatWorktree}
        onLocalWorkspaceChange={handleLocalWorkspaceChange}
        onModelChange={(nextModel, nextProvider) =>
          setProviderSettings((settings) => {
            const provider = nextProvider ?? settings.provider;
            return {
              ...settings,
              model: nextModel,
              provider,
              providerModels: {
                ...settings.providerModels,
                [provider]: nextModel,
              },
            };
          })
        }
        onRequestPlanRevision={handleRequestPlanRevision}
        onRegenerateResponse={handleRegenerateResponse}
        onResolveToolApproval={handleResolveToolApproval}
        onSendMessage={handleSendMessage}
        onDeleteQueuedMessage={handleDeleteQueuedMessage}
        onHoldQueuedMessage={handleHoldQueuedMessage}
        onSteerQueuedMessage={handleSteerQueuedMessage}
        onUpdateQueuedMessage={handleUpdateQueuedMessage}
        onStopGeneration={handleStopGeneration}
        onSubmitPlanningInput={handleSubmitPlanningInput}
        lastProviderContextUsage={lastProviderContextUsage?.chatId === activeChat.id ? lastProviderContextUsage.usage : null}
        onCreateProject={openCreateProjectDialog}
        providerSettings={createToolAwareProviderSettings()}
        projects={projects}
        queuedMessageCount={queuedChatSends.filter((queuedSend) => queuedSend.chatId === activeChat.id).length}
        heldQueuedMessageIds={queuedChatSends.filter((queuedSend) => queuedSend.chatId === activeChat.id && queuedSend.held).map((queuedSend) => queuedSend.userMessageId)}
        onSelectProject={handleSelectProject}
        onThinkingChange={(nextThinking) => setProviderSettings((settings) => ({ ...settings, thinking: nextThinking }))}
        onWebSearchChange={(nextWebSearch) => setProviderSettings((settings) => ({ ...settings, webSearch: nextWebSearch }))}
        thinking={providerSettings.thinking}
        webSearch={providerSettings.webSearch}
        onTogglePin={() => activeChat && handleTogglePin(activeChat.id)}
        onToggleTerminal={handleToggleTerminal}
        onOpenChatInNewWindow={handleOpenActiveChatInNewWindow}
        onOpenSideChat={() => handleNewChat(activeChat.project)}
        onRenameChat={() => handleOpenRenameChat(activeChat)}
        terminalEnabled={toolSettings.terminal}
        terminalOpen={terminalOpen}
      />
    );
  }

  function handleSkipOnboarding() {
    setOnboardingOpen(false);
  }

  function handleNeverShowOnboarding() {
    savePersistentString(ONBOARDING_NEVER_SHOW_KEY, "true");
    setOnboardingOpen(false);
  }

  function handleOpenOnboardingSettings() {
    setActiveSettingsSection("providers");
    setActiveRoute("settings");
    setOnboardingOpen(false);
  }

  const pendingDeleteChat = pendingDeleteChatId ? chats.find((chat) => chat.id === pendingDeleteChatId) : undefined;
  const pendingRenameChat = renameChatId ? chats.find((chat) => chat.id === renameChatId) : undefined;
  const pendingDeleteProject = pendingDeleteProjectName ? projects.find((project) => project.name.toLowerCase() === pendingDeleteProjectName.toLowerCase()) : undefined;
  const pendingDeleteProjectChats = pendingDeleteProject
    ? chats.filter((chat) => chat.project.toLowerCase() === pendingDeleteProject.name.toLowerCase())
    : [];

  return (
    <>
      <AppShell
        activeChatId={activeChatId}
        activeRoute={activeRoute}
        activeSettingsSection={activeSettingsSection}
        appInfo={appInfo}
        appearanceMode={appearanceMode}
        authUser={authSession.user}
        chats={chats}
        desktopRuntime={isDesktopRuntime}
        projects={projects}
        searchOpen={searchOpen}
        sidebarOpen={sidebarOpen}
        onAppearanceModeChange={setAppearanceMode}
        onCreateProject={openCreateProjectDialog}
        onCloseSearch={() => setSearchOpen(false)}
        onDeleteChat={handleDeleteChat}
        onDeleteProject={handleDeleteProject}
        onNewChat={handleNewChat}
        onOpenBulkDeleteChats={handleOpenBulkDeleteChats}
        onOpenSearch={() => setSearchOpen(true)}
        onLogout={onLogout}
        onRouteChange={setActiveRoute}
        onShowAbout={() => setAboutOpen(true)}
        onCloseTerminal={() => setTerminalOpen(false)}
        onSelectChat={handleSelectChat}
        onSelectProject={handleSelectProject}
        onSettingsSectionChange={setActiveSettingsSection}
        onTerminalHeightChange={setTerminalHeight}
        onToggleTerminal={handleToggleTerminal}
        onTogglePin={handleTogglePin}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        terminalAttachedSession={terminalAttachedSession}
        terminalHeight={terminalHeight}
        terminalOpen={terminalOpen}
        terminalWorkingDirectory={localWorkspace.enabled && localWorkspace.roots[0] ? localWorkspace.roots[0] : defaultTerminalWorkingDirectory}
      >
        <div className="route-stack">
          <div className="route-panel" data-active={activeRoute === "chat"} data-route="chat" aria-hidden={activeRoute !== "chat"}>
            {renderChatPage()}
          </div>
          {activeRoute !== "chat" ? (
            <div className="route-panel" data-active="true" data-route={activeRoute}>
              {renderUtilityPage()}
            </div>
          ) : null}
        </div>
      </AppShell>

      <OnboardingDialog
        open={onboardingOpen}
        onClose={handleSkipOnboarding}
        onNeverShowAgain={handleNeverShowOnboarding}
        onOpenSettings={handleOpenOnboardingSettings}
      />

      <BulkDeleteChatsDialog
        chats={chats}
        open={bulkDeleteChatsOpen}
        selectedChatIds={bulkDeleteChatIds}
        sendingChatIds={sendingChatIds}
        onClearSelection={handleClearBulkDeleteChats}
        onClose={() => {
          setBulkDeleteChatsOpen(false);
          setBulkDeleteChatIds([]);
        }}
        onConfirm={confirmBulkDeleteChats}
        onSelectAll={handleSelectAllBulkDeleteChats}
        onToggleChat={handleToggleBulkDeleteChat}
      />

      <TextInputDialog
        confirmLabel="Rename"
        description={pendingRenameChat ? `Current project: ${pendingRenameChat.project}` : undefined}
        error={renameChatError}
        label="Chat name"
        open={Boolean(pendingRenameChat)}
        placeholder="Chat name"
        title="Rename chat"
        value={renameChatTitle}
        onChange={(value) => {
          setRenameChatTitle(value);
          setRenameChatError(null);
        }}
        onClose={() => {
          setRenameChatId(null);
          setRenameChatTitle("");
          setRenameChatError(null);
        }}
        onSubmit={confirmRenameChat}
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

      <ConfirmDialog
        confirmLabel="Delete project"
        description="This removes the project and all of its chats from local history."
        icon={Trash2}
        open={Boolean(pendingDeleteProject)}
        title="Delete project?"
        tone="danger"
        onClose={() => setPendingDeleteProjectName(null)}
        onConfirm={confirmDeleteProject}
      >
        {pendingDeleteProject ? (
          <dl className="dialog-detail-list">
            <div>
              <dt>Project</dt>
              <dd>{pendingDeleteProject.name}</dd>
            </div>
            <div>
              <dt>Chats</dt>
              <dd>{pendingDeleteProjectChats.length}</dd>
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

function formatDiscordStreamMessage(update: DiscordStreamUpdate, final: boolean) {
  const sections: string[] = [];
  const visibleContent = update.content?.trim();

  if (!final) {
    sections.push(update.status || "Gilbert is working...");

    if (!visibleContent && update.progress) {
      sections.push(formatDiscordProgress(update.progress));
    }

    if (update.toolCall && update.toolCall.status !== "complete") {
      sections.push(formatDiscordToolStatus(update.toolCall));
    }
  }

  if (visibleContent) {
    sections.push(visibleContent);
  } else if (final) {
    sections.push(update.status === "Error" ? "Gilbert hit an error before producing a visible answer." : "Gilbert finished, but there was no visible response text.");
  }

  if (final && update.sources?.length) {
    sections.push(formatDiscordSources(update.sources));
  }

  return limitDiscordStreamMessage(formatMarkdownForDiscord(sections.filter(Boolean).join("\n\n")));
}

function waitForDiscordFlushSlot() {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, 80);
  });
}

function formatDiscordProgress(progress: ChatProgressItem) {
  return progress.detail ? `${progress.label}: ${progress.detail}` : progress.label;
}

function formatLocalToolPreviewProgress(toolCalls: ChatToolCall[]) {
  if (toolCalls.length === 0) {
    return "Preparing tool request";
  }

  const firstDetailedTool = toolCalls.find((toolCall) => toolCall.label !== "Agent tools" || toolCall.detail);
  const targets = toolCalls
    .map((toolCall) => toolCall.detail)
    .filter((detail): detail is string => Boolean(detail?.trim()))
    .slice(0, 2);
  const targetText = targets.length > 0 ? `: ${targets.join(", ")}${toolCalls.length > targets.length ? ` and ${toolCalls.length - targets.length} more` : ""}` : "";

  if (toolCalls.length === 1) {
    return firstDetailedTool ? `Preparing ${firstDetailedTool.label.toLowerCase()}${firstDetailedTool.detail ? `: ${firstDetailedTool.detail}` : ""}` : "Preparing tool request";
  }

  return `Preparing ${toolCalls.length} tool calls${targetText}`;
}

function formatDiscordToolStatus(toolCall: ChatToolCall) {
  const status = toolCall.status === "waiting_approval" ? "waiting for approval" : toolCall.status.replace("_", " ");
  const detail = toolCall.detail || toolCall.output;

  return [`Tool ${status}: ${toolCall.label}`, detail ? detail.slice(0, 280) : ""].filter(Boolean).join("\n");
}

function formatDiscordSources(sources: ChatSource[]) {
  const formattedSources = sources.slice(0, 3).map((source, index) => `${index + 1}. ${source.title} - ${source.url}`);

  return ["Sources:", ...formattedSources].join("\n");
}

function limitDiscordStreamMessage(content: string) {
  const normalized = content.trim();

  if (normalized.length <= DISCORD_STREAM_MESSAGE_LIMIT) {
    return normalized;
  }

  const suffix = "\n\n[More is available in Gilbert.]";
  const limit = DISCORD_STREAM_MESSAGE_LIMIT - suffix.length - 4;
  const trimmed = closeUnclosedDiscordCodeFence(normalized.slice(0, Math.max(0, limit)).trim());

  return `${trimmed}${suffix}`;
}

function formatMarkdownForDiscord(content: string) {
  const segments = splitMarkdownFenceSegments(content.replace(/\r\n/g, "\n"));

  return segments
    .map((segment) => (segment.code ? segment.content : formatDiscordTextMarkdown(segment.content)))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitMarkdownFenceSegments(content: string) {
  const segments: Array<{ code: boolean; content: string }> = [];
  const fencePattern = /```[\s\S]*?```/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = fencePattern.exec(content))) {
    if (match.index > cursor) {
      segments.push({ code: false, content: content.slice(cursor, match.index) });
    }

    segments.push({ code: true, content: match[0] });
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({ code: false, content: content.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ code: false, content }];
}

function formatDiscordTextMarkdown(content: string) {
  const lines = content.split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (isMarkdownTableStart(lines, index)) {
      const { nextIndex, rendered } = renderMarkdownTableForDiscord(lines, index);
      output.push(rendered);
      index = nextIndex - 1;
      continue;
    }

    if (isMarkdownHorizontalRule(lines[index])) {
      if (output[output.length - 1]?.trim()) {
        output.push("");
      }
      continue;
    }

    output.push(lines[index]);
  }

  return output.join("\n");
}

function isMarkdownHorizontalRule(line: string) {
  return /^(\s*)(-{3,}|\*{3,}|_{3,})(\s*)$/.test(line);
}

function isMarkdownTableStart(lines: string[], index: number) {
  const header = lines[index]?.trim() ?? "";
  const separator = lines[index + 1]?.trim() ?? "";

  return header.includes("|") && /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(separator);
}

function renderMarkdownTableForDiscord(lines: string[], startIndex: number) {
  const headers = parseMarkdownTableRow(lines[startIndex]);
  const rows: string[][] = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
    rows.push(parseMarkdownTableRow(lines[index]));
    index += 1;
  }

  const renderedRows = rows
    .map((row) => renderMarkdownTableRowForDiscord(headers, row))
    .filter(Boolean);

  return {
    nextIndex: index,
    rendered: renderedRows.length > 0 ? renderedRows.join("\n") : lines.slice(startIndex, index).join("\n"),
  };
}

function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

function renderMarkdownTableRowForDiscord(headers: string[], row: string[]) {
  if (headers.length <= 2 && row.length >= 2) {
    return `- **${row[0]}:** ${row[1]}`;
  }

  const cells = row
    .map((cell, index) => {
      const header = headers[index]?.trim();
      return header ? `**${header}:** ${cell}` : cell;
    })
    .filter(Boolean);

  return cells.length > 0 ? `- ${cells.join("; ")}` : "";
}

function closeUnclosedDiscordCodeFence(content: string) {
  const fenceCount = content.match(/```/g)?.length ?? 0;

  return fenceCount % 2 === 1 ? `${content}\n\`\`\`` : content;
}

function getChatIdFromLocationHash() {
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const chatId = params.get("chat");

  return chatId?.trim() || "";
}

function createChatDeeplink(chatId: string) {
  const url = new URL(window.location.href);
  url.hash = `chat=${encodeURIComponent(chatId)}`;
  return url.toString();
}

function formatChatAsMarkdown(chat: ChatSummary) {
  const sections = [
    `# ${chat.title || "New chat"}`,
    "",
    `- Session: \`${chat.id}\``,
    `- Project: ${chat.project}`,
    `- Updated: ${chat.updatedAt}`,
  ];

  if (chat.messages.length === 0) {
    sections.push("", "_No messages yet._");
    return sections.join("\n");
  }

  for (const message of chat.messages) {
    const visibleBody = [message.responseThinking, message.content].filter((part) => part?.trim()).join("\n\n");

    sections.push("", `## ${message.role === "assistant" ? "Assistant" : "User"} - ${message.createdAt}`, "", visibleBody || "_No visible text._");

    if (message.reasoning?.trim()) {
      sections.push("", "<details>", "<summary>Reasoning</summary>", "", message.reasoning.trim(), "", "</details>");
    }

    if (message.attachments?.length) {
      sections.push("", "Attachments:", ...message.attachments.map((attachment) => `- ${attachment.name} (${attachment.mimeType}, ${attachment.size} bytes)`));
    }

    if (message.sources?.length) {
      sections.push("", "Sources:", ...message.sources.map((source) => `- [${source.title}](${source.url})${source.detail ? ` - ${source.detail}` : ""}`));
    }
  }

  return sections.join("\n");
}

function createForkedChat(sourceChat: ChatSummary, projectName: string, title = `Fork: ${sourceChat.title || "New chat"}`): ChatSummary {
  const now = new Date().toISOString();

  return {
    ...sourceChat,
    archived: false,
    id: createId("chat"),
    isDraft: undefined,
    messages: sourceChat.messages.map(cloneMessageForFork),
    pinned: false,
    project: normalizeProjectName(projectName),
    title,
    updatedAt: now,
  };
}

function cloneMessageForFork(message: ChatMessage): ChatMessage {
  return {
    ...cloneJson(message),
    agentRunId: undefined,
    agentRunStatus: undefined,
    approvals: undefined,
    id: createId("message"),
    isStreaming: undefined,
    status: message.status === "queued" ? undefined : message.status,
    toolCalls: message.toolCalls?.map(cloneToolCallForFork),
  };
}

function cloneToolCallForFork(toolCall: ChatToolCall): ChatToolCall {
  const clonedToolCall = cloneJson(toolCall);
  const active = clonedToolCall.status === "active" || clonedToolCall.status === "waiting_approval";

  return {
    ...clonedToolCall,
    detail: active ? "Snapshot from forked chat; live tool state was not carried over." : clonedToolCall.detail,
    id: createId("tool-call"),
    status: active ? "skipped" : clonedToolCall.status,
    terminal: clonedToolCall.terminal
      ? {
          ...clonedToolCall.terminal,
          live: false,
          sessionId: undefined,
        }
      : undefined,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createUniqueProjectName(baseName: string, projects: ProjectSummary[]) {
  const fallbackName = createProjectBaseName(baseName);
  const existingNames = new Set(projects.map((project) => project.name.toLowerCase()));

  if (!existingNames.has(fallbackName.toLowerCase())) {
    return fallbackName;
  }

  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${fallbackName} ${index}`;

    if (!existingNames.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${fallbackName} ${Date.now()}`;
}

function createProjectBaseName(baseName: string) {
  const trimmedBaseName = baseName.trim();

  if (!trimmedBaseName) {
    return "Folder project";
  }

  return isNoProjectName(trimmedBaseName) ? `${DEFAULT_PROJECT} folder` : trimmedBaseName;
}

function projectNameFromPath(path: string) {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);

  return parts[parts.length - 1] || "";
}

function normalizeSelectedProjectPath(path: string) {
  const trimmed = path.trim();

  if (!trimmed) {
    return "";
  }

  if (/^[a-z]:$/i.test(trimmed)) {
    return `${trimmed}\\`;
  }

  return trimmed.replace(/[\\/]+$/, "");
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}

function upsertToolCall(toolCalls: ChatToolCall[], nextToolCall: ChatToolCall) {
  const existingIndex = toolCalls.findIndex((toolCall) => toolCall.id === nextToolCall.id);

  if (existingIndex < 0) {
    return [...toolCalls, nextToolCall];
  }

  return toolCalls.map((toolCall, index) => (index === existingIndex ? nextToolCall : toolCall));
}

function mergeAgentApprovals(currentApprovals: AgentApproval[], nextApprovals: AgentApproval[]) {
  if (nextApprovals.length === 0) {
    return currentApprovals;
  }

  const mergedApprovals = [...currentApprovals];

  for (const nextApproval of nextApprovals) {
    const existingIndex = mergedApprovals.findIndex((approval) => approval.id === nextApproval.id);

    if (existingIndex >= 0) {
      mergedApprovals[existingIndex] = {
        ...mergedApprovals[existingIndex],
        ...nextApproval,
      };
    } else {
      mergedApprovals.push(nextApproval);
    }
  }

  return mergedApprovals;
}

function mergeChatArtifacts(currentArtifacts: ChatArtifact[] | undefined, nextArtifacts: ChatArtifact[] | undefined) {
  if (!nextArtifacts?.length) {
    return currentArtifacts;
  }

  const mergedArtifacts = [...(currentArtifacts ?? [])];

  for (const nextArtifact of nextArtifacts) {
    const existingIndex = mergedArtifacts.findIndex((artifact) =>
      nextArtifact.id
        ? artifact.id === nextArtifact.id
        : artifact.title === nextArtifact.title && artifact.url === nextArtifact.url,
    );

    if (existingIndex >= 0) {
      mergedArtifacts[existingIndex] = {
        ...mergedArtifacts[existingIndex],
        ...nextArtifact,
      };
    } else {
      mergedArtifacts.push(nextArtifact);
    }
  }

  return mergedArtifacts;
}

function recoverInterruptedAgentRun(run: AgentRun, now: string): AgentRun {
  if (run.status !== "running" && run.status !== "queued") {
    return run;
  }

  return {
    ...run,
    events: [
      ...run.events,
      {
        at: now,
        detail: "The app restarted before this run finished. Pending approvals are recoverable, but in-flight model/tool work was stopped.",
        id: `agent-event-${now}`,
        label: "Recovered after restart",
        type: "recovery",
      },
    ],
    lastError: "Stopped when the app restarted.",
    status: "failed",
    steps: run.steps.map((step) =>
      step.status === "running" || step.status === "queued"
        ? {
            ...step,
            completedAt: step.completedAt ?? now,
            detail: "Stopped when the app restarted.",
            status: "failed",
          }
        : step,
    ),
    updatedAt: now,
  };
}
