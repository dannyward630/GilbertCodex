import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { BrowserPreviewPanel } from "../components/browser/BrowserPreviewPanel";
import { ChatComposer } from "../components/chat/ChatComposer";
import { ChatThread } from "../components/chat/ChatThread";
import { ConversationHeader } from "../components/chat/ConversationHeader";
import { RightRail } from "../components/inspector/RightRail";
import type { AppInfo } from "../types/app";
import type { ChatSendInput, ChatSummary } from "../types/chat";
import type { ThinkingSettings } from "../types/settings";

interface ChatPageProps {
  appInfo: AppInfo;
  chat: ChatSummary;
  hasApiKey: boolean;
  isSending: boolean;
  model: string;
  onModelChange: (model: string) => void;
  onSendMessage: (input: ChatSendInput) => void | Promise<void>;
  onThinkingChange: (thinking: ThinkingSettings) => void;
  thinking: ThinkingSettings;
  onTogglePin: () => void;
}

export function ChatPage({
  appInfo,
  chat,
  hasApiKey,
  isSending,
  model,
  onModelChange,
  onSendMessage,
  onThinkingChange,
  thinking,
  onTogglePin,
}: ChatPageProps) {
  const conversationBodyRef = useRef<HTMLDivElement>(null);
  const [composerHeight, setComposerHeight] = useState(152);
  const [headerBlurActive, setHeaderBlurActive] = useState(false);
  const [rightRailOpen, setRightRailOpen] = useState(false);
  const [browserPreviewOpen, setBrowserPreviewOpen] = useState(false);
  const [browserPreviewExpanded, setBrowserPreviewExpanded] = useState(false);
  const [browserPreviewResizing, setBrowserPreviewResizing] = useState(false);
  const [browserPreviewWidth, setBrowserPreviewWidth] = useState(DEFAULT_BROWSER_PREVIEW_WIDTH);
  const rightRailHasActivity = chatHasThinkingActivity(chat);
  const conversationMainStyle = {
    "--composer-clearance": `${Math.max(composerHeight + 34, 178)}px`,
  } as CSSProperties;
  const showRightRail = rightRailOpen;
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
    setBrowserPreviewOpen((open) => {
      if (open) {
        setBrowserPreviewExpanded(false);
      }

      return !open;
    });
  }, []);

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

      const updateWidth = (clientX: number) => {
        const containerRect = container.getBoundingClientRect();
        setBrowserPreviewWidth(clampBrowserPreviewWidth(containerRect.right - clientX));
      };
      const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX);
      const stopResize = () => {
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
    if (!showBrowserPreview || browserPreviewExpanded) {
      return;
    }

    const handleResize = () => setBrowserPreviewWidth((width) => clampBrowserPreviewWidth(width));
    handleResize();
    window.addEventListener("resize", handleResize);

    return () => window.removeEventListener("resize", handleResize);
  }, [browserPreviewExpanded, clampBrowserPreviewWidth, showBrowserPreview]);

  return (
    <div className="conversation-frame" data-header-blur={headerBlurActive}>
      <ConversationHeader
        browserPreviewOpen={showBrowserPreview}
        inspectorOpen={showRightRail}
        pinned={Boolean(chat.pinned)}
        title={chat.title}
        onToggleBrowserPreview={handleToggleBrowserPreview}
        onToggleInspector={() => setRightRailOpen((open) => !open)}
        onTogglePin={onTogglePin}
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
          />
          <ChatComposer
            disabled={isSending}
            model={model}
            onHeightChange={setComposerHeight}
            onModelChange={onModelChange}
            onSubmit={onSendMessage}
            onThinkingChange={onThinkingChange}
            thinking={thinking}
          />
        </section>
        {showRightRail ? <RightRail chat={chat} hasActivity={rightRailHasActivity} onClose={() => setRightRailOpen(false)} /> : null}
        {showBrowserPreview ? (
          <BrowserPreviewPanel
            expanded={browserPreviewExpanded}
            initialUrl={getBrowserPreviewUrl()}
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

function chatHasThinkingActivity(chat: ChatSummary) {
  return chat.messages.some(
    (message) =>
      message.role === "assistant" &&
      Boolean(message.reasoning?.trim() || message.thinking?.startedAt || message.thinking?.completedAt),
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

function getBrowserPreviewUrl() {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:1420/";
  }

  try {
    const currentUrl = new URL(window.location.href);
    const host = currentUrl.hostname.toLowerCase();
    const isLocalHost = host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";

    return isLocalHost ? currentUrl.href : "http://127.0.0.1:1420/";
  } catch {
    return "http://127.0.0.1:1420/";
  }
}
