import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BrowserPreviewPanel } from "../components/browser/BrowserPreviewPanel";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatThread } from "../components/chat/ChatThread";
import { ConversationHeader } from "../components/chat/ConversationHeader";
import { RightRail, chatHasLiveRightRailActivity, chatHasRightRailContent } from "../components/inspector/RightRail";
import type { ContextWindowUsage, ModelContextWindowMap } from "../lib/contextWindow";
import type { AppInfo } from "../types/app";
import type { ChatComposerDraft, ChatPlanningInputAnswer, ChatSendInput, ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProviderSettings, ThinkingSettings, WebSearchSettings } from "../types/settings";

interface ChatPageProps {
  appInfo: AppInfo;
  browserPreviewEnabled: boolean;
  chat: ChatSummary;
  composerDraft?: ChatComposerDraft | null;
  contextWindowSource: "estimate" | "openrouter";
  contextWindowTokens: number;
  hasApiKey: boolean;
  isSending: boolean;
  localWorkspace: LocalWorkspaceSettings;
  lastProviderContextUsage?: ContextWindowUsage | null;
  maxOutputTokens: number;
  model: string;
  modelContextWindows: ModelContextWindowMap;
  onComposerDraftApplied?: () => void;
  onLocalWorkspaceChange: (settings: LocalWorkspaceSettings) => void;
  onModelChange: (model: string) => void;
  onRegenerateResponse: (messageId: string) => void | Promise<void>;
  onSendMessage: (input: ChatSendInput) => void | Promise<void>;
  onStopGeneration: () => void;
  onSubmitPlanningInput: (messageId: string, answers: ChatPlanningInputAnswer[]) => void | Promise<void>;
  providerSettings: ProviderSettings;
  onThinkingChange: (thinking: ThinkingSettings) => void;
  onWebSearchChange: (webSearch: WebSearchSettings) => void;
  systemPrompt: string;
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
  chat,
  composerDraft,
  contextWindowSource,
  contextWindowTokens,
  hasApiKey,
  isSending,
  localWorkspace,
  lastProviderContextUsage,
  maxOutputTokens,
  model,
  modelContextWindows,
  onComposerDraftApplied,
  onLocalWorkspaceChange,
  onModelChange,
  onRegenerateResponse,
  onSendMessage,
  onStopGeneration,
  onSubmitPlanningInput,
  providerSettings,
  onThinkingChange,
  onWebSearchChange,
  systemPrompt,
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
  const rightRailHasActivity = useMemo(() => chatHasLiveRightRailActivity(chat), [chat]);
  const rightRailHasContent = useMemo(() => chatHasRightRailContent(chat), [chat]);
  const conversationMainStyle = {
    "--composer-clearance": `${Math.max(composerHeight + 34, 178)}px`,
  } as CSSProperties;
  const showRightRail = rightRailOpen && rightRailHasContent;
  const showBrowserPreview = browserPreviewOpen;
  const sideLayout = showRightRail && showBrowserPreview ? "split" : showBrowserPreview ? "preview" : showRightRail ? "rail" : "none";
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
        onToggleInspector={() => setRightRailOpen((open) => (rightRailHasContent ? !open : false))}
        onTogglePin={onTogglePin}
        onToggleTerminal={onToggleTerminal}
        terminalEnabled={terminalEnabled}
        terminalOpen={terminalOpen}
      />
      <div
        className="conversation-body"
        data-browser-expanded={showBrowserPreview && browserPreviewExpanded}
        data-browser-resizing={browserPreviewResizing}
        data-right-rail-open={showRightRail}
        data-side-layout={sideLayout}
        ref={conversationBodyRef}
        style={conversationBodyStyle}
      >
        <section className="conversation-main" aria-label="Chat thread" style={conversationMainStyle}>
          <ChatThread
            appInfo={appInfo}
            chat={chat}
            hasApiKey={hasApiKey}
            onHeaderBlurChange={setHeaderBlurActive}
            onOpenActivity={() => setRightRailOpen(true)}
            onRegenerateResponse={onRegenerateResponse}
            onStopGeneration={onStopGeneration}
          />
          <ChatComposer
            chat={chat}
            contextWindowSource={contextWindowSource}
            contextWindowTokens={contextWindowTokens}
            disabled={isSending}
            draft={composerDraft}
            localWorkspace={localWorkspace}
            lastProviderContextUsage={lastProviderContextUsage}
            maxOutputTokens={maxOutputTokens}
            model={model}
            modelContextWindows={modelContextWindows}
            onDraftApplied={onComposerDraftApplied}
            onHeightChange={setComposerHeight}
            onLocalWorkspaceChange={onLocalWorkspaceChange}
            onModelChange={onModelChange}
            onStopGeneration={onStopGeneration}
            onSubmit={onSendMessage}
            providerSettings={providerSettings}
            onThinkingChange={onThinkingChange}
            onWebSearchChange={onWebSearchChange}
            systemPrompt={systemPrompt}
            thinking={thinking}
            webSearch={webSearch}
          />
        </section>
        {showRightRail ? <RightRail chat={chat} hasActivity={rightRailHasActivity} onClose={() => setRightRailOpen(false)} onSubmitPlanningInput={onSubmitPlanningInput} /> : null}
        {showBrowserPreview ? (
          <BrowserPreviewPanel
            expanded={browserPreviewExpanded}
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
