import { Fragment, useEffect, useRef } from "react";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageAttachments } from "./MessageAttachments";
import { MessageActions } from "./MessageActions";
import { MessageBlock } from "./MessageBlock";
import { PlanReviewCard } from "./PlanReviewCard";
import { ThinkingDisclosure } from "../thinking/ThinkingDisclosure";
import type { AppInfo } from "../../types/app";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatContextCompaction, ChatMessageSource, ChatSummary } from "../../types/chat";

const INLINE_THINKING_TAGS = "think|thinking|thought|reasoning";
const INLINE_THINKING_BLOCK_PATTERN = new RegExp(`<(${INLINE_THINKING_TAGS})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
const INLINE_THINKING_OPEN_PATTERN = new RegExp(`<(${INLINE_THINKING_TAGS})\\b[^>]*>`, "i");
const INLINE_THINKING_CLOSE_PATTERN = new RegExp(`<\\/(${INLINE_THINKING_TAGS})>`, "gi");
const INTERNAL_ASSISTANT_STATUS_MESSAGES = new Set([
  "Reading tool results...",
  "Using agent tools...",
  "Writing final answer from local tool results...",
]);

interface ChatThreadProps {
  appInfo: AppInfo;
  chat: ChatSummary;
  hasApiKey: boolean;
  onHeaderBlurChange?: (active: boolean) => void;
  onOpenActivity?: () => void;
  onRequestPlanRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onStopGeneration?: (messageId: string) => void;
}

export function ChatThread({ appInfo, chat, hasApiKey, onHeaderBlurChange, onOpenActivity, onRequestPlanRevision, onRegenerateResponse, onResolveToolApproval, onStopGeneration }: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const headerBlurActiveRef = useRef(false);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const scrollAnchorMessage = getScrollAnchorMessage(chat);
  const streamMarker = scrollAnchorMessage
    ? `${chat.messages.length}:${scrollAnchorMessage.id}:${scrollAnchorMessage.content.length}:${scrollAnchorMessage.reasoning?.length ?? 0}:${scrollAnchorMessage.isStreaming ? "1" : "0"}`
    : `empty:${chat.messages.length}`;

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
          <MarkdownMessage content={hasApiKey ? `${appInfo.name} is ready.` : "Add a provider API key in Settings, then send a message to start testing."} />
        </MessageBlock>
      </div>
    );
  }

  return (
    <div ref={threadRef} className="chat-thread" onScroll={handleThreadScroll}>
      {chat.messages.map((message, messageIndex) => {
        if (message.status === "queued") {
          return null;
        }

        const displayMessage = message.role === "assistant" ? separateDisplayThinking(message.content, message.reasoning) : { content: message.content, reasoning: message.reasoning };
        const hasVisibleContent = displayMessage.content.trim().length > 0;
        const hasVisibleAttachment = Boolean(message.attachments?.length);
        const hasThinkingIndicator = message.role === "assistant" && Boolean(message.thinking || displayMessage.reasoning?.trim());
        const showPlanReview = shouldShowPlanReviewCard(message);

        if (message.role === "assistant" && !hasVisibleContent && !hasVisibleAttachment && !hasThinkingIndicator && !showPlanReview) {
          return null;
        }

        const actionMessage = message.role === "assistant" ? { ...message, content: displayMessage.content } : message;

        return (
          <Fragment key={message.id}>
            {message.contextCompactions?.map((compaction) => (
              <ContextCompactionDivider key={`${message.id}-${compaction.compactedAt}`} compaction={compaction} />
            ))}
            <MessageBlock role={message.role} status={message.status} isStreaming={message.isStreaming}>
              {hasThinkingIndicator ? (
                <ThinkingDisclosure
                  activityMode={message.mode === "plan" || message.planning ? "planning" : "thinking"}
                  completedAt={message.thinking?.completedAt}
                  content={displayMessage.reasoning}
                  isPrivate
                  isThinking={Boolean(message.thinking && !message.thinking.completedAt)}
                  onOpenActivity={onOpenActivity}
                  startedAt={message.thinking?.startedAt}
                />
              ) : null}
              <MessageAttachments attachments={message.attachments} />
              {message.role === "user" && message.source?.kind === "discord" ? <DiscordMessageSource source={message.source} /> : null}
              {showPlanReview ? (
                <PlanReviewCard
                  content={displayMessage.content}
                  isStreaming={message.isStreaming}
                  message={actionMessage}
                  onOpenActivity={onOpenActivity}
                  onRequestRevision={onRequestPlanRevision}
                  onResolvePlanApproval={onResolveToolApproval}
                />
              ) : displayMessage.content.trim() || message.isStreaming ? (
                <MarkdownMessage content={displayMessage.content} isStreaming={message.isStreaming} />
              ) : null}
              <MessageActions
                canRegenerate={canRegenerateMessage(chat, messageIndex)}
                message={actionMessage}
                onRegenerateResponse={onRegenerateResponse}
                onStopGeneration={onStopGeneration}
              />
            </MessageBlock>
          </Fragment>
        );
      })}
    </div>
  );
}

function DiscordMessageSource({ source }: { source: ChatMessageSource }) {
  const title = [source.guildId ? `Guild ${source.guildId}` : "", source.channelId ? `Channel ${source.channelId}` : "", source.userId ? `User ${source.userId}` : ""].filter(Boolean).join(" | ");
  const command = source.commandName ? `/${source.commandName}` : "slash command";

  return (
    <div className="message-source-strip" title={title || "Discord"}>
      <span className="message-source-dot" aria-hidden="true" />
      <strong>Discord</strong>
      <small>
        {command}
        {source.username ? ` from ${source.username}` : ""}
      </small>
    </div>
  );
}

function shouldShowPlanReviewCard(message: ChatSummary["messages"][number]) {
  if (message.role !== "assistant" || !(message.mode === "plan" || message.planning)) {
    return false;
  }

  const hasPendingPlanningApproval = message.approvals?.some((approval) => approval.tool === "planning_handoff" && approval.status === "pending");
  const hasAcceptedPlanningApproval = message.approvals?.some((approval) => approval.tool === "planning_handoff" && (approval.status === "approved" || approval.status === "edited"));
  const isPlanningOnly = !message.toolCalls?.length && !message.artifacts?.length;

  return Boolean((message.isStreaming && isPlanningOnly) || hasPendingPlanningApproval || (isPlanningOnly && message.planning && !hasAcceptedPlanningApproval && message.agentRunStatus !== "completed"));
}

function ContextCompactionDivider({ compaction }: { compaction: ChatContextCompaction }) {
  const detail = `${formatCompactTokenCount(compaction.beforeTokens)} -> ${formatCompactTokenCount(compaction.afterTokens)}`;

  return (
    <div className="context-compaction-divider" title={`${detail}, ${compaction.compactedMessageCount} older messages compacted`}>
      <span>Automatically compacting context</span>
    </div>
  );
}

function formatCompactTokenCount(tokens: number) {
  if (tokens >= 1000) {
    return `${Number((tokens / 1000).toFixed(tokens >= 100000 ? 0 : 1))}k`;
  }

  return String(tokens);
}

function separateDisplayThinking(content: string, existingReasoning?: string) {
  const reasoningParts: string[] = [];
  let visibleContent = content.replace(INLINE_THINKING_BLOCK_PATTERN, (_match, _tag: string, thinking: string) => {
    reasoningParts.push(thinking);
    return "";
  });
  const openThinkingMatch = INLINE_THINKING_OPEN_PATTERN.exec(visibleContent);

  if (openThinkingMatch && typeof openThinkingMatch.index === "number") {
    const openThinkingIndex = openThinkingMatch.index;
    const beforeThinking = visibleContent.slice(0, openThinkingIndex);
    const afterThinking = visibleContent.slice(openThinkingIndex + openThinkingMatch[0].length);

    reasoningParts.push(afterThinking.replace(INLINE_THINKING_CLOSE_PATTERN, ""));
    visibleContent = beforeThinking;
  }

  const inlineReasoning = reasoningParts.join("").trim();

  return {
    content: removeInternalAssistantStatusMessage(visibleContent.replace(INLINE_THINKING_CLOSE_PATTERN, "").trimStart()),
    reasoning: [existingReasoning, inlineReasoning].filter(Boolean).join("\n\n"),
  };
}

function removeInternalAssistantStatusMessage(content: string) {
  return INTERNAL_ASSISTANT_STATUS_MESSAGES.has(content.trim()) ? "" : content;
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
