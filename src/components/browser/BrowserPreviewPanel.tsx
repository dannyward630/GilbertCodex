import { ArrowLeft, ArrowRight, Globe2, GripVertical, LockKeyhole, Maximize2, Minimize2, MoreVertical, PanelRight, Plus, RotateCw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";

interface BrowserPreviewPanelProps {
  expanded: boolean;
  initialUrl?: string;
  previewWidth: number;
  resizeMaxWidth: number;
  resizeMinWidth: number;
  onClose: () => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>) => void;
  onToggleExpanded: () => void;
}

interface BrowserPreviewTab {
  createdAt: string;
  id: string;
  reloadKey: number;
  updatedAt: string;
  url: string;
}

interface BrowserPreviewSession {
  activeTabId: string;
  tabs: BrowserPreviewTab[];
}

const BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v1";

export function BrowserPreviewPanel({
  expanded,
  initialUrl,
  previewWidth,
  resizeMaxWidth,
  resizeMinWidth,
  onClose,
  onResizeKeyDown,
  onResizeStart,
  onToggleExpanded,
}: BrowserPreviewPanelProps) {
  const fallbackUrl = useMemo(() => normalizePreviewUrl(initialUrl) ?? getDefaultLocalPreviewUrl(), [initialUrl]);
  const [session, setSession] = useState<BrowserPreviewSession>(() => loadBrowserPreviewSession(fallbackUrl));
  const activeTab = getActiveTab(session, fallbackUrl);
  const activeUrl = activeTab.url;
  const [addressDraft, setAddressDraft] = useState(activeUrl);
  const [addressInvalid, setAddressInvalid] = useState(false);
  const previewTitle = formatPreviewTitle(activeUrl);

  useEffect(() => {
    saveBrowserPreviewSession(session);
  }, [session]);

  useEffect(() => {
    setAddressDraft(activeUrl);
    setAddressInvalid(false);
  }, [activeTab.id, activeUrl]);

  function submitAddress(value = addressDraft) {
    const nextUrl = normalizePreviewUrl(value);

    if (!nextUrl) {
      setAddressInvalid(true);
      return;
    }

    updateActiveTab((tab) => ({
      ...tab,
      reloadKey: tab.url === nextUrl ? tab.reloadKey : tab.reloadKey + 1,
      updatedAt: new Date().toISOString(),
      url: nextUrl,
    }));
    setAddressDraft(nextUrl);
    setAddressInvalid(false);
  }

  function updateActiveTab(updater: (tab: BrowserPreviewTab) => BrowserPreviewTab) {
    setSession((currentSession) => {
      const currentActiveTab = getActiveTab(currentSession, fallbackUrl);
      const nextTabs = currentSession.tabs.map((tab) => (tab.id === currentActiveTab.id ? updater(tab) : tab));

      return {
        activeTabId: currentActiveTab.id,
        tabs: nextTabs.length > 0 ? nextTabs : [createPreviewTab(fallbackUrl)],
      };
    });
  }

  function openNewTab() {
    const nextTab = createPreviewTab(fallbackUrl);

    setSession((currentSession) => ({
      activeTabId: nextTab.id,
      tabs: [...currentSession.tabs, nextTab],
    }));
  }

  function closeTab(tabId: string) {
    setSession((currentSession) => {
      const currentTabIndex = currentSession.tabs.findIndex((tab) => tab.id === tabId);
      const remainingTabs = currentSession.tabs.filter((tab) => tab.id !== tabId);

      if (remainingTabs.length === 0) {
        const nextTab = createPreviewTab(fallbackUrl);
        return {
          activeTabId: nextTab.id,
          tabs: [nextTab],
        };
      }

      if (currentSession.activeTabId !== tabId) {
        return {
          ...currentSession,
          tabs: remainingTabs,
        };
      }

      const nextActiveTab = remainingTabs[Math.max(0, Math.min(currentTabIndex, remainingTabs.length - 1))];

      return {
        activeTabId: nextActiveTab.id,
        tabs: remainingTabs,
      };
    });
  }

  function reloadActiveTab() {
    updateActiveTab((tab) => ({
      ...tab,
      reloadKey: tab.reloadKey + 1,
      updatedAt: new Date().toISOString(),
    }));
  }

  return (
    <aside className="browser-preview-panel" data-expanded={expanded} aria-label="Browser preview">
      <div
        className="browser-preview-resize-handle"
        aria-label="Resize browser preview"
        aria-orientation="vertical"
        aria-valuemax={resizeMaxWidth}
        aria-valuemin={resizeMinWidth}
        aria-valuenow={Math.round(previewWidth)}
        role="separator"
        tabIndex={expanded ? -1 : 0}
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizeStart}
      >
        <GripVertical size={15} aria-hidden="true" />
      </div>
      <div className="browser-preview-window">
        <div className="browser-preview-tabbar">
          <div className="browser-preview-tab-strip">
            <div className="browser-preview-badge">
              <Globe2 size={14} aria-hidden="true" />
              <span>Preview</span>
            </div>
            <div className="browser-preview-tabs" role="tablist" aria-label="Browser preview tabs">
              {session.tabs.map((tab) => {
                const tabTitle = formatPreviewTitle(tab.url);
                const selected = tab.id === activeTab.id;

                return (
                  <div className="browser-preview-tab" data-selected={selected} key={tab.id}>
                    <button className="browser-preview-tab-select" type="button" role="tab" aria-selected={selected} title={tab.url} onClick={() => setSession((current) => ({ ...current, activeTabId: tab.id }))}>
                      <Globe2 size={15} aria-hidden="true" />
                      <span>{tabTitle}</span>
                    </button>
                    <button className="browser-preview-tab-close" type="button" aria-label={`Close preview tab ${tabTitle}`} onClick={() => closeTab(tab.id)}>
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              <button className="browser-preview-icon-button" type="button" aria-label="New browser preview tab" onClick={openNewTab}>
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="browser-preview-window-actions">
            <button type="button" aria-label={expanded ? "Restore browser preview" : "Expand browser preview"} onClick={onToggleExpanded}>
              {expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
            </button>
            <button type="button" aria-label="Close browser preview" onClick={onClose}>
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="browser-preview-toolbar">
          <div className="browser-preview-nav">
            <button type="button" aria-label="Back" disabled>
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Forward" disabled>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Reload preview" onClick={reloadActiveTab}>
              <RotateCw size={15} aria-hidden="true" />
            </button>
          </div>

          <form
            className="browser-preview-address"
            aria-label="Address"
            data-invalid={addressInvalid}
            onSubmit={(event) => {
              event.preventDefault();
              submitAddress();
            }}
          >
            <LockKeyhole size={14} aria-hidden="true" />
            <input
              aria-label="Browser preview URL"
              spellCheck={false}
              title={activeUrl}
              value={addressDraft}
              onBlur={(event) => submitAddress(event.currentTarget.value)}
              onChange={(event) => {
                setAddressDraft(event.target.value);
                setAddressInvalid(false);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitAddress(event.currentTarget.value);
                  event.currentTarget.blur();
                }
              }}
            />
          </form>

          <div className="browser-preview-tools">
            <button type="button" aria-label="Find in page" disabled>
              <Search size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Preview layout" disabled>
              <PanelRight size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Browser menu" disabled>
              <MoreVertical size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="browser-preview-content" aria-label={`Preview content for ${activeUrl}`}>
          <iframe className="browser-preview-frame" key={`${activeTab.id}-${activeTab.reloadKey}`} title={`Preview ${previewTitle}`} src={activeUrl} />
        </div>
      </div>
    </aside>
  );
}

function getDefaultLocalPreviewUrl() {
  if (typeof window === "undefined") {
    return "http://127.0.0.1:1420/";
  }

  return normalizePreviewUrl(window.location.href) ?? "http://127.0.0.1:1420/";
}

function normalizePreviewUrl(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue) {
    return null;
  }

  const candidateUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedValue) ? trimmedValue : `http://${trimmedValue}`;

  try {
    const url = new URL(candidateUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function formatPreviewTitle(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;

    return `${url.host}${path}`;
  } catch {
    return value || "Local preview";
  }
}

function createPreviewTab(url: string): BrowserPreviewTab {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    id: createPreviewTabId(),
    reloadKey: 0,
    updatedAt: now,
    url,
  };
}

function createPreviewTabId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `browser-tab-${crypto.randomUUID()}`;
  }

  return `browser-tab-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function getActiveTab(session: BrowserPreviewSession, fallbackUrl: string) {
  return session.tabs.find((tab) => tab.id === session.activeTabId) ?? session.tabs[0] ?? createPreviewTab(fallbackUrl);
}

function loadBrowserPreviewSession(fallbackUrl: string): BrowserPreviewSession {
  if (typeof window === "undefined") {
    const fallbackTab = createPreviewTab(fallbackUrl);
    return {
      activeTabId: fallbackTab.id,
      tabs: [fallbackTab],
    };
  }

  try {
    const storedSession = JSON.parse(window.localStorage.getItem(BROWSER_PREVIEW_SESSION_KEY) ?? "null") as Partial<BrowserPreviewSession> | null;
    const tabs = Array.isArray(storedSession?.tabs)
      ? storedSession.tabs.flatMap((tab) => {
          const normalizedTab = normalizeStoredTab(tab);
          return normalizedTab ? [normalizedTab] : [];
        })
      : [];

    if (tabs.length > 0) {
      const activeTabId = tabs.some((tab) => tab.id === storedSession?.activeTabId) ? String(storedSession?.activeTabId) : tabs[0].id;

      return {
        activeTabId,
        tabs,
      };
    }
  } catch {
    // Fall through to a fresh session.
  }

  const fallbackTab = createPreviewTab(fallbackUrl);

  return {
    activeTabId: fallbackTab.id,
    tabs: [fallbackTab],
  };
}

function saveBrowserPreviewSession(session: BrowserPreviewSession) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(BROWSER_PREVIEW_SESSION_KEY, JSON.stringify(session));
  } catch {
    return;
  }
}

function normalizeStoredTab(value: unknown): BrowserPreviewTab | null {
  if (typeof value !== "object" || !value) {
    return null;
  }

  const tab = value as Partial<BrowserPreviewTab>;
  const url = normalizePreviewUrl(tab.url);

  if (!url) {
    return null;
  }

  return {
    createdAt: typeof tab.createdAt === "string" && tab.createdAt ? tab.createdAt : new Date().toISOString(),
    id: typeof tab.id === "string" && tab.id ? tab.id : createPreviewTabId(),
    reloadKey: typeof tab.reloadKey === "number" && Number.isFinite(tab.reloadKey) ? tab.reloadKey : 0,
    updatedAt: typeof tab.updatedAt === "string" && tab.updatedAt ? tab.updatedAt : new Date().toISOString(),
    url,
  };
}
