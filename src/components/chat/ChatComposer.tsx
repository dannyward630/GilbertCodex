import { type ChangeEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  FileUp,
  Hand,
  Image as ImageIcon,
  LoaderCircle,
  Mic,
  MicOff,
  Plus,
  Shield,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ThinkingModeControls } from "../thinking/ThinkingModeControls";
import { createChatAttachmentFromFile, formatAttachmentSize, isImageAttachment } from "../../lib/chatAttachments";
import { DEFAULT_CHAT_MODEL, IMAGE_REASONING_MODEL } from "../../lib/models";
import type { ChatAttachment, ChatSendInput } from "../../types/chat";
import type { ThinkingSettings } from "../../types/settings";

type ComposerMenu = "attach" | "review" | "model" | null;
type VoiceState = "idle" | "listening" | "blocked" | "unsupported";

interface ChatComposerProps {
  disabled: boolean;
  model: string;
  onHeightChange?: (height: number) => void;
  onModelChange: (model: string) => void;
  onSubmit: (input: ChatSendInput) => void | Promise<void>;
  onThinkingChange: (thinking: ThinkingSettings) => void;
  thinking: ThinkingSettings;
}

interface ReviewMode {
  id: "guard" | "review" | "full";
  label: string;
  detail: string;
  icon: LucideIcon;
}

interface ModelOption {
  id: string;
  label: string;
  detail: string;
  value: string;
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

const modelOptions: ModelOption[] = [
  {
    id: "ring-free",
    label: "Ring 2.6 1T",
    detail: "Free reasoning route on OpenRouter.",
    value: DEFAULT_CHAT_MODEL,
  },
  {
    id: "nemotron-omni",
    label: "Nemotron Omni",
    detail: "Auto-routes image uploads in the background.",
    value: IMAGE_REASONING_MODEL,
  },
];

function modelFromValue(modelValue: string): ModelOption {
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

export function ChatComposer({ disabled, model, onHeightChange, onModelChange, onSubmit, onThinkingChange, thinking }: ChatComposerProps) {
  const composerRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const voiceRequestRef = useRef(0);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const [message, setMessage] = useState("");
  const [openMenu, setOpenMenu] = useState<ComposerMenu>(null);
  const [planMode, setPlanMode] = useState(false);
  const [reviewMode, setReviewMode] = useState<ReviewMode>(reviewModes[1]);
  const [attachments, setAttachments] = useState<ComposerAttachmentDraft[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const readyAttachments = attachments.flatMap((attachment) => (attachment.attachment ? [attachment.attachment] : []));
  const hasImageAttachment = readyAttachments.some(isImageAttachment);
  const hasPendingAttachments = attachments.some((attachment) => attachment.status === "loading");
  const hasFailedAttachments = attachments.some((attachment) => attachment.status === "error");
  const canSend = (Boolean(message.trim()) || readyAttachments.length > 0) && !disabled && !hasPendingAttachments && !hasFailedAttachments;
  const selectedModel = modelFromValue(model);
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

  function toggleMenu(menu: Exclude<ComposerMenu, null>) {
    setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
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
          placeholder={voiceState === "listening" ? "Listening... speak when ready" : "Ask Gilbert Codex to build, inspect, or change this project"}
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
                <button className="composer-menu-item" type="button" role="menuitem" onClick={() => setPlanMode((current) => !current)}>
                  <Wand2 size={18} aria-hidden="true" />
                  <span>Plan mode</span>
                  <span className="composer-switch" data-on={planMode}>
                    <span />
                  </span>
                </button>
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
                      onClick={() => {
                        setReviewMode(mode);
                        setOpenMenu(null);
                      }}
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
                        <small>{option.detail}</small>
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
          <button className="send-button" type="submit" aria-label="Send message" disabled={!canSend}>
            <ArrowUp size={19} aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="composer-footer">
        <button className="local-toggle" type="button" disabled>
          Work locally
          <ChevronDown size={14} aria-hidden="true" />
        </button>
        {voiceState === "blocked" ? <span className="composer-status">Mic permission is blocked</span> : null}
        {voiceState === "unsupported" ? <span className="composer-status">Mic is not available in this preview</span> : null}
        {hasPendingAttachments ? <span className="composer-status">Preparing attachments</span> : null}
        {hasImageAttachment ? <span className="composer-status">Image uploads use Nemotron Omni</span> : null}
        {hasFailedAttachments ? <span className="composer-status composer-status-warning">Remove failed attachments to send</span> : null}
        {planMode ? <span className="composer-status">Plan mode on</span> : null}
      </div>
    </form>
  );
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
