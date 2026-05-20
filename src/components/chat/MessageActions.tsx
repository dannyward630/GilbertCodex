import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Pencil, SquareArrowUpRight, ThumbsDown, ThumbsUp } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import { normalizeMarkdownForDisplay } from "../../lib/markdown";
import { stripVisibleToolProtocol } from "../../lib/visibleToolProtocol";
import type { ChatMessage } from "../../types/chat";

interface MessageActionsProps {
  message: ChatMessage;
  onEditMessage?: (messageId: string) => void;
  onForkFromMessage?: (messageId: string) => void | Promise<void>;
  onMessageFeedback?: (messageId: string, feedback: ChatMessage["feedback"]) => void;
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

export function MessageActions({ message, onEditMessage, onForkFromMessage, onMessageFeedback }: MessageActionsProps) {
  const copiedTimerRef = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const timeLabel = useMemo(() => formatMessageTime(message.createdAt), [message.createdAt]);
  const fullTimeLabel = useMemo(() => formatMessageDateTime(message.createdAt), [message.createdAt]);
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
