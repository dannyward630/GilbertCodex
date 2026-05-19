import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { GitBranch, Grid2X2, Sparkles } from "lucide-react";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatThread } from "../components/chat/ChatThread";
import { ConversationHeader } from "../components/chat/ConversationHeader";
import { RightRail, chatHasPendingRightRailAction, chatHasPlanReviewContent, chatHasRightRailContent } from "../components/inspector/RightRail";
import type { ContextCompactionNotice, ContextWindowUsage, ModelContextWindowMap } from "../lib/contextWindow";
import { useAnimatedPresence } from "../lib/useAnimatedPresence";
import type { AppInfo } from "../types/app";
import type { AgentApprovalDecision } from "../types/agentRun";
import type { ChatComposerDraft, ChatMessage, ChatPlanningInputAnswer, ChatSendInput, ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProviderSettings, ThinkingSettings, WebSearchSettings } from "../types/settings";
import type { CreateProjectOptions, ProjectSummary } from "../types/project";

const BrowserPreviewPanel = lazy(() => import("../components/browser/BrowserPreviewPanel").then((module) => ({ default: module.BrowserPreviewPanel })));
const GitReviewPanel = lazy(() => import("../components/git/GitReviewPanel").then((module) => ({ default: module.GitReviewPanel })));

interface ChatPageProps {
  active?: boolean;
  appInfo: AppInfo;
  browserPreviewEnabled: boolean;
  browserPreviewRequestId?: number;
  browserPreviewUrl?: string | null;
  chat: ChatSummary;
  chats: ChatSummary[];
  composerDraft?: ChatComposerDraft | null;
  composerRestoreDraft?: ChatComposerDraft | null;
  composerRestoreDraftId?: string | null;
  contextWindowSource: "estimate" | "openrouter" | "provider";
  contextWindowTokens: number;
  hasApiKey: boolean;
  isSending: boolean;
  lastContextCompaction?: ContextCompactionNotice | null;
  localWorkspace: LocalWorkspaceSettings;
  lastProviderContextUsage?: ContextWindowUsage | null;
  model: string;
  modelContextWindows: ModelContextWindowMap;
  onComposerDraftApplied?: () => void;
  onComposerDraftChange?: (chatId: string, draft: ChatComposerDraft | null) => void;
  onCreateProject: (options?: CreateProjectOptions) => void | string | null | Promise<string | null | void>;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onModelChange: (model: string, provider: ProviderSettings["provider"]) => void;
  onDeleteQueuedMessage: (messageId: string) => void;
  onHoldQueuedMessage: (messageId: string, held: boolean) => void;
  onUpdateQueuedMessage: (messageId: string, content: string) => void;
  onAddAutomation: () => void;
  onArchiveChat: () => void;
  onCopyChatDeeplink: () => void;
  onCopyChatMarkdown: () => void;
  onCopySessionId: () => void;
  onCopyWorkingDirectory: () => void;
  onForkChatLocal: () => void;
  onForkChatWorktree: () => void | Promise<void>;
  onOpenChatInNewWindow: () => void | Promise<void>;
  onOpenSideChat: () => void;
  onRenameChat: () => void;
  onSelectProject: (project: string) => void;
  onSelectChat: (chatId: string) => void;
  onEditUserMessage: (messageId: string, content: string) => void | Promise<void>;
  onRequestPlanRevision: (messageId: string, feedback: string) => void | Promise<void>;
  onRegenerateResponse: (messageId: string) => void | Promise<void>;
  onSendMessage: (input: ChatSendInput) => void | Promise<void>;
  onSteerQueuedMessage: (messageId: string, contentOverride?: string) => void;
  onStopGeneration: (messageId?: string) => void;
  onSubmitPlanningInput: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  providerSettings: ProviderSettings;
  projects: ProjectSummary[];
  queuedMessageCount?: number;
  heldQueuedMessageIds?: string[];
  onThinkingChange: (thinking: ThinkingSettings) => void;
  onWebSearchChange: (webSearch: WebSearchSettings) => void;
  thinking: ThinkingSettings;
  webSearch: WebSearchSettings;
  onTogglePin: () => void;
  onToggleTerminal: () => void;
  terminalEnabled: boolean;
  terminalOpen: boolean;
}

export function ChatPage({
  active = true,
  appInfo,
  browserPreviewEnabled,
  browserPreviewRequestId = 0,
  browserPreviewUrl,
  chat,
  chats,
  composerDraft,
  composerRestoreDraft,
  composerRestoreDraftId,
  contextWindowSource,
  contextWindowTokens,
  hasApiKey,
  isSending,
  lastContextCompaction,
  localWorkspace,
  lastProviderContextUsage,
  model,
  modelContextWindows,
  onComposerDraftApplied,
  onComposerDraftChange,
  onCreateProject,
  onLocalWorkspaceChange,
  onModelChange,
  onDeleteQueuedMessage,
  onHoldQueuedMessage,
  onUpdateQueuedMessage,
  onAddAutomation,
  onArchiveChat,
  onCopyChatDeeplink,
  onCopyChatMarkdown,
  onCopySessionId,
  onCopyWorkingDirectory,
  onForkChatLocal,
  onForkChatWorktree,
  onOpenChatInNewWindow,
  onOpenSideChat,
  onRenameChat,
  onSelectChat,
  onSelectProject,
  onEditUserMessage,
  onRequestPlanRevision,
  onRegenerateResponse,
  onSendMessage,
  onSteerQueuedMessage,
  onStopGeneration,
  onSubmitPlanningInput,
  onResolveToolApproval,
  providerSettings,
  projects,
  queuedMessageCount = 0,
  heldQueuedMessageIds = [],
  onThinkingChange,
  onWebSearchChange,
  thinking,
  webSearch,
  onTogglePin,
  onToggleTerminal,
  terminalEnabled,
  terminalOpen,
}: ChatPageProps) {
  const conversationBodyRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(152);
  const [headerBlurActive, setHeaderBlurActive] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(false);
  const [activePlanReviewMessageId, setActivePlanReviewMessageId] = useState<string | null>(null);
  const [planReviewExpanded, setPlanReviewExpanded] = useState(false);
  const [browserPreviewOpen, setBrowserPreviewOpen] = useState(false);
  const [browserPreviewExpanded, setBrowserPreviewExpanded] = useState(false);
  const [browserPreviewResizing, setBrowserPreviewResizing] = useState(false);
  const [browserPreviewWidth, setBrowserPreviewWidth] = useState(DEFAULT_BROWSER_PREVIEW_WIDTH);
  const [gitReviewOpen, setGitReviewOpen] = useState(false);
  const [gitReviewExpanded, setGitReviewExpanded] = useState(false);
  const [gitReviewResizing, setGitReviewResizing] = useState(false);
  const [gitReviewWidth, setGitReviewWidth] = useState(DEFAULT_GIT_REVIEW_WIDTH);
  const rightRailNeedsAction = useMemo(() => chatHasPendingRightRailAction(chat), [chat]);
  const rightRailHasContent = useMemo(
    () => chatHasRightRailContent(chat) || chatHasPlanReviewContent(chat, activePlanReviewMessageId),
    [activePlanReviewMessageId, chat],
  );
  const queuedMessages = useMemo(() => getQueuedMessages(chat.messages), [chat.messages]);
  const emptyChat = chat.messages.length === 0;
  const conversationMainStyle = useMemo(
    () =>
      ({
        "--composer-clearance": `${Math.max(composerHeight + 64, 208)}px`,
      }) as CSSProperties,
    [composerHeight],
  );
  const showGitReview = active && gitReviewOpen;
  const showRightRail = active && !showGitReview && rightRailOpen && rightRailHasContent;
  const showBrowserPreview = active && !showGitReview && browserPreviewOpen;
  const gitReviewPresence = useAnimatedPresence(showGitReview, 320);
  const rightRailPresence = useAnimatedPresence(showRightRail, 320);
  const browserPreviewPresence = useAnimatedPresence(showBrowserPreview, 320);
  const renderGitReview = gitReviewPresence.mounted;
  const renderRightRail = !renderGitReview && rightRailPresence.mounted;
  const renderBrowserPreview = !renderGitReview && browserPreviewPresence.mounted;
  const sideLayout = renderGitReview ? "review" : renderRightRail && renderBrowserPreview ? "split" : renderBrowserPreview ? "preview" : renderRightRail ? "rail" : "none";
  const planReviewActive = Boolean(activePlanReviewMessageId && renderRightRail);
  const conversationBodyStyle = useMemo(
    () =>
      ({
        "--browser-preview-width": `${browserPreviewWidth}px`,
        "--git-review-width": `${gitReviewWidth}px`,
      }) as CSSProperties,
    [browserPreviewWidth, gitReviewWidth],
  );

  const handleComposerHeightChange = useCallback((height: number) => {
    const nextHeight = Math.max(Math.round(height), 0);
    setComposerHeight((currentHeight) => (currentHeight === nextHeight ? currentHeight : nextHeight));
  }, []);

  const clampBrowserPreviewWidth = useCallback(
    (width: number) => {
      const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const { maxWidth, minWidth } = getBrowserPreviewResizeBounds(sideLayout, containerWidth);

      return clamp(Math.round(width), minWidth, maxWidth);
    },
    [sideLayout],
  );

  const clampGitReviewWidth = useCallback(
    (width: number) => {
      const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const { maxWidth, minWidth } = getGitReviewResizeBounds(containerWidth);

      return clamp(Math.round(width), minWidth, maxWidth);
    },
    [],
  );

  const handleToggleBrowserPreview = useCallback(() => {
    if (!browserPreviewEnabled) {
      return;
    }

    setGitReviewOpen(false);
    setGitReviewExpanded(false);
    setBrowserPreviewOpen((open) => {
      if (open) {
        setBrowserPreviewExpanded(false);
      }

      return !open;
    });
  }, [browserPreviewEnabled]);

  const handleCloseBrowserPreview = useCallback(() => {
    setBrowserPreviewExpanded(false);
    setBrowserPreviewOpen(false);
  }, []);

  const handleOpenGitReview = useCallback(() => {
    setBrowserPreviewExpanded(false);
    setBrowserPreviewOpen(false);
    setRightRailOpen(false);
    setActivePlanReviewMessageId(null);
    setPlanReviewExpanded(false);
    setGitReviewOpen(true);
  }, []);

  const handleCloseGitReview = useCallback(() => {
    setGitReviewExpanded(false);
    setGitReviewOpen(false);
  }, []);

  const handleCloseRightRail = useCallback(() => {
    setRightRailOpen(false);
    setActivePlanReviewMessageId(null);
    setPlanReviewExpanded(false);
  }, []);

  const handleOpenPlanReview = useCallback((messageId: string) => {
    setGitReviewOpen(false);
    setGitReviewExpanded(false);
    setPlanReviewExpanded(false);
    setActivePlanReviewMessageId(messageId);
    setRightRailOpen(true);
  }, []);

  const handleTogglePlanReviewExpanded = useCallback(() => {
    setBrowserPreviewExpanded(false);
    setPlanReviewExpanded((expanded) => !expanded);
  }, []);

  const handleSubmitGitReview = useCallback(
    (prompt: string) =>
      onSendMessage({
        attachments: [],
        content: prompt,
        localWorkspace,
        mode: "chat",
        webSearch: {
          enabled: false,
          maxResults: webSearch.maxResults,
          provider: webSearch.provider,
        },
      }),
    [localWorkspace, onSendMessage, webSearch.maxResults, webSearch.provider],
  );

  const handleGitReviewResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (gitReviewExpanded || !showGitReview) {
        return;
      }

      const container = conversationBodyRef.current;

      if (!container) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setGitReviewResizing(true);

      let resizeFrame: number | null = null;
      let pendingClientX = event.clientX;

      const commitWidth = () => {
        const containerRect = container.getBoundingClientRect();
        setGitReviewWidth(clampGitReviewWidth(containerRect.right - pendingClientX));
      };
      const updateWidth = (clientX: number) => {
        pendingClientX = clientX;

        if (resizeFrame !== null) {
          return;
        }

        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          commitWidth();
        });
      };
      const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
      const stopResize = () => {
        if (resizeFrame !== null) {
          window.cancelAnimationFrame(resizeFrame);
          resizeFrame = null;
          commitWidth();
        }

        setGitReviewResizing(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      };

      updateWidth(event.clientX);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize, { once: true });
      window.addEventListener("pointercancel", stopResize, { once: true });
    },
    [clampGitReviewWidth, gitReviewExpanded, showGitReview],
  );

  const handleGitReviewResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (gitReviewExpanded) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setGitReviewWidth((width) => clampGitReviewWidth(width + GIT_REVIEW_RESIZE_STEP));
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setGitReviewWidth((width) => clampGitReviewWidth(width - GIT_REVIEW_RESIZE_STEP));
      }

      if (event.key === "Home") {
        event.preventDefault();
        setGitReviewWidth((width) => {
          const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
          return getGitReviewResizeBounds(containerWidth).minWidth || width;
        });
      }

      if (event.key === "End") {
        event.preventDefault();
        setGitReviewWidth((width) => {
          const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
          return getGitReviewResizeBounds(containerWidth).maxWidth || width;
        });
      }
    },
    [clampGitReviewWidth, gitReviewExpanded],
  );

  const handleBrowserPreviewResizeStart = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (browserPreviewExpanded || !showBrowserPreview) {
        return;
      }

      const container = conversationBodyRef.current;

      if (!container) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setBrowserPreviewResizing(true);

      let resizeFrame: number | null = null;
      let pendingClientX = event.clientX;

      const commitWidth = () => {
        const containerRect = container.getBoundingClientRect();
        setBrowserPreviewWidth(clampBrowserPreviewWidth(containerRect.right - pendingClientX));
      };
      const updateWidth = (clientX: number) => {
        pendingClientX = clientX;

        if (resizeFrame !== null) {
          return;
        }

        resizeFrame = window.requestAnimationFrame(() => {
          resizeFrame = null;
          commitWidth();
        });
      };
      const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
      const stopResize = () => {
        if (resizeFrame !== null) {
          window.cancelAnimationFrame(resizeFrame);
          resizeFrame = null;
          commitWidth();
        }

        setBrowserPreviewResizing(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      };

      updateWidth(event.clientX);
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize, { once: true });
      window.addEventListener("pointercancel", stopResize, { once: true });
    },
    [browserPreviewExpanded, clampBrowserPreviewWidth, showBrowserPreview],
  );

  const handleBrowserPreviewResizeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (browserPreviewExpanded) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setBrowserPreviewWidth((width) => clampBrowserPreviewWidth(width + BROWSER_PREVIEW_RESIZE_STEP));
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        setBrowserPreviewWidth((width) => clampBrowserPreviewWidth(width - BROWSER_PREVIEW_RESIZE_STEP));
      }

      if (event.key === "Home") {
        event.preventDefault();
        setBrowserPreviewWidth((width) => {
          const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
          return getBrowserPreviewResizeBounds(sideLayout, containerWidth).minWidth || width;
        });
      }

      if (event.key === "End") {
        event.preventDefault();
        setBrowserPreviewWidth((width) => {
          const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
          return getBrowserPreviewResizeBounds(sideLayout, containerWidth).maxWidth || width;
        });
      }
    },
    [browserPreviewExpanded, clampBrowserPreviewWidth, sideLayout],
  );

  useEffect(() => {
    if (!active) {
      return;
    }

    setGitReviewOpen(false);
    setGitReviewExpanded(false);
    setActivePlanReviewMessageId(null);
    setPlanReviewExpanded(false);
  }, [active, chat.id]);

  useEffect(() => {
    if (!activePlanReviewMessageId) {
      return;
    }

    if (!chatHasPlanReviewContent(chat, activePlanReviewMessageId)) {
      setActivePlanReviewMessageId(null);
      setPlanReviewExpanded(false);
    }
  }, [activePlanReviewMessageId, chat]);

  useEffect(() => {
    if (!active) {
      return;
    }

    if (!rightRailHasContent) {
      setRightRailOpen(false);
      setActivePlanReviewMessageId(null);
      setPlanReviewExpanded(false);
      return;
    }

    if (rightRailNeedsAction) {
      setRightRailOpen(true);
    }
  }, [active, chat.id, rightRailHasContent, rightRailNeedsAction]);

  useEffect(() => {
    if (!showBrowserPreview || browserPreviewExpanded) {
      return;
    }

    const handleResize = () => setBrowserPreviewWidth((width) => clampBrowserPreviewWidth(width));
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [browserPreviewExpanded, clampBrowserPreviewWidth, showBrowserPreview]);

  useEffect(() => {
    if (!showGitReview || gitReviewExpanded) {
      return;
    }

    const handleResize = () => setGitReviewWidth((width) => clampGitReviewWidth(width));
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [clampGitReviewWidth, gitReviewExpanded, showGitReview]);

  useEffect(() => {
    if (!browserPreviewEnabled && browserPreviewOpen) {
      setBrowserPreviewExpanded(false);
      setBrowserPreviewOpen(false);
    }
  }, [browserPreviewEnabled, browserPreviewOpen]);

  useEffect(() => {
    if (!active || !browserPreviewEnabled || !browserPreviewUrl) {
      return;
    }

    setBrowserPreviewExpanded(false);
    setBrowserPreviewOpen(true);
    setGitReviewOpen(false);
    setGitReviewExpanded(false);
  }, [active, browserPreviewEnabled, browserPreviewRequestId, browserPreviewUrl]);

  const composer = (
    <ChatComposer
      chat={chat}
      chats={chats}
      active={active}
      contextWindowSource={contextWindowSource}
      contextWindowTokens={contextWindowTokens}
      draft={composerDraft}
      restoreDraft={composerRestoreDraft}
      restoreDraftId={composerRestoreDraftId}
      isGenerating={isSending}
      lastContextCompaction={lastContextCompaction}
      layout={emptyChat ? "center" : "dock"}
      localWorkspace={localWorkspace}
      lastProviderContextUsage={lastProviderContextUsage}
      model={model}
      modelContextWindows={modelContextWindows}
      onCreateProject={onCreateProject}
      onDraftApplied={onComposerDraftApplied}
      onDraftChange={(draft) => onComposerDraftChange?.(chat.id, draft)}
      onDeleteQueuedMessage={onDeleteQueuedMessage}
      onHoldQueuedMessage={onHoldQueuedMessage}
      onUpdateQueuedMessage={onUpdateQueuedMessage}
      onHeightChange={handleComposerHeightChange}
      onLocalWorkspaceChange={onLocalWorkspaceChange}
      onModelChange={onModelChange}
      onForkWorktree={onForkChatWorktree}
      onReviewChanges={handleOpenGitReview}
      onSelectProject={onSelectProject}
      onStopGeneration={onStopGeneration}
      onSteerQueuedMessage={onSteerQueuedMessage}
      onSubmit={onSendMessage}
      projects={projects}
      providerSettings={providerSettings}
      queuedMessageCount={Math.max(queuedMessageCount, queuedMessages.length)}
      queuedMessages={queuedMessages}
      heldQueuedMessageIds={heldQueuedMessageIds}
      onThinkingChange={onThinkingChange}
      onWebSearchChange={onWebSearchChange}
      thinking={thinking}
      webSearch={webSearch}
    />
  );

  return (
    <div className="conversation-frame" data-header-blur={headerBlurActive}>
      <ConversationHeader
        browserPreviewEnabled={browserPreviewEnabled}
        browserPreviewOpen={showBrowserPreview}
        pinned={Boolean(chat.pinned)}
        title={chat.title}
        onAddAutomation={onAddAutomation}
        onArchive={onArchiveChat}
        onCopyDeeplink={onCopyChatDeeplink}
        onCopyMarkdown={onCopyChatMarkdown}
        onCopySessionId={onCopySessionId}
        onCopyWorkingDirectory={onCopyWorkingDirectory}
        onForkLocal={onForkChatLocal}
        onForkWorktree={() => void onForkChatWorktree()}
        onOpenNewWindow={() => void onOpenChatInNewWindow()}
        onToggleBrowserPreview={handleToggleBrowserPreview}
        onOpenSideChat={onOpenSideChat}
        onRename={onRenameChat}
        onTogglePin={onTogglePin}
        onToggleTerminal={onToggleTerminal}
        terminalEnabled={terminalEnabled}
        terminalOpen={terminalOpen}
      />
      <div
        className="conversation-body"
        data-browser-expanded={renderBrowserPreview && browserPreviewExpanded}
        data-browser-resizing={browserPreviewResizing}
        data-git-review-expanded={renderGitReview && gitReviewExpanded}
        data-git-review-open={renderGitReview}
        data-git-review-resizing={gitReviewResizing}
        data-plan-review-expanded={planReviewActive && planReviewExpanded}
        data-plan-review-open={planReviewActive}
        data-right-rail-open={renderRightRail}
        data-side-layout={sideLayout}
        ref={conversationBodyRef}
        style={conversationBodyStyle}
      >
        <section className="conversation-main" aria-label="Chat thread" data-empty={emptyChat} style={conversationMainStyle}>
          {emptyChat ? (
            <EmptyChatStart
              onSelectSuggestion={(content) =>
                onSendMessage({
                  attachments: [],
                  content,
                  localWorkspace,
                  webSearch: webSearch.enabled
                    ? {
                        enabled: true,
                        maxResults: webSearch.maxResults,
                        provider: webSearch.provider,
                      }
                    : undefined,
                })
              }
            >
              {composer}
            </EmptyChatStart>
          ) : (
            <>
              <ChatThread
                appInfo={appInfo}
                chat={chat}
                chats={chats}
                active={active}
                hasApiKey={hasApiKey}
                onEditUserMessage={onEditUserMessage}
                onHeaderBlurChange={setHeaderBlurActive}
                onOpenPlanReview={handleOpenPlanReview}
                onRequestPlanRevision={onRequestPlanRevision}
                onRegenerateResponse={onRegenerateResponse}
                onResolveToolApproval={onResolveToolApproval}
                onSelectChat={onSelectChat}
                onStopGeneration={onStopGeneration}
              />
              {composer}
            </>
          )}
        </section>
        {renderRightRail ? (
          <div className="side-panel-presence" data-panel="right-rail" data-presence={rightRailPresence.exiting ? "exit" : "enter"}>
            <RightRail
              activePlanReviewMessageId={activePlanReviewMessageId}
              chat={chat}
              planReviewExpanded={planReviewExpanded}
              onClose={handleCloseRightRail}
              onRequestPlanRevision={onRequestPlanRevision}
              onResolveToolApproval={onResolveToolApproval}
              onSubmitPlanningInput={onSubmitPlanningInput}
              onTogglePlanReviewExpanded={handleTogglePlanReviewExpanded}
            />
          </div>
        ) : null}
        {renderGitReview ? (
          <div className="side-panel-presence" data-panel="git-review" data-presence={gitReviewPresence.exiting ? "exit" : "enter"}>
            <Suspense fallback={null}>
              <GitReviewPanel
                expanded={gitReviewExpanded}
                previewWidth={gitReviewWidth}
                resizeMaxWidth={GIT_REVIEW_MAX_WIDTH}
                resizeMinWidth={GIT_REVIEW_MIN_WIDTH}
                root={localWorkspace.roots[0] ?? ""}
                onClose={handleCloseGitReview}
                onResizeKeyDown={handleGitReviewResizeKeyDown}
                onResizeStart={handleGitReviewResizeStart}
                onSubmitReview={handleSubmitGitReview}
                onToggleExpanded={() => setGitReviewExpanded((expanded) => !expanded)}
              />
            </Suspense>
          </div>
        ) : null}
        {renderBrowserPreview ? (
          <div className="side-panel-presence" data-presence={browserPreviewPresence.exiting ? "exit" : "enter"}>
            <Suspense fallback={null}>
              <BrowserPreviewPanel
                closing={browserPreviewPresence.exiting}
                expanded={browserPreviewExpanded}
                initialUrl={browserPreviewUrl ?? undefined}
                previewWidth={browserPreviewWidth}
                resizeMaxWidth={BROWSER_PREVIEW_MAX_WIDTH}
                resizeMinWidth={BROWSER_PREVIEW_MIN_WIDTH}
                onClose={handleCloseBrowserPreview}
                onResizeKeyDown={handleBrowserPreviewResizeKeyDown}
                onResizeStart={handleBrowserPreviewResizeStart}
                onToggleExpanded={() => setBrowserPreviewExpanded((expanded) => !expanded)}
              />
            </Suspense>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const BROWSER_PREVIEW_MIN_WIDTH = 320;
const BROWSER_PREVIEW_MAX_WIDTH = 1120;
const DEFAULT_BROWSER_PREVIEW_WIDTH = 560;
const BROWSER_PREVIEW_RESIZE_STEP = 40;
const GIT_REVIEW_MIN_WIDTH = 460;
const GIT_REVIEW_MAX_WIDTH = 1280;
const DEFAULT_GIT_REVIEW_WIDTH = 760;
const GIT_REVIEW_RESIZE_STEP = 48;
const PREVIEW_ONLY_RESERVED_WIDTH = 320;
const SPLIT_LAYOUT_RESERVED_WIDTH = 560;
const GIT_REVIEW_RESERVED_WIDTH = 360;

const starterSuggestions = [
  {
    icon: GitBranch,
    label: "Think of a suitable starter task for me, implement it, and walk me through the solution",
  },
  {
    icon: Sparkles,
    label: "Explain this project to me",
  },
  {
    icon: Grid2X2,
    label: "Connect your favorite apps to Gilbert Codex",
  },
];

function EmptyChatStart({ children, onSelectSuggestion }: { children: ReactNode; onSelectSuggestion: (content: string) => void }) {
  return (
    <div className="empty-chat-start">
      <h2>What should we work on?</h2>
      {children}
      <div className="empty-chat-suggestions" aria-label="Starter prompts">
        {starterSuggestions.map((suggestion) => {
          const SuggestionIcon = suggestion.icon;

          return (
            <button key={suggestion.label} type="button" onClick={() => onSelectSuggestion(suggestion.label)}>
              <SuggestionIcon size={19} aria-hidden="true" />
              <span>{suggestion.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getBrowserPreviewResizeBounds(sideLayout: string, containerWidth: number) {
  const reservedWidth = sideLayout === "split" ? SPLIT_LAYOUT_RESERVED_WIDTH : PREVIEW_ONLY_RESERVED_WIDTH;
  const availableWidth = Math.max(BROWSER_PREVIEW_MIN_WIDTH, containerWidth - reservedWidth);
  const maxWidth = Math.min(BROWSER_PREVIEW_MAX_WIDTH, availableWidth);

  return {
    maxWidth,
    minWidth: Math.min(BROWSER_PREVIEW_MIN_WIDTH, maxWidth),
  };
}

function getGitReviewResizeBounds(containerWidth: number) {
  const availableWidth = Math.max(GIT_REVIEW_MIN_WIDTH, containerWidth - GIT_REVIEW_RESERVED_WIDTH);
  const maxWidth = Math.min(GIT_REVIEW_MAX_WIDTH, availableWidth);

  return {
    maxWidth,
    minWidth: Math.min(GIT_REVIEW_MIN_WIDTH, maxWidth),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getQueuedMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role === "user" && message.status === "queued");
}
