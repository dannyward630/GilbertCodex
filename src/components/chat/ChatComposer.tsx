import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  FileUp,
  FolderOpen,
  Gauge,
  Globe2,
  Hand,
  HardDrive,
  Home,
  Image as ImageIcon,
  ListChecks,
  LoaderCircle,
  Mic,
  MicOff,
  Plus,
  RefreshCw,
  Shield,
  ShieldCheck,
  Sparkles,
  Square,
  Wand2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ThinkingModeControls } from "../thinking/ThinkingModeControls";
import { createChatAttachmentFromFile, formatAttachmentSize, isImageAttachment } from "../../lib/chatAttachments";
import {
  AUTO_COMPACT_CONTEXT_THRESHOLD,
  formatTokenCount,
  getFallbackModelContextWindow,
  type ContextWindowUsage,
  type ModelContextWindow,
  type ModelContextWindowMap,
} from "../../lib/contextWindow";
import { CHAT_MODEL_OPTIONS, type ChatModelOption } from "../../lib/models";
import { estimateOpenRouterContextWindowUsage } from "../../services/openRouterUsage";
import { DEFAULT_PLANNING_MAX_PASSES } from "../../services/planningClient";
import {
  buildComputerFileIndex,
  createGilbertProjectMemoryTemplate,
  formatLocalWorkspaceIndexStatus,
  getDefaultComputerWorkspace,
  GILBERT_PROJECT_MEMORY_FILE,
  listenForComputerFileIndexProgress,
  listenForComputerFolderDrops,
  listComputerDirectory,
  listComputerDrives,
  localPermissionModeLabel,
  localWorkspaceScopeLabel,
  pickComputerFolder,
  registerBrowserDroppedFolders,
  writeComputerTextFile,
} from "../../tools/computer/files";
import type { ChatAttachment, ChatComposerDraft, ChatSendInput, ChatSummary } from "../../types/chat";
import type { ComputerDrive, ComputerFileIndexProgress, ComputerFileIndexSummary, LocalPermissionMode, LocalWorkspaceScope, LocalWorkspaceSettings } from "../../types/localWorkspace";
import type { ProviderSettings, ThinkingSettings, WebSearchSettings } from "../../types/settings";

type ComposerMenu = "attach" | "context" | "local" | "model" | "review" | null;
type VoiceState = "idle" | "listening" | "blocked" | "unsupported";

interface ChatComposerProps {
  chat: ChatSummary;
  contextWindowSource: "estimate" | "openrouter";
  contextWindowTokens: number;
  disabled: boolean;
  draft?: ChatComposerDraft | null;
  localWorkspace: LocalWorkspaceSettings;
  lastProviderContextUsage?: ContextWindowUsage | null;
  maxOutputTokens: number;
  model: string;
  modelContextWindows: ModelContextWindowMap;
  onDraftApplied?: () => void;
  onHeightChange?: (height: number) => void;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onModelChange: (model: string) => void;
  onStopGeneration?: () => void;
  onSubmit: (input: ChatSendInput) => void | Promise<void>;
  providerSettings: ProviderSettings;
  onThinkingChange: (thinking: ThinkingSettings) => void;
  onWebSearchChange: (webSearch: WebSearchSettings) => void;
  systemPrompt: string;
  thinking: ThinkingSettings;
  webSearch: WebSearchSettings;
}

interface ReviewMode {
  id: "guard" | "review" | "full";
  label: string;
  detail: string;
  icon: LucideIcon;
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
  maxPasses: number;
}

const reviewModes: ReviewMode[] = [
  {
    id: "guard",
    label: "Ask first",
    detail: "Review sensitive edits before they run.",
    icon: Hand,
  },
  {
    id: "review",
    label: "Gilbert review",
    detail: "Inspect changes and call out risks.",
    icon: ShieldCheck,
  },
  {
    id: "full",
    label: "Full workspace",
    detail: "Allow broader edits when you are moving fast.",
    icon: Shield,
  },
];

const modelOptions = CHAT_MODEL_OPTIONS;

const planningPassOptions = [3, 5, DEFAULT_PLANNING_MAX_PASSES];

function modelFromValue(modelValue: string): ChatModelOption {
  const normalizedValue = modelValue.trim();
  const matchingOption = modelOptions.find((option) => option.value === normalizedValue);

  if (matchingOption) {
    return matchingOption;
  }

  return {
    id: "custom",
    label: "Custom model",
    detail: normalizedValue || "No model selected",
    value: normalizedValue,
  };
}

function formatModelContextWindow(contextWindow: ModelContextWindow) {
  const suffix = contextWindow.source === "openrouter" ? "" : " est.";

  return `${formatTokenCount(contextWindow.tokens)} context${suffix}`;
}

function modelContextWindowTitle(contextWindow: ModelContextWindow) {
  return contextWindow.source === "openrouter" ? "Context window reported by OpenRouter" : "Estimated context window until OpenRouter metadata is available";
}

export function ChatComposer({
  chat,
  contextWindowSource,
  contextWindowTokens,
  disabled,
  draft,
  localWorkspace,
  lastProviderContextUsage,
  maxOutputTokens,
  model,
  modelContextWindows,
  onDraftApplied,
  onHeightChange,
  onLocalWorkspaceChange,
  onModelChange,
  onStopGeneration,
  onSubmit,
  providerSettings,
  onThinkingChange,
  onWebSearchChange,
  systemPrompt,
  thinking,
  webSearch,
}: ChatComposerProps) {
  const composerRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const voiceRequestRef = useRef(0);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const [message, setMessage] = useState("");
  const [openMenu, setOpenMenu] = useState<ComposerMenu>(null);
  const [planMode, setPlanMode] = useState<PlanningModeSettings>({
    enabled: false,
    maxPasses: DEFAULT_PLANNING_MAX_PASSES,
  });
  const [attachments, setAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const readyAttachments = attachments.flatMap((attachment) => (attachment.attachment ? [attachment.attachment] : []));
  const hasImageAttachment = readyAttachments.some(isImageAttachment);
  const hasPendingAttachments = attachments.some((attachment) => attachment.status === "loading");
  const hasFailedAttachments = attachments.some((attachment) => attachment.status === "error");
  const canSend = (Boolean(message.trim()) || readyAttachments.length > 0) && !disabled && !hasPendingAttachments && !hasFailedAttachments;
  const selectedModel = modelFromValue(model);
  const estimatedContextUsage = estimateOpenRouterContextWindowUsage({
    chat,
    contextWindowTokens,
    draftAttachments: readyAttachments,
    draftContent: message,
    settings: providerSettings,
    source: contextWindowSource,
  });
  const hasDraftContext = Boolean(message.trim()) || readyAttachments.length > 0;
  const contextUsage = hasDraftContext ? estimatedContextUsage : lastProviderContextUsage ?? estimatedContextUsage;
  const contextUsagePercent = Math.min(Math.round((contextUsage.totalTokens / contextUsage.contextWindowTokens) * 100), 100);
  const reviewMode = reviewModeFromPermissionMode(localWorkspace.permissionMode);
  const ReviewIcon = reviewMode.icon;

  useEffect(() => {
    mountedRef.current = true;

    function handlePointerDown(event: PointerEvent) {
      if (!composerRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      mountedRef.current = false;
      voiceRequestRef.current += 1;
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = null;
    };
  }, []);

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

  function toggleMenu(menu: Exclude<ComposerMenu, null>) {
    setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
  }

  function togglePlanMode() {
    setPlanMode((currentPlanMode) => ({
      ...currentPlanMode,
      enabled: !currentPlanMode.enabled,
    }));
  }

  function setPlanningPasses(maxPasses: number) {
    setPlanMode((currentPlanMode) => ({
      ...currentPlanMode,
      enabled: true,
      maxPasses,
    }));
  }

  function toggleWebSearch() {
    onWebSearchChange({
      ...webSearch,
      enabled: !webSearch.enabled,
      provider: "duckduckgo",
    });
  }

  function selectReviewMode(mode: ReviewMode) {
    const permissionMode = permissionModeFromReviewMode(mode.id);
    const nextWorkspace: LocalWorkspaceSettings = {
      ...localWorkspace,
      permissionMode,
    };

    if (mode.id === "full") {
      nextWorkspace.enabled = true;
      nextWorkspace.scope = nextWorkspace.scope || "current-folder";
    }

    onLocalWorkspaceChange(nextWorkspace);
    setOpenMenu(null);
  }

  function handleFileSelect(event: ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    if (selectedFiles.length > 0) {
      const draftAttachments = selectedFiles.map((file, index) => ({
        id: createDraftAttachmentId(index),
        mimeType: file.type || "application/octet-stream",
        name: file.name || "Attachment",
        size: file.size,
        status: "loading" as const,
      }));

      setAttachments((currentAttachments) => [...currentAttachments, ...draftAttachments]);
      void prepareAttachments(selectedFiles, draftAttachments);
    }
    event.target.value = "";
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
      planning: planMode.enabled
        ? {
            maxPasses: planMode.maxPasses,
          }
        : undefined,
      webSearch: {
        enabled: webSearch.enabled,
        maxResults: webSearch.maxResults,
        provider: "duckduckgo",
      },
    });
  }

  function handleTextKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage();
    }
  }

  function stopVoiceInput() {
    voiceRequestRef.current += 1;
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;

    if (mountedRef.current) {
      setVoiceState("idle");
    }
  }

  async function handleVoiceToggle() {
    if (voiceState === "listening") {
      stopVoiceInput();
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setVoiceState("unsupported");
      return;
    }

    const requestId = voiceRequestRef.current + 1;
    voiceRequestRef.current = requestId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      if (!mountedRef.current || voiceRequestRef.current !== requestId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
      voiceStreamRef.current = stream;
      setVoiceState("listening");
    } catch {
      if (mountedRef.current && voiceRequestRef.current === requestId) {
        setVoiceState("blocked");
      }
    }
  }

  const voiceLabel =
    voiceState === "listening"
      ? "Stop voice input"
      : voiceState === "blocked"
        ? "Microphone blocked"
        : voiceState === "unsupported"
          ? "Voice input unavailable"
          : "Start voice input";

  return (
    <form
      className="composer-shell"
      ref={composerRef}
      onSubmit={(event) => {
        event.preventDefault();
        submitMessage();
      }}
    >
      <input
        ref={fileInputRef}
        className="composer-file-input"
        type="file"
        multiple
        accept="image/*,.pdf,.txt,.md,.csv,.json,.ts,.tsx,.js,.jsx,.css,.html,.rs,.kt,.java,.py"
        onChange={handleFileSelect}
      />
      <label className="composer-input-wrap">
        <span className="sr-only">Message Gilbert Codex</span>
        <textarea
          disabled={disabled}
          placeholder={
            disabled
              ? "Generating response..."
              : voiceState === "listening"
                ? "Listening... speak when ready"
                : planMode.enabled
                  ? "Ask for a plan before Gilbert Codex starts coding"
                  : "Ask Gilbert Codex to build, inspect, or change this project"
          }
          rows={3}
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
                  aria-checked={planMode.enabled}
                  onClick={togglePlanMode}
                >
                  <Wand2 size={18} aria-hidden="true" />
                  <span>
                    <strong>Plan mode</strong>
                    <small>{planMode.enabled ? `Up to ${planMode.maxPasses} passes` : "Adaptive pass budget"}</small>
                  </span>
                  <span className="composer-switch" data-on={planMode.enabled}>
                    <span />
                  </span>
                </button>
                {planMode.enabled ? (
                  <div className="composer-plan-inline" role="group" aria-label="Plan mode settings">
                    <div className="composer-plan-inline-header">
                      <ListChecks size={14} aria-hidden="true" />
                      <span>
                        <strong>Planning flow</strong>
                        <small>Stage-by-stage, then final answer</small>
                      </span>
                    </div>
                    <div className="composer-plan-pass-row" role="radiogroup" aria-label="Maximum planning passes">
                      {planningPassOptions.map((passCount) => (
                        <button
                          key={passCount}
                          type="button"
                          role="radio"
                          aria-checked={planMode.maxPasses === passCount}
                          data-selected={planMode.maxPasses === passCount}
                          onClick={() => setPlanningPasses(passCount)}
                        >
                          <strong>{passCount}</strong>
                          <small>{passCount === DEFAULT_PLANNING_MAX_PASSES ? "Deep" : passCount === 5 ? "Balanced" : "Quick"}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
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
          <button
            className="composer-tool composer-tool-web"
            type="button"
            aria-label={webSearch.enabled ? "Disable DuckDuckGo web search" : "Enable DuckDuckGo web search"}
            aria-pressed={webSearch.enabled}
            title={webSearch.enabled ? "DuckDuckGo web search on" : "Search the web with DuckDuckGo"}
            data-active={webSearch.enabled}
            onClick={toggleWebSearch}
          >
            <Globe2 size={18} aria-hidden="true" />
          </button>
          <ThinkingModeControls settings={thinking} onChange={onThinkingChange} />
        </div>
        <div className="composer-actions-left">
          <div className="composer-menu-anchor">
            <button
              className="mode-chip"
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === "review"}
              data-active={openMenu === "review"}
              onClick={() => toggleMenu("review")}
            >
              <ReviewIcon size={16} aria-hidden="true" />
              <span>{reviewMode.label}</span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {openMenu === "review" ? (
              <div className="composer-popover composer-popover-review" role="menu" aria-label="Review mode">
                {reviewModes.map((mode) => {
                  const Icon = mode.icon;
                  const selected = mode.id === reviewMode.id;
                  return (
                    <button
                      key={mode.id}
                      className="composer-menu-item composer-menu-item-stacked"
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      data-selected={selected}
                      onClick={() => selectReviewMode(mode)}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>
                        <strong>{mode.label}</strong>
                        <small>{mode.detail}</small>
                      </span>
                      {selected ? <Check size={18} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="composer-menu-anchor">
            <button
              className="mode-chip mode-chip-model"
              type="button"
              aria-haspopup="menu"
              aria-expanded={openMenu === "model"}
              data-active={openMenu === "model"}
              onClick={() => toggleMenu("model")}
            >
              <Sparkles size={16} aria-hidden="true" />
              <span>{selectedModel.label}</span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {openMenu === "model" ? (
              <div className="composer-popover composer-popover-model" role="menu" aria-label="Model selector">
                {modelOptions.map((option) => {
                  const selected = option.value === selectedModel.value;
                  const optionContextWindow = modelContextWindows[option.value] ?? getFallbackModelContextWindow(option.value);
                  return (
                    <button
                      key={option.id}
                      className="composer-menu-item composer-menu-item-stacked"
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      data-selected={selected}
                      onClick={() => {
                        onModelChange(option.value);
                        setOpenMenu(null);
                      }}
                    >
                      <Sparkles size={18} aria-hidden="true" />
                      <span>
                        <strong>{option.label}</strong>
                        <small className="model-option-detail">
                          <span>{option.detail}</span>
                          <span className="model-context-size" title={modelContextWindowTitle(optionContextWindow)}>
                            {formatModelContextWindow(optionContextWindow)}
                          </span>
                        </small>
                      </span>
                      {selected ? <Check size={18} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
        <div className="composer-actions-right">
          <button
            className="composer-tool"
            type="button"
            aria-label={voiceLabel}
            title={voiceLabel}
            data-active={voiceState === "listening"}
            data-warning={voiceState === "blocked" || voiceState === "unsupported"}
            onClick={handleVoiceToggle}
          >
            {voiceState === "listening" ? <MicOff size={18} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
          </button>
          {disabled && onStopGeneration ? (
            <button className="send-button send-button-stop" type="button" aria-label="Stop response" title="Stop response" onClick={onStopGeneration}>
              <Square size={14} aria-hidden="true" />
            </button>
          ) : (
            <button className="send-button" type="submit" aria-label="Send message" disabled={!canSend}>
              <ArrowUp size={19} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="composer-footer">
        <div className="composer-menu-anchor composer-local-root">
          <button
            className="local-toggle"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={openMenu === "local"}
            data-active={openMenu === "local" || localWorkspace.enabled}
            onClick={() => toggleMenu("local")}
          >
            <HardDrive size={13} aria-hidden="true" />
            <span>{localWorkspace.enabled ? localWorkspaceScopeLabel(localWorkspace.scope) : "Work locally"}</span>
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {openMenu === "local" ? <LocalWorkspacePopover settings={localWorkspace} onChange={onLocalWorkspaceChange} /> : null}
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
              Context {formatTokenCount(contextUsage.totalTokens)} / {formatTokenCount(contextUsage.contextWindowTokens)}
            </span>
            <ChevronDown size={13} aria-hidden="true" />
          </button>
          {openMenu === "context" ? <ContextWindowPopover usage={contextUsage} usagePercent={contextUsagePercent} /> : null}
        </div>
        {voiceState === "blocked" ? <span className="composer-status">Mic permission is blocked</span> : null}
        {voiceState === "unsupported" ? <span className="composer-status">Mic is not available in this preview</span> : null}
        {hasPendingAttachments ? <span className="composer-status">Preparing attachments</span> : null}
        {hasImageAttachment ? <span className="composer-status">Image uploads use Nemotron Omni</span> : null}
        {hasFailedAttachments ? <span className="composer-status composer-status-warning">Remove failed attachments to send</span> : null}
        {disabled ? <span className="composer-status">Generating response</span> : null}
        {webSearch.enabled ? <span className="composer-status composer-status-web">DuckDuckGo web on</span> : null}
        {planMode.enabled ? <span className="composer-status">Plan mode - up to {planMode.maxPasses} passes</span> : null}
        {localWorkspace.enabled ? <span className="composer-status">Local - {formatLocalWorkspaceIndexStatus(localWorkspace)}</span> : null}
      </div>
    </form>
  );
}

function LocalWorkspacePopover({ onChange, settings }: { onChange: (settings: LocalWorkspaceSettings) => void; settings: LocalWorkspaceSettings }) {
  const activeIndexRequestRef = useRef<number | null>(null);
  const indexRequestRef = useRef(0);
  const [drives, setDrives] = useState<ComputerDrive[]>([]);
  const [browserPath, setBrowserPath] = useState(settings.roots[0] ?? "");
  const [dropHovering, setDropHovering] = useState(false);
  const [error, setError] = useState<string | null>(settings.lastError ?? null);
  const [indexProgress, setIndexProgress] = useState<ComputerFileIndexProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [pathDraft, setPathDraft] = useState(settings.roots[0] ?? "");
  const [fullComputerWarningOpen, setFullComputerWarningOpen] = useState(false);

  useEffect(() => {
    let disposed = false;

    async function bootstrap() {
      setLoading(true);
      setError(null);

      try {
        const [driveList, defaultWorkspace] = await Promise.all([listComputerDrives(), getDefaultComputerWorkspace()]);

        if (disposed) {
          return;
        }

        const startPath = settings.roots[0] || defaultWorkspace || driveList[0]?.path || "";
        setDrives(driveList);
        setBrowserPath(startPath);
        setPathDraft(startPath);
      } catch (caughtError) {
        if (!disposed) {
          setError(readErrorMessage(caughtError, "Could not open local computer files."));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
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

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenForComputerFolderDrops(
      (paths) => {
        if (!disposed) {
          void useDroppedPaths(paths);
        }
      },
      (hovering) => {
        if (!disposed) {
          setDropHovering(hovering);
        }
      },
    ).then((nextUnlisten) => {
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
  }, [settings]);

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
      void rebuildIndex(nextSettings, scope === "full-computer" ? "Auto-indexing drives" : "Auto-indexing folder");

      if (scope !== "full-computer" && roots[0]) {
        setBrowserPath(roots[0]);
        setPathDraft(roots[0]);
      }
    } catch (caughtError) {
      setError(readErrorMessage(caughtError, "Could not switch local workspace scope."));
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
      return driveList.map((drive) => drive.path);
    }

    if (scope === "current-folder") {
      const defaultWorkspace = await getDefaultComputerWorkspace();
      return defaultWorkspace ? [defaultWorkspace] : settings.roots;
    }

    return browserPath ? [browserPath] : settings.roots;
  }

  async function openFolderPicker() {
    setError(null);

    try {
      const selectedPath = await pickComputerFolder(browserPath || settings.roots[0]);

      if (!selectedPath) {
        return;
      }

      await useSelectedFolder(selectedPath);
    } catch (caughtError) {
      setError(readErrorMessage(caughtError, "Could not open the folder picker."));
    }
  }

  async function openTypedPath() {
    const nextPath = pathDraft.trim();

    if (!nextPath) {
      return;
    }

    try {
      await useSelectedFolder(nextPath);
    } catch (caughtError) {
      setError(readErrorMessage(caughtError, "Could not open that folder."));
    }
  }

  async function useDroppedPaths(paths: string[]) {
    setDropHovering(false);

    if (paths.length === 0) {
      setError("Drop a folder from your computer, or use Open folder.");
      return;
    }

    for (const path of paths) {
      try {
        await useSelectedFolder(path);
        return;
      } catch {
        const parentPath = parentLocalPath(path);

        if (parentPath && parentPath !== path) {
          try {
            await useSelectedFolder(parentPath);
            return;
          } catch {
            continue;
          }
        }
      }
    }

    setError("That drop did not include a readable folder path. Use Open folder or type the folder path.");
  }

  async function useSelectedFolder(path: string) {
    setLoading(true);
    setError(null);

    try {
      const nextListing = await listComputerDirectory(path, 1);
      setBrowserPath(nextListing.path);
      setPathDraft(nextListing.path);
      const nextSettings: LocalWorkspaceSettings = {
        ...settings,
        enabled: true,
        lastError: undefined,
        roots: [nextListing.path],
        scope: "selected-folder",
      };

      commitSettings(nextSettings);
      void rebuildIndex(nextSettings, "Auto-indexing selected folder");
    } finally {
      setLoading(false);
    }
  }

  async function rebuildIndex(settingsOverride: LocalWorkspaceSettings = settings, reason = "Indexing workspace") {
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

  const selectedRoots = settings.roots.length > 0 ? settings.roots : browserPath ? [browserPath] : [];
  const activeRoot = selectedRoots[0] ?? "";
  const liveIndexProgress = indexing && indexProgress?.requestId === indexRequestRef.current ? indexProgress : null;
  const rootDetail =
    settings.scope === "full-computer"
      ? "Full computer mode is enabled; the file browser stays hidden here."
      : activeRoot || "Choose or drop the project folder to use.";

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

      {fullComputerWarningOpen ? (
        <div className="local-danger-popup" role="alertdialog" aria-label="Full computer access warning">
          <div>
            <HardDrive size={18} aria-hidden="true" />
            <span>
              <strong>Full computer access</strong>
              <small>Gilbert can see all readable drives and index file names, paths, and text previews. This is powerful and can expose private files.</small>
            </span>
          </div>
          <p>Full computer mode stays read-only, but use it only when you really want the whole device visible to the AI.</p>
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

      <div className="local-permission-panel">
        <ShieldCheck size={15} aria-hidden="true" />
        <span>
          <strong>{localPermissionModeLabel(settings.permissionMode)}</strong>
          <small>{permissionModeDetail(settings.permissionMode)}</small>
        </span>
      </div>

      <div className="local-project-panel" aria-label="Project folder in use">
        <FolderOpen size={16} aria-hidden="true" />
        <span>
          <strong>{settings.scope === "full-computer" ? "Full computer scope" : "Project folder in use"}</strong>
          <small>{rootDetail}</small>
        </span>
        {loading ? <LoaderCircle size={15} aria-hidden="true" /> : null}
      </div>

      <div
        className="local-drop-zone"
        data-hovering={dropHovering}
        onDragEnter={(event) => {
          event.preventDefault();
          setDropHovering(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDropHovering(true);
        }}
        onDragLeave={() => setDropHovering(false)}
        onDrop={(event) => {
          event.preventDefault();
          const paths = Array.from(event.dataTransfer.files)
            .map((file) => (file as File & { path?: string }).path || file.webkitRelativePath || file.name)
            .filter(Boolean);
          void registerBrowserDroppedFolders(event.dataTransfer).then((browserPaths) => useDroppedPaths([...browserPaths, ...paths]));
        }}
      >
        <FolderOpen size={16} aria-hidden="true" />
        <span>
          <strong>Drop a folder here</strong>
          <small>Desktop drops use the real folder path.</small>
        </span>
        <button type="button" onClick={() => void openFolderPicker()}>
          Open folder
        </button>
      </div>

      <div className="local-path-row">
        <input
          aria-label="Folder path"
          placeholder="C:\\Users\\You\\Documents"
          value={pathDraft}
          onChange={(event) => setPathDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void openTypedPath();
            }
          }}
        />
        <button type="button" onClick={() => void openTypedPath()}>
          Open
        </button>
      </div>

      <div className="local-index-row">
        <button type="button" disabled={indexing || selectedRoots.length === 0} onClick={() => void rebuildIndex(settings, "Indexing workspace")}>
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

function ContextWindowPopover({ usage, usagePercent }: { usage: ContextWindowUsage; usagePercent: number }) {
  const reservePercent = Math.min(Math.round((usage.maxOutputTokens / usage.contextWindowTokens) * 100), 100);
  const compactPercent = Math.round(AUTO_COMPACT_CONTEXT_THRESHOLD * 100);
  const compactTokenLimit = Math.floor(usage.contextWindowTokens * AUTO_COMPACT_CONTEXT_THRESHOLD);
  const isOpenRouterUsage = usage.tokenSource === "openrouter";

  return (
    <div className="composer-popover composer-popover-context" role="dialog" aria-label="Context window">
      <div className="context-window-header">
        <span>
          <strong>Context window</strong>
          <small>
            {isOpenRouterUsage
              ? "OpenRouter usage from last request"
              : usage.source === "openrouter"
                ? "Estimated full payload against model limit"
                : "Estimated full payload against estimated limit"}
          </small>
        </span>
        <strong>
          {formatTokenCount(usage.totalTokens)} / {formatTokenCount(usage.contextWindowTokens)}
        </strong>
      </div>
      <div className="context-window-meter" aria-hidden="true">
        <span style={{ width: `${usagePercent}%` }} />
        <em style={{ width: `${reservePercent}%` }} />
        <i style={{ left: `${compactPercent}%` }} />
      </div>
      <p className="context-window-note">
        {isOpenRouterUsage
          ? "Prompt and completion use OpenRouter returned usage. Section rows are the app's normalized split of that exact prompt total."
          : "Estimated from the serialized OpenRouter request body plus the response reserve."}{" "}
        Auto compacts at {compactPercent}% ({formatTokenCount(compactTokenLimit)}).
      </p>
      <dl className="context-window-list">
        <div>
          <dt>{isOpenRouterUsage ? "OpenRouter prompt" : "Prompt payload estimate"}</dt>
          <dd>{formatTokenCount(usage.inputTokens)}</dd>
        </div>
        {typeof usage.openRouterCompletionTokens === "number" ? (
          <div>
            <dt>OpenRouter completion</dt>
            <dd>{formatTokenCount(usage.openRouterCompletionTokens)}</dd>
          </div>
        ) : null}
        {typeof usage.openRouterTotalTokens === "number" ? (
          <div>
            <dt>OpenRouter actual total</dt>
            <dd>{formatTokenCount(usage.openRouterTotalTokens)}</dd>
          </div>
        ) : null}
        <div>
          <dt>{isOpenRouterUsage ? "Chat, tools, sources split" : "Chat, tools, sources"}</dt>
          <dd>{formatTokenCount(usage.messageTokens)}</dd>
        </div>
        <div>
          <dt>Draft</dt>
          <dd>{formatTokenCount(usage.draftTokens)}</dd>
        </div>
        <div>
          <dt>{isOpenRouterUsage ? "System, runtime split" : "System, runtime tools"}</dt>
          <dd>{formatTokenCount(usage.systemTokens)}</dd>
        </div>
        <div>
          <dt>{isOpenRouterUsage ? "OpenRouter envelope split" : "OpenRouter envelope"}</dt>
          <dd>{formatTokenCount(usage.requestOverheadTokens)}</dd>
        </div>
        <div>
          <dt>Response reserve</dt>
          <dd>{formatTokenCount(usage.maxOutputTokens)}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{formatTokenCount(usage.availableTokens)}</dd>
        </div>
      </dl>
    </div>
  );
}

function reviewModeFromPermissionMode(permissionMode: LocalPermissionMode) {
  const reviewModeId = permissionMode === "ask-first" ? "guard" : permissionMode === "full-workspace" ? "full" : "review";
  return reviewModes.find((mode) => mode.id === reviewModeId) ?? reviewModes[1];
}

function permissionModeFromReviewMode(reviewModeId: ReviewMode["id"]): LocalPermissionMode {
  if (reviewModeId === "guard") {
    return "ask-first";
  }

  if (reviewModeId === "full") {
    return "full-workspace";
  }

  return "gilbert-review";
}

function permissionModeDetail(permissionMode: LocalPermissionMode) {
  if (permissionMode === "ask-first") {
    return "Every edit needs your confirmation.";
  }

  if (permissionMode === "full-workspace") {
    return "All available drives can be visible.";
  }

  return "Free inside the selected folder.";
}

function joinLocalPath(root: string, child: string) {
  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function parentLocalPath(path: string) {
  const normalized = path.trim().replace(/[\\/]+$/, "");
  const lastBackslash = normalized.lastIndexOf("\\");
  const lastSlash = normalized.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);

  return index > 0 ? normalized.slice(0, index) : "";
}

function createIndexProgressFromRoots(requestId: number, roots: string[]): ComputerFileIndexProgress {
  return {
    done: false,
    entryCount: 0,
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
  const skipped = progress.skippedEntries > 0 ? `, ${formatCompactCount(progress.skippedEntries)} skipped` : "";
  const cap = progress.truncated ? ", capped" : "";
  return `${entries} items, ${folders} folders${skipped}${cap}`;
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
