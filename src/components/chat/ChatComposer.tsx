import {
  type CSSProperties,
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  memo,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowUp,
  Check,
  ChevronDown,
  CloudOff,
  CornerDownRight,
  FileUp,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Globe2,
  Hand,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  MicOff,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Square,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { ModelSelectorPopover, type LiveModelCatalogStatus } from "./ModelSelectorPopover";
import { MessageSteeringQueue } from "./steering/MessageSteeringQueue";
import { createChatAttachmentFromFile, formatAttachmentSize, isImageAttachment, isMediaAttachment, isVideoAttachment } from "../../lib/chatAttachments";
import { DEFAULT_PROJECT, formatChatAge, isNoProjectName, isPlainResearchChat, normalizeProjectName, sortChatsByUpdatedAt } from "../../lib/chatUtils";
import { matchesHotkey } from "../../lib/hotkeys";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import { scheduleIdleTask } from "../../lib/idleTask";
import {
  AUTO_COMPACT_CONTEXT_THRESHOLD,
  formatTokenCount,
  type ContextWindowUsage,
  type ContextCompactionNotice,
  type ModelContextWindowMap,
} from "../../lib/contextWindow";
import { formatGitChangedFiles, formatGitChangeStripLabel, getGitStatusIssue } from "../../lib/gitStatusUi";
import { MODEL_PROVIDERS, buildProviderModelOptions, prefersLiveModelCatalog, usesLiveModelCatalog, type ChatModelOption, type ProviderModelMetadata } from "../../lib/models";
import { fetchProviderModels } from "../../services/modelProviderClient";
import { formatWebSearchProviderLabel } from "../../services/webSearchClient";
import { estimateModelProviderContextWindowUsage, projectDraftOntoProviderUsage } from "../../services/modelProviderUsage";
import { SkillMentionPicker } from "../../features/plugins/SkillMentionPicker";
import { getSkillMentionMatches, type PluginSkillOption } from "../../features/plugins/pluginCatalog";
import {
  commitComputerGitChanges,
  createComputerGitBranch,
  getComputerGitStatus,
  initComputerGitRepository,
  localPermissionModeLabel,
  pullComputerGitBranch,
  pushComputerGitBranch,
  stageComputerGitChanges,
} from "../../localWorkspace/files";
import type { ChatAttachment, ChatComposerDraft, ChatMessage, ChatSendInput, ChatSummary } from "../../types/chat";
import type { ComputerGitStatus, LocalPermissionMode, LocalWorkspaceSettings } from "../../types/localWorkspace";
import type { CreateProjectOptions, ProjectSummary } from "../../types/project";
import type { AppFollowUpBehavior, ProviderSettings, ThinkingSettings, WebSearchSettings } from "../../types/settings";

type ComposerMenu = "attach" | "context" | "model" | "workspace" | null;
type VoiceState = "blocked" | "error" | "idle" | "listening" | "requesting" | "unsupported";

interface BuiltInSpeechRecognitionAlternative {
  transcript: string;
}

interface BuiltInSpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: BuiltInSpeechRecognitionAlternative | undefined;
}

interface BuiltInSpeechRecognitionResultList {
  length: number;
  [index: number]: BuiltInSpeechRecognitionResult | undefined;
}

interface BuiltInSpeechRecognitionEvent extends Event {
  results: BuiltInSpeechRecognitionResultList;
}

interface BuiltInSpeechRecognitionErrorEvent extends Event {
  error?: string;
}

interface BuiltInSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: ((event: BuiltInSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BuiltInSpeechRecognitionEvent) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
}

type BuiltInSpeechRecognitionConstructor = new () => BuiltInSpeechRecognition;

interface ChatComposerProps {
  active?: boolean;
  chat: ChatSummary;
  chats: ChatSummary[];
  contextWindowSource: "estimate" | "openrouter" | "provider";
  contextWindowTokens: number;
  dictationDictionary?: string;
  dictationHoldHotkey?: string;
  dictationToggleHotkey?: string;
  draft?: ChatComposerDraft | null;
  restoreDraft?: ChatComposerDraft | null;
  restoreDraftId?: string | null;
  followUpBehavior?: AppFollowUpBehavior;
  isGenerating: boolean;
  lastContextCompaction?: ContextCompactionNotice | null;
  layout?: "center" | "dock";
  localWorkspace: LocalWorkspaceSettings;
  lastProviderContextUsage?: ContextWindowUsage | null;
  model: string;
  modelContextWindows: ModelContextWindowMap;
  onCreateProject: (options?: CreateProjectOptions) => void | string | null | Promise<string | null | void>;
  onDraftApplied?: () => void;
  onDraftChange?: (draft: ChatComposerDraft | null) => void;
  onDeleteQueuedMessage: (messageId: string) => void;
  onHoldQueuedMessage: (messageId: string, held: boolean) => void;
  onHeightChange?: (height: number) => void;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onModelChange: (model: string, provider: ChatModelOption["provider"]) => void;
  onForkWorktree?: () => void | Promise<void>;
  onReviewChanges?: () => void;
  onSelectProject: (project: string) => void;
  onStopGeneration?: () => void;
  onSteerQueuedMessage: (messageId: string, contentOverride?: string) => void;
  onSubmit: (input: ChatSendInput) => void | Promise<void>;
  projects: ProjectSummary[];
  providerSettings: ProviderSettings;
  queuedMessageCount?: number;
  queuedMessages?: ChatMessage[];
  requireCtrlEnterForLongPrompts?: boolean;
  heldQueuedMessageIds?: string[];
  onThinkingChange: (thinking: ThinkingSettings) => void;
  onWebSearchChange: (webSearch: WebSearchSettings) => void;
  onImageGenerationChange: (enabled: boolean) => void;
  thinking: ThinkingSettings;
  webSearch: WebSearchSettings;
}

interface ComposerAttachmentDraft {
  attachment?: ChatAttachment;
  error?: string;
  id: string;
  mimeType: string;
  name: string;
  size: number;
  status: "error" | "loading" | "ready";
}

interface PlanningModeSettings {
  enabled: boolean;
}

interface SkillMentionState {
  activeIndex: number;
  open: boolean;
  query: string;
  rangeEnd: number;
  rangeStart: number;
  trigger: "$" | "@";
}

interface SkillMentionTrigger {
  query: string;
  rangeEnd: number;
  rangeStart: number;
  trigger: "$" | "@";
}

interface ChatResearchMentionState {
  activeIndex: number;
  open: boolean;
  query: string;
  rangeEnd: number;
  rangeStart: number;
}

interface ChatResearchMentionTrigger {
  query: string;
  rangeEnd: number;
  rangeStart: number;
}

type ModelProviderDefinition = (typeof MODEL_PROVIDERS)[number];
type LiveModelCatalogCacheStatus = Extract<LiveModelCatalogStatus, "error" | "ready">;

interface LiveModelCatalogCacheEntry {
  checkedAt: number;
  key: string;
  status: LiveModelCatalogCacheStatus;
}

const GIT_STATUS_REFRESH_INTERVAL_MS = 15_000;
const LIVE_MODEL_CATALOG_READY_CACHE_MS = 5 * 60 * 1000;
const LIVE_MODEL_CATALOG_ERROR_CACHE_MS = 60 * 1000;
const LOCAL_MODEL_CATALOG_READY_CACHE_MS = 0;
const LOCAL_MODEL_CATALOG_ERROR_CACHE_MS = 0;
const CLOSED_SKILL_MENTION_STATE: SkillMentionState = {
  activeIndex: 0,
  open: false,
  query: "",
  rangeEnd: 0,
  rangeStart: 0,
  trigger: "$",
};
const CLOSED_CHAT_RESEARCH_MENTION_STATE: ChatResearchMentionState = {
  activeIndex: 0,
  open: false,
  query: "",
  rangeEnd: 0,
  rangeStart: 0,
};

function modelFromValue(modelValue: string, providerId: ChatModelOption["provider"], discoveredModels?: ProviderModelMetadata[]): ChatModelOption {
  const normalizedValue = modelValue.trim();
  const matchingOption = buildProviderModelOptions(providerId, discoveredModels, normalizedValue).find((option) => option.value === normalizedValue);

  if (matchingOption) {
    return matchingOption;
  }

  return {
    id: "custom",
    label: normalizedValue || "Choose model",
    detail: normalizedValue || "No model selected",
    provider: providerId,
    value: normalizedValue,
  };
}

function formatComposerModelLabel(label: string) {
  return label.replace(/^Codex\s+/i, "").trim() || label;
}

function shouldRequireSubmitChord(content: string) {
  return content.includes("\n") || content.length >= 240;
}

function createLiveModelCatalogRequestKey(settings: ProviderSettings) {
  return getLiveModelCatalogProviders(settings)
    .map((provider) => createLiveModelCatalogProviderRequestKey(provider, settings))
    .join("\n");
}

function getLiveModelCatalogProviders(settings: ProviderSettings) {
  return MODEL_PROVIDERS.filter((provider) => shouldLoadLiveModelCatalogProvider(provider.id, settings.provider));
}

export function shouldLoadLiveModelCatalogProvider(provider: ProviderSettings["provider"], activeProvider: ProviderSettings["provider"]) {
  return usesLiveModelCatalog(provider) && (provider === "openrouter" || provider === "9router" || provider === activeProvider || prefersLiveModelCatalog(provider));
}

function createLiveModelCatalogProviderRequestKey(provider: ModelProviderDefinition, settings: ProviderSettings) {
  const apiKey = provider.id === "openrouter" ? settings.apiKeys[provider.id] || settings.openRouterApiKey || "" : settings.apiKeys[provider.id] || "";
  const baseUrl = settings.baseUrls[provider.id] || provider.defaultBaseUrl;
  const model = settings.providerModels[provider.id] || provider.defaultModel;

  return [provider.id, baseUrl, model, fingerprintSecret(apiKey)].join("\u001f");
}

function fingerprintSecret(secret: string) {
  if (!secret) {
    return "none";
  }

  let hash = 0x811c9dc5;

  for (let index = 0; index < secret.length; index += 1) {
    hash ^= secret.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${secret.length}:${(hash >>> 0).toString(36)}`;
}

function isFreshLiveModelCatalogCache(entry: LiveModelCatalogCacheEntry | undefined, requestKey: string, provider: ProviderSettings["provider"]) {
  if (!entry || entry.key !== requestKey) {
    return false;
  }

  const maxAge =
    entry.status === "ready"
      ? prefersLiveModelCatalog(provider)
        ? LOCAL_MODEL_CATALOG_READY_CACHE_MS
        : LIVE_MODEL_CATALOG_READY_CACHE_MS
      : prefersLiveModelCatalog(provider)
        ? LOCAL_MODEL_CATALOG_ERROR_CACHE_MS
        : LIVE_MODEL_CATALOG_ERROR_CACHE_MS;

  return Date.now() - entry.checkedAt < maxAge;
}

function ChatComposerComponent({
  active = true,
  chat,
  chats,
  contextWindowSource,
  contextWindowTokens,
  dictationDictionary = "",
  dictationHoldHotkey = "",
  dictationToggleHotkey = "",
  draft,
  restoreDraft,
  restoreDraftId,
  followUpBehavior = "queue",
  isGenerating,
  lastContextCompaction,
  layout = "dock",
  localWorkspace,
  lastProviderContextUsage,
  model,
  modelContextWindows,
  onCreateProject,
  onDraftApplied,
  onDraftChange,
  onDeleteQueuedMessage,
  onHoldQueuedMessage,
  onHeightChange,
  onLocalWorkspaceChange,
  onModelChange,
  onReviewChanges,
  onSelectProject,
  onStopGeneration,
  onSteerQueuedMessage,
  onSubmit,
  projects,
  providerSettings,
  queuedMessageCount,
  queuedMessages = [],
  requireCtrlEnterForLongPrompts = false,
  heldQueuedMessageIds = [],
  onThinkingChange,
  onWebSearchChange,
  onImageGenerationChange,
  thinking,
  webSearch,
}: ChatComposerProps) {
  const composerRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const mountedRef = useRef(true);
  const skipNextAttachmentDraftEmitRef = useRef(false);
  const providerSettingsRef = useRef(providerSettings);
  const visibleQueuedMessageCount = queuedMessageCount ?? queuedMessages.length;
  const messageRef = useRef("");
  const messageSyncFrameRef = useRef(0);
  const draftChangeTimerRef = useRef<number | null>(null);
  const pendingDraftChangeRef = useRef<{ draft: ChatComposerDraft | null; onDraftChange?: (draft: ChatComposerDraft | null) => void } | null>(null);
  const voiceBaseMessageRef = useRef("");
  const voiceRecognitionRef = useRef<BuiltInSpeechRecognition | null>(null);
  const voiceRequestRef = useRef(0);
  const [message, setMessage] = useState("");
  const [contextDraftMessage, setContextDraftMessage] = useState("");
  const deferredMessage = useDeferredValue(contextDraftMessage);
  const [skillMention, setSkillMention] = useState<SkillMentionState>(CLOSED_SKILL_MENTION_STATE);
  const [chatResearchMention, setChatResearchMention] = useState<ChatResearchMentionState>(CLOSED_CHAT_RESEARCH_MENTION_STATE);
  const [selectedResearchChatIds, setSelectedResearchChatIds] = useState<string[]>([]);
  const [openMenu, setOpenMenu] = useState<ComposerMenu>(null);
  const [planMode, setPlanMode] = useState<PlanningModeSettings>({
    enabled: false,
  });
  const [attachments, setAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const [liveModelCatalogs, setLiveModelCatalogs] = useState<Partial<Record<ProviderSettings["provider"], ProviderModelMetadata[]>>>({});
  const [liveModelCatalogStatus, setLiveModelCatalogStatus] = useState<Partial<Record<ProviderSettings["provider"], LiveModelCatalogStatus>>>({});
  const liveModelCatalogCache = useRef<Partial<Record<ProviderSettings["provider"], LiveModelCatalogCacheEntry>>>({});
  const [gitStatus, setGitStatus] = useState<ComputerGitStatus | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitInitRunning, setGitInitRunning] = useState(false);
  const [gitInitNotice, setGitInitNotice] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [gitActionRunning, setGitActionRunning] = useState<string | null>(null);
  const [gitActionNotice, setGitActionNotice] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [gitCommitMessage, setGitCommitMessage] = useState("");
  const [gitBranchName, setGitBranchName] = useState("");
  const [projectSearch, setProjectSearch] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const readyAttachments = useMemo(() => attachments.flatMap((attachment) => (attachment.attachment ? [attachment.attachment] : [])), [attachments]);
  const hasMediaAttachment = useMemo(() => readyAttachments.some(isMediaAttachment), [readyAttachments]);
  const hasPendingAttachments = useMemo(() => attachments.some((attachment) => attachment.status === "loading"), [attachments]);
  const hasFailedAttachments = useMemo(() => attachments.some((attachment) => attachment.status === "error"), [attachments]);
  const canSend = (Boolean(message.trim()) || readyAttachments.length > 0) && !hasPendingAttachments && !hasFailedAttachments;
  const selectedModel = useMemo(
    () => modelFromValue(model, providerSettings.provider, liveModelCatalogs[providerSettings.provider]),
    [liveModelCatalogs, model, providerSettings.provider],
  );
  const webSearchProviderLabel = formatWebSearchProviderLabel(webSearch.provider);
  const imageGenerationEnabled = providerSettings.tools.imageGeneration;
  const estimatedContextUsage = useMemo(
    () =>
      estimateModelProviderContextWindowUsage({
        chat,
        contextWindowTokens,
        draftAttachments: readyAttachments,
        draftContent: deferredMessage,
        settings: providerSettings,
        source: contextWindowSource,
      }),
    [chat, contextWindowSource, contextWindowTokens, deferredMessage, providerSettings, readyAttachments],
  );
  const hasDraftContext = Boolean(deferredMessage.trim()) || readyAttachments.length > 0;
  const contextUsage = hasDraftContext && lastProviderContextUsage ? projectDraftOntoProviderUsage(lastProviderContextUsage, estimatedContextUsage) : lastProviderContextUsage ?? estimatedContextUsage;
  const contextUsageRatio = clampUnit(getContextRequestTokens(contextUsage) / Math.max(contextUsage.contextWindowTokens, 1));
  const contextUsagePercent = Math.round(contextUsageRatio * 100);
  const contextButtonLabel = `Context ${formatTokenCount(contextUsage.inputTokens)} input, ${formatTokenCount(getContextRequestTokens(contextUsage))} total request of ${formatTokenCount(contextUsage.contextWindowTokens)}. Auto-compacts at ${Math.round(AUTO_COMPACT_CONTEXT_THRESHOLD * 100)}%.`;
  const activeRoot = localWorkspace.roots[0] ?? "";
  const activeProjectName = normalizeProjectName(chat.project);
  const activeProject = projects.find((project) => project.name.toLowerCase() === activeProjectName.toLowerCase());
  const projectLabel = isNoProjectName(activeProjectName) ? DEFAULT_PROJECT : activeProject?.name || activeProjectName;
  const gitBranchLabel = gitStatus?.available ? gitStatus.branch || "Git" : gitStatusLoading ? "Checking Git" : "No Git";
  const hasGitChangeSummary = Boolean(gitStatus?.available && gitStatus.changedFiles > 0);
  const composerModelLabel = formatComposerModelLabel(selectedModel.label);
  const workspaceMetaLabel = gitStatus?.available
    ? hasGitChangeSummary
      ? `${gitBranchLabel} · ${gitStatus.changedFiles}`
      : gitBranchLabel
    : localWorkspace.enabled
      ? localPermissionModeLabel(localWorkspace.permissionMode)
      : "Local off";
  const workspaceButtonLabel = `Workspace: ${projectLabel}. ${workspaceMetaLabel}.`;
  const activeModeCount = (webSearch.enabled ? 1 : 0) + (imageGenerationEnabled ? 1 : 0) + (planMode.enabled ? 1 : 0);
  const heldQueuedMessageIdSet = useMemo(() => new Set(heldQueuedMessageIds), [heldQueuedMessageIds]);
  const researchChatOptions = useMemo(() => sortChatsByUpdatedAt(chats.filter((candidate) => isPlainResearchChat(candidate, chat.id))), [chat.id, chats]);
  const selectedResearchChats = useMemo(
    () =>
      selectedResearchChatIds
        .map((chatId) => researchChatOptions.find((candidate) => candidate.id === chatId))
        .filter((candidate): candidate is ChatSummary => Boolean(candidate)),
    [researchChatOptions, selectedResearchChatIds],
  );
  const researchChatMatches = useMemo(
    () => getChatResearchMentionMatches(researchChatOptions, chatResearchMention.query, selectedResearchChatIds),
    [chatResearchMention.query, researchChatOptions, selectedResearchChatIds],
  );

  function setComposerMessage(nextMessage: string, options: { immediate?: boolean; notifyDraft?: boolean; notifyDraftImmediately?: boolean } = {}) {
    messageRef.current = nextMessage;

    const textarea = textareaRef.current;
    if (textarea && textarea.value !== nextMessage) {
      textarea.value = nextMessage;
    }
    resizeComposerTextarea();

    if (options.immediate || typeof window === "undefined") {
      if (messageSyncFrameRef.current) {
        window.cancelAnimationFrame(messageSyncFrameRef.current);
        messageSyncFrameRef.current = 0;
      }
      setMessage(nextMessage);
      setContextDraftMessage(nextMessage);
      if (options.notifyDraft !== false) {
        emitDraftChange(nextMessage, attachments, { immediate: options.notifyDraftImmediately });
      }
      return;
    }

    if (options.notifyDraft !== false) {
      emitDraftChange(nextMessage, attachments, { immediate: options.notifyDraftImmediately });
    }

    if (messageSyncFrameRef.current) {
      return;
    }

    messageSyncFrameRef.current = window.requestAnimationFrame(() => {
      messageSyncFrameRef.current = 0;
      setMessage(messageRef.current);
      resizeComposerTextarea();
    });
  }

  function resizeComposerTextarea() {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    const viewportHeight = typeof window === "undefined" ? 720 : window.innerHeight;
    const maxHeight = Math.round(Math.min(220, Math.max(112, viewportHeight * 0.3)));

    textarea.style.height = "auto";
    const nextHeight = Math.min(maxHeight, Math.max(66, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function canSubmitDraft(content: string) {
    return (Boolean(content.trim()) || readyAttachments.length > 0) && !hasPendingAttachments && !hasFailedAttachments;
  }

  function emitDraftChange(content: string, attachmentDrafts: ComposerAttachmentDraft[], options: { immediate?: boolean } = {}) {
    const draft = createComposerDraft(content, attachmentDrafts);

    if (options.immediate || typeof window === "undefined") {
      cancelPendingDraftChange();
      setContextDraftMessage(content);
      onDraftChange?.(draft);
      return;
    }

    pendingDraftChangeRef.current = {
      draft,
      onDraftChange,
    };

    if (draftChangeTimerRef.current !== null) {
      window.clearTimeout(draftChangeTimerRef.current);
    }

    draftChangeTimerRef.current = window.setTimeout(() => {
      flushPendingDraftChange();
    }, 350);
  }

  function flushPendingDraftChange(options: { updateContext?: boolean } = {}) {
    if (draftChangeTimerRef.current !== null) {
      window.clearTimeout(draftChangeTimerRef.current);
      draftChangeTimerRef.current = null;
    }

    const pendingDraftChange = pendingDraftChangeRef.current;
    pendingDraftChangeRef.current = null;

    if (options.updateContext !== false && mountedRef.current) {
      setContextDraftMessage(messageRef.current);
    }

    if (pendingDraftChange) {
      pendingDraftChange.onDraftChange?.(pendingDraftChange.draft);
    }
  }

  function cancelPendingDraftChange() {
    if (draftChangeTimerRef.current !== null) {
      window.clearTimeout(draftChangeTimerRef.current);
      draftChangeTimerRef.current = null;
    }

    pendingDraftChangeRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      flushPendingDraftChange({ updateContext: false });
      mountedRef.current = false;
      if (messageSyncFrameRef.current) {
        window.cancelAnimationFrame(messageSyncFrameRef.current);
        messageSyncFrameRef.current = 0;
      }
      cancelVoiceInput(false);
    };
  }, []);

  useDismissableLayer({
    active: openMenu !== null,
    ignoreSelectors: [".model-selector-popover"],
    onDismiss: () => setOpenMenu(null),
    refs: [composerRef],
  });

  useEffect(() => {
    if (!active) {
      setGitStatusLoading(false);
      return;
    }

    if (!activeRoot || localWorkspace.scope === "full-computer") {
      setGitStatus(null);
      setGitStatusLoading(false);
      setGitInitNotice(null);
      return;
    }

    let disposed = false;

    async function refreshGitStatus(showLoading: boolean) {
      if (showLoading) {
        setGitStatusLoading(true);
      }

      try {
        const status = await getComputerGitStatus(activeRoot);

        if (!disposed) {
          setGitStatus(status);
        }
      } catch (error) {
        if (!disposed) {
          setGitStatus(createUnavailableGitStatus(readErrorMessage(error, "Git status unavailable.")));
        }
      } finally {
        if (!disposed) {
          setGitStatusLoading(false);
        }
      }
    }

    const cancelInitialRefresh = scheduleIdleTask(() => {
      void refreshGitStatus(true);
    }, 900);

    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshGitStatus(false);
      }
    }, GIT_STATUS_REFRESH_INTERVAL_MS);
    const refreshOnFocus = () => void refreshGitStatus(false);
    const refreshOnVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshGitStatus(false);
      }
    };

    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);

    return () => {
      disposed = true;
      cancelInitialRefresh();
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [active, activeRoot, localWorkspace.indexUpdatedAt, localWorkspace.scope]);

  useEffect(() => {
    setGitInitNotice(null);
    setGitActionNotice(null);
    setGitCommitMessage("");
    setGitBranchName("");
  }, [activeRoot]);

  useEffect(() => {
    const composer = composerRef.current;

    if (!active || !composer || !onHeightChange) {
      return;
    }

    let pendingHeight = Math.round(composer.offsetHeight);
    let lastReportedHeight = pendingHeight;
    let animationFrame = 0;

    onHeightChange(pendingHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      const nextHeight = Math.round(entry.contentRect.height);

      if (nextHeight === lastReportedHeight) {
        return;
      }

      pendingHeight = nextHeight;

      if (animationFrame) {
        return;
      }

      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        lastReportedHeight = pendingHeight;
        onHeightChange(pendingHeight);
      });
    });

    observer.observe(composer);

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }

      observer.disconnect();
    };
  }, [active, onHeightChange]);

  useEffect(() => {
    flushPendingDraftChange();
    skipNextAttachmentDraftEmitRef.current = true;
    setComposerMessage(draft?.content ?? "", { immediate: true, notifyDraft: false });
    setAttachments(draft?.attachments.map(createDraftFromAttachment) ?? []);
    closeSkillMentionPicker();
    closeChatResearchMentionPicker();
  }, [chat.id]);

  useEffect(() => {
    if (skipNextAttachmentDraftEmitRef.current) {
      skipNextAttachmentDraftEmitRef.current = false;
      return;
    }

    emitDraftChange(messageRef.current, attachments);
  }, [attachments]);

  useEffect(() => {
    resizeComposerTextarea();
  }, [message]);

  useEffect(() => {
    window.addEventListener("resize", resizeComposerTextarea);

    return () => window.removeEventListener("resize", resizeComposerTextarea);
  }, []);

  useEffect(() => {
    if (!restoreDraft || !restoreDraftId) {
      return;
    }

    skipNextAttachmentDraftEmitRef.current = true;
    setComposerMessage(restoreDraft.content, { immediate: true, notifyDraft: false });
    setAttachments(restoreDraft.attachments.map(createDraftFromAttachment));
    closeSkillMentionPicker();
    closeChatResearchMentionPicker();
    cancelPendingDraftChange();
    setContextDraftMessage(restoreDraft.content);
    onDraftChange?.(restoreDraft);
    onDraftApplied?.();
  }, [restoreDraftId]);

  useEffect(() => {
    setSelectedResearchChatIds([]);
    closeChatResearchMentionPicker();
  }, [chat.id]);

  useEffect(() => {
    if (!active || (!dictationHoldHotkey && !dictationToggleHotkey)) {
      return;
    }

    function handleDictationKeyDown(event: globalThis.KeyboardEvent) {
      if (event.repeat) {
        return;
      }

      if (dictationToggleHotkey && matchesHotkey(event, dictationToggleHotkey)) {
        event.preventDefault();
        handleVoiceToggle();
        return;
      }

      if (dictationHoldHotkey && matchesHotkey(event, dictationHoldHotkey)) {
        event.preventDefault();
        if (voiceState !== "listening" && voiceState !== "requesting") {
          handleVoiceToggle();
        }
      }
    }

    function handleDictationKeyUp(event: globalThis.KeyboardEvent) {
      if (!dictationHoldHotkey || !matchesHotkey(event, dictationHoldHotkey)) {
        return;
      }

      event.preventDefault();
      if (voiceState === "listening" || voiceState === "requesting") {
        handleVoiceToggle();
      }
    }

    window.addEventListener("keydown", handleDictationKeyDown);
    window.addEventListener("keyup", handleDictationKeyUp);
    return () => {
      window.removeEventListener("keydown", handleDictationKeyDown);
      window.removeEventListener("keyup", handleDictationKeyUp);
    };
  }, [active, dictationHoldHotkey, dictationToggleHotkey, voiceState]);

  const liveModelCatalogRequestKey = createLiveModelCatalogRequestKey(providerSettings);
  providerSettingsRef.current = providerSettings;

  useEffect(() => {
    const subscriptionProviderReady =
      providerSettings.provider === "9router" ||
      Boolean(providerSettings.providerModels["9router"]?.trim());

    if (subscriptionProviderReady) {
      return;
    }

    delete liveModelCatalogCache.current["9router"];
    clearLiveModelCatalog("9router");
    setLiveModelCatalogStatus((current) => {
      if (!current["9router"]) {
        return current;
      }

      const next = { ...current };
      delete next["9router"];
      return next;
    });
  }, [providerSettings.provider, providerSettings.providerModels]);

  useEffect(() => {
    if (openMenu !== "model") {
      return;
    }

    const latestProviderSettings = providerSettingsRef.current;
    const liveProviders = getLiveModelCatalogProviders(latestProviderSettings);
    const controllers = liveProviders.flatMap((provider) => {
      const requestKey = createLiveModelCatalogProviderRequestKey(provider, latestProviderSettings);
      const cachedCatalog = liveModelCatalogCache.current[provider.id];
      const cachedStatus = cachedCatalog?.status;

      if (cachedStatus && isFreshLiveModelCatalogCache(cachedCatalog, requestKey, provider.id)) {
        setLiveModelCatalogStatus((current) => (current[provider.id] === cachedStatus ? current : { ...current, [provider.id]: cachedStatus }));
        if (prefersLiveModelCatalog(provider.id) && cachedStatus === "error") {
          clearLiveModelCatalog(provider.id);
        }
        return [];
      }

      return [{ controller: new AbortController(), provider, requestKey }];
    });

    controllers.forEach(({ controller, provider, requestKey }) => {
      setLiveModelCatalogStatus((current) => ({
        ...current,
        [provider.id]: "loading",
      }));
      if (prefersLiveModelCatalog(provider.id)) {
        clearLiveModelCatalog(provider.id);
      }

      const settingsForProvider: ProviderSettings = {
        ...latestProviderSettings,
        model: latestProviderSettings.providerModels[provider.id] || provider.defaultModel,
        provider: provider.id,
      };

      void fetchProviderModels(settingsForProvider, { signal: controller.signal })
        .then((models) => {
          if (controller.signal.aborted) {
            return;
          }

          setLiveModelCatalogs((current) => ({
            ...current,
            [provider.id]: models,
          }));
          liveModelCatalogCache.current[provider.id] = {
            checkedAt: Date.now(),
            key: requestKey,
            status: "ready",
          };
          setLiveModelCatalogStatus((current) => ({
            ...current,
            [provider.id]: "ready",
          }));
        })
        .catch(() => {
          if (controller.signal.aborted) {
            return;
          }

          if (prefersLiveModelCatalog(provider.id)) {
            clearLiveModelCatalog(provider.id);
          }
          liveModelCatalogCache.current[provider.id] = {
            checkedAt: Date.now(),
            key: requestKey,
            status: "error",
          };
          setLiveModelCatalogStatus((current) => ({
            ...current,
            [provider.id]: "error",
          }));
        });
    });

    return () => controllers.forEach(({ controller }) => controller.abort());
  }, [liveModelCatalogRequestKey, openMenu]);

  function clearLiveModelCatalog(provider: ProviderSettings["provider"]) {
    setLiveModelCatalogs((current) => {
      if (!current[provider]?.length) {
        return current;
      }

      return {
        ...current,
        [provider]: [],
      };
    });
  }

  function toggleMenu(menu: Exclude<ComposerMenu, null>) {
    setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
  }

  function handleComposerPointerDownCapture(event: ReactPointerEvent<HTMLFormElement>) {
    if (openMenu !== "attach") {
      return;
    }

    const target = event.target instanceof Element ? event.target : null;

    if (target?.closest(".composer-popover-attach") || target?.closest(".composer-attach-toggle")) {
      return;
    }

    setOpenMenu(null);
  }

  function handleModelMenuPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    toggleMenu("model");
  }

  function handleModelMenuClick(event: ReactMouseEvent<HTMLButtonElement>) {
    if (event.detail === 0) {
      toggleMenu("model");
    }
  }

  async function initializeGitRepository() {
    if (!activeRoot || gitInitRunning) {
      return;
    }

    setGitInitRunning(true);
    setGitInitNotice(null);

    try {
      const result = await initComputerGitRepository(activeRoot);
      setGitStatus(result.status);
      setGitInitNotice({ kind: "success", message: result.message });
    } catch (error) {
      setGitInitNotice({ kind: "error", message: readErrorMessage(error, "Git init failed.") });
    } finally {
      setGitInitRunning(false);
    }
  }

  async function runComposerGitAction(actionId: string, action: () => Promise<{ message: string; status: ComputerGitStatus }>, success?: (message: string) => void) {
    if (!activeRoot || gitActionRunning) {
      return;
    }

    setGitActionRunning(actionId);
    setGitActionNotice(null);

    try {
      const result = await action();
      setGitStatus(result.status);
      setGitActionNotice({ kind: "success", message: result.message });
      success?.(result.message);
    } catch (error) {
      setGitActionNotice({ kind: "error", message: readErrorMessage(error, "Git action failed.") });
    } finally {
      setGitActionRunning(null);
    }
  }

  function stageAllComposerGitChanges() {
    void runComposerGitAction("stage", () => stageComputerGitChanges(activeRoot));
  }

  function pullComposerGitBranch() {
    void runComposerGitAction("pull", () => pullComputerGitBranch(activeRoot));
  }

  function pushComposerGitBranch() {
    void runComposerGitAction("push", () => pushComputerGitBranch(activeRoot));
  }

  function commitComposerGitChanges() {
    const messageText = gitCommitMessage.trim();

    if (!messageText) {
      setGitActionNotice({ kind: "error", message: "Enter a commit message first." });
      return;
    }

    void runComposerGitAction("commit", () => commitComputerGitChanges(activeRoot, messageText, true), () => setGitCommitMessage(""));
  }

  function createComposerGitBranch() {
    const branchName = gitBranchName.trim();

    if (!branchName) {
      setGitActionNotice({ kind: "error", message: "Enter a branch name first." });
      return;
    }

    void runComposerGitAction("branch", () => createComputerGitBranch(activeRoot, branchName), () => setGitBranchName(""));
  }

  function togglePlanMode() {
    setPlanMode((currentPlanMode) => ({
      ...currentPlanMode,
      enabled: !currentPlanMode.enabled,
    }));
  }

  function toggleWebSearch() {
    onWebSearchChange({
      ...webSearch,
      enabled: !webSearch.enabled,
      provider: webSearch.provider,
    });
  }

  function toggleImageGeneration() {
    onImageGenerationChange(!imageGenerationEnabled);
  }

  function addAttachmentFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const draftAttachments = files.map((file, index) => ({
      id: createDraftAttachmentId(index),
      mimeType: file.type || "application/octet-stream",
      name: file.name || "Attachment",
      size: file.size,
      status: "loading" as const,
    }));

    setAttachments((currentAttachments) => [...currentAttachments, ...draftAttachments]);
    void prepareAttachments(files, draftAttachments);
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    addAttachmentFiles(selectedFiles);
    event.target.value = "";
    setOpenMenu(null);
  }

  function handleComposerPaste(event: ClipboardEvent<HTMLFormElement>) {
    const pastedImages = getPastedImageFiles(event.clipboardData);

    if (pastedImages.length === 0) {
      return;
    }

    event.preventDefault();
    addAttachmentFiles(pastedImages);
    setOpenMenu(null);
  }

  async function prepareAttachments(files: File[], draftAttachments: ComposerAttachmentDraft[]) {
    await Promise.all(
      files.map(async (file, index) => {
        const draftId = draftAttachments[index]?.id;

        if (!draftId) {
          return;
        }

        try {
          const attachment = await createChatAttachmentFromFile(file);

          if (!mountedRef.current) {
            return;
          }

          setAttachments((currentAttachments) =>
            currentAttachments.map((draft) =>
              draft.id === draftId
                ? {
                    ...draft,
                    attachment,
                    mimeType: attachment.mimeType,
                    status: "ready",
                  }
                : draft,
            ),
          );
        } catch (error) {
          if (!mountedRef.current) {
            return;
          }

          setAttachments((currentAttachments) =>
            currentAttachments.map((draft) =>
              draft.id === draftId
                ? {
                    ...draft,
                    error: error instanceof Error ? error.message : "Could not prepare this attachment.",
                    status: "error",
                  }
                : draft,
            ),
          );
        }
      }),
    );
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function removeAttachment(fileIndex: number) {
    setAttachments((currentAttachments) => currentAttachments.filter((_, index) => index !== fileIndex));
  }

  function submitMessage() {
    const content = messageRef.current.trim();

    if (!canSubmitDraft(content)) {
      return;
    }

    const referencedChatIds = resolveComposerResearchChatIds(content, selectedResearchChatIds, researchChatOptions);

    setComposerMessage("", { immediate: true, notifyDraft: false });
    setAttachments([]);
    setSelectedResearchChatIds([]);
    closeSkillMentionPicker();
    closeChatResearchMentionPicker();
    cancelPendingDraftChange();
    setContextDraftMessage("");
    onDraftChange?.(null);
    void onSubmit({
      attachments: readyAttachments,
      content,
      followUpBehavior,
      localWorkspace,
      mode: planMode.enabled ? "plan" : "chat",
      planning: planMode.enabled ? {} : undefined,
      referencedChatIds: referencedChatIds.length > 0 ? referencedChatIds : undefined,
      webSearch: {
        enabled: webSearch.enabled,
        maxResults: webSearch.maxResults,
        provider: webSearch.provider,
      },
    });
  }

  function restoreQueuedMessageToComposer(queuedMessage: ChatMessage) {
    const restoredAttachments = (queuedMessage.attachments ?? []).map(createDraftFromAttachment);

    setOpenMenu(null);
    closeSkillMentionPicker();
    closeChatResearchMentionPicker();
    setSelectedResearchChatIds(queuedMessage.researchReferences?.map((reference) => reference.chatId) ?? []);
    skipNextAttachmentDraftEmitRef.current = true;
    setAttachments(restoredAttachments);
    setComposerMessage(queuedMessage.content, { immediate: true, notifyDraft: false });
    cancelPendingDraftChange();
    setContextDraftMessage(queuedMessage.content);
    onDraftChange?.(createComposerDraft(queuedMessage.content, restoredAttachments));
    onHoldQueuedMessage(queuedMessage.id, false);
    onDeleteQueuedMessage(queuedMessage.id);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      const cursorPosition = queuedMessage.content.length;
      textareaRef.current?.setSelectionRange(cursorPosition, cursorPosition);
      resizeComposerTextarea();
    });
  }

  function steerQueuedMessage(messageId: string) {
    const queuedMessage = queuedMessages.find((message) => message.id === messageId);
    const nextContent = (queuedMessage?.content ?? "").trim();

    if (!nextContent) {
      return;
    }

    onHoldQueuedMessage(messageId, false);
    onSteerQueuedMessage(messageId, nextContent);
  }

  function handleTextKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (skillMention.open) {
      const matches = getSkillMentionMatches(skillMention.query);

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSkillMention((currentState) => ({
          ...currentState,
          activeIndex: matches.length > 0 ? (currentState.activeIndex + 1) % matches.length : 0,
        }));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSkillMention((currentState) => ({
          ...currentState,
          activeIndex: matches.length > 0 ? (currentState.activeIndex - 1 + matches.length) % matches.length : 0,
        }));
        return;
      }

      if ((event.key === "Enter" || event.key === "Tab") && matches.length > 0) {
        event.preventDefault();
        insertSkillMention(matches[Math.min(skillMention.activeIndex, matches.length - 1)]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSkillMentionPicker();
        return;
      }
    }

    if (chatResearchMention.open) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setChatResearchMention((currentState) => ({
          ...currentState,
          activeIndex: researchChatMatches.length > 0 ? (currentState.activeIndex + 1) % researchChatMatches.length : 0,
        }));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setChatResearchMention((currentState) => ({
          ...currentState,
          activeIndex: researchChatMatches.length > 0 ? (currentState.activeIndex - 1 + researchChatMatches.length) % researchChatMatches.length : 0,
        }));
        return;
      }

      if ((event.key === "Enter" || event.key === "Tab") && researchChatMatches.length > 0) {
        event.preventDefault();
        insertChatResearchMention(researchChatMatches[Math.min(chatResearchMention.activeIndex, researchChatMatches.length - 1)]);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeChatResearchMentionPicker();
        return;
      }
    }

    if (event.key === "Enter" && !event.shiftKey) {
      const requiresSubmitChord = requireCtrlEnterForLongPrompts && shouldRequireSubmitChord(messageRef.current);

      if (requiresSubmitChord && !event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();
      submitMessage();
    }
  }

  function handleMessageChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const nextMessage = event.target.value;

    setComposerMessage(nextMessage);
    syncComposerMentionPickers(nextMessage, event.target.selectionStart ?? nextMessage.length, event.target.selectionEnd ?? event.target.selectionStart ?? nextMessage.length);
  }

  function handleTextSelection(event: ReactMouseEvent<HTMLTextAreaElement> | KeyboardEvent<HTMLTextAreaElement>) {
    const target = event.currentTarget;

    syncComposerMentionPickers(target.value, target.selectionStart ?? target.value.length, target.selectionEnd ?? target.selectionStart ?? target.value.length);
  }

  function closeSkillMentionPicker() {
    setSkillMention(CLOSED_SKILL_MENTION_STATE);
  }

  function closeChatResearchMentionPicker() {
    setChatResearchMention(CLOSED_CHAT_RESEARCH_MENTION_STATE);
  }

  function syncComposerMentionPickers(nextMessage: string, selectionStart: number, selectionEnd: number) {
    syncSkillMentionPicker(nextMessage, selectionStart, selectionEnd);
    syncChatResearchMentionPicker(nextMessage, selectionStart, selectionEnd);
  }

  function syncSkillMentionPicker(nextMessage: string, selectionStart: number, selectionEnd: number) {
    if (selectionStart !== selectionEnd) {
      closeSkillMentionPicker();
      return;
    }

    const trigger = findSkillMentionTrigger(nextMessage, selectionStart);

    if (!trigger) {
      closeSkillMentionPicker();
      return;
    }

    setOpenMenu(null);
    closeChatResearchMentionPicker();
    setSkillMention({
      activeIndex: 0,
      open: true,
      query: trigger.query,
      rangeEnd: trigger.rangeEnd,
      rangeStart: trigger.rangeStart,
      trigger: trigger.trigger,
    });
  }

  function syncChatResearchMentionPicker(nextMessage: string, selectionStart: number, selectionEnd: number) {
    if (selectionStart !== selectionEnd) {
      closeChatResearchMentionPicker();
      return;
    }

    const trigger = findChatResearchMentionTrigger(nextMessage, selectionStart);

    if (!trigger) {
      closeChatResearchMentionPicker();
      return;
    }

    setOpenMenu(null);
    closeSkillMentionPicker();
    setChatResearchMention({
      activeIndex: 0,
      open: true,
      query: trigger.query,
      rangeEnd: trigger.rangeEnd,
      rangeStart: trigger.rangeStart,
    });
  }

  function insertSkillMention(skill: PluginSkillOption) {
    if (!skillMention.open) {
      return;
    }

    const currentMessage = messageRef.current;
    const beforeMention = currentMessage.slice(0, skillMention.rangeStart);
    const afterMention = currentMessage.slice(skillMention.rangeEnd).replace(/^\s+/, "");
    const insertion = `${skill.mention} `;
    const nextMessage = `${beforeMention}${insertion}${afterMention}`;
    const nextCursorPosition = beforeMention.length + insertion.length;

    setComposerMessage(nextMessage, { immediate: true });
    closeSkillMentionPicker();

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  function insertChatResearchMention(researchChat: ChatSummary) {
    if (!chatResearchMention.open) {
      return;
    }

    const currentMessage = messageRef.current;
    const beforeMention = currentMessage.slice(0, chatResearchMention.rangeStart);
    const afterMention = currentMessage.slice(chatResearchMention.rangeEnd).replace(/^\s+/, "");
    const insertion = `#${researchChat.title} `;
    const nextMessage = `${beforeMention}${insertion}${afterMention}`;
    const nextCursorPosition = beforeMention.length + insertion.length;

    setComposerMessage(nextMessage, { immediate: true });
    setSelectedResearchChatIds((currentIds) => (currentIds.includes(researchChat.id) ? currentIds : [...currentIds, researchChat.id]));
    closeChatResearchMentionPicker();

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursorPosition, nextCursorPosition);
    });
  }

  function removeSelectedResearchChat(chatId: string) {
    setSelectedResearchChatIds((currentIds) => currentIds.filter((candidateId) => candidateId !== chatId));
  }

  function cancelVoiceInput(updateState = true) {
    voiceRequestRef.current += 1;
    const recognition = voiceRecognitionRef.current;
    voiceRecognitionRef.current = null;

    if (recognition) {
      recognition.onend = null;
      recognition.onerror = null;
      recognition.onresult = null;
      recognition.abort();
    }

    if (updateState && mountedRef.current) {
      setVoiceStatus(null);
      setVoiceState("idle");
    }
  }

  function finishVoiceInput() {
    const recognition = voiceRecognitionRef.current;

    if (!recognition) {
      cancelVoiceInput();
      return;
    }

    recognition.stop();
    setVoiceStatus("Finishing dictation");
  }

  function handleVoiceToggle() {
    if (voiceState === "listening") {
      finishVoiceInput();
      return;
    }

    if (voiceState === "requesting") {
      cancelVoiceInput();
      return;
    }

    const SpeechRecognitionConstructor = getBuiltInSpeechRecognition();
    if (!SpeechRecognitionConstructor) {
      setVoiceStatus(null);
      setVoiceState("unsupported");
      return;
    }

    const requestId = voiceRequestRef.current + 1;
    voiceRequestRef.current = requestId;
    setVoiceStatus("Opening microphone");
    setVoiceState("requesting");

    try {
      const recognition = new SpeechRecognitionConstructor();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = navigator.language || "en-US";
      recognition.maxAlternatives = 1;
      voiceBaseMessageRef.current = messageRef.current;
      voiceRecognitionRef.current = recognition;

      recognition.onresult = (event) => {
        if (voiceRequestRef.current !== requestId) {
          return;
        }

        setComposerMessage(buildDictationMessage(voiceBaseMessageRef.current, event.results, dictationDictionary), { immediate: true });
        setVoiceStatus("Listening");
      };

      recognition.onerror = (event) => {
        if (!mountedRef.current || voiceRequestRef.current !== requestId) {
          return;
        }

        recognition.onend = null;
        recognition.onerror = null;
        recognition.onresult = null;
        voiceRecognitionRef.current = null;
        voiceRequestRef.current += 1;

        if (event.error === "not-allowed" || event.error === "service-not-allowed") {
          setVoiceStatus(null);
          setVoiceState("blocked");
          return;
        }

        if (event.error === "no-speech") {
          setVoiceStatus("No speech detected");
        } else {
          setVoiceStatus(formatSpeechRecognitionError(event.error));
        }
        setVoiceState("error");
      };

      recognition.onend = () => {
        if (!mountedRef.current || voiceRequestRef.current !== requestId) {
          return;
        }

        voiceRecognitionRef.current = null;
        setVoiceStatus(null);
        setVoiceState("idle");
      };

      recognition.start();
      setVoiceStatus("Listening");
      setVoiceState("listening");
    } catch (error) {
      if (mountedRef.current && voiceRequestRef.current === requestId) {
        voiceRecognitionRef.current = null;
        setVoiceStatus(readErrorMessage(error, "Voice dictation could not start."));
        setVoiceState("error");
      }
    }
  }

  const voiceBusy = voiceState === "requesting";
  const voiceLabel = formatVoiceLabel(voiceState);

  return (
    <>
      <form
        className="composer-shell"
        data-layout={layout}
        ref={composerRef}
        onPointerDownCapture={handleComposerPointerDownCapture}
        onSubmit={(event) => {
          event.preventDefault();
          submitMessage();
        }}
        onPaste={handleComposerPaste}
      >
      <input
        ref={fileInputRef}
        className="composer-file-input"
        type="file"
        multiple
        accept="image/*,video/mp4,video/mpeg,video/quicktime,video/webm,.mov,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.css,.html,.rs,.kt,.java,.py"
        onChange={handleFileSelect}
      />
      {hasGitChangeSummary ? (
        <div className="composer-menu-anchor composer-change-root">
          <div className="composer-change-strip" aria-label={formatGitChangeStripLabel(gitStatus)}>
            <div className="composer-change-summary">
              <span>{formatGitChangedFiles(gitStatus)}</span>
              <span className="composer-change-add">+{gitStatus?.additions ?? 0}</span>
              <span className="composer-change-remove">-{gitStatus?.deletions ?? 0}</span>
            </div>
            <button
              type="button"
              className="composer-review-button"
              onClick={() => {
                setOpenMenu(null);
                onReviewChanges?.();
              }}
            >
              Review changes
            </button>
          </div>
        </div>
      ) : null}
      <MessageSteeringQueue
        heldMessageIds={heldQueuedMessageIdSet}
        isGenerating={isGenerating}
        messages={queuedMessages}
        onDeleteMessage={onDeleteQueuedMessage}
        onEditMessage={restoreQueuedMessageToComposer}
        onHoldMessage={onHoldQueuedMessage}
        onSteerMessage={steerQueuedMessage}
      />
      <div className="composer-input-wrap" data-indicators={activeModeCount > 0 ? "true" : "false"}>
        <label className="sr-only" htmlFor="composer-message-input">Message Gilbert Codex</label>
        <textarea
          id="composer-message-input"
          ref={textareaRef}
          aria-autocomplete="list"
          aria-controls={skillMention.open ? "composer-skill-mention-picker" : chatResearchMention.open ? "composer-chat-research-picker" : undefined}
          aria-expanded={skillMention.open || chatResearchMention.open}
          placeholder={
            isGenerating
              ? "Add a follow-up or steer the next turn"
              : voiceState === "requesting"
                ? "Opening microphone..."
              : voiceState === "listening"
                ? "Listening... click the mic again when finished"
                : planMode.enabled
                  ? "Ask for a plan before Gilbert Codex starts coding"
                  : "Ask Gilbert Codex to build, inspect, or change this project"
          }
          rows={2}
          defaultValue=""
          onChange={handleMessageChange}
          onBlur={() => flushPendingDraftChange()}
          onClick={handleTextSelection}
          onKeyDown={handleTextKeyDown}
        />
        {activeModeCount > 0 ? (
          <div className="composer-inline-indicators" aria-label="Active composer modes">
            {webSearch.enabled ? (
              <span title={`${webSearchProviderLabel} web search on`} aria-label={`${webSearchProviderLabel} web search on`}>
                <Globe2 size={13} aria-hidden="true" />
              </span>
            ) : null}
            {imageGenerationEnabled ? (
              <span title="Image generation on" aria-label="Image generation on">
                <ImageIcon size={13} aria-hidden="true" />
              </span>
            ) : null}
            {planMode.enabled ? (
              <span title="Plan mode on" aria-label="Plan mode on">
                <Wand2 size={13} aria-hidden="true" />
              </span>
            ) : null}
          </div>
        ) : null}
        {skillMention.open ? (
          <div id="composer-skill-mention-picker">
            <SkillMentionPicker
              activeIndex={skillMention.activeIndex}
              onActiveIndexChange={(activeIndex) => setSkillMention((currentState) => ({ ...currentState, activeIndex }))}
              onSelect={insertSkillMention}
              query={skillMention.query}
              trigger={skillMention.trigger}
            />
          </div>
        ) : null}
        {chatResearchMention.open ? (
          <div id="composer-chat-research-picker" className="composer-chat-research-picker">
            <ChatResearchMentionPicker
              activeIndex={chatResearchMention.activeIndex}
              matches={researchChatMatches}
              onActiveIndexChange={(activeIndex) => setChatResearchMention((currentState) => ({ ...currentState, activeIndex }))}
              onSelect={insertChatResearchMention}
              query={chatResearchMention.query}
            />
          </div>
        ) : null}
      </div>
      {selectedResearchChats.length > 0 ? (
        <div className="composer-research-chats" aria-label="Attached research chats">
          {selectedResearchChats.map((researchChat) => (
            <span key={researchChat.id} className="research-chat-chip">
              <CornerDownRight size={14} aria-hidden="true" />
              <span>
                <strong>{researchChat.title}</strong>
                <small>{normalizeProjectName(researchChat.project)}</small>
              </span>
              <button type="button" aria-label={`Remove ${researchChat.title}`} onClick={() => removeSelectedResearchChat(researchChat.id)}>
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {attachments.length > 0 ? (
        <div className="composer-attachments" aria-label="Attached files">
          {attachments.map((attachment, index) => (
            <div key={attachment.id} className="attachment-chip" data-kind={attachment.attachment?.kind ?? "file"} data-status={attachment.status}>
              <AttachmentPreview attachment={attachment} />
              <span>
                <strong>{attachment.name}</strong>
                <small>{attachment.error || (attachment.status === "loading" ? "Preparing" : formatAttachmentSize(attachment.size))}</small>
              </span>
              <button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => removeAttachment(index)}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="composer-actions">
        <div className="composer-pinned-actions">
          <div className="composer-menu-anchor composer-attach-root">
            <button
              className="composer-tool composer-tool-primary composer-attach-toggle"
              type="button"
              aria-label="Add files and tools"
              aria-haspopup="menu"
              aria-expanded={openMenu === "attach"}
              data-active={openMenu === "attach"}
              onClick={() => toggleMenu("attach")}
            >
              <Plus size={17} aria-hidden="true" />
            </button>
            {openMenu === "attach" ? (
              <div className="composer-popover composer-popover-attach" role="menu" aria-label="Add menu">
                <button className="composer-menu-item" type="button" role="menuitem" onClick={openFilePicker}>
                  <FileUp size={18} aria-hidden="true" />
                  <span>Add photos & files</span>
                </button>
                <div className="composer-menu-separator" />
                <button
                  className="composer-menu-item composer-menu-item-stacked"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={webSearch.enabled}
                  onClick={toggleWebSearch}
                >
                  <Globe2 size={18} aria-hidden="true" />
                  <span>
                    <strong>Web search</strong>
                    <small>{webSearch.enabled ? `${webSearchProviderLabel} tool available, max ${webSearch.maxResults}` : `Model cannot call ${webSearchProviderLabel}`}</small>
                  </span>
                  <span className="composer-switch" data-on={webSearch.enabled}>
                    <span />
                  </span>
                </button>
                <button
                  className="composer-menu-item composer-menu-item-stacked"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={imageGenerationEnabled}
                  onClick={toggleImageGeneration}
                >
                  <ImageIcon size={18} aria-hidden="true" />
                  <span>
                    <strong>Generate images</strong>
                    <small>{imageGenerationEnabled ? "Subscription image tool available" : "Model cannot create image artifacts"}</small>
                  </span>
                  <span className="composer-switch" data-on={imageGenerationEnabled}>
                    <span />
                  </span>
                </button>
                <button
                  className="composer-menu-item composer-menu-item-stacked"
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={planMode.enabled}
                  onClick={togglePlanMode}
                >
                  <Wand2 size={18} aria-hidden="true" />
                  <span>
                    <strong>Plan mode</strong>
                    <small>{planMode.enabled ? "Research the codebase and write a plan to approve" : "Have Gilbert read the code and propose a plan first"}</small>
                  </span>
                  <span className="composer-switch" data-on={planMode.enabled}>
                    <span />
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <div className="composer-actions-left">
          <div className="composer-menu-anchor composer-workspace-root">
            <button
              className="workspace-toggle"
              type="button"
              aria-haspopup="dialog"
              aria-expanded={openMenu === "workspace"}
              aria-label={workspaceButtonLabel}
              data-active={openMenu === "workspace"}
              data-permission={localWorkspace.permissionMode}
              onClick={() => toggleMenu("workspace")}
            >
              <FolderGit2 size={14} aria-hidden="true" />
              <span>
                <strong>{projectLabel}</strong>
                <small>{workspaceMetaLabel}</small>
              </span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {openMenu === "workspace" ? (
              <WorkspacePopover
                actionNotice={gitActionNotice}
                actionRunning={gitActionRunning}
                activeProjectName={chat.project}
                branchName={gitBranchName}
                commitMessage={gitCommitMessage}
                initNotice={gitInitNotice}
                initializing={gitInitRunning}
                loading={gitStatusLoading}
                onBranchNameChange={setGitBranchName}
                onCommit={commitComposerGitChanges}
                onCommitMessageChange={setGitCommitMessage}
                onCreateProject={onCreateProject}
                onCreateBranch={createComposerGitBranch}
                onInitialize={initializeGitRepository}
                onLocalWorkspaceChange={onLocalWorkspaceChange}
                onPull={pullComposerGitBranch}
                onPush={pushComposerGitBranch}
                onReviewChanges={onReviewChanges}
                onSelectProject={(projectName) => {
                  onSelectProject(projectName);
                  setOpenMenu(null);
                }}
                onStageAll={stageAllComposerGitChanges}
                projectLabel={projectLabel}
                projectSearch={projectSearch}
                projects={projects}
                root={activeRoot}
                setProjectSearch={setProjectSearch}
                status={gitStatus}
                workspace={localWorkspace}
              />
            ) : null}
          </div>
        </div>
        <div className="composer-actions-right">
          <div className="composer-menu-anchor composer-context-root">
            <button
              className="context-window-chip"
              type="button"
              aria-label={contextButtonLabel}
              aria-haspopup="dialog"
              aria-expanded={openMenu === "context"}
              data-active={openMenu === "context"}
              data-context-level={getContextUsageLevel(contextUsageRatio)}
              title={contextButtonLabel}
              onClick={() => toggleMenu("context")}
            >
              <span className="context-window-ring" style={createContextRingStyle(contextUsageRatio)} aria-hidden="true" />
            </button>
            {openMenu === "context" ? <ContextWindowPopover compaction={lastContextCompaction} usage={contextUsage} usagePercent={contextUsagePercent} /> : null}
          </div>
          <div className="composer-menu-anchor composer-model-root">
            <button
              ref={modelButtonRef}
              className="mode-chip mode-chip-model"
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === "model"}
              data-active={openMenu === "model"}
              onClick={handleModelMenuClick}
              onPointerDown={handleModelMenuPointerDown}
            >
              <Sparkles size={14} aria-hidden="true" />
              <span>{composerModelLabel}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            {openMenu === "model" ? (
              <ModelSelectorPopover
                anchorRef={modelButtonRef}
                liveModelCatalogs={liveModelCatalogs}
                liveModelCatalogStatus={liveModelCatalogStatus}
                model={model}
                modelContextWindows={modelContextWindows}
                onClose={() => setOpenMenu(null)}
                onModelChange={onModelChange}
                onThinkingChange={onThinkingChange}
                providerSettings={providerSettings}
                selectedModel={selectedModel}
                thinking={thinking}
              />
            ) : null}
          </div>
          <button
            className="composer-tool"
            type="button"
            aria-label={voiceLabel}
            title={voiceLabel}
            data-active={voiceState === "listening" || voiceBusy}
            data-busy={voiceBusy}
            data-warning={voiceState === "blocked" || voiceState === "unsupported" || voiceState === "error"}
            onClick={handleVoiceToggle}
          >
            {voiceBusy ? (
              <LoaderCircle size={18} aria-hidden="true" />
            ) : voiceState === "listening" ? (
              <span className="voice-waveform" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </span>
            ) : voiceState === "error" || voiceState === "blocked" || voiceState === "unsupported" ? (
              <MicOff size={18} aria-hidden="true" />
            ) : (
              <Mic size={18} aria-hidden="true" />
            )}
          </button>
          {isGenerating && onStopGeneration ? (
            <button className="send-button send-button-stop" type="button" aria-label="Stop response" title="Stop response" onClick={() => onStopGeneration()}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button className="send-button" type="submit" aria-label={isGenerating ? "Queue message" : "Send message"} title={isGenerating ? "Queue message" : "Send message"} disabled={!canSend}>
            <ArrowUp size={19} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="composer-footer">
        {voiceState === "blocked" ? <span className="composer-status composer-status-warning">Mic permission is blocked</span> : null}
        {voiceState === "unsupported" ? <span className="composer-status composer-status-warning">Mic is not available in this preview</span> : null}
        {voiceState === "error" && voiceStatus ? <span className="composer-status composer-status-warning">{voiceStatus}</span> : null}
        {voiceState !== "blocked" && voiceState !== "unsupported" && voiceState !== "error" && voiceStatus ? <span className="composer-status">{voiceStatus}</span> : null}
        {hasPendingAttachments ? <span className="composer-status">Preparing attachments</span> : null}
        {hasMediaAttachment ? <span className="composer-status">Media uploads use Nemotron Omni when needed</span> : null}
        {hasFailedAttachments ? <span className="composer-status composer-status-warning">Remove failed attachments to send</span> : null}
        {visibleQueuedMessageCount > 0 ? <span className="composer-status composer-status-queued">{visibleQueuedMessageCount === 1 ? "1 queued" : `${visibleQueuedMessageCount} queued`}</span> : null}
      </div>
      </form>
      <p className="composer-ai-disclaimer" data-layout={layout}>
        Gilbert Codex is AI and can make mistakes. Please double-check responses.
      </p>
    </>
  );
}

export const ChatComposer = memo(ChatComposerComponent, areChatComposerPropsEqual);

function areChatComposerPropsEqual(previous: ChatComposerProps, next: ChatComposerProps) {
  return (
    previous.active === next.active &&
    previous.chat === next.chat &&
    previous.chats === next.chats &&
    previous.contextWindowSource === next.contextWindowSource &&
    previous.contextWindowTokens === next.contextWindowTokens &&
    previous.dictationDictionary === next.dictationDictionary &&
    previous.dictationHoldHotkey === next.dictationHoldHotkey &&
    previous.dictationToggleHotkey === next.dictationToggleHotkey &&
    previous.draft === next.draft &&
    previous.restoreDraft === next.restoreDraft &&
    previous.restoreDraftId === next.restoreDraftId &&
    previous.followUpBehavior === next.followUpBehavior &&
    previous.isGenerating === next.isGenerating &&
    previous.lastContextCompaction === next.lastContextCompaction &&
    previous.layout === next.layout &&
    previous.localWorkspace === next.localWorkspace &&
    previous.lastProviderContextUsage === next.lastProviderContextUsage &&
    previous.model === next.model &&
    previous.modelContextWindows === next.modelContextWindows &&
    previous.projects === next.projects &&
    previous.providerSettings === next.providerSettings &&
    previous.queuedMessageCount === next.queuedMessageCount &&
    previous.queuedMessages === next.queuedMessages &&
    previous.requireCtrlEnterForLongPrompts === next.requireCtrlEnterForLongPrompts &&
    previous.heldQueuedMessageIds === next.heldQueuedMessageIds &&
    previous.thinking === next.thinking &&
    previous.webSearch === next.webSearch
  );
}

function WorkspacePopover({
  actionNotice,
  actionRunning,
  activeProjectName,
  branchName,
  commitMessage,
  initNotice,
  initializing,
  loading,
  onBranchNameChange,
  onCommit,
  onCommitMessageChange,
  onCreateBranch,
  onCreateProject,
  onInitialize,
  onLocalWorkspaceChange,
  onPull,
  onPush,
  onReviewChanges,
  onSelectProject,
  onStageAll,
  projectLabel,
  projectSearch,
  projects,
  root,
  setProjectSearch,
  status,
  workspace,
}: {
  actionNotice: { kind: "error" | "success"; message: string } | null;
  actionRunning: string | null;
  activeProjectName: string;
  branchName: string;
  commitMessage: string;
  initNotice: { kind: "error" | "success"; message: string } | null;
  initializing: boolean;
  loading: boolean;
  onBranchNameChange: (value: string) => void;
  onCommit: () => void;
  onCommitMessageChange: (value: string) => void;
  onCreateBranch: () => void;
  onCreateProject: (options?: CreateProjectOptions) => void | string | null | Promise<string | null | void>;
  onInitialize: () => void;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onPull: () => void;
  onPush: () => void;
  onReviewChanges?: () => void;
  onSelectProject: (projectName: string) => void;
  onStageAll: () => void;
  projectLabel: string;
  projectSearch: string;
  projects: ProjectSummary[];
  root: string;
  setProjectSearch: (value: string) => void;
  status: ComputerGitStatus | null;
  workspace: LocalWorkspaceSettings;
}) {
  const rootLabel = root ? formatCompactPath(root) : "No local folder";
  const gitSummary = loading ? "Checking Git" : status?.available ? status.branch || "Git repository" : "Git not ready";

  return (
    <div className="composer-popover composer-popover-workspace" role="dialog" aria-label="Workspace">
      <div className="workspace-popover-head">
        <span className="workspace-popover-icon" aria-hidden="true">
          <FolderGit2 size={18} />
        </span>
        <span>
          <strong>{projectLabel}</strong>
          <small>{rootLabel}</small>
        </span>
      </div>

      <section className="workspace-popover-section" aria-label="Project folder">
        <div className="workspace-popover-section-head">
          <span>Project</span>
          <small>{projects.length === 1 ? "1 saved" : `${projects.length} saved`}</small>
        </div>
        <ProjectPopover
          activeProjectName={activeProjectName}
          compact
          onCreateProject={onCreateProject}
          onSelectProject={onSelectProject}
          projectSearch={projectSearch}
          projects={projects}
          setProjectSearch={setProjectSearch}
        />
      </section>

      <section className="workspace-popover-section" aria-label="Local permissions">
        <div className="workspace-popover-section-head">
          <span>Local</span>
          <small>{localPermissionModeLabel(workspace.permissionMode)}</small>
        </div>
        <LocalWorkspacePopover compact settings={workspace} onChange={onLocalWorkspaceChange} />
      </section>

      <section className="workspace-popover-section" aria-label="Git status">
        <div className="workspace-popover-section-head">
          <span>Git</span>
          <small>{gitSummary}</small>
        </div>
        <GitStatusPopover
          actionNotice={actionNotice}
          actionRunning={actionRunning}
          branchName={branchName}
          compact
          commitMessage={commitMessage}
          initNotice={initNotice}
          initializing={initializing}
          loading={loading}
          onBranchNameChange={onBranchNameChange}
          onCommit={onCommit}
          onCommitMessageChange={onCommitMessageChange}
          onCreateBranch={onCreateBranch}
          onInitialize={onInitialize}
          onPull={onPull}
          onPush={onPush}
          onReviewChanges={onReviewChanges}
          onStageAll={onStageAll}
          root={root}
          status={status}
        />
      </section>
    </div>
  );
}

function ProjectPopover({
  activeProjectName,
  compact = false,
  onCreateProject,
  onSelectProject,
  projectSearch,
  projects,
  setProjectSearch,
}: {
  activeProjectName: string;
  compact?: boolean;
  onCreateProject: (options?: CreateProjectOptions) => void | string | null | Promise<string | null | void>;
  onSelectProject: (projectName: string) => void;
  projectSearch: string;
  projects: ProjectSummary[];
  setProjectSearch: (value: string) => void;
}) {
  const normalizedQuery = projectSearch.trim().toLowerCase();
  const activeProject = normalizeProjectName(activeProjectName);
  const noProjectSelected = isNoProjectName(activeProject);
  const filteredProjects = sortProjectOptions(
    projects.filter((project) => {
      if (isNoProjectName(project.name)) {
        return false;
      }

      if (!normalizedQuery) {
        return true;
      }

      return project.name.toLowerCase().includes(normalizedQuery) || (project.localWorkspace?.roots ?? []).some((root) => root.toLowerCase().includes(normalizedQuery));
    }),
  );

  async function handleCreateProject() {
    const createdProjectName = await onCreateProject();

    if (typeof createdProjectName === "string" && createdProjectName.trim()) {
      onSelectProject(createdProjectName);
    }
  }

  return (
    <div className="composer-popover composer-popover-project" role="dialog" aria-label="Projects" data-compact={compact || undefined}>
      <label className="project-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search projects</span>
        <input autoFocus={!compact} placeholder="Search projects" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} />
      </label>
      <div className="project-list" role="listbox" aria-label="Project folders">
        <button type="button" role="option" aria-selected={noProjectSelected} data-selected={noProjectSelected} onClick={() => onSelectProject(DEFAULT_PROJECT)}>
          <CloudOff size={18} aria-hidden="true" />
          <span>
            <strong>{DEFAULT_PROJECT}</strong>
            <small>No folder, project memory, or local file context</small>
          </span>
          {noProjectSelected ? <Check size={18} aria-hidden="true" /> : null}
        </button>
        {filteredProjects.map((project) => {
          const selected = project.name.toLowerCase() === activeProject.toLowerCase();
          const root = project.localWorkspace?.roots[0];

          return (
            <button key={project.id} type="button" role="option" aria-selected={selected} data-selected={selected} onClick={() => onSelectProject(project.name)}>
              <FolderGit2 size={18} aria-hidden="true" />
              <span>
                <strong>{project.name}</strong>
                <small>{root ? formatCompactPath(root) : "Choose a folder to make this project local"}</small>
              </span>
              {selected ? <Check size={18} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
      <div className="project-menu-actions">
        <button type="button" onClick={() => void handleCreateProject()}>
          <FolderOpen size={18} aria-hidden="true" />
          <span>Add project folder</span>
        </button>
      </div>
    </div>
  );
}

function ChatResearchMentionPicker({
  activeIndex,
  matches,
  onActiveIndexChange,
  onSelect,
  query,
}: {
  activeIndex: number;
  matches: ChatSummary[];
  onActiveIndexChange: (index: number) => void;
  onSelect: (chat: ChatSummary) => void;
  query: string;
}) {
  return (
    <div className="skill-mention-picker chat-research-picker" role="listbox" aria-label="Chat research suggestions">
      <div className="skill-mention-heading">
        <Search size={15} aria-hidden="true" />
        <span>Chat notes</span>
        {query ? <small>#{query}</small> : <small>Regular chats</small>}
      </div>
      <div className="skill-mention-list">
        {matches.length > 0 ? (
          matches.map((researchChat, index) => (
            <button
              key={researchChat.id}
              type="button"
              role="option"
              aria-selected={activeIndex === index}
              data-active={activeIndex === index}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => onActiveIndexChange(index)}
              onClick={() => onSelect(researchChat)}
            >
              <span className="skill-mention-icon">
                <CornerDownRight size={16} aria-hidden="true" />
              </span>
              <span className="skill-mention-copy">
                <strong>{researchChat.title}</strong>
                <small>{normalizeProjectName(researchChat.project)} - {researchChat.messages.length} messages</small>
              </span>
              <span className="skill-mention-meta">
                <strong>#{researchChat.title}</strong>
                <small>{formatChatAge(researchChat.updatedAt)}</small>
              </span>
            </button>
          ))
        ) : (
          <div className="skill-mention-empty">
            <Search size={16} aria-hidden="true" />
            <span>No matching chats</span>
          </div>
        )}
      </div>
    </div>
  );
}

function sortProjectOptions(projects: ProjectSummary[]) {
  return [...projects].sort((left, right) => {
    const leftCreatedAt = parseProjectOptionDate(left.createdAt);
    const rightCreatedAt = parseProjectOptionDate(right.createdAt);

    if (leftCreatedAt !== rightCreatedAt) {
      return rightCreatedAt - leftCreatedAt;
    }

    return left.name.localeCompare(right.name);
  });
}

function parseProjectOptionDate(value: string) {
  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function GitStatusPopover({
  actionNotice,
  actionRunning,
  branchName,
  compact = false,
  commitMessage,
  initNotice,
  initializing,
  loading,
  onBranchNameChange,
  onCommit,
  onCommitMessageChange,
  onCreateBranch,
  onInitialize,
  onPull,
  onPush,
  onReviewChanges,
  onStageAll,
  root,
  status,
}: {
  actionNotice: { kind: "error" | "success"; message: string } | null;
  actionRunning: string | null;
  branchName: string;
  compact?: boolean;
  commitMessage: string;
  initNotice: { kind: "error" | "success"; message: string } | null;
  initializing: boolean;
  loading: boolean;
  onBranchNameChange: (value: string) => void;
  onCommit: () => void;
  onCommitMessageChange: (value: string) => void;
  onCreateBranch: () => void;
  onInitialize: () => void;
  onPull: () => void;
  onPush: () => void;
  onReviewChanges?: () => void;
  onStageAll: () => void;
  root: string;
  status: ComputerGitStatus | null;
}) {
  if (loading) {
    return (
      <div className="composer-popover composer-popover-branch" role="dialog" aria-label="Git status" data-compact={compact || undefined}>
        <div className="git-status-loading">
          <LoaderCircle size={16} aria-hidden="true" />
          <span>Checking local Git status</span>
        </div>
      </div>
    );
  }

  if (!status?.available) {
    const issue = getGitStatusIssue(status, root);
    const canInitialize = issue.kind === "not-repo" && Boolean(root);

    return (
      <div className="composer-popover composer-popover-branch" role="dialog" aria-label="Git status" data-compact={compact || undefined}>
        <div className="git-status-error" data-kind={issue.kind}>
          <div className="git-status-error-icon">
            {issue.kind === "not-repo" ? <GitBranch size={18} aria-hidden="true" /> : issue.kind === "missing-path" ? <FolderOpen size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
          </div>
          <span>
            <strong>{issue.title}</strong>
            <small>{issue.detail}</small>
          </span>
        </div>
        {issue.hint ? <div className="git-status-hint">{issue.hint}</div> : null}
        {canInitialize ? (
          <button type="button" className="git-status-action" disabled={initializing} onClick={onInitialize}>
            {initializing ? <LoaderCircle size={15} aria-hidden="true" /> : <GitBranch size={15} aria-hidden="true" />}
            <span>Initialize Git</span>
          </button>
        ) : null}
        {initNotice ? <div className="git-status-notice" data-kind={initNotice.kind}>{initNotice.message}</div> : null}
        {status?.error ? (
          <div className="git-status-error-detail" title={status.error} data-compact={compact || undefined}>
            {status.error}
          </div>
        ) : null}
        {root && !compact ? (
          <div className="git-status-root" title={root}>
            {formatCompactPath(root)}
          </div>
        ) : null}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="composer-popover composer-popover-branch" role="dialog" aria-label="Git status" data-compact="true">
        <div className="git-status-header">
          <GitBranch size={16} aria-hidden="true" />
          <span>
            <strong>{status.branch || "Git repository"}</strong>
            <small>{status.githubOwner && status.githubRepo ? `${status.githubOwner}/${status.githubRepo}` : status.remoteUrl || "Local repository"}</small>
          </span>
        </div>
        <div className="git-status-compact-metrics" aria-label="Git change summary">
          <span>{status.changedFiles === 1 ? "1 changed" : `${status.changedFiles} changed`}</span>
          <span className="git-additions">+{status.additions}</span>
          <span className="git-deletions">-{status.deletions}</span>
        </div>
        <div className="git-status-action-grid" data-compact="true">
          <button type="button" disabled={Boolean(actionRunning) || status.changedFiles === 0} onClick={onStageAll}>
            {actionRunning === "stage" ? <LoaderCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            <span>Stage</span>
          </button>
          <button type="button" disabled={Boolean(actionRunning)} onClick={onPull}>
            {actionRunning === "pull" ? <LoaderCircle size={14} aria-hidden="true" /> : <CornerDownRight size={14} aria-hidden="true" />}
            <span>Pull</span>
          </button>
          <button type="button" disabled={Boolean(actionRunning)} onClick={onPush}>
            {actionRunning === "push" ? <LoaderCircle size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}
            <span>Push</span>
          </button>
          {onReviewChanges ? (
            <button type="button" disabled={Boolean(actionRunning)} onClick={onReviewChanges}>
              <Search size={14} aria-hidden="true" />
              <span>Review</span>
            </button>
          ) : null}
        </div>
        {actionNotice ? <div className="git-status-notice" data-kind={actionNotice.kind}>{actionNotice.message}</div> : null}
      </div>
    );
  }

  return (
    <div className="composer-popover composer-popover-branch" role="dialog" aria-label="Git status">
      <div className="git-status-header">
        <GitBranch size={18} aria-hidden="true" />
        <span>
          <strong>{status.branch || "Git repository"}</strong>
          <small>{status.githubOwner && status.githubRepo ? `${status.githubOwner}/${status.githubRepo}` : status.remoteUrl || "Local repository"}</small>
        </span>
      </div>
      <dl className="git-status-list">
        <div>
          <dt>Code added</dt>
          <dd className="git-additions">+{status.additions}</dd>
        </div>
        <div>
          <dt>Code removed</dt>
          <dd className="git-deletions">-{status.deletions}</dd>
        </div>
      </dl>
      <div className="git-status-file-count">{status.changedFiles === 1 ? "1 changed file" : `${status.changedFiles} changed files`}</div>
      <div className="git-status-actions" aria-label="Git actions">
        <div className="git-status-action-row">
          <input
            type="text"
            value={commitMessage}
            placeholder="Commit message"
            onChange={(event) => onCommitMessageChange(event.target.value)}
          />
          <button type="button" disabled={Boolean(actionRunning) || !commitMessage.trim()} onClick={onCommit}>
            {actionRunning === "commit" ? <LoaderCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            <span>Commit</span>
          </button>
        </div>
        <div className="git-status-action-row">
          <input
            type="text"
            value={branchName}
            placeholder="codex/new-branch"
            onChange={(event) => onBranchNameChange(event.target.value)}
          />
          <button type="button" disabled={Boolean(actionRunning) || !branchName.trim()} onClick={onCreateBranch}>
            {actionRunning === "branch" ? <LoaderCircle size={14} aria-hidden="true" /> : <GitBranch size={14} aria-hidden="true" />}
            <span>Branch</span>
          </button>
        </div>
        <div className="git-status-action-grid">
          <button type="button" disabled={Boolean(actionRunning) || status.changedFiles === 0} onClick={onStageAll}>
            {actionRunning === "stage" ? <LoaderCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
            <span>Stage</span>
          </button>
          <button type="button" disabled={Boolean(actionRunning)} onClick={onPull}>
            {actionRunning === "pull" ? <LoaderCircle size={14} aria-hidden="true" /> : <CornerDownRight size={14} aria-hidden="true" />}
            <span>Pull</span>
          </button>
          <button type="button" disabled={Boolean(actionRunning)} onClick={onPush}>
            {actionRunning === "push" ? <LoaderCircle size={14} aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}
            <span>Push</span>
          </button>
          {onReviewChanges ? (
            <button type="button" disabled={Boolean(actionRunning)} onClick={onReviewChanges}>
              <Search size={14} aria-hidden="true" />
              <span>Review</span>
            </button>
          ) : null}
        </div>
      </div>
      {actionNotice ? <div className="git-status-notice" data-kind={actionNotice.kind}>{actionNotice.message}</div> : null}
      <div className="git-status-root" title={status.repositoryRoot || root}>
        {formatCompactPath(status.repositoryRoot || root)}
      </div>
    </div>
  );
}

function LocalWorkspacePopover({
  compact = false,
  onChange,
  settings,
}: {
  compact?: boolean;
  onChange: (settings: LocalWorkspaceSettings) => void;
  settings: LocalWorkspaceSettings;
}) {
  function selectPermissionMode(permissionMode: LocalPermissionMode) {
    onChange({
      ...settings,
      lastError: undefined,
      permissionMode,
    });
  }

  return (
    <div className="composer-popover composer-popover-local" role="dialog" aria-label="Local permissions" data-compact={compact || undefined}>
      <div className="local-permission-menu" role="radiogroup" aria-label="Local permissions">
        {[
          { icon: Hand, label: "Default permissions", mode: "default" },
          { icon: ShieldCheck, label: "Auto-review", mode: "auto-review" },
          { icon: ShieldAlert, label: "Full access", mode: "full-access" },
        ].map((option) => {
          const selected = settings.permissionMode === option.mode;
          const Icon = option.icon;

          return (
            <button key={option.mode} type="button" role="radio" aria-checked={selected} data-selected={selected} onClick={() => selectPermissionMode(option.mode as LocalPermissionMode)}>
              <Icon size={17} aria-hidden="true" />
              <span>{option.label}</span>
              {selected ? <Check size={17} aria-hidden="true" /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ContextWindowPopover({ usage, usagePercent }: { compaction?: ContextCompactionNotice | null; usage: ContextWindowUsage; usagePercent: number }) {
  const contextLabel = `${formatTokenCount(usage.inputTokens)} / ${formatTokenCount(usage.contextWindowTokens)}`;
  const totalLabel = `${formatTokenCount(usage.totalTokens)} total`;
  const fitDetail = usage.fitsContextWindow === false || (usage.overflowTokens ?? 0) > 0
    ? `${formatTokenCount(usage.overflowTokens ?? 0)} over request budget`
    : `${formatTokenCount(usage.availableTokens)} available after output reserve`;
  const budgetItems = [
    { label: "Input", value: usage.inputTokens },
    { label: "Output cap", value: usage.maxOutputTokens },
    { label: "Reasoning", value: usage.reasoningReserveTokens ?? 0 },
    { label: "Safety", value: usage.safetyMarginTokens ?? 0 },
  ].filter((item) => item.value > 0);

  return (
    <div className="composer-popover composer-popover-context" role="dialog" aria-label="Context window">
      <div className="context-window-header">
        <strong>Context</strong>
        <strong>
          {contextLabel}
        </strong>
      </div>
      <div className="context-window-meter" aria-label={`Context usage ${contextLabel}`} role="meter" aria-valuemin={0} aria-valuemax={usage.contextWindowTokens} aria-valuenow={Math.round(usage.inputTokens)}>
        <span style={{ width: `${usagePercent}%` }} />
        <i aria-hidden="true" style={{ left: `${AUTO_COMPACT_CONTEXT_THRESHOLD * 100}%` }} />
      </div>
      <div className="context-window-fit" data-overflow={usage.fitsContextWindow === false || (usage.overflowTokens ?? 0) > 0}>
        <span>{totalLabel}</span>
        <span>{fitDetail}</span>
      </div>
      <div className="context-window-breakdown" aria-label="Provider request budget lanes">
        {budgetItems.map((item) => (
          <span key={item.label}>
            <small>{item.label}</small>
            <strong>{formatTokenCount(item.value)}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

function createContextRingStyle(usageRatio: number): CSSProperties {
  return {
    "--context-progress-angle": `${clampUnit(usageRatio) * 360}deg`,
  } as CSSProperties;
}

function getContextUsageLevel(usageRatio: number) {
  if (usageRatio >= AUTO_COMPACT_CONTEXT_THRESHOLD) {
    return "compact";
  }

  if (usageRatio >= AUTO_COMPACT_CONTEXT_THRESHOLD * 0.875) {
    return "high";
  }

  return "normal";
}

function getContextRequestTokens(usage: ContextWindowUsage) {
  return usage.requestedTotalTokens ?? usage.totalTokens;
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1);
}

function formatVoiceLabel(voiceState: VoiceState) {
  if (voiceState === "listening") {
    return "Stop voice input";
  }

  if (voiceState === "requesting") {
    return "Cancel voice input";
  }

  if (voiceState === "blocked") {
    return "Microphone blocked";
  }

  if (voiceState === "unsupported") {
    return "Voice input unavailable";
  }

  if (voiceState === "error") {
    return "Retry voice input";
  }

  return "Start voice input";
}

function findSkillMentionTrigger(message: string, cursorPosition: number): SkillMentionTrigger | null {
  const beforeCursor = message.slice(0, cursorPosition);
  const match = beforeCursor.match(/(^|\s)([$@])([a-z0-9._:-]{0,48})$/i);

  if (!match) {
    return null;
  }

  const trigger = match[2] === "@" ? "@" : "$";
  const query = match[3] ?? "";
  const rangeStart = beforeCursor.length - query.length - 1;

  return {
    query,
    rangeEnd: cursorPosition,
    rangeStart,
    trigger,
  };
}

function findChatResearchMentionTrigger(message: string, cursorPosition: number): ChatResearchMentionTrigger | null {
  const beforeCursor = message.slice(0, cursorPosition);
  const match = beforeCursor.match(/(^|\s)#([^\n#@$]{0,80})$/);

  if (!match) {
    return null;
  }

  const query = (match[2] ?? "").trimStart();
  const rangeStart = beforeCursor.length - (match[2]?.length ?? 0) - 1;

  return {
    query,
    rangeEnd: cursorPosition,
    rangeStart,
  };
}

function getChatResearchMentionMatches(chats: ChatSummary[], query: string, selectedChatIds: string[]) {
  const selectedIds = new Set(selectedChatIds);
  const normalizedQuery = normalizeMentionText(query);
  const candidates = chats.filter((chat) => !selectedIds.has(chat.id));

  if (!normalizedQuery) {
    return candidates;
  }

  return candidates
    .filter((chat) => {
      const title = normalizeMentionText(chat.title);

      return title.includes(normalizedQuery);
    });
}

function resolveComposerResearchChatIds(content: string, selectedChatIds: string[], chats: ChatSummary[]) {
  const referencedIds = new Set(selectedChatIds);

  for (const chat of chats) {
    if (contentReferencesComposerChatTitle(content, chat.title)) {
      referencedIds.add(chat.id);
    }
  }

  return [...referencedIds];
}

function contentReferencesComposerChatTitle(content: string, title: string) {
  const cleanTitle = title.trim();

  if (!cleanTitle || cleanTitle.toLowerCase() === "new chat") {
    return false;
  }

  const escapedTitle = escapeMentionRegExp(cleanTitle).replace(/\s+/g, "\\s+");
  return new RegExp(`(^|\\s)#${escapedTitle}(?=$|[\\s.,;:!?\\)])`, "i").test(content);
}

function normalizeMentionText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeMentionRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getBuiltInSpeechRecognition() {
  const speechWindow = window as Window & {
    SpeechRecognition?: BuiltInSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BuiltInSpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function buildDictationMessage(baseMessage: string, results: BuiltInSpeechRecognitionResultList, dictionary: string) {
  const transcriptParts: string[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const transcript = results[index]?.[0]?.transcript?.trim();

    if (transcript) {
      transcriptParts.push(transcript);
    }
  }

  const transcript = applyDictationDictionary(formatDictationTranscript(transcriptParts.join(" ")), dictionary);

  if (!transcript) {
    return baseMessage;
  }

  if (!baseMessage.trim()) {
    return transcript;
  }

  const separator = /[\s\n]$/.test(baseMessage) ? "" : " ";
  return `${baseMessage}${separator}${transcript}`;
}

function formatDictationTranscript(text: string) {
  const normalizedText = text.replace(/\s+/g, " ").trim();

  if (!normalizedText) {
    return "";
  }

  return `${normalizedText.charAt(0).toUpperCase()}${normalizedText.slice(1)}`;
}

function applyDictationDictionary(text: string, dictionary: string) {
  const phrases = dictionary
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 120);

  return phrases.reduce((nextText, phrase) => {
    const escapedPhrase = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return nextText.replace(new RegExp(`(^|[^\\w])(${escapedPhrase})(?=$|[^\\w])`, "gi"), (_match, prefix) => `${prefix}${phrase}`);
  }, text);
}

function formatSpeechRecognitionError(error?: string) {
  if (error === "audio-capture") {
    return "No microphone was found.";
  }

  if (error === "network") {
    return "Built-in speech recognition could not connect.";
  }

  if (error === "aborted") {
    return "Voice dictation stopped.";
  }

  return "Voice dictation could not complete.";
}

function formatCompactPath(path: string) {
  const trimmed = path.trim();

  if (!trimmed) {
    return "";
  }

  const normalized = trimmed.replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]+/).filter(Boolean);

  if (parts.length <= 3) {
    return normalized;
  }

  return `...\\${parts.slice(-3).join("\\")}`;
}

function createUnavailableGitStatus(error?: string): ComputerGitStatus {
  return {
    additions: 0,
    ahead: 0,
    available: false,
    behind: 0,
    changedFiles: 0,
    clean: true,
    deletions: 0,
    error,
    files: [],
  };
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return fallback;
}

function AttachmentPreview({ attachment }: { attachment: ComposerAttachmentDraft }) {
  if (attachment.status === "loading") {
    return <LoaderCircle className="attachment-spinner" size={15} aria-hidden="true" />;
  }

  if (attachment.attachment && isImageAttachment(attachment.attachment)) {
    return <img alt="" src={attachment.attachment.dataUrl} />;
  }

  if (attachment.attachment && isVideoAttachment(attachment.attachment)) {
    return <Video size={15} aria-hidden="true" />;
  }

  if (attachment.mimeType.startsWith("image/")) {
    return <ImageIcon size={15} aria-hidden="true" />;
  }

  if (attachment.mimeType.startsWith("video/")) {
    return <Video size={15} aria-hidden="true" />;
  }

  return <FileUp size={15} aria-hidden="true" />;
}

function createDraftAttachmentId(index: number) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `draft-${crypto.randomUUID()}`;
  }

  return `draft-${Date.now()}-${index}-${Math.round(Math.random() * 100000)}`;
}

function createDraftFromAttachment(attachment: ChatAttachment, index: number): ComposerAttachmentDraft {
  return {
    attachment,
    id: `restored-${attachment.id}-${index}`,
    mimeType: attachment.mimeType,
    name: attachment.name,
    size: attachment.size,
    status: "ready",
  };
}

function createComposerDraft(content: string, attachmentDrafts: ComposerAttachmentDraft[]): ChatComposerDraft | null {
  const attachments = attachmentDrafts.flatMap((attachmentDraft) => (attachmentDraft.attachment ? [attachmentDraft.attachment] : []));

  if (!content.trim() && attachments.length === 0) {
    return null;
  }

  return {
    attachments,
    content,
  };
}

function getPastedImageFiles(clipboardData: DataTransfer) {
  const files: File[] = [];

  for (const item of Array.from(clipboardData.items)) {
    if (item.kind !== "file" || !item.type.startsWith("image/")) {
      continue;
    }

    const file = item.getAsFile();

    if (file) {
      files.push(normalizePastedImageFile(file, files.length));
    }
  }

  if (files.length > 0) {
    return files;
  }

  return Array.from(clipboardData.files)
    .filter((file) => file.type.startsWith("image/"))
    .map((file, index) => normalizePastedImageFile(file, index));
}

function normalizePastedImageFile(file: File, index: number) {
  if (file.name.trim()) {
    return file;
  }

  const mimeType = file.type || "image/png";
  const extension = imageExtensionFromMimeType(mimeType);

  return new File([file], `pasted-image-${Date.now()}-${index + 1}.${extension}`, {
    lastModified: file.lastModified || Date.now(),
    type: mimeType,
  });
}

function imageExtensionFromMimeType(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    case "image/bmp":
      return "bmp";
    case "image/png":
    default:
      return "png";
  }
}
