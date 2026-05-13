import { Fragment, useEffect, useRef } from "react";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageArtifacts, MessageAttachments, OpenableImage } from "./MessageAttachments";
import { MessageActions } from "./MessageActions";
import { MessageBlock } from "./MessageBlock";
import { PlanReviewCard } from "./PlanReviewCard";
import { ThinkingDisclosure } from "../thinking/ThinkingDisclosure";
import { isInterruptedAssistantMessage } from "../../app/chatRuntime";
import type { AppInfo } from "../../types/app";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatContextCompaction, ChatMessage, ChatMessageSource, ChatSource, ChatSummary } from "../../types/chat";

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
        const hasVisibleArtifact = Boolean(message.artifacts?.length);
        const activity = message.role === "assistant" ? getAssistantActivity(message) : null;
        const hasThinkingIndicator = message.role === "assistant" && Boolean(message.thinking || displayMessage.reasoning?.trim() || activity);
        const showPlanReview = shouldShowPlanReviewCard(message);

        if (message.role === "assistant" && !hasVisibleContent && !hasVisibleAttachment && !hasVisibleArtifact && !hasThinkingIndicator && !showPlanReview) {
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
                  isThinking={Boolean(message.isStreaming || (message.thinking && !message.thinking.completedAt) || activity?.active)}
                  liveDetail={activity?.detail}
                  onOpenActivity={onOpenActivity}
                  progressLabel={activity?.label}
                  startedAt={message.thinking?.startedAt}
                />
              ) : null}
              <MessageAttachments attachments={message.attachments} />
              <MessageArtifacts artifacts={message.artifacts} />
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
              {shouldShowWebImageSources(message) ? <WebImageSources sources={message.sources ?? []} /> : null}
              <MessageActions
                canRegenerate={canRegenerateMessage(chat, messageIndex)}
                message={actionMessage}
                onRegenerateResponse={onRegenerateResponse}
                onStopGeneration={onStopGeneration}
              />
              {message.role === "assistant" && !message.isStreaming && isInterruptedAssistantMessage(message) && canRegenerateMessage(chat, messageIndex) ? (
                <ResponseRecoveryActions messageId={message.id} onOpenActivity={onOpenActivity} onRegenerateResponse={onRegenerateResponse} />
              ) : null}
            </MessageBlock>
          </Fragment>
        );
      })}
    </div>
  );
}

function WebImageSources({ sources }: { sources: ChatSource[] }) {
  const imageSources = sources.filter((source) => source.sourceType === "image" && (source.thumbnailUrl || source.imageUrl)).slice(0, 6);

  if (imageSources.length === 0) {
    return null;
  }

  return (
    <div className="web-image-strip" aria-label="Web image results">
      {imageSources.map((source) => (
        <div className="web-image-card" key={source.id ?? source.url}>
          <OpenableImage alt={source.title} caption={source.detail ?? source.title} className="web-image-button" src={source.thumbnailUrl || source.imageUrl || source.url} />
          <a href={source.url} rel="noreferrer" target="_blank">{source.title}</a>
        </div>
      ))}
    </div>
  );
}

function shouldShowWebImageSources(message: ChatMessage) {
  return (
    message.role === "assistant" &&
    message.webSearch?.enabled &&
    message.webSearch.status === "complete" &&
    message.mode !== "plan" &&
    !message.toolCalls?.length &&
    Boolean(message.sources?.some((source) => source.sourceType === "image" && (source.thumbnailUrl || source.imageUrl)))
  );
}

function ResponseRecoveryActions({
  messageId,
  onOpenActivity,
  onRegenerateResponse,
}: {
  messageId: string;
  onOpenActivity?: () => void;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
}) {
  return (
    <div className="response-recovery-actions">
      <button type="button" onClick={() => void onRegenerateResponse?.(messageId)}>
        Continue response
      </button>
      {onOpenActivity ? (
        <button type="button" onClick={onOpenActivity}>
          Open activity
        </button>
      ) : null}
    </div>
  );
}

function getAssistantActivity(message: ChatMessage) {
  const activeProgress = [...(message.progress ?? [])].reverse().find((item) => item.status === "active");
  const activeTool = [...(message.toolCalls ?? [])].reverse().find((toolCall) => toolCall.status === "active");
  const waitingTool = [...(message.toolCalls ?? [])].reverse().find((toolCall) => toolCall.status === "waiting_approval");
  const toolCount = message.toolCalls?.length ?? 0;
  const completeTools = message.toolCalls?.filter((toolCall) => toolCall.status === "complete").length ?? 0;
  const activeTools = message.toolCalls?.filter((toolCall) => toolCall.status === "active").length ?? 0;
  const errorTools = message.toolCalls?.filter((toolCall) => toolCall.status === "error" || toolCall.status === "skipped").length ?? 0;
  const webStatus = message.webSearch?.enabled ? message.webSearch.status : undefined;
  const active = Boolean(message.isStreaming || activeProgress || activeTool || webStatus === "active");

  if (!active && !toolCount && !activeProgress && !waitingTool && webStatus !== "error") {
    return null;
  }

  const label = activeProgress?.label ?? activeTool?.label ?? waitingTool?.label ?? (webStatus === "active" ? "Searching web" : toolCount ? "Reviewing tool results" : "Working");
  const details = [
    activeProgress?.detail,
    activeTool ? formatAssistantActivityToolDetail(activeTool) : "",
    waitingTool ? "Waiting for your approval in Activity." : "",
    toolCount ? `${toolCount} tools: ${completeTools} complete${activeTools ? `, ${activeTools} running` : ""}${errorTools ? `, ${errorTools} blocked` : ""}` : "",
    webStatus === "active" ? "Web search is still running." : "",
    webStatus === "error" ? message.webSearch?.error ?? "Web search failed." : "",
  ].filter(Boolean);

  return {
    active,
    detail: details.join(" "),
    label,
  };
}

function formatAssistantActivityToolDetail(toolCall: NonNullable<ChatSummary["messages"][number]["toolCalls"]>[number]) {
  const fileChangeSummary = formatAssistantActivityFileChangeSummary(toolCall.fileChanges);
  const liveOutput = toolCall.status === "active" ? cleanAssistantActivityText(toolCall.output) : "";

  return [liveOutput, fileChangeSummary, toolCall.detail].filter(Boolean).join(" ");
}

function formatAssistantActivityFileChangeSummary(fileChanges: NonNullable<ChatSummary["messages"][number]["toolCalls"]>[number]["fileChanges"]) {
  if (!fileChanges?.length) {
    return "";
  }

  const additions = fileChanges.reduce((total, change) => total + change.additions, 0);
  const deletions = fileChanges.reduce((total, change) => total + change.deletions, 0);
  return `${fileChanges.length === 1 ? "1 file" : `${fileChanges.length} files`} changed, +${additions} -${deletions}.`;
}

function cleanAssistantActivityText(content?: string) {
  const normalized = content?.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "";
  }

  return normalized.length > 180 ? `${normalized.slice(0, 179).trimEnd()}...` : normalized;
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

  const hasAcceptedPlanningApproval = message.approvals?.some((approval) => approval.tool === "planning_handoff" && (approval.status === "approved" || approval.status === "edited"));

  if (hasAcceptedPlanningApproval) {
    return false;
  }

  return true;
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
