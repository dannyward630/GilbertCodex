import { useEffect, useRef } from "react";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageAttachments } from "./MessageAttachments";
import { MessageActions } from "./MessageActions";
import { MessageBlock } from "./MessageBlock";
import { ThinkingDisclosure } from "../thinking/ThinkingDisclosure";
import type { AppInfo } from "../../types/app";
import type { ChatSummary } from "../../types/chat";

interface ChatThreadProps {
  appInfo: AppInfo;
  chat: ChatSummary;
  hasApiKey: boolean;
  onHeaderBlurChange?: (active: boolean) => void;
  onOpenActivity?: () => void;
}

export function ChatThread({ appInfo, chat, hasApiKey, onHeaderBlurChange, onOpenActivity }: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const headerBlurActiveRef = useRef(false);
  const programmaticScrollRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const streamMarker = chat.messages
    .map((message) => `${message.id}:${message.content.length}:${message.reasoning?.length ?? 0}:${message.isStreaming ? "1" : "0"}`)
    .join("|");

  useEffect(() => {
    shouldStickToBottomRef.current = true;
    setHeaderBlurActive(false);
    scrollToThreadBottom();
  }, [chat.id]);

  useEffect(() => {
    if (!shouldStickToBottomRef.current) {
      return;
    }

    scrollToThreadBottom();
  }, [streamMarker]);

  function scrollToThreadBottom() {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    programmaticScrollRef.current = true;
    thread.scrollTo({ top: thread.scrollHeight });
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }

  function setHeaderBlurActive(active: boolean) {
    if (active === headerBlurActiveRef.current) {
      return;
    }

    headerBlurActiveRef.current = active;
    onHeaderBlurChange?.(active);
  }

  function handleThreadScroll() {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom < 96;

    if (!programmaticScrollRef.current) {
      const hasScrollableContent = thread.scrollHeight - thread.clientHeight > 8;
      setHeaderBlurActive(hasScrollableContent && thread.scrollTop > 8);
    }
  }

  if (chat.messages.length === 0) {
    return (
      <div ref={threadRef} className="chat-thread" onScroll={handleThreadScroll}>
        <MessageBlock role="assistant">
          <MarkdownMessage content={hasApiKey ? `${appInfo.name} is ready.` : "Add your OpenRouter API key in Settings, then send a message to start testing."} />
        </MessageBlock>
      </div>
    );
  }

  return (
    <div ref={threadRef} className="chat-thread" onScroll={handleThreadScroll}>
      {chat.messages.map((message) => (
        <MessageBlock key={message.id} role={message.role} status={message.status} isStreaming={message.isStreaming}>
          {message.role === "assistant" ? (
            <ThinkingDisclosure
              completedAt={message.thinking?.completedAt}
              content={message.reasoning}
              isPrivate={Boolean(message.thinking && !message.reasoning && !message.isStreaming)}
              isThinking={Boolean(message.thinking && !message.thinking.completedAt)}
              onOpenActivity={onOpenActivity}
              startedAt={message.thinking?.startedAt}
            />
          ) : null}
          <MessageAttachments attachments={message.attachments} />
          {message.content.trim() || message.isStreaming ? <MarkdownMessage content={message.content} isStreaming={message.isStreaming} /> : null}
          <MessageActions message={message} />
        </MessageBlock>
      ))}
    </div>
  );
}
