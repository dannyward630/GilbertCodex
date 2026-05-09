import { useEffect, useRef, useState } from "react";
import { Check, Clock3, Copy, MoreHorizontal } from "lucide-react";
import { copyTextToClipboard } from "../../lib/clipboard";
import type { ChatMessage } from "../../types/chat";

interface MessageActionsProps {
  message: ChatMessage;
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

export function MessageActions({ message }: MessageActionsProps) {
  const actionRef = useRef<HTMLDivElement | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const timeLabel = formatMessageTime(message.createdAt);
  const fullTimeLabel = formatMessageDateTime(message.createdAt);
  const copyDisabled = !message.content.trim();

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

    const didCopy = await copyTextToClipboard(message.content);

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

  return (
    <div className="message-meta" ref={actionRef}>
      {timeLabel ? (
        <time dateTime={message.createdAt} title={fullTimeLabel}>
          {timeLabel}
        </time>
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
