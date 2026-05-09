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
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
  onStopGeneration?: () => void;
}

export function ChatThread({ appInfo, chat, hasApiKey, onHeaderBlurChange, onOpenActivity, onRegenerateResponse, onStopGeneration }: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const headerBlurActiveRef = useRef(false);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const scrollAnchorMessage = getScrollAnchorMessage(chat);
  const streamMarker = scrollAnchorMessage
    ? `${scrollAnchorMessage.id}:${scrollAnchorMessage.content.length}:${scrollAnchorMessage.reasoning?.length ?? 0}:${scrollAnchorMessage.isStreaming ? "1" : "0"}`
    : "empty";

  useEffect(() => {
    return () => {
      if (scrollFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollFrameRef.current);
      }

      if (programmaticScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(programmaticScrollFrameRef.current);
      }
    };
  }, []);

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
    if (scrollFrameRef.current !== null) {
      return;
    }

    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      flushScrollToThreadBottom();
    });
  }

  function flushScrollToThreadBottom() {
    const thread = threadRef.current;

    if (!thread) {
      return;
    }

    programmaticScrollRef.current = true;
    thread.scrollTo({ top: thread.scrollHeight });

    if (programmaticScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(programmaticScrollFrameRef.current);
    }

    programmaticScrollFrameRef.current = window.requestAnimationFrame(() => {
      programmaticScrollFrameRef.current = null;
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
      {chat.messages.map((message, messageIndex) => {
        const isPlanningMessage = message.role === "assistant" && (message.mode === "plan" || Boolean(message.planning));
        const hasVisibleContent = message.content.trim().length > 0;

        if (isPlanningMessage && !hasVisibleContent) {
          return null;
        }

        return (
          <MessageBlock key={message.id} role={message.role} status={message.status} isStreaming={message.isStreaming}>
            {message.role === "assistant" && !isPlanningMessage ? (
              <ThinkingDisclosure
                activityMode={message.mode === "plan" || message.planning ? "planning" : "thinking"}
                completedAt={message.thinking?.completedAt}
                content={message.reasoning}
                isPrivate={false}
                isThinking={Boolean(message.thinking && !message.thinking.completedAt)}
                onOpenActivity={onOpenActivity}
                progressLabel={formatPlanningProgressLabel(message.planning?.passCount, message.planning?.maxPasses)}
                startedAt={message.thinking?.startedAt}
              />
            ) : null}
            <MessageAttachments attachments={message.attachments} />
            {message.content.trim() || message.isStreaming ? <MarkdownMessage content={message.content} isStreaming={message.isStreaming} /> : null}
            <MessageActions
              canRegenerate={canRegenerateMessage(chat, messageIndex)}
              message={message}
              onRegenerateResponse={onRegenerateResponse}
              onStopGeneration={onStopGeneration}
            />
          </MessageBlock>
        );
      })}
    </div>
  );
}

function getScrollAnchorMessage(chat: ChatSummary) {
  for (let index = chat.messages.length - 1; index >= 0; index -= 1) {
    const message = chat.messages[index];

    if (message?.isStreaming) {
      return message;
    }
  }

  return chat.messages[chat.messages.length - 1];
}

function canRegenerateMessage(chat: ChatSummary, messageIndex: number) {
  const message = chat.messages[messageIndex];

  if (!message || message.role !== "assistant" || message.isStreaming) {
    return false;
  }

  if (message.planning?.inputRequest && !message.planning.inputRequest.answeredAt) {
    return false;
  }

  return chat.messages.slice(0, messageIndex).some((candidate) => candidate.role === "user");
}

function formatPlanningProgressLabel(passCount?: number, maxPasses?: number) {
  if (!maxPasses) {
    return undefined;
  }

  return `Pass ${Math.max(passCount ?? 0, 1)} of ${maxPasses}`;
}
