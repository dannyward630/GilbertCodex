import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { GitBranch, Grid2X2, Sparkles } from "lucide-react";
import { BrowserPreviewPanel } from "../components/browser/BrowserPreviewPanel";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatThread } from "../components/chat/ChatThread";
import { ConversationHeader } from "../components/chat/ConversationHeader";
import { GitReviewPanel } from "../components/git/GitReviewPanel";
import { RightRail, chatHasLiveRightRailActivity, chatHasRightRailContent } from "../components/inspector/RightRail";
import type { ContextCompactionNotice, ContextWindowUsage, ModelContextWindowMap } from "../lib/contextWindow";
import type { AppInfo } from "../types/app";
import type { AgentApprovalDecision } from "../types/agentRun";
import type { ChatComposerDraft, ChatMessage, ChatPlanningInputAnswer, ChatSendInput, ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProviderSettings, ThinkingSettings, WebSearchSettings } from "../types/settings";
import type { ProjectSummary } from "../types/project";

interface ChatPageProps {
  appInfo: AppInfo;
  browserPreviewEnabled: boolean;
  browserPreviewRequestId?: number;
  browserPreviewUrl?: string | null;
  chat: ChatSummary;
  composerDraft?: ChatComposerDraft | null;
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
  onCreateProject: () => void | string | null | Promise<string | null | void>;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onModelChange: (model: string, provider: ProviderSettings["provider"]) => void;
  onDeleteQueuedMessage: (messageId: string) => void;
  onOpenSideChat: () => void;
  onSelectProject: (project: string) => void;
  onRequestPlanRevision: (messageId: string, feedback: string) => void | Promise<void>;
  onRegenerateResponse: (messageId: string) => void | Promise<void>;
  onSendMessage: (input: ChatSendInput) => void | Promise<void>;
  onSteerQueuedMessage: (messageId: string) => void;
  onStopGeneration: () => void;
  onSubmitPlanningInput: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
  onResolveToolApproval?: (messageId: string, approvalId: string, decision: AgentApprovalDecision) => void | Promise<void>;
  providerSettings: ProviderSettings;
  projects: ProjectSummary[];
  queuedMessageCount?: number;
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
  appInfo,
  browserPreviewEnabled,
  browserPreviewRequestId = 0,
  browserPreviewUrl,
  chat,
  composerDraft,
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
  onCreateProject,
  onLocalWorkspaceChange,
  onModelChange,
  onDeleteQueuedMessage,
  onOpenSideChat,
  onSelectProject,
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
  const [browserPreviewOpen, setBrowserPreviewOpen] = useState(false);
  const [browserPreviewExpanded, setBrowserPreviewExpanded] = useState(false);
  const [browserPreviewResizing, setBrowserPreviewResizing] = useState(false);
  const [browserPreviewWidth, setBrowserPreviewWidth] = useState(DEFAULT_BROWSER_PREVIEW_WIDTH);
  const [gitReviewOpen, setGitReviewOpen] = useState(false);
  const rightRailHasActivity = useMemo(() => chatHasLiveRightRailActivity(chat), [chat]);
  const rightRailHasContent = useMemo(() => chatHasRightRailContent(chat), [chat]);
  const queuedMessages = useMemo(() => getQueuedMessages(chat.messages), [chat.messages]);
  const emptyChat = chat.messages.length === 0;
  const conversationMainStyle = {
    "--composer-clearance": `${Math.max(composerHeight + 34, 178)}px`,
  } as CSSProperties;
  const showGitReview = gitReviewOpen;
  const showRightRail = !showGitReview && rightRailOpen && rightRailHasContent;
  const showBrowserPreview = !showGitReview && browserPreviewOpen;
  const sideLayout = showGitReview ? "review" : showRightRail && showBrowserPreview ? "split" : showBrowserPreview ? "preview" : showRightRail ? "rail" : "none";
  const conversationBodyStyle = {
    "--browser-preview-width": `${browserPreviewWidth}px`,
  } as CSSProperties;

  const clampBrowserPreviewWidth = useCallback(
    (width: number) => {
      const containerWidth = conversationBodyRef.current?.getBoundingClientRect().width ?? window.innerWidth;
      const { maxWidth, minWidth } = getBrowserPreviewResizeBounds(sideLayout, containerWidth);

      return clamp(Math.round(width), minWidth, maxWidth);
    },
    [sideLayout],
  );

  const handleToggleBrowserPreview = useCallback(() => {
    if (!browserPreviewEnabled) {
      return;
    }

    setGitReviewOpen(false);
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
    setGitReviewOpen(true);
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
          provider: "duckduckgo",
        },
      }),
    [localWorkspace, onSendMessage, webSearch.maxResults],
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
    if (rightRailHasActivity) {
      setRightRailOpen(true);
    }
  }, [chat.id, rightRailHasActivity]);

  useEffect(() => {
    setGitReviewOpen(false);
  }, [chat.id]);

  useEffect(() => {
    if (!rightRailHasContent) {
      setRightRailOpen(false);
    }
  }, [chat.id, rightRailHasContent]);

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
    if (!browserPreviewEnabled && browserPreviewOpen) {
      setBrowserPreviewExpanded(false);
      setBrowserPreviewOpen(false);
    }
  }, [browserPreviewEnabled, browserPreviewOpen]);

  useEffect(() => {
    if (!browserPreviewEnabled || !browserPreviewUrl) {
      return;
    }

    setBrowserPreviewExpanded(false);
    setBrowserPreviewOpen(true);
    setGitReviewOpen(false);
  }, [browserPreviewEnabled, browserPreviewRequestId, browserPreviewUrl]);

  const composer = (
    <ChatComposer
      chat={chat}
      contextWindowSource={contextWindowSource}
      contextWindowTokens={contextWindowTokens}
      draft={composerDraft}
      isGenerating={isSending}
      lastContextCompaction={lastContextCompaction}
      layout={emptyChat ? "center" : "dock"}
      localWorkspace={localWorkspace}
      lastProviderContextUsage={lastProviderContextUsage}
      model={model}
      modelContextWindows={modelContextWindows}
      onCreateProject={onCreateProject}
      onDraftApplied={onComposerDraftApplied}
      onDeleteQueuedMessage={onDeleteQueuedMessage}
      onHeightChange={setComposerHeight}
      onLocalWorkspaceChange={onLocalWorkspaceChange}
      onModelChange={onModelChange}
      onReviewChanges={handleOpenGitReview}
      onSelectProject={onSelectProject}
      onStopGeneration={onStopGeneration}
      onSteerQueuedMessage={onSteerQueuedMessage}
      onSubmit={onSendMessage}
      projects={projects}
      providerSettings={providerSettings}
      queuedMessageCount={Math.max(queuedMessageCount, queuedMessages.length)}
      queuedMessages={queuedMessages}
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
        inspectorAvailable={rightRailHasContent}
        inspectorOpen={showRightRail}
        pinned={Boolean(chat.pinned)}
        title={chat.title}
        onToggleBrowserPreview={handleToggleBrowserPreview}
        onToggleInspector={() => {
          if (showGitReview) {
            setGitReviewOpen(false);
            setRightRailOpen(rightRailHasContent);
            return;
          }

          setRightRailOpen((open) => (rightRailHasContent ? !open : false));
        }}
        onOpenSideChat={onOpenSideChat}
        onTogglePin={onTogglePin}
        onToggleTerminal={onToggleTerminal}
        terminalEnabled={terminalEnabled}
        terminalOpen={terminalOpen}
      />
      <div
        className="conversation-body"
        data-browser-expanded={showBrowserPreview && browserPreviewExpanded}
        data-browser-resizing={browserPreviewResizing}
        data-git-review-open={showGitReview}
        data-right-rail-open={showRightRail}
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
                hasApiKey={hasApiKey}
                onHeaderBlurChange={setHeaderBlurActive}
                onOpenActivity={() => setRightRailOpen(true)}
                onRequestPlanRevision={onRequestPlanRevision}
                onRegenerateResponse={onRegenerateResponse}
                onResolveToolApproval={onResolveToolApproval}
                onStopGeneration={onStopGeneration}
              />
              {composer}
            </>
          )}
        </section>
        {showRightRail ? <RightRail chat={chat} hasActivity={rightRailHasActivity} onClose={() => setRightRailOpen(false)} onResolveToolApproval={onResolveToolApproval} onSubmitPlanningInput={onSubmitPlanningInput} /> : null}
        {showGitReview ? <GitReviewPanel root={localWorkspace.roots[0] ?? ""} onClose={() => setGitReviewOpen(false)} onSubmitReview={handleSubmitGitReview} /> : null}
        {showBrowserPreview ? (
          <BrowserPreviewPanel
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
        ) : null}
      </div>
    </div>
  );
}

const BROWSER_PREVIEW_MIN_WIDTH = 320;
const BROWSER_PREVIEW_MAX_WIDTH = 1120;
const DEFAULT_BROWSER_PREVIEW_WIDTH = 560;
const BROWSER_PREVIEW_RESIZE_STEP = 40;
const PREVIEW_ONLY_RESERVED_WIDTH = 320;
const SPLIT_LAYOUT_RESERVED_WIDTH = 560;

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getQueuedMessages(messages: ChatMessage[]) {
  return messages.filter((message) => message.role === "user" && message.status === "queued");
}
