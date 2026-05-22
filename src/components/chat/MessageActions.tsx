import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Pencil, RotateCcw, SquareArrowUpRight, ThumbsDown, ThumbsUp } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { formatDeviceMessageDateTime, formatDeviceMessageTime } from "../../lib/localDateTime";
import { normalizeMarkdownForDisplay } from "../../lib/markdown";
import { stripVisibleToolProtocol } from "../../lib/visibleToolProtocol";
import type { ChatMessage } from "../../types/chat";

interface MessageActionsProps {
  message: ChatMessage;
  onEditMessage?: (messageId: string) => void;
  onForkFromMessage?: (messageId: string) => void | Promise<void>;
  onMessageFeedback?: (messageId: string, feedback: ChatMessage["feedback"]) => void;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
}

function formatStreamTimingTitle(message: ChatMessage) {
  const timing = message.streamTiming;
  const timestamp = formatDeviceMessageDateTime(message.createdAt);

  if (!timing || message.role !== "assistant") {
    return timestamp;
  }

  const details = [
    timing.timeToFirstVisibleTokenMs !== undefined
      ? `first visible token ${formatDurationMs(timing.timeToFirstVisibleTokenMs)}`
      : timing.timeToFirstTokenMs !== undefined
        ? `first token ${formatDurationMs(timing.timeToFirstTokenMs)}`
        : "",
    timing.timeToFirstByteMs !== undefined ? `first byte ${formatDurationMs(timing.timeToFirstByteMs)}` : "",
    timing.totalMs !== undefined ? `total ${formatDurationMs(timing.totalMs)}` : "",
  ].filter(Boolean);

  return [timestamp, details.join(", ")].filter(Boolean).join(" - ");
}

function formatDurationMs(value: number) {
  if (value >= 10_000) {
    return `${(value / 1000).toFixed(1)}s`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }

  return `${Math.round(value)}ms`;
}

export function MessageActions({ message, onEditMessage, onForkFromMessage, onMessageFeedback, onRegenerateResponse }: MessageActionsProps) {
  const copiedTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const timeLabel = useMemo(() => formatDeviceMessageTime(message.createdAt), [message.createdAt]);
  const fullTimeLabel = useMemo(() => formatStreamTimingTitle(message), [message]);
  const copyContent = useMemo(
    () => message.role === "assistant"
      ? normalizeMarkdownForDisplay(stripVisibleToolProtocol(message.content), { final: !message.isStreaming })
      : message.content,
    [message.content, message.isStreaming, message.role],
  );
  const copyDisabled = !copyContent.trim();
  const showEdit = Boolean(onEditMessage && message.role === "user");
  const showAssistantFeedback = Boolean(onMessageFeedback && message.role === "assistant" && !message.isStreaming && message.status !== "queued");
  const showFork = Boolean(onForkFromMessage && message.role === "assistant" && !message.isStreaming && message.status !== "queued");
  const showRegenerate = Boolean(onRegenerateResponse && message.role === "assistant" && !message.isStreaming && message.status !== "queued");
  const statusLabel = message.status === "queued" ? "Queued" : null;

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

    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }

    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1400);
  }

  function editMessage() {
    if (!showEdit || !onEditMessage) {
      return;
    }

    onEditMessage(message.id);
  }

  function toggleFeedback(feedback: ChatMessage["feedback"]) {
    if (!showAssistantFeedback || !onMessageFeedback) {
      return;
    }

    onMessageFeedback(message.id, feedback);
  }

  function forkFromMessage() {
    if (!showFork || !onForkFromMessage) {
      return;
    }

    void onForkFromMessage(message.id);
  }

  function regenerateResponse() {
    if (!showRegenerate || !onRegenerateResponse) {
      return;
    }

    void onRegenerateResponse(message.id);
  }

  return (
    <div className="message-meta">
      {showEdit ? (
        <button className="message-action" type="button" aria-label="Edit message" title="Edit message" onClick={editMessage}>
          <Pencil size={14} aria-hidden="true" />
        </button>
      ) : null}
      <button className="message-action" type="button" aria-label={copied ? "Message copied" : "Copy message"} title={copied ? "Message copied" : "Copy message"} disabled={copyDisabled} onClick={copyMessage}>
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
      {showAssistantFeedback ? (
        <>
          <button className="message-action" type="button" aria-label="Like response" aria-pressed={message.feedback === "liked"} title="Like response" data-active={message.feedback === "liked"} onClick={() => toggleFeedback("liked")}>
            <ThumbsUp size={14} aria-hidden="true" />
          </button>
          <button className="message-action" type="button" aria-label="Dislike response" aria-pressed={message.feedback === "disliked"} title="Dislike response" data-active={message.feedback === "disliked"} onClick={() => toggleFeedback("disliked")}>
            <ThumbsDown size={14} aria-hidden="true" />
          </button>
        </>
      ) : null}
      {showRegenerate ? (
        <button className="message-action" type="button" aria-label="Regenerate response" title="Regenerate response" onClick={regenerateResponse}>
          <RotateCcw size={14} aria-hidden="true" />
        </button>
      ) : null}
      {showFork ? (
        <button className="message-action" type="button" aria-label="Branch in a new chat" title="Branch in a new chat" onClick={forkFromMessage}>
          <SquareArrowUpRight size={14} aria-hidden="true" />
        </button>
      ) : null}
      {statusLabel ? <span className="message-state">{statusLabel}</span> : null}
      {timeLabel ? (
        <time dateTime={message.createdAt} title={fullTimeLabel}>
          {timeLabel}
        </time>
      ) : null}
    </div>
  );
}
