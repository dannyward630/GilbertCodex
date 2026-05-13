import {
  type ChangeEvent,
  type ClipboardEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AlertTriangle,
  ArrowUp,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  CloudOff,
  CornerDownRight,
  FileUp,
  FolderGit2,
  FolderOpen,
  Gauge,
  GitBranch,
  Globe2,
  HardDrive,
  Home,
  Image as ImageIcon,
  Laptop,
  LoaderCircle,
  Mic,
  MicOff,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { ThinkingModeControls } from "../thinking/ThinkingModeControls";
import { ModelSelectorPopover, type LiveModelCatalogStatus } from "./ModelSelectorPopover";
import { createChatAttachmentFromFile, formatAttachmentSize, isImageAttachment } from "../../lib/chatAttachments";
import { DEFAULT_PROJECT, isNoProjectName, normalizeProjectName } from "../../lib/chatUtils";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import {
  AUTO_COMPACT_CONTEXT_THRESHOLD,
  formatTokenCount,
  type ContextWindowUsage,
  type ContextCompactionNotice,
  type ModelContextWindowMap,
} from "../../lib/contextWindow";
import { formatGitChangedFiles, formatGitChangeStripLabel, getGitStatusIssue } from "../../lib/gitStatusUi";
import { MODEL_PROVIDERS, buildProviderModelOptions, getModelProvider, prefersLiveModelCatalog, usesLiveModelCatalog, type ChatModelOption, type ProviderModelMetadata } from "../../lib/models";
import { fetchProviderModels } from "../../services/modelProviderClient";
import { formatWebSearchProviderLabel } from "../../services/webSearchClient";
import { estimateModelProviderContextWindowUsage, projectDraftOntoProviderUsage } from "../../services/modelProviderUsage";
import {
  buildComputerFileIndex,
  createGilbertProjectMemoryTemplate,
  getComputerGitStatus,
  formatLocalWorkspaceIndexStatus,
  getDefaultComputerWorkspace,
  GILBERT_PROJECT_MEMORY_FILE,
  initComputerGitRepository,
  listenForComputerFileIndexProgress,
  listComputerDrives,
  localWorkspaceScopeLabel,
  localPermissionModeLabel,
  mergeFullComputerRoots,
  pickComputerFolder,
  writeComputerTextFile,
} from "../../tools/computer/files";
import type { ChatAttachment, ChatComposerDraft, ChatMessage, ChatSendInput, ChatSummary } from "../../types/chat";
import type { ComputerDrive, ComputerFileIndexProgress, ComputerFileIndexSummary, ComputerGitStatus, LocalPermissionMode, LocalWorkspaceScope, LocalWorkspaceSettings } from "../../types/localWorkspace";
import type { ProjectSummary } from "../../types/project";
import type { ProviderSettings, ThinkingSettings, WebSearchSettings } from "../../types/settings";

type ComposerMenu = "attach" | "branch" | "context" | "local" | "model" | "project" | null;
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
  chat: ChatSummary;
  contextWindowSource: "estimate" | "openrouter" | "provider";
  contextWindowTokens: number;
  draft?: ChatComposerDraft | null;
  isGenerating: boolean;
  lastContextCompaction?: ContextCompactionNotice | null;
  layout?: "center" | "dock";
  localWorkspace: LocalWorkspaceSettings;
  lastProviderContextUsage?: ContextWindowUsage | null;
  model: string;
  modelContextWindows: ModelContextWindowMap;
  onCreateProject: () => void | string | null | Promise<string | null | void>;
  onDraftApplied?: () => void;
  onDeleteQueuedMessage: (messageId: string) => void;
  onHoldQueuedMessage: (messageId: string, held: boolean) => void;
  onUpdateQueuedMessage: (messageId: string, content: string) => void;
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
  heldQueuedMessageIds?: string[];
  onThinkingChange: (thinking: ThinkingSettings) => void;
  onWebSearchChange: (webSearch: WebSearchSettings) => void;
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
const LOCAL_MODEL_CATALOG_READY_CACHE_MS = 5_000;
const LOCAL_MODEL_CATALOG_ERROR_CACHE_MS = 2_000;

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

function createLiveModelCatalogRequestKey(settings: ProviderSettings) {
  return getLiveModelCatalogProviders(settings)
    .map((provider) => createLiveModelCatalogProviderRequestKey(provider, settings))
    .join("\n");
}

function getLiveModelCatalogProviders(settings: ProviderSettings) {
  return MODEL_PROVIDERS.filter((provider) => shouldLoadLiveModelCatalogProvider(provider.id, settings.provider));
}

function shouldLoadLiveModelCatalogProvider(provider: ProviderSettings["provider"], activeProvider: ProviderSettings["provider"]) {
  return usesLiveModelCatalog(provider) && (provider === "openrouter" || provider === activeProvider || prefersLiveModelCatalog(provider));
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

export function ChatComposer({
  chat,
  contextWindowSource,
  contextWindowTokens,
  draft,
  isGenerating,
  lastContextCompaction,
  layout = "dock",
  localWorkspace,
  lastProviderContextUsage,
  model,
  modelContextWindows,
  onCreateProject,
  onDraftApplied,
  onDeleteQueuedMessage,
  onHoldQueuedMessage,
  onUpdateQueuedMessage,
  onHeightChange,
  onLocalWorkspaceChange,
  onModelChange,
  onForkWorktree,
  onReviewChanges,
  onSelectProject,
  onStopGeneration,
  onSteerQueuedMessage,
  onSubmit,
  projects,
  providerSettings,
  queuedMessageCount,
  queuedMessages = [],
  heldQueuedMessageIds = [],
  onThinkingChange,
  onWebSearchChange,
  thinking,
  webSearch,
}: ChatComposerProps) {
  const composerRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  const providerSettingsRef = useRef(providerSettings);
  const visibleQueuedMessageCount = queuedMessageCount ?? queuedMessages.length;
  const voiceBaseMessageRef = useRef("");
  const voiceRecognitionRef = useRef<BuiltInSpeechRecognition | null>(null);
  const voiceRequestRef = useRef(0);
  const [message, setMessage] = useState("");
  const [openMenu, setOpenMenu] = useState<ComposerMenu>(null);
  const [planMode, setPlanMode] = useState<PlanningModeSettings>({
    enabled: false,
  });
  const [attachments, setAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const [liveModelCatalogs, setLiveModelCatalogs] = useState<Partial<Record<ProviderSettings["provider"], ProviderModelMetadata[]>>>({});
  const [liveModelCatalogErrors, setLiveModelCatalogErrors] = useState<Partial<Record<ProviderSettings["provider"], string>>>({});
  const [liveModelCatalogStatus, setLiveModelCatalogStatus] = useState<Partial<Record<ProviderSettings["provider"], LiveModelCatalogStatus>>>({});
  const liveModelCatalogCache = useRef<Partial<Record<ProviderSettings["provider"], LiveModelCatalogCacheEntry>>>({});
  const [gitStatus, setGitStatus] = useState<ComputerGitStatus | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [gitInitRunning, setGitInitRunning] = useState(false);
  const [gitInitNotice, setGitInitNotice] = useState<{ kind: "error" | "success"; message: string } | null>(null);
  const [projectSearch, setProjectSearch] = useState("");
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [queueMenuMessageId, setQueueMenuMessageId] = useState<string | null>(null);
  const [queuedEditDrafts, setQueuedEditDrafts] = useState<Record<string, string>>({});
  const readyAttachments = attachments.flatMap((attachment) => (attachment.attachment ? [attachment.attachment] : []));
  const hasImageAttachment = readyAttachments.some(isImageAttachment);
  const hasPendingAttachments = attachments.some((attachment) => attachment.status === "loading");
  const hasFailedAttachments = attachments.some((attachment) => attachment.status === "error");
  const canSend = (Boolean(message.trim()) || readyAttachments.length > 0) && !hasPendingAttachments && !hasFailedAttachments;
  const selectedProvider = getModelProvider(providerSettings.provider);
  const selectedModel = modelFromValue(model, providerSettings.provider, liveModelCatalogs[providerSettings.provider]);
  const webSearchProviderLabel = formatWebSearchProviderLabel(webSearch.provider);
  const estimatedContextUsage = estimateModelProviderContextWindowUsage({
    chat,
    contextWindowTokens,
    draftAttachments: readyAttachments,
    draftContent: message,
    settings: providerSettings,
    source: contextWindowSource,
  });
  const hasDraftContext = Boolean(message.trim()) || readyAttachments.length > 0;
  const contextUsage = hasDraftContext && lastProviderContextUsage ? projectDraftOntoProviderUsage(lastProviderContextUsage, estimatedContextUsage) : lastProviderContextUsage ?? estimatedContextUsage;
  const contextUsagePercent = Math.min(Math.round((contextUsage.inputTokens / contextUsage.contextWindowTokens) * 100), 100);
  const activeRoot = localWorkspace.roots[0] ?? "";
  const activeProjectName = normalizeProjectName(chat.project);
  const activeProject = projects.find((project) => project.name.toLowerCase() === activeProjectName.toLowerCase());
  const projectLabel = isNoProjectName(activeProjectName) ? DEFAULT_PROJECT : activeProject?.name || activeProjectName;
  const gitBranchLabel = gitStatus?.available ? gitStatus.branch || "Git" : gitStatusLoading ? "Checking Git" : "No Git";
  const hasGitChangeSummary = Boolean(gitStatus?.available && gitStatus.changedFiles > 0);
  const heldQueuedMessageIdSet = new Set(heldQueuedMessageIds);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      cancelVoiceInput(false);
    };
  }, []);

  useDismissableLayer({
    active: openMenu !== null,
    ignoreSelectors: [".model-selector-popover"],
    onDismiss: () => setOpenMenu(null),
    refs: [composerRef],
  });

  useDismissableLayer({
    active: queueMenuMessageId !== null,
    onDismiss: () => setQueueMenuMessageId(null),
    refs: [composerRef],
  });

  useEffect(() => {
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

    void refreshGitStatus(true);

    const refreshTimer = window.setInterval(() => {
      void refreshGitStatus(false);
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
      window.clearInterval(refreshTimer);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
    };
  }, [activeRoot, localWorkspace.indexUpdatedAt, localWorkspace.scope]);

  useEffect(() => {
    setGitInitNotice(null);
  }, [activeRoot]);

  useEffect(() => {
    const composer = composerRef.current;

    if (!composer || !onHeightChange) {
      return;
    }

    onHeightChange(composer.offsetHeight);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      onHeightChange(entry.contentRect.height);
    });

    observer.observe(composer);

    return () => observer.disconnect();
  }, [onHeightChange]);

  useEffect(() => {
    if (!draft) {
      return;
    }

    setMessage(draft.content);
    setAttachments(draft.attachments.map(createDraftFromAttachment));
    onDraftApplied?.();
  }, [draft, onDraftApplied]);

  const liveModelCatalogRequestKey = createLiveModelCatalogRequestKey(providerSettings);
  providerSettingsRef.current = providerSettings;

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
        return [];
      }

      return [{ controller: new AbortController(), provider, requestKey }];
    });

    controllers.forEach(({ controller, provider, requestKey }) => {
      setLiveModelCatalogStatus((current) => ({
        ...current,
        [provider.id]: "loading",
      }));

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
          setLiveModelCatalogErrors((current) => ({
            ...current,
            [provider.id]: undefined,
          }));
          setLiveModelCatalogStatus((current) => ({
            ...current,
            [provider.id]: "ready",
          }));
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return;
          }

          setLiveModelCatalogErrors((current) => ({
            ...current,
            [provider.id]: readErrorMessage(error, `Could not load ${provider.label} models.`),
          }));
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

  function toggleMenu(menu: Exclude<ComposerMenu, null>) {
    setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
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
    const content = message.trim();

    if (!canSend) {
      return;
    }

    setMessage("");
    setAttachments([]);
    void onSubmit({
      attachments: readyAttachments,
      content,
      localWorkspace,
      mode: planMode.enabled ? "plan" : "chat",
      planning: planMode.enabled ? {} : undefined,
      webSearch: {
        enabled: webSearch.enabled,
        maxResults: webSearch.maxResults,
        provider: webSearch.provider,
      },
    });
  }

  function beginQueuedMessageEdit(queuedMessage: ChatMessage) {
    setOpenMenu(null);
    setQueueMenuMessageId(null);
    setQueuedEditDrafts((drafts) => ({
      ...drafts,
      [queuedMessage.id]: drafts[queuedMessage.id] ?? queuedMessage.content,
    }));
    onHoldQueuedMessage(queuedMessage.id, true);
  }

  function updateQueuedMessageDraft(messageId: string, content: string) {
    setQueuedEditDrafts((drafts) => ({
      ...drafts,
      [messageId]: content,
    }));
  }

  function cancelQueuedMessageEdit(messageId: string) {
    setQueuedEditDrafts((drafts) => removeQueuedEditDraft(drafts, messageId));
    onHoldQueuedMessage(messageId, false);
  }

  function steerQueuedMessage(messageId: string) {
    const queuedMessage = queuedMessages.find((message) => message.id === messageId);
    const draftContent = queuedEditDrafts[messageId];
    const nextContent = (draftContent ?? queuedMessage?.content ?? "").trim();

    if (!nextContent) {
      return;
    }

    if (draftContent !== undefined) {
      onUpdateQueuedMessage(messageId, nextContent);
      setQueuedEditDrafts((drafts) => removeQueuedEditDraft(drafts, messageId));
    }

    onHoldQueuedMessage(messageId, false);
    onSteerQueuedMessage(messageId, nextContent);
  }

  function resumeQueuedMessage(messageId: string) {
    const draftContent = queuedEditDrafts[messageId]?.trim();

    if (draftContent) {
      onUpdateQueuedMessage(messageId, draftContent);
    }

    setQueuedEditDrafts((drafts) => removeQueuedEditDraft(drafts, messageId));
    onHoldQueuedMessage(messageId, false);
  }

  function handleTextKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
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
      voiceBaseMessageRef.current = message;
      voiceRecognitionRef.current = recognition;

      recognition.onresult = (event) => {
        if (voiceRequestRef.current !== requestId) {
          return;
        }

        setMessage(buildDictationMessage(voiceBaseMessageRef.current, event.results));
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
    <form
      className="composer-shell"
      data-layout={layout}
      ref={composerRef}
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
        accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.css,.html,.rs,.kt,.java,.py"
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
          {openMenu === "branch" ? <GitStatusPopover initNotice={gitInitNotice} initializing={gitInitRunning} loading={gitStatusLoading} onInitialize={initializeGitRepository} root={activeRoot} status={gitStatus} /> : null}
        </div>
      ) : null}
      {queuedMessages.length > 0 ? (
        <div className="composer-queue-tray" aria-label="Queued follow-up messages">
          {queuedMessages.map((queuedMessage) => {
            const editDraft = queuedEditDrafts[queuedMessage.id];
            const isEditingQueuedMessage = editDraft !== undefined;
            const isHeldQueuedMessage = heldQueuedMessageIdSet.has(queuedMessage.id);
            const canSteerQueuedMessage = isGenerating && (editDraft ?? queuedMessage.content).trim().length > 0;

            return (
              <div className="composer-queue-row" data-editing={isEditingQueuedMessage} key={queuedMessage.id}>
                <CornerDownRight size={15} aria-hidden="true" />
                {isEditingQueuedMessage ? (
                  <label className="composer-queue-edit">
                    <span className="sr-only">Edit queued steering message</span>
                    <textarea
                      autoFocus
                      rows={2}
                      value={editDraft}
                      onChange={(event) => updateQueuedMessageDraft(queuedMessage.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault();
                          if (canSteerQueuedMessage) {
                            steerQueuedMessage(queuedMessage.id);
                          }
                        }
                      }}
                    />
                  </label>
                ) : (
                  <span title={queuedMessage.content}>{formatQueuedMessagePreview(queuedMessage)}</span>
                )}
                {isGenerating ? (
                  <button type="button" className="composer-queue-steer" disabled={!canSteerQueuedMessage} onClick={() => steerQueuedMessage(queuedMessage.id)}>
                    <CornerDownRight size={14} aria-hidden="true" />
                    <span>Steer</span>
                  </button>
                ) : isHeldQueuedMessage ? (
                  <button type="button" className="composer-queue-steer" onClick={() => resumeQueuedMessage(queuedMessage.id)}>
                    <Check size={14} aria-hidden="true" />
                    <span>Queue</span>
                  </button>
                ) : (
                  <span className="composer-queue-state">Queued</span>
                )}
                {isEditingQueuedMessage ? (
                  <button type="button" className="composer-queue-icon" aria-label="Cancel queued message edit" title="Cancel edit" onClick={() => cancelQueuedMessageEdit(queuedMessage.id)}>
                    <X size={14} aria-hidden="true" />
                  </button>
                ) : (
                  <button type="button" className="composer-queue-icon" aria-label="Remove queued message" title="Remove queued message" onClick={() => onDeleteQueuedMessage(queuedMessage.id)}>
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                )}
                <span className="composer-queue-menu-wrap">
                  <button
                    type="button"
                    className="composer-queue-icon"
                    aria-label="More queued message actions"
                    aria-haspopup="menu"
                    aria-expanded={queueMenuMessageId === queuedMessage.id}
                    title="More"
                    onClick={() => setQueueMenuMessageId((currentId) => (currentId === queuedMessage.id ? null : queuedMessage.id))}
                  >
                    <MoreHorizontal size={15} aria-hidden="true" />
                  </button>
                  {queueMenuMessageId === queuedMessage.id ? (
                    <div className="composer-queue-menu" role="menu" aria-label="Queued message actions">
                      <button type="button" role="menuitem" onClick={() => beginQueuedMessageEdit(queuedMessage)}>
                        <Pencil size={14} aria-hidden="true" />
                        <span>Edit</span>
                      </button>
                    </div>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
      <label className="composer-input-wrap">
        <span className="sr-only">Message Gilbert Codex</span>
        <textarea
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
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={handleTextKeyDown}
        />
      </label>
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
          <div className="composer-menu-anchor">
            <button
              className="composer-tool composer-tool-primary"
              type="button"
              aria-label="Add files and tools"
              aria-haspopup="menu"
              aria-expanded={openMenu === "attach"}
              data-active={openMenu === "attach"}
              onClick={() => toggleMenu("attach")}
            >
              <Plus size={20} aria-hidden="true" />
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
                    <small>{webSearch.enabled ? `${webSearchProviderLabel} up to ${webSearch.maxResults} sources` : `Use ${webSearchProviderLabel} when this message needs sources`}</small>
                  </span>
                  <span className="composer-switch" data-on={webSearch.enabled}>
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
                <div className="composer-menu-separator" />
                <div className="composer-menu-panel">
                  <ThinkingModeControls settings={thinking} onChange={onThinkingChange} variant="panel" />
                </div>
                <div className="composer-menu-nested">
                  <button className="composer-menu-item" type="button" role="menuitem" aria-haspopup="menu">
                    <Boxes size={18} aria-hidden="true" />
                    <span>Tools</span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                  <div className="composer-submenu" role="menu" aria-label="Tool menu">
                    <button type="button" role="menuitem" disabled>
                      Browser
                    </button>
                    <button type="button" role="menuitem" disabled>
                      GitHub
                    </button>
                    <button type="button" role="menuitem" disabled>
                      Terminal
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <div className="composer-actions-left">
          <div className="composer-menu-anchor">
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
              <Sparkles size={16} aria-hidden="true" />
              <span>{selectedModel.label}</span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {openMenu === "model" ? (
              <ModelSelectorPopover
                anchorRef={modelButtonRef}
                liveModelCatalogErrors={liveModelCatalogErrors}
                liveModelCatalogs={liveModelCatalogs}
                liveModelCatalogStatus={liveModelCatalogStatus}
                model={model}
                modelContextWindows={modelContextWindows}
                onClose={() => setOpenMenu(null)}
                onModelChange={onModelChange}
                providerSettings={providerSettings}
                selectedModel={selectedModel}
              />
            ) : null}
          </div>
        </div>
        <div className="composer-actions-right">
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
        <div className="composer-menu-anchor composer-project-root">
          <button
            className="project-toggle"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "project"}
            data-active={openMenu === "project"}
            onClick={() => toggleMenu("project")}
          >
            <FolderGit2 size={14} aria-hidden="true" />
            <span>{projectLabel}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {openMenu === "project" ? (
            <ProjectPopover
              activeProjectName={chat.project}
              onCreateProject={onCreateProject}
              onSelectProject={(projectName) => {
                onSelectProject(projectName);
                setOpenMenu(null);
              }}
              projectSearch={projectSearch}
              projects={projects}
              setProjectSearch={setProjectSearch}
            />
          ) : null}
        </div>
        <div className="composer-menu-anchor composer-local-root">
          <button
            className="local-toggle"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "local"}
            data-active={openMenu === "local" || localWorkspace.enabled}
            onClick={() => toggleMenu("local")}
          >
            <Laptop size={14} aria-hidden="true" />
            <span>{localWorkspace.enabled ? "Work locally" : "Local off"}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {openMenu === "local" ? (
            <LocalWorkspacePopover
              providerLabel={selectedProvider.label}
              providerUsage={contextUsage}
              providerUsagePercent={contextUsagePercent}
              settings={localWorkspace}
              onChange={onLocalWorkspaceChange}
              onForkWorktree={onForkWorktree}
            />
          ) : null}
        </div>
        <div className="composer-menu-anchor composer-branch-root">
          <button
            className="branch-toggle"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "branch"}
            data-active={openMenu === "branch"}
            data-git={gitStatus?.available ? "true" : "false"}
            onClick={() => toggleMenu("branch")}
          >
            <GitBranch size={14} aria-hidden="true" />
            <span>{gitBranchLabel}</span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {openMenu === "branch" && !hasGitChangeSummary ? <GitStatusPopover initNotice={gitInitNotice} initializing={gitInitRunning} loading={gitStatusLoading} onInitialize={initializeGitRepository} root={activeRoot} status={gitStatus} /> : null}
        </div>
        <div className="composer-menu-anchor composer-context-root">
          <button
            className="context-window-chip"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "context"}
            data-active={openMenu === "context"}
            onClick={() => toggleMenu("context")}
          >
            <Gauge size={13} aria-hidden="true" />
            <span>
              Context {formatTokenCount(contextUsage.inputTokens)} / {formatTokenCount(contextUsage.contextWindowTokens)}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {openMenu === "context" ? <ContextWindowPopover compaction={lastContextCompaction} usage={contextUsage} usagePercent={contextUsagePercent} /> : null}
        </div>
        {voiceState === "blocked" ? <span className="composer-status composer-status-warning">Mic permission is blocked</span> : null}
        {voiceState === "unsupported" ? <span className="composer-status composer-status-warning">Mic is not available in this preview</span> : null}
        {voiceState === "error" && voiceStatus ? <span className="composer-status composer-status-warning">{voiceStatus}</span> : null}
        {voiceState !== "blocked" && voiceState !== "unsupported" && voiceState !== "error" && voiceStatus ? <span className="composer-status">{voiceStatus}</span> : null}
        {hasPendingAttachments ? <span className="composer-status">Preparing attachments</span> : null}
        {hasImageAttachment ? <span className="composer-status">Image uploads use Nemotron Omni</span> : null}
        {hasFailedAttachments ? <span className="composer-status composer-status-warning">Remove failed attachments to send</span> : null}
        {isGenerating ? <span className="composer-status">Generating response</span> : null}
        {visibleQueuedMessageCount > 0 ? <span className="composer-status composer-status-queued">{visibleQueuedMessageCount === 1 ? "1 queued" : `${visibleQueuedMessageCount} queued`}</span> : null}
        {webSearch.enabled ? <span className="composer-status composer-status-web">{webSearchProviderLabel} web on</span> : null}
        {planMode.enabled ? <span className="composer-status">Plan mode</span> : null}
      </div>
    </form>
  );
}

function ProjectPopover({
  activeProjectName,
  onCreateProject,
  onSelectProject,
  projectSearch,
  projects,
  setProjectSearch,
}: {
  activeProjectName: string;
  onCreateProject: () => void | string | null | Promise<string | null | void>;
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
    <div className="composer-popover composer-popover-project" role="dialog" aria-label="Projects">
      <label className="project-search">
        <Search size={16} aria-hidden="true" />
        <span className="sr-only">Search projects</span>
        <input autoFocus placeholder="Search projects" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} />
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
  initNotice,
  initializing,
  loading,
  onInitialize,
  root,
  status,
}: {
  initNotice: { kind: "error" | "success"; message: string } | null;
  initializing: boolean;
  loading: boolean;
  onInitialize: () => void;
  root: string;
  status: ComputerGitStatus | null;
}) {
  if (loading) {
    return (
      <div className="composer-popover composer-popover-branch" role="dialog" aria-label="Git status">
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
      <div className="composer-popover composer-popover-branch" role="dialog" aria-label="Git status">
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
          <div className="git-status-error-detail" title={status.error}>
            {status.error}
          </div>
        ) : null}
        {root ? (
          <div className="git-status-root" title={root}>
            {formatCompactPath(root)}
          </div>
        ) : null}
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
      <div className="git-status-root" title={status.repositoryRoot || root}>
        {formatCompactPath(status.repositoryRoot || root)}
      </div>
    </div>
  );
}

function LocalWorkspacePopover({
  onChange,
  onForkWorktree,
  providerLabel,
  providerUsage,
  providerUsagePercent,
  settings,
}: {
  onChange: (settings: LocalWorkspaceSettings) => void;
  onForkWorktree?: () => void | Promise<void>;
  providerLabel: string;
  providerUsage: ContextWindowUsage;
  providerUsagePercent: number;
  settings: LocalWorkspaceSettings;
}) {
  const activeIndexRequestRef = useRef<number | null>(null);
  const indexRequestRef = useRef(0);
  const [drives, setDrives] = useState<ComputerDrive[]>([]);
  const [browserPath, setBrowserPath] = useState(settings.roots[0] ?? "");
  const [error, setError] = useState<string | null>(settings.lastError ?? null);
  const [indexProgress, setIndexProgress] = useState<ComputerFileIndexProgress | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [fullComputerWarningOpen, setFullComputerWarningOpen] = useState(false);

  useEffect(() => {
    let disposed = false;

    async function bootstrap() {
      setError(null);

      try {
        const [driveList, defaultWorkspace] = await Promise.all([listComputerDrives(), getDefaultComputerWorkspace()]);

        if (disposed) {
          return;
        }

        const startPath = settings.roots[0] || defaultWorkspace || driveList[0]?.path || "";
        setDrives(driveList);
        setBrowserPath(startPath);
      } catch (caughtError) {
        if (!disposed) {
          setError(readErrorMessage(caughtError, "Could not open local computer files."));
        }
      }
    }

    void bootstrap();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenForComputerFileIndexProgress((progress) => {
      if (disposed || activeIndexRequestRef.current !== progress.requestId) {
        return;
      }

      setIndexProgress(progress);
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
  }, []);

  function commit(patch: Partial<LocalWorkspaceSettings>) {
    onChange({
      ...settings,
      lastError: undefined,
      ...patch,
    });
  }

  function commitSettings(nextSettings: LocalWorkspaceSettings) {
    onChange({
      ...nextSettings,
      lastError: nextSettings.lastError,
    });
  }

  async function setEnabled(enabled: boolean) {
    if (!enabled) {
      commit({ enabled: false, indexReason: undefined, indexStatus: "idle" });
      return;
    }

    if (settings.scope === "full-computer") {
      setFullComputerWarningOpen(true);
      return;
    }

    const roots = await resolveRootsForScope(settings.scope);
    const nextSettings: LocalWorkspaceSettings = {
      ...settings,
      enabled: true,
      lastError: undefined,
      roots,
    };
    commitSettings(nextSettings);
    void rebuildIndex(nextSettings, "Auto-indexing workspace");
  }

  async function selectScope(scope: LocalWorkspaceScope) {
    if (scope === "full-computer") {
      setFullComputerWarningOpen(true);
      return;
    }

    await applyScope(scope);
  }

  async function applyScope(scope: LocalWorkspaceScope) {
    setError(null);

    try {
      const roots = await resolveRootsForScope(scope);
      const nextSettings = {
        ...settings,
        enabled: true,
        permissionMode: scope === "full-computer" ? "full-workspace" : settings.permissionMode,
        roots,
        scope,
        lastError: undefined,
      };

      commitSettings(nextSettings);
      if (scope !== "full-computer") {
        void rebuildIndex(nextSettings, "Auto-indexing folder");
      }

      if (scope !== "full-computer" && roots[0]) {
        setBrowserPath(roots[0]);
      }
    } catch (caughtError) {
      setError(readErrorMessage(caughtError, "Could not switch local workspace scope."));
    }
  }

  async function selectPermissionMode(permissionMode: LocalPermissionMode) {
    setError(null);

    try {
      const roots = settings.enabled && settings.roots.length > 0 ? settings.roots : await resolveRootsForScope(settings.scope);
      const nextSettings: LocalWorkspaceSettings = {
        ...settings,
        enabled: true,
        permissionMode,
        roots,
        lastError: undefined,
      };

      commitSettings(nextSettings);

      if (!settings.enabled && roots.length > 0) {
        void rebuildIndex(nextSettings, "Auto-indexing workspace");
      }
    } catch (caughtError) {
      setError(readErrorMessage(caughtError, "Could not switch local permission mode."));
    }
  }

  async function confirmFullComputerScope() {
    setFullComputerWarningOpen(false);
    await applyScope("full-computer");
  }

  async function resolveRootsForScope(scope: LocalWorkspaceScope) {
    if (scope === "full-computer") {
      const driveList = drives.length > 0 ? drives : await listComputerDrives();
      setDrives(driveList);
      return mergeFullComputerRoots(settings.roots, driveList);
    }

    if (scope === "current-folder") {
      if (settings.roots.length > 0) {
        return settings.roots;
      }

      const defaultWorkspace = await getDefaultComputerWorkspace();
      return defaultWorkspace ? [defaultWorkspace] : settings.roots;
    }

    if (settings.roots.length > 0) {
      return settings.roots;
    }

    const selectedFolder = await pickComputerFolder(browserPath || settings.roots[0]);
    return selectedFolder ? [selectedFolder] : [];
  }

  async function rebuildIndex(settingsOverride: LocalWorkspaceSettings = settings, reason = "Indexing workspace") {
    if (settingsOverride.scope === "full-computer") {
      const roots = settingsOverride.roots.length > 0 ? settingsOverride.roots : await resolveRootsForScope(settingsOverride.scope);
      onChange({
        ...settingsOverride,
        enabled: true,
        indexReason: undefined,
        indexStatus: "idle",
        indexSummary: undefined,
        indexUpdatedAt: undefined,
        lastError: undefined,
        roots,
      });
      setIndexing(false);
      setIndexProgress(null);
      setError(null);
      return;
    }

    const requestId = indexRequestRef.current + 1;
    indexRequestRef.current = requestId;
    activeIndexRequestRef.current = requestId;
    setIndexing(true);
    setIndexProgress(null);
    setError(null);

    try {
      const roots = settingsOverride.roots.length > 0 ? settingsOverride.roots : await resolveRootsForScope(settingsOverride.scope);

      if (roots.length === 0) {
        throw new Error("Choose a folder or enable full computer first.");
      }

      setIndexProgress(createIndexProgressFromRoots(requestId, roots));
      onChange({
        ...settingsOverride,
        enabled: true,
        indexReason: reason,
        indexStatus: "indexing",
        lastError: undefined,
        roots,
      });

      const summary = await buildComputerFileIndex(roots, settingsOverride.scope, requestId);

      if (indexRequestRef.current !== requestId) {
        return;
      }

      setIndexProgress(createIndexProgressFromSummary(requestId, summary));
      onChange({
        ...settingsOverride,
        enabled: true,
        indexReason: undefined,
        indexSummary: summary,
        indexStatus: "idle",
        indexUpdatedAt: new Date().toISOString(),
        lastError: undefined,
        roots,
      });
    } catch (caughtError) {
      if (indexRequestRef.current !== requestId) {
        return;
      }

      const message = readErrorMessage(caughtError, "Could not build the local file index.");
      setError(message);

      onChange({
        ...settingsOverride,
        indexReason: undefined,
        indexStatus: "error",
        lastError: message,
      });
    } finally {
      if (indexRequestRef.current === requestId) {
        setIndexing(false);
        activeIndexRequestRef.current = null;
      }
    }
  }

  async function createProjectMemoryFile() {
    const root = selectedRoots[0];

    if (!root || settings.scope === "full-computer") {
      setError(`${GILBERT_PROJECT_MEMORY_FILE} can be created only inside a current or selected folder workspace.`);
      return;
    }

    setError(null);

    try {
      const memoryPath = joinLocalPath(root, GILBERT_PROJECT_MEMORY_FILE);
      await writeComputerTextFile(memoryPath, createGilbertProjectMemoryTemplate(), [root], {
        createParentDirs: false,
        overwrite: false,
      });
      void rebuildIndex(
        {
          ...settings,
          enabled: true,
          roots: selectedRoots,
        },
        `Indexed ${GILBERT_PROJECT_MEMORY_FILE}`,
      );
    } catch (caughtError) {
      setError(readErrorMessage(caughtError, `Could not create ${GILBERT_PROJECT_MEMORY_FILE}.`));
    }
  }

  const selectedRoots = settings.roots.length > 0 ? settings.roots : [];
  const liveIndexProgress = indexing && indexProgress?.requestId === indexRequestRef.current ? indexProgress : null;

  return (
    <div className="composer-popover composer-popover-local" role="dialog" aria-label="Local computer workspace">
      <div className="local-popover-header">
        <span>
          <strong>Work locally</strong>
          <small>{settings.enabled ? `${localWorkspaceScopeLabel(settings.scope)} - ${localPermissionModeLabel(settings.permissionMode)}` : "Off"}</small>
        </span>
        <button className="local-switch-button" type="button" role="switch" aria-checked={settings.enabled} data-on={settings.enabled} onClick={() => void setEnabled(!settings.enabled)}>
          <span />
        </button>
      </div>

      <div className="local-mode-menu" aria-label="Start in">
        <small>Start in</small>
        <button type="button" data-selected={settings.enabled} onClick={() => void setEnabled(true)}>
          <Laptop size={18} aria-hidden="true" />
          <span>Work locally</span>
          {settings.enabled ? <Check size={18} aria-hidden="true" /> : null}
        </button>
        <button
          type="button"
          disabled={!onForkWorktree || settings.roots.length === 0}
          title={settings.roots.length === 0 ? "Choose a Git-backed project folder before creating a worktree." : "Fork this chat into a new Git worktree."}
          onClick={() => void onForkWorktree?.()}
        >
          <CornerDownRight size={18} aria-hidden="true" />
          <span>New worktree</span>
        </button>
        <ProviderUsageSnapshot providerLabel={providerLabel} usage={providerUsage} usagePercent={providerUsagePercent} />
      </div>

      <div className="local-scope-row" role="radiogroup" aria-label="Local workspace scope">
        {(["current-folder", "selected-folder", "full-computer"] as LocalWorkspaceScope[]).map((scope) => {
          const selected = settings.scope === scope;
          const Icon = scope === "full-computer" ? HardDrive : scope === "selected-folder" ? FolderOpen : Home;

          return (
            <button key={scope} type="button" role="radio" aria-checked={selected} data-selected={selected} onClick={() => void selectScope(scope)}>
              <Icon size={15} aria-hidden="true" />
              <span>{localWorkspaceScopeLabel(scope)}</span>
            </button>
          );
        })}
      </div>

      <div className="local-permission-row" role="radiogroup" aria-label="Local workspace permissions">
        {[
          { icon: Wand2, label: "Auto full", mode: "full-workspace" },
          { icon: AlertTriangle, label: "Review", mode: "gilbert-review" },
          { icon: CloudOff, label: "Read only", mode: "read-only" },
        ].map((option) => {
          const selected = option.mode === "gilbert-review"
            ? settings.permissionMode === "gilbert-review" || settings.permissionMode === "ask-first"
            : settings.permissionMode === option.mode;
          const Icon = option.icon;

          return (
            <button key={option.mode} type="button" role="radio" aria-checked={selected} data-selected={selected} onClick={() => void selectPermissionMode(option.mode as LocalPermissionMode)}>
              <Icon size={15} aria-hidden="true" />
              <span>{option.label}</span>
            </button>
          );
        })}
      </div>

      {fullComputerWarningOpen ? (
        <div className="local-danger-popup" role="alertdialog" aria-label="Full computer access warning">
          <div>
            <HardDrive size={18} aria-hidden="true" />
            <span>
              <strong>Full computer access</strong>
              <small>Gilbert can see all readable drives and index file names, paths, and text previews. This is powerful and can expose private files.</small>
            </span>
          </div>
          <p>Full computer mode enables read/write file tools across readable drive roots when write tools are on. Use it only when you want the whole device available to the AI.</p>
          <div>
            <button type="button" onClick={() => setFullComputerWarningOpen(false)}>
              Cancel
            </button>
            <button type="button" data-danger="true" onClick={() => void confirmFullComputerScope()}>
              Enable full computer
            </button>
          </div>
        </div>
      ) : null}

      <div className="local-index-row">
        <button type="button" disabled={indexing || selectedRoots.length === 0 || settings.scope === "full-computer"} onClick={() => void rebuildIndex(settings, "Indexing workspace")}>
          {indexing ? <LoaderCircle size={15} aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
          <span>{indexing ? formatIndexButtonLabel(liveIndexProgress) : "Index now"}</span>
        </button>
        <button type="button" disabled={indexing || selectedRoots.length === 0 || settings.scope === "full-computer"} onClick={() => void createProjectMemoryFile()}>
          <FileUp size={15} aria-hidden="true" />
          <span>{GILBERT_PROJECT_MEMORY_FILE}</span>
        </button>
        <span>{indexing ? formatLiveIndexProgress(liveIndexProgress) : formatLocalWorkspaceIndexStatus(settings)}</span>
      </div>
      {indexing ? (
        <div className="local-index-progress" role="status" aria-live="polite">
          <span>
            <strong>{formatLiveIndexProgress(liveIndexProgress)}</strong>
            <small>{formatIndexCurrentPath(liveIndexProgress?.currentPath)}</small>
          </span>
          <div className="local-index-progress-track" aria-hidden="true">
            <i />
          </div>
        </div>
      ) : null}
      <div className="local-popover-note">
        Index updates automatically when you select or drop a folder. {GILBERT_PROJECT_MEMORY_FILE} is loaded as project memory when present.
      </div>

      {error ? <div className="local-popover-error">{error}</div> : null}
    </div>
  );
}

function ProviderUsageSnapshot({ providerLabel, usage, usagePercent }: { providerLabel: string; usage: ContextWindowUsage; usagePercent: number }) {
  const reservePercent = Math.min(Math.round((usage.maxOutputTokens / usage.contextWindowTokens) * 100), 100);
  const isProviderUsage = usage.tokenSource === "openrouter" || usage.tokenSource === "provider";
  const sourceLabel =
    usage.tokenSource === "projected"
      ? "Projected next request"
      : isProviderUsage
        ? "Last provider payload"
        : "Provider-visible request estimate";

  return (
    <div className="local-provider-usage-card" role="group" aria-label={`${providerLabel} usage`}>
      <div className="local-provider-usage-header">
        <Gauge size={17} aria-hidden="true" />
        <span>
          <strong>Provider usage</strong>
          <small>
            {providerLabel} - {sourceLabel}
          </small>
        </span>
        <em>{formatTokenCount(usage.inputTokens)}</em>
      </div>
      <div className="local-provider-usage-meter" aria-hidden="true">
        <span style={{ width: `${usagePercent}%` }} />
        <em style={{ width: `${reservePercent}%` }} />
      </div>
      <dl className="local-provider-usage-list">
        <div>
          <dt>{isProviderUsage ? "Provider prompt" : "Provider payload estimate"}</dt>
          <dd>{formatTokenCount(usage.inputTokens)}</dd>
        </div>
        <div>
          <dt>Chat, tools, sources</dt>
          <dd>{formatTokenCount(usage.messageTokens)}</dd>
        </div>
        <div>
          <dt>System, runtime, envelope</dt>
          <dd>{formatTokenCount(usage.systemTokens + usage.requestOverheadTokens)}</dd>
        </div>
        <div>
          <dt>Response cap</dt>
          <dd>{formatTokenCount(usage.maxOutputTokens)}</dd>
        </div>
        {typeof usage.openRouterTotalTokens === "number" ? (
          <div>
            <dt>Provider actual total</dt>
            <dd>{formatTokenCount(usage.openRouterTotalTokens)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function ContextWindowPopover({ compaction, usage, usagePercent }: { compaction?: ContextCompactionNotice | null; usage: ContextWindowUsage; usagePercent: number }) {
  const reservePercent = Math.min(Math.round((usage.maxOutputTokens / usage.contextWindowTokens) * 100), 100);
  const compactPercent = Math.round(AUTO_COMPACT_CONTEXT_THRESHOLD * 100);
  const compactTokenLimit = Math.floor(usage.contextWindowTokens * AUTO_COMPACT_CONTEXT_THRESHOLD);
  const isProviderUsage = usage.tokenSource === "openrouter" || usage.tokenSource === "provider";
  const isProjectedUsage = usage.tokenSource === "projected";

  return (
    <div className="composer-popover composer-popover-context" role="dialog" aria-label="Context window">
      <div className="context-window-header">
        <span>
          <strong>Context window</strong>
          <small>
            {isProjectedUsage
              ? "Projected next request from last provider payload"
              : isProviderUsage
                ? "Provider usage from last request"
                : usage.source === "openrouter" || usage.source === "provider"
                  ? "Provider-visible payload estimate against model limit"
                : "Provider-visible payload estimate against estimated limit"}
          </small>
        </span>
        <strong>
          {formatTokenCount(usage.inputTokens)} / {formatTokenCount(usage.contextWindowTokens)}
        </strong>
      </div>
      <div className="context-window-meter" aria-hidden="true">
        <span style={{ width: `${usagePercent}%` }} />
        <em style={{ width: `${reservePercent}%` }} />
        <i style={{ left: `${compactPercent}%` }} />
      </div>
      <p className="context-window-note">
        {isProjectedUsage
          ? "Uses the last provider prompt as a baseline and adds the current draft estimate, so typing does not hide transient tool context."
          : isProviderUsage
            ? "Provider-reported prompt tokens replace the serialized estimate after a send."
            : "Estimated from the exact serialized provider request body. The response cap is tracked separately."}{" "}
        Auto compacts only after the prompt payload exceeds the selected input window ({formatTokenCount(compactTokenLimit)}).
      </p>
      <dl className="context-window-list">
        {compaction ? (
          <div className="context-window-compaction-row">
            <dt>
              Last auto compact
              <small>
                {compaction.forcedByProviderUsage ? "Provider usage crossed the limit" : "Payload crossed the limit"} - {compaction.compactedMessageCount} older messages
              </small>
            </dt>
            <dd>
              {formatTokenCount(compaction.afterTokens)} / {formatTokenCount(compaction.contextWindowTokens)}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{isProjectedUsage ? "Projected provider prompt" : isProviderUsage ? "Provider prompt" : "Provider payload estimate"}</dt>
          <dd>{formatTokenCount(usage.inputTokens)}</dd>
        </div>
        {typeof usage.openRouterCompletionTokens === "number" ? (
          <div>
            <dt>Provider completion</dt>
            <dd>{formatTokenCount(usage.openRouterCompletionTokens)}</dd>
          </div>
        ) : null}
        {typeof usage.openRouterTotalTokens === "number" ? (
          <div>
            <dt>Provider actual total</dt>
            <dd>{formatTokenCount(usage.openRouterTotalTokens)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{isProviderUsage ? "Chat, tools, sources split" : "Chat, tools, sources"}</dt>
          <dd>{formatTokenCount(usage.messageTokens)}</dd>
        </div>
        <div>
          <dt>Draft</dt>
          <dd>{formatTokenCount(usage.draftTokens)}</dd>
        </div>
        <div>
          <dt>{isProviderUsage ? "System, runtime split" : "System, runtime tools"}</dt>
          <dd>{formatTokenCount(usage.systemTokens)}</dd>
        </div>
        <div>
          <dt>{isProviderUsage ? "Provider envelope split" : "Provider envelope"}</dt>
          <dd>{formatTokenCount(usage.requestOverheadTokens)}</dd>
        </div>
        <div>
          <dt>Response cap</dt>
          <dd>{formatTokenCount(usage.maxOutputTokens)}</dd>
        </div>
        <div>
          <dt>Available if cap is used</dt>
          <dd>{formatTokenCount(usage.availableTokens)}</dd>
        </div>
      </dl>
    </div>
  );
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

function formatQueuedMessagePreview(message: ChatMessage) {
  const content = message.content.trim();

  if (content) {
    return content;
  }

  const attachmentCount = message.attachments?.length ?? 0;

  if (attachmentCount === 1) {
    return message.attachments?.[0]?.name || "1 attachment";
  }

  return `${attachmentCount} attachments`;
}

function removeQueuedEditDraft(drafts: Record<string, string>, messageId: string) {
  const { [messageId]: _removed, ...nextDrafts } = drafts;
  return nextDrafts;
}

function getBuiltInSpeechRecognition() {
  const speechWindow = window as Window & {
    SpeechRecognition?: BuiltInSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BuiltInSpeechRecognitionConstructor;
  };

  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function buildDictationMessage(baseMessage: string, results: BuiltInSpeechRecognitionResultList) {
  const transcriptParts: string[] = [];

  for (let index = 0; index < results.length; index += 1) {
    const transcript = results[index]?.[0]?.transcript?.trim();

    if (transcript) {
      transcriptParts.push(transcript);
    }
  }

  const transcript = formatDictationTranscript(transcriptParts.join(" "));

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

function joinLocalPath(root: string, child: string) {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function createIndexProgressFromRoots(requestId: number, roots: string[]): ComputerFileIndexProgress {
  return {
    done: false,
    entryCount: 0,
    ignoredEntries: 0,
    requestId,
    roots,
    scannedDirectories: 0,
    skippedEntries: 0,
    truncated: false,
  };
}

function createIndexProgressFromSummary(requestId: number, summary: ComputerFileIndexSummary): ComputerFileIndexProgress {
  return {
    done: true,
    entryCount: summary.entryCount,
    ignoredEntries: summary.ignoredEntries,
    requestId,
    roots: summary.roots,
    scannedDirectories: summary.scannedDirectories,
    skippedEntries: summary.skippedEntries,
    truncated: summary.truncated,
  };
}

function formatIndexButtonLabel(progress: ComputerFileIndexProgress | null) {
  if (!progress || progress.entryCount === 0) {
    return "Indexing";
  }

  return `Indexing ${formatCompactCount(progress.entryCount)}`;
}

function formatLiveIndexProgress(progress: ComputerFileIndexProgress | null) {
  if (!progress) {
    return "Starting index...";
  }

  const entries = formatCompactCount(progress.entryCount);
  const folders = formatCompactCount(progress.scannedDirectories);
  const ignored = progress.ignoredEntries > 0 ? `, ${formatCompactCount(progress.ignoredEntries)} ignored` : "";
  const skipped = progress.skippedEntries > 0 ? `, ${formatCompactCount(progress.skippedEntries)} skipped` : "";
  const cap = progress.truncated ? ", capped" : "";
  return `${entries} items, ${folders} folders${ignored}${skipped}${cap}`;
}

function formatIndexCurrentPath(path?: string) {
  if (!path) {
    return "Preparing workspace scan";
  }

  const normalized = path.replace(/[\\/]+$/, "");
  const lastBackslash = normalized.lastIndexOf("\\");
  const lastSlash = normalized.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);
  const name = index >= 0 ? normalized.slice(index + 1) : normalized;

  return name || normalized || "Scanning";
}

function formatCompactCount(value: number) {
  return new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? "compact" : "standard" }).format(value);
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

  if (attachment.mimeType.startsWith("image/")) {
    return <ImageIcon size={15} aria-hidden="true" />;
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
