import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronRight, ExternalLink, Globe2, Hash, X } from "lucide-react";
import { AssistantWorkTrace, createAssistantActivitySnapshot } from "./AssistantActivityIndicator";
import { MarkdownMessage } from "./MarkdownMessage";
import { MessageArtifacts, MessageAttachments } from "./MessageAttachments";
import { MessageActions } from "./MessageActions";
import { MessageBlock } from "./MessageBlock";
import { PlanReviewCard } from "./PlanReviewCard";
import { isInterruptedAssistantMessage } from "../../app/chatRuntime";
import { extractInlineThinking } from "../../lib/inlineThinkingExtractor";
import { getSavedPlanContent, isPlanExecutionContent } from "../../lib/planReview";
import { stripVisibleToolProtocol } from "../../lib/visibleToolProtocol";
import type { AppInfo } from "../../types/app";
import type { AgentApprovalDecision } from "../../types/agentRun";
import type { ChatContextCompaction, ChatMessage, ChatMessageSource, ChatResearchReference, ChatSource, ChatSummary } from "../../types/chat";

const INTERNAL_ASSISTANT_STATUS_MESSAGES = new Set([
  "Reading tool results...",
  "Using agent tools...",
  "Writing final answer from local tool results...",
]);

interface ChatThreadProps {
  active?: boolean;
  appInfo: AppInfo;
  chat: ChatSummary;
  chats: ChatSummary[];
  hasApiKey: boolean;
  onHeaderBlurChange?: (active: boolean) => void;
  onOpenPlanReview?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, content: string) => void | Promise<void>;
  onRequestPlanRevision?: (messageId: string, feedback: string) => void | Promise<void>;
  onRegenerateResponse?: (messageId: string) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  onSelectChat?: (chatId: string) => void;
  onStopGeneration?: (messageId: string) => void;
}

export function ChatThread({
  active = true,
  appInfo,
  chat,
  chats,
  hasApiKey,
  onHeaderBlurChange,
  onEditUserMessage,
  onOpenPlanReview,
  onRequestPlanRevision,
  onRegenerateResponse,
  onResolveToolApproval,
  onSelectChat,
  onStopGeneration,
}: ChatThreadProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const headerBlurActiveRef = useRef(false);
  const programmaticScrollFrameRef = useRef<number | null>(null);
  const programmaticScrollRef = useRef(false);
  const scrollFrameRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const scrollAnchorMessage = getScrollAnchorMessage(chat);
  const streamMarker = scrollAnchorMessage
    ? `${chat.messages.length}:${scrollAnchorMessage.id}:${scrollAnchorMessage.content.length}:${createMessageActivityMarker(scrollAnchorMessage)}:${scrollAnchorMessage.isStreaming ? "1" : "0"}`
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
    if (!active) {
      return;
    }

    shouldStickToBottomRef.current = true;
    setHeaderBlurActive(false);
    scrollToThreadBottom();
  }, [active, chat.id]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (!shouldStickToBottomRef.current) {
      return;
    }

    scrollToThreadBottom();
  }, [active, streamMarker]);

  useEffect(() => {
    if (!editingMessageId) {
      return;
    }

    const editableMessageStillExists = chat.messages.some((message) => message.id === editingMessageId && message.role === "user" && message.status !== "queued");

    if (!editableMessageStillExists) {
      setEditingMessageId(null);
      setEditingContent("");
    }
  }, [chat.id, chat.messages, editingMessageId]);

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
    if (!active) {
      return;
    }

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

  function handleStartEditMessage(messageId: string) {
    const message = chat.messages.find((candidate) => candidate.id === messageId && candidate.role === "user" && candidate.status !== "queued");

    if (!message || !onEditUserMessage) {
      return;
    }

    setEditingMessageId(message.id);
    setEditingContent(message.content);
  }

  function handleCancelEditMessage() {
    setEditingMessageId(null);
    setEditingContent("");
  }

  function handleSubmitEditMessage(message: ChatMessage) {
    if (!onEditUserMessage || message.role !== "user") {
      return;
    }

    const hasAttachments = Boolean(message.attachments?.length);

    if (!editingContent.trim() && !hasAttachments) {
      return;
    }

    const nextContent = editingContent;
    setEditingMessageId(null);
    setEditingContent("");
    void onEditUserMessage(message.id, nextContent);
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

        const displayMessage = message.role === "assistant" ? separateDisplayThinking(message.content, Boolean(message.isStreaming)) : { content: message.content };
        const hasVisibleContent = displayMessage.content.trim().length > 0;
        const messageSources = message.role === "assistant" ? getMessageSources(message, displayMessage.content) : [];
        const showMessageSources = message.role === "assistant" && !message.isStreaming && hasVisibleContent && messageSources.length > 0;
        const hasVisibleAttachment = Boolean(message.attachments?.length);
        const hasVisibleArtifact = Boolean(message.artifacts?.length);
        const showPlanReview = shouldShowPlanReviewCard(message);
        const savedPlanContent = message.role === "assistant" ? getSavedPlanContent(message) : "";
        const showPlanExecutionContent = message.role === "assistant" && showPlanReview && isPlanExecutionContent(message, displayMessage.content);
        const isEditingUserMessage = message.role === "user" && editingMessageId === message.id;
        const activitySnapshot = message.role === "assistant"
          ? createAssistantActivitySnapshot(message, { responseStarted: hasVisibleContent })
          : null;
        const hasWorkTrace = message.role === "assistant" && (Boolean(message.workTrace?.length) || Boolean(message.responseThinking?.trim()));
        const showAssistantWorkTrace = message.role === "assistant" && (activitySnapshot || hasWorkTrace || Boolean(message.isStreaming && !hasVisibleContent));
        const visibleContextCompactions = message.role === "assistant" ? getVisibleContextCompactions(message.contextCompactions) : [];
        const showMessageBlock = message.role !== "assistant" || hasVisibleContent || hasVisibleAttachment || hasVisibleArtifact || showPlanReview || showAssistantWorkTrace;

        if (message.role === "assistant" && !showMessageBlock && visibleContextCompactions.length === 0) {
          return null;
        }

        const actionMessage = message.role === "assistant" ? { ...message, content: displayMessage.content } : message;

        return (
          <Fragment key={message.id}>
            {visibleContextCompactions.map((compaction) => (
              <ContextCompactionDivider key={`${message.id}-${compaction.compactedAt}`} compaction={compaction} />
            ))}
            {showMessageBlock ? (
              <MessageBlock role={message.role} status={message.status} isStreaming={message.isStreaming}>
                <MessageAttachments attachments={message.attachments} />
                <MessageArtifacts artifacts={message.artifacts} />
                {message.role === "user" && message.source?.kind === "discord" ? <DiscordMessageSource source={message.source} /> : null}
                {message.role === "user" ? <MessageResearchReferences references={message.researchReferences} chats={chats} onSelectChat={onSelectChat} /> : null}
                {showAssistantWorkTrace ? (
                  <AssistantWorkTrace
                    activitySnapshot={activitySnapshot}
                    responseStarted={hasVisibleContent}
                    thinking={message.role === "assistant" ? message.thinking : undefined}
                    thinkingContent={message.role === "assistant" ? message.responseThinking ?? "" : ""}
                    thinkingStreaming={Boolean(message.isStreaming && !hasVisibleContent)}
                    workTrace={message.role === "assistant" ? message.workTrace : undefined}
                  />
                ) : null}
                {isEditingUserMessage ? (
                  <MessageEditForm
                    hasAttachments={hasVisibleAttachment}
                    value={editingContent}
                    onCancel={handleCancelEditMessage}
                    onChange={setEditingContent}
                    onSubmit={() => handleSubmitEditMessage(message)}
                  />
                ) : showPlanReview ? (
                  <>
                    <PlanReviewCard
                      content={savedPlanContent || displayMessage.content}
                      isStreaming={message.isStreaming}
                      message={actionMessage}
                      onOpenFullPlan={onOpenPlanReview}
                      onRequestRevision={onRequestPlanRevision}
                      onResolvePlanApproval={onResolveToolApproval}
                    />
                    {showPlanExecutionContent ? (
                      <div className="plan-execution-response">
                        <MarkdownMessage content={displayMessage.content} isStreaming={message.isStreaming} />
                      </div>
                    ) : null}
                  </>
                ) : displayMessage.content.trim() ? (
                  <MarkdownMessage content={displayMessage.content} isStreaming={message.isStreaming} />
                ) : null}
                {showMessageSources ? <MessageSourcesRow sources={messageSources} /> : null}
                {isEditingUserMessage ? null : (
                  <MessageActions
                    canRegenerate={canRegenerateMessage(chat, messageIndex)}
                    message={actionMessage}
                    onEditMessage={onEditUserMessage ? handleStartEditMessage : undefined}
                    onRegenerateResponse={onRegenerateResponse}
                    onStopGeneration={onStopGeneration}
                  />
                )}
                {message.role === "assistant" && !message.isStreaming && isInterruptedAssistantMessage(message) && canRegenerateMessage(chat, messageIndex) ? <ResponseRecoveryActions messageId={message.id} onRegenerateResponse={onRegenerateResponse} /> : null}
              </MessageBlock>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function MessageEditForm({
  hasAttachments,
  onCancel,
  onChange,
  onSubmit,
  value,
}: {
  hasAttachments: boolean;
  onCancel: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = value.trim().length > 0 || hasAttachments;

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 92), 260)}px`;
  }, [value]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (canSubmit) {
      onSubmit();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();

      if (canSubmit) {
        onSubmit();
      }
    }
  }

  return (
    <form className="message-edit-form" onSubmit={handleSubmit}>
      <textarea
        ref={textareaRef}
        className="message-edit-textarea"
        value={value}
        rows={3}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="message-edit-actions">
        <button className="message-edit-cancel" type="button" onClick={onCancel}>
          <X size={14} aria-hidden="true" />
          <span>Cancel</span>
        </button>
        <button className="message-edit-submit" type="submit" disabled={!canSubmit}>
          <Check size={14} aria-hidden="true" />
          <span>Send</span>
        </button>
      </div>
    </form>
  );
}

function MessageSourcesRow({ sources }: { sources: ChatSource[] }) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const visibleSources = getUniqueMessageSources(sources);
  const hasSources = visibleSources.length > 0;
  const inlineSources = visibleSources.slice(0, 4);
  const remainingSourceCount = visibleSources.length - inlineSources.length;

  if (!hasSources) {
    return null;
  }

  return (
    <section className="response-meta response-sources" data-has-sources={hasSources} aria-label="Sources cited in this response">
      <div className="response-sources-line">
        <span className="message-sources-title" aria-label={`${visibleSources.length} sources`}>
          <Globe2 size={13} aria-hidden="true" />
          <span>Sources</span>
          <strong>{visibleSources.length}</strong>
        </span>
        <div className="message-sources-preview">
          {inlineSources.map((source, index) => (
            <a className="message-source-chip" href={source.url} key={source.id ?? source.url} rel="noreferrer" target="_blank" title={cleanSourceTitle(source.title, source.url)}>
              <span className="message-source-index" aria-hidden="true">{index + 1}</span>
              <span>{formatMessageSourceHost(source.url)}</span>
            </a>
          ))}
          <button className="message-sources-toggle" type="button" aria-expanded={sourcesExpanded} onClick={() => setSourcesExpanded((current) => !current)}>
            <span>{sourcesExpanded ? "Hide" : remainingSourceCount > 0 ? `+${remainingSourceCount}` : "Details"}</span>
            {sourcesExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
          </button>
        </div>
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

function MessageResearchReferences({
  chats,
  onSelectChat,
  references,
}: {
  chats: ChatSummary[];
  onSelectChat?: (chatId: string) => void;
  references?: ChatResearchReference[];
}) {
  if (!references?.length) {
    return null;
  }

  const visibleReferences = references.map((reference) => {
    const liveChat = chats.find((chat) => chat.id === reference.chatId && !chat.archived);

    return {
      ...reference,
      missing: !liveChat,
      project: liveChat?.project ?? reference.project,
      title: liveChat?.title ?? reference.title,
    };
  });

  return (
    <div className="message-research-references" aria-label="Attached chat notes">
      <span className="message-research-label">
        <Hash size={13} aria-hidden="true" />
        Notes
      </span>
      {visibleReferences.map((reference) => {
        const label = `${reference.title}${reference.missing ? " unavailable" : ""}`;
        const content = (
          <>
            <strong>{reference.title}</strong>
            <small>{reference.missing ? "Deleted chat" : reference.project}</small>
          </>
        );

        return onSelectChat && !reference.missing ? (
          <button key={reference.chatId} type="button" className="message-research-chip" aria-label={`Open referenced chat ${label}`} onClick={() => onSelectChat(reference.chatId)}>
            {content}
          </button>
        ) : (
          <span key={reference.chatId} className="message-research-chip" data-missing={reference.missing}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

function getMessageSources(message: ChatMessage, visibleContent: string) {
  return getUniqueMessageSources([...(message.sources ?? []), ...extractMessageSources(visibleContent)]);
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

  return Boolean(getSavedPlanContent(message) || message.approvals?.some((approval) => approval.tool === "planning_handoff"));
}

function ContextCompactionDivider({ compaction }: { compaction: ChatContextCompaction }) {
  const detail = `${formatCompactTokenCount(compaction.beforeTokens)} -> ${formatCompactTokenCount(compaction.afterTokens)}`;
  const compactedCount = `${compaction.compactedMessageCount} older message${compaction.compactedMessageCount === 1 ? "" : "s"}`;
  const activeRequest = compaction.contextWindowTokens
    ? `${formatCompactTokenCount(compaction.afterTokens)} / ${formatCompactTokenCount(compaction.contextWindowTokens)}`
    : formatCompactTokenCount(compaction.afterTokens);

  return (
    <div className="context-compaction-divider" title={`${detail}, ${compactedCount} compacted`}>
      <span className="context-compaction-divider-content">
        <strong>Context compacted</strong>
        <small>{compactedCount}. Active request {activeRequest}.</small>
      </span>
    </div>
  );
}

function getVisibleContextCompactions(compactions: ChatContextCompaction[] | undefined) {
  if (!compactions?.length) {
    return [];
  }

  const latestByStrategy = new Map<string, ChatContextCompaction>();

  for (const compaction of compactions) {
    latestByStrategy.set(getContextCompactionStrategyKey(compaction), compaction);
  }

  return Array.from(latestByStrategy.values());
}

function getContextCompactionStrategyKey(compaction: ChatContextCompaction) {
  return `${compaction.strategy ?? "context-compaction"}:${compaction.summaryVersion ?? "unknown"}`;
}

function formatCompactTokenCount(tokens: number) {
  if (tokens >= 1000) {
    return `${Number((tokens / 1000).toFixed(tokens >= 100000 ? 0 : 1))}k`;
  }

  return String(tokens);
}

function separateDisplayThinking(content: string, isStreaming = false) {
  // Streaming messages still get the tail-prefix guard so a half-typed `<thi`
  // never flashes into the public area. Hidden content is intentionally not
  // returned to the UI.
  const { content: visibleContent } = extractInlineThinking(content, {
    final: !isStreaming,
  });

  return {
    content: removeInternalAssistantStatusMessage(stripVisibleToolProtocol(visibleContent).trimStart()),
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
