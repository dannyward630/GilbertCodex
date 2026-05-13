import { useEffect, useRef, useState } from "react";
import { Check, Clock3, Copy, MoreHorizontal, RefreshCcw, Square } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { isInterruptedAssistantMessage } from "../../app/chatRuntime";
import type { ChatMessage } from "../../types/chat";

interface MessageActionsProps {
  canRegenerate?: boolean;
  message: ChatMessage;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
  onStopGeneration?: (messageId: string) => void;
}

function formatMessageTime(createdAt: string) {
  const timestamp = Date.parse(createdAt);

  if (Number.isNaN(timestamp)) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatMessageDateTime(createdAt: string) {
  const timestamp = Date.parse(createdAt);

  if (Number.isNaN(timestamp)) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function MessageActions({ canRegenerate, message, onRegenerateResponse, onStopGeneration }: MessageActionsProps) {
  const actionRef = useRef<HTMLDivElement | null>(null);
  const copiedTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const timeLabel = formatMessageTime(message.createdAt);
  const fullTimeLabel = formatMessageDateTime(message.createdAt);
  const copyContent = [message.responseThinking, message.content].filter((part) => part?.trim()).join("\n\n");
  const copyDisabled = !copyContent.trim();
  const showRegenerate = Boolean(canRegenerate && onRegenerateResponse && message.role === "assistant" && !message.isStreaming);
  const regenerateLabel = isInterruptedAssistantMessage(message) ? "Continue response" : "Regenerate response";
  const showStop = Boolean(onStopGeneration && message.role === "assistant" && message.isStreaming);
  const statusLabel = message.status === "queued" ? "Queued" : null;

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!actionRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    if (menuOpen) {
      document.addEventListener("pointerdown", handlePointerDown);
    }

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  async function copyMessage() {
    if (copyDisabled) {
      return;
    }

    const didCopy = await copyTextToClipboard(copyContent);

    if (!didCopy) {
      return;
    }

    setCopied(true);
    setMenuOpen(false);

    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }

    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1400);
  }

  async function copyTimestamp() {
    if (!fullTimeLabel) {
      return;
    }

    await copyTextToClipboard(fullTimeLabel);
    setMenuOpen(false);
  }

  function regenerateResponse() {
    if (!showRegenerate || !onRegenerateResponse) {
      return;
    }

    setMenuOpen(false);
    void onRegenerateResponse(message.id);
  }

  function stopGeneration() {
    if (!showStop || !onStopGeneration) {
      return;
    }

    setMenuOpen(false);
    onStopGeneration(message.id);
  }

  return (
    <div className="message-meta" ref={actionRef}>
      {timeLabel ? (
        <time dateTime={message.createdAt} title={fullTimeLabel}>
          {timeLabel}
        </time>
      ) : null}
      {statusLabel ? <span className="message-state">{statusLabel}</span> : null}
      {showStop ? (
        <button className="message-action" type="button" aria-label="Stop response" title="Stop response" onClick={stopGeneration}>
          <Square size={12} aria-hidden="true" />
        </button>
      ) : null}
      {showRegenerate ? (
        <button className="message-action" type="button" aria-label={regenerateLabel} title={regenerateLabel} onClick={regenerateResponse}>
          <RefreshCcw size={14} aria-hidden="true" />
        </button>
      ) : null}
      <button className="message-action" type="button" aria-label={copied ? "Message copied" : "Copy message"} title={copied ? "Message copied" : "Copy message"} disabled={copyDisabled} onClick={copyMessage}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      <div className="message-more">
        <button
          className="message-action"
          type="button"
          aria-label="More message actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={15} aria-hidden="true" />
        </button>
        {menuOpen ? (
          <div className="message-action-menu" role="menu">
            {showStop ? (
              <button type="button" role="menuitem" onClick={stopGeneration}>
                <Square size={12} aria-hidden="true" />
                <span>Stop response</span>
              </button>
            ) : null}
            {showRegenerate ? (
              <button type="button" role="menuitem" onClick={regenerateResponse}>
                <RefreshCcw size={14} aria-hidden="true" />
                <span>{regenerateLabel}</span>
              </button>
            ) : null}
            <button type="button" role="menuitem" disabled={copyDisabled} onClick={copyMessage}>
              <Copy size={14} aria-hidden="true" />
              <span>Copy text</span>
            </button>
            <button type="button" role="menuitem" onClick={copyTimestamp}>
              <Clock3 size={14} aria-hidden="true" />
              <span>Copy time</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
