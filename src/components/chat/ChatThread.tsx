import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Globe2 } from "lucide-react";
import { AssistantWorkTrace, createAssistantActivitySnapshot } from "./AssistantActivityIndicator";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageArtifacts, MessageAttachments } from "./MessageAttachments";
import { MessageActions } from "./MessageActions";
import { MessageBlock } from "./MessageBlock";
import { PlanReviewCard } from "./PlanReviewCard";
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
  onRequestPlanRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onStopGeneration?: (messageId: string) => void;
}

export function ChatThread({ appInfo, chat, hasApiKey, onHeaderBlurChange, onRequestPlanRevision, onRegenerateResponse, onResolveToolApproval, onStopGeneration }: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const headerBlurActiveRef = useRef(false);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const scrollAnchorMessage = getScrollAnchorMessage(chat);
  const streamMarker = scrollAnchorMessage
    ? `${chat.messages.length}:${scrollAnchorMessage.id}:${scrollAnchorMessage.content.length}:${scrollAnchorMessage.reasoning?.length ?? 0}:${scrollAnchorMessage.responseThinking?.length ?? 0}:${createMessageActivityMarker(scrollAnchorMessage)}:${scrollAnchorMessage.isStreaming ? "1" : "0"}`
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
        const responseThinking = message.role === "assistant" ? getVisibleResponseThinking(message.responseThinking, displayMessage.content) : "";
        const hasVisibleContent = displayMessage.content.trim().length > 0;
        const hasVisibleResponseThinking = responseThinking.length > 0;
        const messageSources = message.role === "assistant" ? getMessageSources(message, displayMessage.content) : [];
        const showMessageSources = message.role === "assistant" && !message.isStreaming && hasVisibleContent && messageSources.length > 0;
        const hasVisibleAttachment = Boolean(message.attachments?.length);
        const hasVisibleArtifact = Boolean(message.artifacts?.length);
        const showPlanReview = shouldShowPlanReviewCard(message);
        const activitySnapshot = message.role === "assistant"
          ? createAssistantActivitySnapshot(message, { responseStarted: hasVisibleContent })
          : null;
        const showAssistantWorkTrace = message.role === "assistant" && (hasVisibleResponseThinking || activitySnapshot || Boolean(message.isStreaming && !hasVisibleContent));

        if (message.role === "assistant" && !hasVisibleContent && !hasVisibleAttachment && !hasVisibleArtifact && !showPlanReview && !showAssistantWorkTrace) {
          return null;
        }

        const actionMessage = message.role === "assistant" ? { ...message, content: displayMessage.content } : message;

        return (
          <Fragment key={message.id}>
            {message.contextCompactions?.map((compaction) => (
              <ContextCompactionDivider key={`${message.id}-${compaction.compactedAt}`} compaction={compaction} />
            ))}
            <MessageBlock role={message.role} status={message.status} isStreaming={message.isStreaming}>
              <MessageAttachments attachments={message.attachments} />
              <MessageArtifacts artifacts={message.artifacts} />
              {message.role === "user" && message.source?.kind === "discord" ? <DiscordMessageSource source={message.source} /> : null}
              {showAssistantWorkTrace ? (
                <AssistantWorkTrace
                  activitySnapshot={activitySnapshot}
                  responseStarted={hasVisibleContent}
                  thinkingContent={hasVisibleResponseThinking ? responseThinking : ""}
                  thinkingStreaming={Boolean(message.isStreaming && !hasVisibleContent)}
                />
              ) : null}
              {showMessageSources ? <MessageSourcesRow sources={messageSources} /> : null}
              {showPlanReview ? (
                <PlanReviewCard
                  content={displayMessage.content}
                  isStreaming={message.isStreaming}
                  message={actionMessage}
                  onRequestRevision={onRequestPlanRevision}
                  onResolvePlanApproval={onResolveToolApproval}
                />
              ) : displayMessage.content.trim() ? (
                <MarkdownMessage content={displayMessage.content} isStreaming={message.isStreaming} />
              ) : null}
              <MessageActions
                canRegenerate={canRegenerateMessage(chat, messageIndex)}
                message={actionMessage}
                onRegenerateResponse={onRegenerateResponse}
                onStopGeneration={onStopGeneration}
              />
              {message.role === "assistant" && !message.isStreaming && isInterruptedAssistantMessage(message) && canRegenerateMessage(chat, messageIndex) ? <ResponseRecoveryActions messageId={message.id} onRegenerateResponse={onRegenerateResponse} /> : null}
            </MessageBlock>
          </Fragment>
        );
      })}
    </div>
  );
}

function MessageSourcesRow({ sources }: { sources: ChatSource[] }) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const visibleSources = getUniqueMessageSources(sources);
  const hasSources = visibleSources.length > 0;
  const hostPreview = getSourceHostPreview(visibleSources);

  if (!hasSources) {
    return null;
  }

  return (
    <section className="response-meta" data-has-sources={hasSources} aria-label="Response details">
      <div className="response-meta-controls">
        <button className="message-sources-toggle" type="button" aria-expanded={sourcesExpanded} onClick={() => setSourcesExpanded((current) => !current)}>
          <span className="message-sources-title">
            <Globe2 size={15} aria-hidden="true" />
            <strong>Sources</strong>
            <small>{visibleSources.length}</small>
          </span>
          <span className="message-sources-preview" aria-hidden="true">
            {hostPreview.map((host) => (
              <span key={host}>{host}</span>
            ))}
          </span>
          <span className="message-sources-action">
            {sourcesExpanded ? "Hide" : "Show"}
            {sourcesExpanded ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
          </span>
        </button>
      </div>
      {sourcesExpanded ? (
        <div className="message-sources-list">
          {visibleSources.map((source, index) => (
            <a className="message-source-link" href={source.url} key={source.id ?? source.url} rel="noreferrer" target="_blank">
              <span className="message-source-index" aria-hidden="true">{index + 1}</span>
              <span>
                <strong>{cleanSourceTitle(source.title, source.url)}</strong>
                <small>{formatMessageSourceDetail(source)}</small>
              </span>
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function getMessageSources(message: ChatMessage, visibleContent: string) {
  return getUniqueMessageSources([...(message.sources ?? []), ...extractMessageSources(visibleContent)]);
}

function getSourceHostPreview(sources: ChatSource[]) {
  const hosts: string[] = [];
  const seenHosts = new Set<string>();

  for (const source of sources) {
    const host = formatMessageSourceHost(source.url);

    if (seenHosts.has(host)) {
      continue;
    }

    seenHosts.add(host);
    hosts.push(host);

    if (hosts.length >= 3) {
      break;
    }
  }

  if (sources.length > hosts.length) {
    hosts.push(`+${sources.length - hosts.length}`);
  }

  return hosts;
}

function getUniqueMessageSources(sources: ChatSource[]) {
  const seenUrls = new Set<string>();
  const uniqueSources: ChatSource[] = [];

  for (const source of sources) {
    const normalizedUrl = normalizeMessageSourceUrl(source.url);

    if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);
    uniqueSources.push({ ...source, url: normalizedUrl });
  }

  return uniqueSources;
}

function extractMessageSources(content: string): ChatSource[] {
  const sources = new Map<string, ChatSource>();
  const body = stripCodeForSourceScan(content);
  const markdownLinkPattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi;
  const bareUrlPattern = /(^|[\s(])(https?:\/\/[^\s<>)]+)/gi;

  for (const match of body.matchAll(markdownLinkPattern)) {
    addMessageSource(sources, match[2], match[1]);
  }

  for (const match of body.matchAll(bareUrlPattern)) {
    addMessageSource(sources, match[2]);
  }

  return [...sources.values()];
}

function addMessageSource(sources: Map<string, ChatSource>, rawUrl: string, title?: string) {
  const url = normalizeMessageSourceUrl(rawUrl);

  if (!url || !isExternalMessageSourceUrl(url) || sources.has(url)) {
    return;
  }

  sources.set(url, {
    sourceType: "web",
    title: cleanSourceTitle(title, url),
    url,
  });
}

function normalizeMessageSourceUrl(rawUrl: string) {
  const trimmedUrl = rawUrl.trim().replace(/[.,;:!?]+$/g, "");

  try {
    return new URL(trimmedUrl).href;
  } catch {
    return "";
  }
}

function isExternalMessageSourceUrl(url: string) {
  try {
    const { hostname, protocol } = new URL(url);
    const host = hostname.toLowerCase();

    return (
      (protocol === "http:" || protocol === "https:") &&
      host !== "localhost" &&
      host !== "0.0.0.0" &&
      host !== "127.0.0.1" &&
      host !== "::1" &&
      !host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

function formatMessageSourceDetail(source: ChatSource) {
  const host = formatMessageSourceHost(source.url);
  const detail = source.detail?.trim();

  if (!detail || detail === source.url || detail === host) {
    return host;
  }

  return `${host} - ${detail}`;
}

function formatMessageSourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Web source";
  }
}

function cleanSourceTitle(title: string | undefined, url: string) {
  const cleanedTitle = (title ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleanedTitle || formatMessageSourceHost(url);
}

function stripCodeForSourceScan(value: string) {
  return value.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
}

function ResponseRecoveryActions({
  messageId,
  onRegenerateResponse,
}: {
  messageId: string;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
}) {
  return (
    <div className="response-recovery-actions">
      <button type="button" onClick={() => void onRegenerateResponse?.(messageId)}>
        Continue response
      </button>
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

function getVisibleResponseThinking(responseThinking: string | undefined, visibleContent: string) {
  const thinking = responseThinking?.trim() ?? "";

  if (!thinking || sameNormalizedVisibleText(thinking, visibleContent)) {
    return "";
  }

  return thinking;
}

function sameNormalizedVisibleText(left: string, right: string) {
  const normalizedLeft = normalizeVisibleText(left);
  const normalizedRight = normalizeVisibleText(right);

  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function normalizeVisibleText(value: string) {
  return value.replace(/\s+/g, " ").trim();
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

function createMessageActivityMarker(message: ChatMessage) {
  const progressMarker = (message.progress ?? [])
    .map((item) => `${item.id ?? item.label}:${item.status}:${item.detail?.length ?? 0}`)
    .join("|");
  const toolMarker = (message.toolCalls ?? [])
    .map((toolCall) => {
      const fileMarker = (toolCall.fileChanges ?? [])
        .map((change) => `${change.path}:${change.kind ?? "update"}:${change.additions}:${change.deletions}:${change.diffPreview?.length ?? 0}`)
        .join(",");

      return `${toolCall.id}:${toolCall.status}:${toolCall.input?.length ?? 0}:${toolCall.output?.length ?? 0}:${fileMarker}`;
    })
    .join("|");

  return `${progressMarker}:${toolMarker}:${message.webSearch?.status ?? ""}:${message.thinking?.completedAt ?? ""}`;
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
