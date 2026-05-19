import {
  ArrowLeft,
  ArrowRight,
  Bug,
  Compass,
  ExternalLink,
  Globe2,
  GripVertical,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Plus,
  RotateCw,
  Search,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { Webview } from "@tauri-apps/api/webview";
import { isTauriDesktopRuntime } from "../../app/tauriClient";
import { loadPersistentString, savePersistentString } from "../../lib/appStorage";
import {
  clearBrowserConsoleEntries,
  getBrowserConsoleSnapshot,
  installBrowserConsoleMessageBridge,
  recordBrowserConsoleEntry,
  stringifyBrowserConsoleValue,
  subscribeBrowserConsole,
  type BrowserConsoleEntry,
  type BrowserConsoleFilter,
  type BrowserConsoleLevel,
  type BrowserConsoleSnapshot,
} from "../../lib/browserConsole";

interface BrowserPreviewPanelProps {
  closing?: boolean;
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

export interface BrowserPreviewTab {
  createdAt: string;
  history: string[];
  historyIndex: number;
  id: string;
  reloadKey: number;
  updatedAt: string;
  url?: string;
}

export interface BrowserPreviewSession {
  activeTabId: string;
  tabs: BrowserPreviewTab[];
}

type LocalPreviewStatus = "available" | "checking" | "unavailable";
type NativeBrowserStatus = "idle" | "loading" | "ready" | "error";
export type SearchEngineId = "duckduckgo" | "github" | "google" | "youtube";

interface NativeBrowserInstance {
  generation: number;
  label: string;
  reloadKey: number;
  tabId: string;
  url: string;
  webview: Webview;
}

interface NativeBrowserBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface SearchEngine {
  id: SearchEngineId;
  label: string;
  searchUrl: (query: string) => string;
}

const BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v2";
const LEGACY_BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v1";
const DEFAULT_SEARCH_ENGINE_ID: SearchEngineId = "duckduckgo";
const LOCAL_PROBE_TIMEOUT_MS = 900;
const LOCAL_PREVIEW_PORTS = [5173, 5174, 3000, 3001, 4173, 4174, 4200, 4201, 4321, 4322, 5000, 5001, 5500, 6006, 8000, 8001, 8080, 8081, 1313, 4000];
const NATIVE_BROWSER_CREATE_TIMEOUT_MS = 6_000;
const HIDDEN_NATIVE_BROWSER_BOUNDS: NativeBrowserBounds = { height: 1, width: 1, x: 0, y: 0 };
const BROWSER_CONSOLE_FILTERS: BrowserConsoleFilter[] = ["all", "error", "warning", "log", "info"];
const SEARCH_ENGINES: SearchEngine[] = [
  {
    id: "google",
    label: "Google",
    searchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    id: "youtube",
    label: "YouTube",
    searchUrl: (query) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  },
  {
    id: "github",
    label: "GitHub",
    searchUrl: (query) => `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    searchUrl: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  },
];

export function BrowserPreviewPanel({
  closing = false,
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
  const activeTabElementRef = useRef<HTMLDivElement | null>(null);
  const nativeFrameRef = useRef<HTMLDivElement>(null);
  const nativeBrowserRef = useRef<NativeBrowserInstance | null>(null);
  const nativeBrowserInstancesRef = useRef<Map<string, NativeBrowserInstance>>(new Map());
  const nativeBrowserGenerationRef = useRef(0);
  const normalizedInitialUrl = useMemo(() => {
    const url = normalizePreviewUrl(initialUrl);
    return url && !isCurrentAppUrl(url) ? url : null;
  }, [initialUrl]);
  const [session, setSession] = useState<BrowserPreviewSession>(() => loadBrowserPreviewSession(normalizedInitialUrl));
  const [mountedIframeTabIds, setMountedIframeTabIds] = useState<Set<string>>(() => new Set());
  const [localPreview, setLocalPreview] = useState<{ status: LocalPreviewStatus; url?: string }>({ status: "checking" });
  const activeTab = getActiveTab(session);
  const activeUrl = activeTab.url;
  const [addressDraft, setAddressDraft] = useState(activeUrl ?? "");
  const [addressInvalid, setAddressInvalid] = useState(false);
  const [activeLocalStatus, setActiveLocalStatus] = useState<LocalPreviewStatus>("available");
  const [nativeBrowserStatus, setNativeBrowserStatus] = useState<NativeBrowserStatus>("idle");
  const [nativeBrowserError, setNativeBrowserError] = useState("");
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleFilter, setConsoleFilter] = useState<BrowserConsoleFilter>("all");
  const [consoleSnapshot, setConsoleSnapshot] = useState<BrowserConsoleSnapshot>(() => getBrowserConsoleSnapshot());
  const selectedSearchEngine = getSearchEngine(DEFAULT_SEARCH_ENGINE_ID);
  const activeUrlIsLocal = Boolean(activeUrl && isLocalHttpUrl(activeUrl));
  const nativeBrowserEnabled = !closing && isTauriDesktopRuntime() && Boolean(activeUrl && !activeUrlIsLocal);
  const showFrame = Boolean(activeUrl && (!activeUrlIsLocal || activeLocalStatus === "available"));
  const iframeTabs = session.tabs.filter((tab) => mountedIframeTabIds.has(tab.id) && tab.url && shouldRenderIframeForUrl(tab.url));
  const visibleConsoleEntries = useMemo(() => filterBrowserConsoleEntries(consoleSnapshot.entries, consoleFilter), [consoleFilter, consoleSnapshot.entries]);
  const activeConsoleIssueCount = consoleSnapshot.counts.error + consoleSnapshot.counts.warning;
  const activeHistoryState = getTabHistoryState(activeTab);
  const canGoBack = activeHistoryState.historyIndex > 0;
  const canGoForward = activeHistoryState.historyIndex >= 0 && activeHistoryState.historyIndex < activeHistoryState.history.length - 1;

  const closeNativeBrowserTab = useCallback((tabId: string) => {
    const instance = nativeBrowserInstancesRef.current.get(tabId);

    if (!instance) {
      return;
    }

    nativeBrowserInstancesRef.current.delete(tabId);

    if (nativeBrowserRef.current?.label === instance.label) {
      nativeBrowserRef.current = null;
      setNativeBrowserStatus("idle");
      setNativeBrowserError("");
    }

    closeNativeBrowserInstance(instance);
  }, []);

  const closeAllNativeBrowserInstances = useCallback(() => {
    const instances = [...nativeBrowserInstancesRef.current.values()];

    if (nativeBrowserRef.current && !instances.some((instance) => instance.label === nativeBrowserRef.current?.label)) {
      instances.push(nativeBrowserRef.current);
    }

    nativeBrowserInstancesRef.current.clear();
    nativeBrowserRef.current = null;
    instances.forEach(closeNativeBrowserInstance);
    setNativeBrowserStatus("idle");
    setNativeBrowserError("");
  }, []);

  const hideInactiveNativeBrowserInstances = useCallback((activeTabId?: string) => {
    for (const instance of nativeBrowserInstancesRef.current.values()) {
      if (instance.tabId !== activeTabId) {
        void hideNativeBrowserInstance(instance);
      }
    }
  }, []);

  const syncNativeBrowserBounds = useCallback(() => {
    const instance = nativeBrowserRef.current;
    const frame = nativeFrameRef.current;

    if (!instance || !frame) {
      return;
    }

    const bounds = getNativeBrowserBounds(frame);

    if (!bounds) {
      void hideNativeBrowserInstance(instance);
      return;
    }

    void setNativeBrowserBounds(instance.webview, bounds);
  }, []);

  useEffect(() => {
    saveBrowserPreviewSession(session);
  }, [session]);

  useEffect(() => {
    const refreshConsoleSnapshot = () => setConsoleSnapshot(getBrowserConsoleSnapshot());
    const unsubscribe = subscribeBrowserConsole(refreshConsoleSnapshot);
    refreshConsoleSnapshot();

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    return installBrowserConsoleMessageBridge(window);
  }, []);

  useEffect(() => {
    if (!isTauriDesktopRuntime()) {
      return;
    }

    void closeStaleNativeBrowserInstances();

    return () => {
      closeAllNativeBrowserInstances();
      void closeStaleNativeBrowserInstances();
    };
  }, [closeAllNativeBrowserInstances]);

  useEffect(() => {
    if (!closing) {
      return;
    }

    closeAllNativeBrowserInstances();
    void closeStaleNativeBrowserInstances();
  }, [closing, closeAllNativeBrowserInstances]);

  useEffect(() => {
    if (!normalizedInitialUrl) {
      return;
    }

    setSession((currentSession) => openUrlInSession(currentSession, normalizedInitialUrl));
  }, [normalizedInitialUrl]);

  useEffect(() => {
    let cancelled = false;

    setLocalPreview({ status: "checking" });
    void findAvailableLocalPreview().then((url) => {
      if (cancelled) {
        return;
      }

      setLocalPreview(url ? { status: "available", url } : { status: "unavailable" });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setAddressDraft(activeUrl ?? "");
    setAddressInvalid(false);
  }, [activeTab.id, activeUrl]);

  useEffect(() => {
    activeTabElementRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTab.id, session.tabs.length]);

  useEffect(() => {
    if (!activeUrl || !isLocalHttpUrl(activeUrl)) {
      setActiveLocalStatus("available");
      return;
    }

    let cancelled = false;

    setActiveLocalStatus("checking");
    void probeUrl(activeUrl).then((available) => {
      if (!cancelled) {
        setActiveLocalStatus(available ? "available" : "unavailable");

        if (!available) {
          recordBrowserConsoleEntry({
            kind: "network",
            level: "warning",
            message: `Local preview did not respond: ${activeUrl}`,
            source: "Browser preview",
            tabId: activeTab.id,
            tabTitle: formatBrowserPreviewTitle(activeUrl),
            url: activeUrl,
          });
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab.id, activeTab.reloadKey, activeUrl]);

  useEffect(() => {
    setMountedIframeTabIds((currentTabIds) => {
      const liveTabIds = new Set(session.tabs.map((tab) => tab.id));
      const nextTabIds = new Set([...currentTabIds].filter((tabId) => liveTabIds.has(tabId)));

      if (activeUrl && showFrame && !nativeBrowserEnabled && !closing) {
        nextTabIds.add(activeTab.id);
      }

      return areSetsEqual(currentTabIds, nextTabIds) ? currentTabIds : nextTabIds;
    });
  }, [activeTab.id, activeUrl, closing, nativeBrowserEnabled, session.tabs, showFrame]);

  useEffect(() => {
    if (!nativeBrowserEnabled || !showFrame || !activeUrl) {
      nativeBrowserRef.current = null;
      setNativeBrowserStatus("idle");
      setNativeBrowserError("");
      hideInactiveNativeBrowserInstances();
      return;
    }

    let disposed = false;
    const tabId = activeTab.id;
    const reloadKey = activeTab.reloadKey;
    const existingInstance = nativeBrowserInstancesRef.current.get(tabId);

    hideInactiveNativeBrowserInstances(tabId);

    if (existingInstance && existingInstance.url === activeUrl && existingInstance.reloadKey === reloadKey) {
      nativeBrowserRef.current = existingInstance;
      setNativeBrowserStatus("ready");
      setNativeBrowserError("");
      void showNativeBrowserInstance(existingInstance);
      syncNativeBrowserBounds();
      return;
    }

    if (existingInstance) {
      nativeBrowserInstancesRef.current.delete(tabId);
      closeNativeBrowserInstance(existingInstance);
    }

    const generation = nativeBrowserGenerationRef.current + 1;
    nativeBrowserGenerationRef.current = generation;
    const label = createNativeBrowserLabel(tabId, generation);

    nativeBrowserRef.current = null;
    setNativeBrowserStatus("loading");
    setNativeBrowserError("");

    void createNativeBrowserInstance(label, activeUrl, nativeFrameRef.current)
      .then((webview) => {
        if (disposed || nativeBrowserGenerationRef.current !== generation) {
          void webview.close().catch(() => undefined);
          return;
        }

        const instance: NativeBrowserInstance = {
          generation,
          label,
          reloadKey,
          tabId,
          url: activeUrl,
          webview,
        };
        nativeBrowserRef.current = instance;
        nativeBrowserInstancesRef.current.set(tabId, instance);
        setNativeBrowserStatus("ready");
        recordBrowserConsoleEntry({
          kind: "browser",
          level: "info",
          message: `Opened native browser view: ${activeUrl}`,
          source: "Browser preview",
          tabId,
          tabTitle: formatBrowserPreviewTitle(activeUrl),
          url: activeUrl,
        });
        hideInactiveNativeBrowserInstances(tabId);
        syncNativeBrowserBounds();
      })
      .catch((error: unknown) => {
        if (disposed || nativeBrowserGenerationRef.current !== generation) {
          return;
        }

        nativeBrowserRef.current = null;
        setNativeBrowserStatus("error");
        const message = error instanceof Error ? error.message : "Could not open the native browser view.";
        setNativeBrowserError(message);
        recordBrowserConsoleEntry({
          kind: "browser",
          level: "error",
          message,
          source: "Browser preview",
          tabId,
          tabTitle: formatBrowserPreviewTitle(activeUrl),
          url: activeUrl,
        });
      });

    return () => {
      disposed = true;
    };
  }, [activeTab.id, activeTab.reloadKey, activeUrl, hideInactiveNativeBrowserInstances, nativeBrowserEnabled, showFrame, syncNativeBrowserBounds]);

  useLayoutEffect(() => {
    if (!nativeBrowserEnabled || !showFrame || !activeUrl) {
      return;
    }

    const frame = nativeFrameRef.current;

    if (!frame) {
      return;
    }

    let resizeFrame: number | null = null;
    const scheduleSync = () => {
      if (resizeFrame !== null) {
        return;
      }

      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        syncNativeBrowserBounds();
      });
    };
    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(frame);
    window.addEventListener("resize", scheduleSync);
    window.addEventListener("scroll", scheduleSync, true);
    const steadySyncInterval = window.setInterval(scheduleSync, 160);

    scheduleSync();

    return () => {
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
      }

      resizeObserver.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.removeEventListener("scroll", scheduleSync, true);
      window.clearInterval(steadySyncInterval);
    };
  }, [activeUrl, nativeBrowserEnabled, showFrame, syncNativeBrowserBounds]);

  useEffect(() => {
    return () => {
      closeAllNativeBrowserInstances();
    };
  }, [closeAllNativeBrowserInstances]);

  function submitAddress(value = addressDraft, engineId = DEFAULT_SEARCH_ENGINE_ID) {
    const nextUrl = createBrowserPreviewNavigationUrl(value, engineId);

    if (!nextUrl) {
      setAddressInvalid(true);
      return;
    }

    navigateToUrl(nextUrl);
  }

  function navigateToUrl(nextUrl: string) {
    closeNativeBrowserTab(activeTab.id);
    recordBrowserConsoleEntry({
      kind: "browser",
      level: "info",
      message: `Navigating to ${nextUrl}`,
      source: "Browser preview",
      tabId: activeTab.id,
      tabTitle: formatBrowserPreviewTitle(nextUrl),
      url: nextUrl,
    });
    updateActiveTab((tab) => ({
      ...tab,
      ...createNavigationHistoryUpdate(tab, nextUrl),
      reloadKey: tab.url === nextUrl ? tab.reloadKey + 1 : tab.reloadKey,
      updatedAt: new Date().toISOString(),
      url: nextUrl,
    }));
    setAddressDraft(nextUrl);
    setAddressInvalid(false);
  }

  function updateActiveTab(updater: (tab: BrowserPreviewTab) => BrowserPreviewTab) {
    setSession((currentSession) => {
      const ensuredSession = ensureSession(currentSession);
      const currentActiveTab = getActiveTab(ensuredSession);
      const nextTabs = ensuredSession.tabs.map((tab) => (tab.id === currentActiveTab.id ? updater(tab) : tab));

      return {
        activeTabId: currentActiveTab.id,
        tabs: nextTabs,
      };
    });
  }

  function openNewTab() {
    const nextTab = createPreviewTab();

    setSession((currentSession) => ({
      activeTabId: nextTab.id,
      tabs: [...ensureSession(currentSession).tabs, nextTab],
    }));
  }

  function navigateHistory(delta: -1 | 1) {
    const historyState = getTabHistoryState(activeTab);
    const nextUrl = historyState.history[historyState.historyIndex + delta];

    if (!nextUrl) {
      return;
    }

    closeNativeBrowserTab(activeTab.id);
    recordBrowserConsoleEntry({
      kind: "browser",
      level: "info",
      message: `History ${delta < 0 ? "back" : "forward"} to ${nextUrl}`,
      source: "Browser preview",
      tabId: activeTab.id,
      tabTitle: formatBrowserPreviewTitle(nextUrl),
      url: nextUrl,
    });
    updateActiveTab((tab) => {
      const currentHistoryState = getTabHistoryState(tab);
      const nextIndex = currentHistoryState.historyIndex + delta;
      const currentNextUrl = currentHistoryState.history[nextIndex];

      if (!currentNextUrl) {
        return tab;
      }

      return {
        ...tab,
        history: currentHistoryState.history,
        historyIndex: nextIndex,
        reloadKey: tab.reloadKey + 1,
        updatedAt: new Date().toISOString(),
        url: currentNextUrl,
      };
    });
    setAddressInvalid(false);
  }

  function closeTab(tabId: string) {
    closeNativeBrowserTab(tabId);
    setMountedIframeTabIds((currentTabIds) => {
      if (!currentTabIds.has(tabId)) {
        return currentTabIds;
      }

      const nextTabIds = new Set(currentTabIds);
      nextTabIds.delete(tabId);
      return nextTabIds;
    });

    setSession((currentSession) => {
      return closeBrowserPreviewSessionTab(currentSession, tabId);
    });
  }

  function reloadActiveTab() {
    if (!activeUrl) {
      return;
    }

    closeNativeBrowserTab(activeTab.id);
    recordBrowserConsoleEntry({
      kind: "browser",
      level: "info",
      message: `Reloading ${activeUrl}`,
      source: "Browser preview",
      tabId: activeTab.id,
      tabTitle: formatBrowserPreviewTitle(activeUrl),
      url: activeUrl,
    });
    updateActiveTab((tab) => ({
      ...tab,
      reloadKey: tab.reloadKey + 1,
      updatedAt: new Date().toISOString(),
    }));
  }

  function activateTab(tabId: string) {
    if (tabId === activeTab.id) {
      return;
    }

    setSession((current) => activateBrowserPreviewSessionTab(current, tabId));
  }

  function handleClosePanel() {
    closeAllNativeBrowserInstances();
    void closeStaleNativeBrowserInstances();
    onClose();
  }

  function handleTabListWheel(event: WheelEvent<HTMLDivElement>) {
    const tabList = event.currentTarget;

    if (tabList.scrollWidth <= tabList.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
      return;
    }

    event.preventDefault();
    tabList.scrollLeft += event.deltaY;
  }

  return (
    <aside className="browser-preview-panel" data-expanded={expanded} aria-label="Browser">
      <div
        className="browser-preview-resize-handle"
        aria-label="Resize browser"
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
            <div className="browser-preview-tabs" role="tablist" aria-label="Browser tabs" onWheel={handleTabListWheel}>
              {session.tabs.map((tab) => {
                const tabTitle = formatBrowserPreviewTitle(tab.url);
                const selected = tab.id === activeTab.id;

                return (
                  <div
                    className="browser-preview-tab"
                    data-selected={selected}
                    key={tab.id}
                    ref={(node) => {
                      if (selected) {
                        activeTabElementRef.current = node;
                      }
                    }}
                  >
                    <button
                      className="browser-preview-tab-select"
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      title={tab.url ?? "New tab"}
                      onClick={() => activateTab(tab.id)}
                    >
                      <Globe2 size={15} aria-hidden="true" />
                      <span>{tabTitle}</span>
                    </button>
                    <button className="browser-preview-tab-close" type="button" aria-label={`Close ${tabTitle}`} onClick={() => closeTab(tab.id)}>
                      <X size={13} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
              <button className="browser-preview-icon-button" type="button" aria-label="New browser tab" onClick={openNewTab}>
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="browser-preview-window-actions">
            <button type="button" aria-label={expanded ? "Restore browser" : "Expand browser"} onClick={onToggleExpanded}>
              {expanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}
            </button>
            <button type="button" aria-label="Close browser" onClick={handleClosePanel}>
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="browser-preview-toolbar">
          <div className="browser-preview-nav">
            <button type="button" aria-label="Back" disabled={!canGoBack} onClick={() => navigateHistory(-1)}>
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Forward" disabled={!canGoForward} onClick={() => navigateHistory(1)}>
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Reload page" disabled={!activeUrl} onClick={reloadActiveTab}>
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
            <Search size={14} aria-hidden="true" />
            <input
              aria-label="Search or enter URL"
              placeholder={`Search ${selectedSearchEngine.label} or enter URL`}
              spellCheck={false}
              title={activeUrl ?? "Search or enter URL"}
              value={addressDraft}
              onBlur={() => {
                if (!addressDraft.trim()) {
                  setAddressDraft(activeUrl ?? "");
                  setAddressInvalid(false);
                }
              }}
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
            <button
              className="browser-preview-console-button"
              data-active={consoleOpen}
              type="button"
              aria-label={consoleOpen ? "Close browser console" : "Open browser console"}
              title={consoleOpen ? "Close browser console" : "Open browser console"}
              onClick={() => setConsoleOpen((open) => !open)}
            >
              {activeConsoleIssueCount > 0 ? <Bug size={15} aria-hidden="true" /> : <Terminal size={15} aria-hidden="true" />}
              {activeConsoleIssueCount > 0 ? (
                <span className="browser-preview-console-badge" data-tone={consoleSnapshot.counts.error > 0 ? "error" : "warning"}>
                  {Math.min(activeConsoleIssueCount, 99)}
                </span>
              ) : null}
            </button>
            {activeUrl ? (
              <a className="browser-preview-icon-link" href={activeUrl} target="_blank" rel="noopener noreferrer" aria-label="Open page externally" title="Open page externally">
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            ) : null}
          </div>
        </div>

        <div className="browser-preview-content" aria-label={activeUrl ? `Browser content for ${activeUrl}` : "Browser start page"}>
          {showFrame && nativeBrowserEnabled ? (
            <div className="browser-preview-native-frame" data-status={nativeBrowserStatus} ref={nativeFrameRef}>
              {nativeBrowserStatus !== "ready" ? (
                <BrowserNativeStatus activeUrl={activeUrl!} error={nativeBrowserError} status={nativeBrowserStatus} />
              ) : null}
            </div>
          ) : null}
          {iframeTabs.map((tab) => {
            const frameActive = tab.id === activeTab.id && showFrame && !nativeBrowserEnabled && !closing;

            return (
              <iframe
                aria-hidden={!frameActive}
                className="browser-preview-frame"
                data-active={frameActive}
                key={createBrowserPreviewFrameKey(tab)}
                onError={() => {
                  recordBrowserConsoleEntry({
                    kind: "network",
                    level: "error",
                    message: `Frame failed to load: ${tab.url}`,
                    source: "Browser preview",
                    tabId: tab.id,
                    tabTitle: formatBrowserPreviewTitle(tab.url),
                    url: tab.url,
                  });
                }}
                onLoad={(event) => handleBrowserFrameLoad(event.currentTarget, tab)}
                src={tab.url}
                title={formatBrowserPreviewTitle(tab.url)}
              />
            );
          })}
          {!showFrame ? (
            <BrowserStartPage
              activeLocalStatus={activeUrlIsLocal ? activeLocalStatus : "available"}
              activeUrl={activeUrl}
              addressDraft={addressDraft}
              localPreview={localPreview}
              onNavigate={navigateToUrl}
              onSubmit={submitAddress}
            />
          ) : null}
          {consoleOpen ? (
            <BrowserConsoleDrawer
              entries={visibleConsoleEntries}
              filter={consoleFilter}
              snapshot={consoleSnapshot}
              onClear={clearBrowserConsoleEntries}
              onClose={() => setConsoleOpen(false)}
              onFilterChange={setConsoleFilter}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}

function BrowserConsoleDrawer({
  entries,
  filter,
  onClear,
  onClose,
  onFilterChange,
  snapshot,
}: {
  entries: BrowserConsoleEntry[];
  filter: BrowserConsoleFilter;
  onClear: () => void;
  onClose: () => void;
  onFilterChange: (filter: BrowserConsoleFilter) => void;
  snapshot: BrowserConsoleSnapshot;
}) {
  return (
    <section className="browser-preview-console-drawer" aria-label="Browser console">
      <header className="browser-preview-console-header">
        <div className="browser-preview-console-title">
          <Terminal size={15} aria-hidden="true" />
          <span>Console</span>
          <small>{snapshot.counts.total} events</small>
        </div>
        <div className="browser-preview-console-filters" aria-label="Console filters">
          {BROWSER_CONSOLE_FILTERS.map((filterId) => (
            <button type="button" data-active={filter === filterId} key={filterId} onClick={() => onFilterChange(filterId)}>
              {formatBrowserConsoleFilterLabel(filterId)}
              <span>{getBrowserConsoleFilterCount(snapshot, filterId)}</span>
            </button>
          ))}
        </div>
        <div className="browser-preview-console-actions">
          <button type="button" aria-label="Clear browser console" title="Clear browser console" disabled={snapshot.counts.total === 0} onClick={onClear}>
            <Trash2 size={14} aria-hidden="true" />
          </button>
          <button type="button" aria-label="Close browser console" title="Close browser console" onClick={onClose}>
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="browser-preview-console-summary" aria-live="polite">
        <span data-tone={snapshot.counts.error > 0 ? "error" : "default"}>{snapshot.counts.error} errors</span>
        <span data-tone={snapshot.counts.warning > 0 ? "warning" : "default"}>{snapshot.counts.warning} warnings</span>
        <span>{snapshot.filteredCount} shown</span>
        {snapshot.truncated ? <span>recent entries</span> : null}
      </div>
      <div className="browser-preview-console-entries" role="log" aria-label="Console entries">
        {entries.length > 0 ? (
          entries.map((entry) => <BrowserConsoleEntryRow entry={entry} key={entry.id} />)
        ) : (
          <div className="browser-preview-console-empty">
            <Bug size={17} aria-hidden="true" />
            <span>No console entries yet.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function BrowserConsoleEntryRow({ entry }: { entry: BrowserConsoleEntry }) {
  return (
    <article className="browser-preview-console-entry" data-level={entry.level}>
      <div className="browser-preview-console-entry-main">
        <span className="browser-preview-console-entry-level">{formatBrowserConsoleLevel(entry.level)}</span>
        <span className="browser-preview-console-entry-message">{entry.message}</span>
      </div>
      <div className="browser-preview-console-entry-meta">
        <span>{formatBrowserConsoleTime(entry.timestamp)}</span>
        <span>{entry.source}</span>
        {entry.tabTitle ? <span>{entry.tabTitle}</span> : null}
        {entry.url ? <span title={entry.url}>{entry.url}</span> : null}
        {typeof entry.line === "number" ? <span>line {entry.line}</span> : null}
      </div>
      {entry.stack ? <pre>{entry.stack}</pre> : null}
    </article>
  );
}

function BrowserNativeStatus({ activeUrl, error, status }: { activeUrl: string; error: string; status: NativeBrowserStatus }) {
  if (status === "error") {
    return (
      <section className="browser-preview-start" aria-label="Native browser status">
        <Globe2 size={22} aria-hidden="true" />
        <h2>Browser unavailable</h2>
        <span>{error || formatBrowserPreviewTitle(activeUrl)}</span>
      </section>
    );
  }

  return (
    <section className="browser-preview-start" aria-label="Native browser status">
      <LoaderCircle className="browser-preview-start-spinner" size={22} aria-hidden="true" />
      <h2>Opening browser</h2>
      <span>{formatBrowserPreviewTitle(activeUrl)}</span>
    </section>
  );
}

interface BrowserStartPageProps {
  activeLocalStatus: LocalPreviewStatus;
  activeUrl?: string;
  addressDraft: string;
  localPreview: { status: LocalPreviewStatus; url?: string };
  onNavigate: (url: string) => void;
  onSubmit: (value: string, engineId?: SearchEngineId) => void;
}

function BrowserStartPage({
  activeLocalStatus,
  activeUrl,
  addressDraft,
  localPreview,
  onNavigate,
  onSubmit,
}: BrowserStartPageProps) {
  const selectedSearchEngine = getSearchEngine(DEFAULT_SEARCH_ENGINE_ID);
  const [startDraft, setStartDraft] = useState(addressDraft);

  useEffect(() => {
    setStartDraft(addressDraft);
  }, [addressDraft]);

  if (activeUrl && activeLocalStatus !== "available") {
    return (
      <section className="browser-preview-start" aria-label="Local server status">
        {activeLocalStatus === "checking" ? <LoaderCircle className="browser-preview-start-spinner" size={22} aria-hidden="true" /> : <Globe2 size={22} aria-hidden="true" />}
        <h2>{activeLocalStatus === "checking" ? "Checking localhost" : "Localhost unavailable"}</h2>
        <span>{formatBrowserPreviewTitle(activeUrl)}</span>
      </section>
    );
  }

  return (
    <section className="browser-preview-start" aria-label="Browser start">
      <div className="browser-preview-start-mark" aria-hidden="true">
        <Compass size={28} />
      </div>
      <h2>New tab</h2>
      <form
        className="browser-preview-start-search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(startDraft, DEFAULT_SEARCH_ENGINE_ID);
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input aria-label="Search the web" value={startDraft} placeholder={`Search ${selectedSearchEngine.label} or enter URL`} onChange={(event) => setStartDraft(event.target.value)} />
        <button type="submit">Search</button>
      </form>

      {localPreview.status === "available" && localPreview.url ? (
        <div className="browser-preview-local-actions" aria-label="Local browser targets">
          <button type="button" onClick={() => onNavigate(localPreview.url!)}>
            Open local site
          </button>
        </div>
      ) : null}
    </section>
  );
}

function handleBrowserFrameLoad(frame: HTMLIFrameElement, tab: BrowserPreviewTab) {
  recordBrowserConsoleEntry({
    kind: "browser",
    level: "info",
    message: `Loaded frame: ${tab.url}`,
    source: "Browser preview",
    tabId: tab.id,
    tabTitle: formatBrowserPreviewTitle(tab.url),
    url: tab.url,
  });
  installSameOriginFrameConsoleBridge(frame, tab);
}

function installSameOriginFrameConsoleBridge(frame: HTMLIFrameElement, tab: BrowserPreviewTab) {
  try {
    const frameWindow = frame.contentWindow as (Window & { __gilbertBrowserConsoleBridgeInstalled?: boolean }) | null;

    if (!frameWindow || frameWindow.__gilbertBrowserConsoleBridgeInstalled) {
      return;
    }

    void frame.contentDocument?.body;
    frameWindow.__gilbertBrowserConsoleBridgeInstalled = true;

    const frameConsole = (frameWindow as unknown as { console?: unknown }).console;
    if (!frameConsole) {
      return;
    }

    const consoleRef = frameConsole as Record<string, (...args: unknown[]) => void>;
    const methods: Array<BrowserConsoleLevel | "warn"> = ["debug", "info", "log", "warn", "error"];

    for (const method of methods) {
      const original = typeof consoleRef[method] === "function" ? consoleRef[method].bind(frameConsole) : undefined;

      consoleRef[method] = (...args: unknown[]) => {
        try {
          original?.(...args);
        } finally {
          recordBrowserConsoleEntry({
            kind: "console",
            level: method,
            message: args.map(stringifyBrowserConsoleValue).join(" "),
            source: "Preview page",
            tabId: tab.id,
            tabTitle: formatBrowserPreviewTitle(tab.url),
            url: tab.url,
          });
        }
      };
    }

    frameWindow.addEventListener("error", (event) => {
      recordBrowserConsoleEntry({
        column: event.colno,
        kind: "pageerror",
        level: "error",
        line: event.lineno,
        message: event.message || "Uncaught page error",
        source: "Preview page",
        stack: event.error instanceof Error ? event.error.stack : undefined,
        tabId: tab.id,
        tabTitle: formatBrowserPreviewTitle(tab.url),
        url: event.filename || tab.url,
      });
    });

    frameWindow.addEventListener("unhandledrejection", (event) => {
      recordBrowserConsoleEntry({
        kind: "pageerror",
        level: "error",
        message: stringifyBrowserConsoleValue(event.reason ?? "Unhandled promise rejection"),
        source: "Preview page",
        stack: event.reason instanceof Error ? event.reason.stack : undefined,
        tabId: tab.id,
        tabTitle: formatBrowserPreviewTitle(tab.url),
        url: tab.url,
      });
    });
  } catch {
    return;
  }
}

function filterBrowserConsoleEntries(entries: BrowserConsoleEntry[], filter: BrowserConsoleFilter) {
  return filter === "all" ? entries : entries.filter((entry) => entry.level === filter);
}

function getBrowserConsoleFilterCount(snapshot: BrowserConsoleSnapshot, filter: BrowserConsoleFilter) {
  return filter === "all" ? snapshot.counts.total : snapshot.counts[filter];
}

function formatBrowserConsoleFilterLabel(filter: BrowserConsoleFilter) {
  if (filter === "all") {
    return "All";
  }

  return formatBrowserConsoleLevel(filter);
}

function formatBrowserConsoleLevel(level: BrowserConsoleLevel) {
  return level === "warning" ? "Warn" : level.charAt(0).toUpperCase() + level.slice(1);
}

function formatBrowserConsoleTime(timestamp: string) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function createBrowserPreviewNavigationUrl(value: string, engineId: SearchEngineId = DEFAULT_SEARCH_ENGINE_ID) {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const directUrl = normalizePreviewUrl(trimmedValue);

  if (directUrl && looksLikeUrl(trimmedValue)) {
    return directUrl;
  }

  return getSearchEngine(engineId).searchUrl(trimmedValue);
}

function normalizePreviewUrl(value?: string) {
  const trimmedValue = value?.trim();

  if (!trimmedValue || /\s/.test(trimmedValue)) {
    return null;
  }

  const candidateUrl = createDirectUrlCandidate(trimmedValue);

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

function createDirectUrlCandidate(value: string) {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    return value;
  }

  return isLocalHostInput(value) ? `http://${value}` : `https://${value}`;
}

function looksLikeUrl(value: string) {
  const trimmedValue = value.trim();

  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedValue) ||
    isLocalHostInput(trimmedValue) ||
    /^[^\s/]+\.[^\s]{2,}(?:\/.*)?$/i.test(trimmedValue) ||
    /^[^\s/:]+:\d{2,5}(?:\/.*)?$/i.test(trimmedValue)
  );
}

function isLocalHostInput(value: string) {
  const trimmedValue = value.trim().toLowerCase();

  return (
    trimmedValue === "localhost" ||
    trimmedValue.startsWith("localhost:") ||
    trimmedValue.startsWith("localhost/") ||
    trimmedValue === "127.0.0.1" ||
    trimmedValue.startsWith("127.0.0.1:") ||
    trimmedValue.startsWith("127.0.0.1/") ||
    trimmedValue === "0.0.0.0" ||
    trimmedValue.startsWith("0.0.0.0:") ||
    trimmedValue.startsWith("0.0.0.0/") ||
    trimmedValue === "[::1]" ||
    trimmedValue.startsWith("[::1]:") ||
    trimmedValue.startsWith("[::1]/")
  );
}

export function formatBrowserPreviewTitle(value?: string) {
  if (!value) {
    return "New tab";
  }

  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;

    if ((url.protocol === "http:" || url.protocol === "https:") && isLocalHostName(url.hostname)) {
      return path ? `Local site${path}` : "Local site";
    }

    return `${url.host}${path}`;
  } catch {
    return value;
  }
}

function createPreviewTab(url?: string): BrowserPreviewTab {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    history: url ? [url] : [],
    historyIndex: url ? 0 : -1,
    id: createPreviewTabId(),
    reloadKey: 0,
    updatedAt: now,
    url,
  };
}

function createBrowserPreviewSession(url?: string): BrowserPreviewSession {
  const tab = createPreviewTab(url);

  return {
    activeTabId: tab.id,
    tabs: [tab],
  };
}

function createPreviewTabId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `browser-tab-${crypto.randomUUID()}`;
  }

  return `browser-tab-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function getActiveTab(session: BrowserPreviewSession) {
  return session.tabs.find((tab) => tab.id === session.activeTabId) ?? session.tabs[0] ?? createPreviewTab();
}

function getTabHistoryState(tab: BrowserPreviewTab) {
  const history = Array.isArray(tab.history) ? tab.history.flatMap((entry) => {
    const url = normalizePreviewUrl(entry);
    return url ? [url] : [];
  }) : [];

  if (tab.url && !history.includes(tab.url)) {
    history.push(tab.url);
  }

  if (history.length === 0) {
    return {
      history,
      historyIndex: -1,
    };
  }

  const storedIndex = Number.isInteger(tab.historyIndex) ? tab.historyIndex : -1;
  const urlIndex = tab.url ? history.lastIndexOf(tab.url) : -1;
  const historyIndex = clampHistoryIndex(storedIndex >= 0 ? storedIndex : urlIndex >= 0 ? urlIndex : history.length - 1, history);

  return {
    history,
    historyIndex,
  };
}

function clampHistoryIndex(index: number, history: string[]) {
  return Math.max(0, Math.min(index, history.length - 1));
}

function createNavigationHistoryUpdate(tab: BrowserPreviewTab, nextUrl: string) {
  const historyState = getTabHistoryState(tab);

  if (historyState.history.length > 0 && historyState.history[historyState.historyIndex] === nextUrl) {
    return historyState;
  }

  const priorHistory = historyState.historyIndex >= 0 ? historyState.history.slice(0, historyState.historyIndex + 1) : [];
  const history = [...priorHistory, nextUrl];

  return {
    history,
    historyIndex: history.length - 1,
  };
}

function ensureSession(session: BrowserPreviewSession) {
  return session.tabs.length > 0 ? session : createBrowserPreviewSession();
}

export function activateBrowserPreviewSessionTab(session: BrowserPreviewSession, tabId: string): BrowserPreviewSession {
  const ensuredSession = ensureSession(session);

  if (!ensuredSession.tabs.some((tab) => tab.id === tabId)) {
    return ensuredSession;
  }

  return {
    ...ensuredSession,
    activeTabId: tabId,
  };
}

export function closeBrowserPreviewSessionTab(session: BrowserPreviewSession, tabId: string): BrowserPreviewSession {
  const ensuredSession = ensureSession(session);
  const currentTabIndex = ensuredSession.tabs.findIndex((tab) => tab.id === tabId);

  if (currentTabIndex < 0) {
    return ensuredSession;
  }

  const remainingTabs = ensuredSession.tabs.filter((tab) => tab.id !== tabId);

  if (remainingTabs.length === 0) {
    return createBrowserPreviewSession();
  }

  if (ensuredSession.activeTabId !== tabId) {
    return {
      ...ensuredSession,
      tabs: remainingTabs,
    };
  }

  const nextActiveTab = remainingTabs[Math.max(0, Math.min(currentTabIndex, remainingTabs.length - 1))];

  return {
    activeTabId: nextActiveTab.id,
    tabs: remainingTabs,
  };
}

function openUrlInSession(session: BrowserPreviewSession, url: string): BrowserPreviewSession {
  const ensuredSession = ensureSession(session);
  const existingTab = ensuredSession.tabs.find((tab) => tab.url === url);

  if (existingTab) {
    return {
      ...ensuredSession,
      activeTabId: existingTab.id,
    };
  }

  const activeTab = getActiveTab(ensuredSession);

  if (!activeTab.url) {
    const historyUpdate = createNavigationHistoryUpdate(activeTab, url);

    return {
      activeTabId: activeTab.id,
      tabs: ensuredSession.tabs.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
              ...historyUpdate,
              updatedAt: new Date().toISOString(),
              url,
            }
          : tab,
      ),
    };
  }

  const nextTab = createPreviewTab(url);

  return {
    activeTabId: nextTab.id,
    tabs: [...ensuredSession.tabs, nextTab],
  };
}

function loadBrowserPreviewSession(initialUrl?: string | null): BrowserPreviewSession {
  if (typeof window === "undefined") {
    return createBrowserPreviewSession(initialUrl ?? undefined);
  }

  const storedSession = readStoredSession(BROWSER_PREVIEW_SESSION_KEY) ?? readStoredSession(LEGACY_BROWSER_PREVIEW_SESSION_KEY);

  if (storedSession) {
    const tabs = Array.isArray(storedSession.tabs)
      ? storedSession.tabs.flatMap((tab) => {
          const normalizedTab = normalizeStoredTab(tab);
          return normalizedTab ? [normalizedTab] : [];
        })
      : [];

    if (tabs.length > 0) {
      const activeTabId = tabs.some((tab) => tab.id === storedSession.activeTabId) ? String(storedSession.activeTabId) : tabs[0].id;
      const session = {
        activeTabId,
        tabs,
      };

      return initialUrl ? openUrlInSession(session, initialUrl) : session;
    }
  }

  return createBrowserPreviewSession(initialUrl ?? undefined);
}

function readStoredSession(key: string) {
  try {
    return JSON.parse(loadPersistentString(key) ?? "null") as Partial<BrowserPreviewSession> | null;
  } catch {
    return null;
  }
}

function saveBrowserPreviewSession(session: BrowserPreviewSession) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    savePersistentString(BROWSER_PREVIEW_SESSION_KEY, JSON.stringify(session));
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

  if (url && isCurrentAppUrl(url)) {
    return null;
  }

  const normalizedHistory = normalizeStoredHistory(tab.history, tab.historyIndex, url);

  return {
    createdAt: typeof tab.createdAt === "string" && tab.createdAt ? tab.createdAt : new Date().toISOString(),
    history: normalizedHistory.history,
    historyIndex: normalizedHistory.historyIndex,
    id: typeof tab.id === "string" && tab.id ? tab.id : createPreviewTabId(),
    reloadKey: typeof tab.reloadKey === "number" && Number.isFinite(tab.reloadKey) ? tab.reloadKey : 0,
    updatedAt: typeof tab.updatedAt === "string" && tab.updatedAt ? tab.updatedAt : new Date().toISOString(),
    url: url ?? undefined,
  };
}

function normalizeStoredHistory(value: unknown, rawIndex: unknown, currentUrl: string | null) {
  const history = Array.isArray(value)
    ? value.flatMap((entry) => {
        const url = typeof entry === "string" ? normalizePreviewUrl(entry) : null;
        return url && !isCurrentAppUrl(url) ? [url] : [];
      })
    : [];

  if (currentUrl && !history.includes(currentUrl)) {
    history.push(currentUrl);
  }

  if (history.length === 0) {
    return {
      history,
      historyIndex: -1,
    };
  }

  const indexFromUrl = currentUrl ? history.lastIndexOf(currentUrl) : -1;
  const storedIndex = typeof rawIndex === "number" && Number.isFinite(rawIndex) ? rawIndex : -1;

  return {
    history,
    historyIndex: clampHistoryIndex(storedIndex >= 0 ? storedIndex : indexFromUrl >= 0 ? indexFromUrl : history.length - 1, history),
  };
}

async function findAvailableLocalPreview() {
  const candidates = getLocalPreviewCandidates();

  if (candidates.length === 0) {
    return null;
  }

  return new Promise<string | null>((resolve) => {
    let pending = candidates.length;
    let resolved = false;

    for (const candidate of candidates) {
      void probeUrl(candidate).then((available) => {
        if (resolved) {
          return;
        }

        if (available) {
          resolved = true;
          resolve(candidate);
          return;
        }

        pending -= 1;

        if (pending === 0) {
          resolve(null);
        }
      });
    }
  });
}

async function probeUrl(url: string) {
  async function fetchWithMode(mode: RequestMode): Promise<Response> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), LOCAL_PROBE_TIMEOUT_MS);

    try {
      return await fetch(url, {
        method: "GET",
        cache: "no-store",
        mode,
        credentials: "omit",
        signal: controller.signal,
      });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  try {
    const corsResponse = await fetchWithMode("cors");

    if (corsResponse.ok) {
      return true;
    }

    if (corsResponse.status > 0 && corsResponse.status < 600) {
      return true;
    }
  } catch {
    // CORS, network failure, or abort; fall through to opaque probe.
  }

  try {
    const opaqueResponse = await fetchWithMode("no-cors");

    return opaqueResponse.type === "opaque" || opaqueResponse.ok;
  } catch {
    return false;
  }
}

function getLocalPreviewCandidates() {
  const hosts = getLocalPreviewHosts();
  const candidates = new Set<string>();

  for (const host of hosts) {
    for (const port of LOCAL_PREVIEW_PORTS) {
      const url = `http://${host}:${port}/`;

      if (!isCurrentAppUrl(url)) {
        candidates.add(url);
      }
    }
  }

  return [...candidates];
}

function getLocalPreviewHosts() {
  const hosts = new Set(["127.0.0.1", "localhost"]);

  if (typeof window !== "undefined") {
    try {
      const currentHost = new URL(window.location.href).hostname;

      if (isLocalHostName(currentHost)) {
        hosts.add(currentHost);
      }
    } catch {
      return [...hosts];
    }
  }

  return [...hosts];
}

function isCurrentAppUrl(url: string) {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const candidateUrl = new URL(url);
    const currentUrl = new URL(window.location.href);

    if (candidateUrl.origin === currentUrl.origin) {
      return true;
    }

    return candidateUrl.protocol === currentUrl.protocol && candidateUrl.port === currentUrl.port && isLocalHostName(candidateUrl.hostname) && isLocalHostName(currentUrl.hostname);
  } catch {
    return false;
  }
}

function isLocalHttpUrl(url: string) {
  try {
    const parsedUrl = new URL(url);

    return parsedUrl.protocol === "http:" && isLocalHostName(parsedUrl.hostname);
  } catch {
    return false;
  }
}

function shouldRenderIframeForUrl(url: string) {
  return !isTauriDesktopRuntime() || isLocalHttpUrl(url);
}

export function createBrowserPreviewFrameKey(tab: Pick<BrowserPreviewTab, "id" | "reloadKey" | "url">) {
  return `${tab.id}-${tab.reloadKey}-${tab.url ?? "empty"}`;
}

function areSetsEqual<T>(first: Set<T>, second: Set<T>) {
  if (first.size !== second.size) {
    return false;
  }

  for (const value of first) {
    if (!second.has(value)) {
      return false;
    }
  }

  return true;
}

function isLocalHostName(hostname: string) {
  const host = hostname.toLowerCase();

  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

function getSearchEngine(engineId: SearchEngineId) {
  return SEARCH_ENGINES.find((engine) => engine.id === engineId) ?? SEARCH_ENGINES.find((engine) => engine.id === DEFAULT_SEARCH_ENGINE_ID) ?? SEARCH_ENGINES[0];
}

let tauriWebviewModulePromise: Promise<typeof import("@tauri-apps/api/webview")> | null = null;
let tauriWindowModulePromise: Promise<typeof import("@tauri-apps/api/window")> | null = null;
let tauriDpiModulePromise: Promise<typeof import("@tauri-apps/api/dpi")> | null = null;

function loadTauriWebviewModule() {
  tauriWebviewModulePromise ??= import("@tauri-apps/api/webview");
  return tauriWebviewModulePromise;
}

function loadTauriWindowModule() {
  tauriWindowModulePromise ??= import("@tauri-apps/api/window");
  return tauriWindowModulePromise;
}

function loadTauriDpiModule() {
  tauriDpiModulePromise ??= import("@tauri-apps/api/dpi");
  return tauriDpiModulePromise;
}

async function createNativeBrowserInstance(label: string, url: string, frame: HTMLElement | null) {
  const bounds = frame ? getNativeBrowserBounds(frame) : null;

  if (!bounds) {
    throw new Error("The browser panel is not ready yet.");
  }

  const [{ Webview }, { getCurrentWindow }] = await Promise.all([loadTauriWebviewModule(), loadTauriWindowModule()]);
  const webview = new Webview(getCurrentWindow(), label, {
    dragDropEnabled: true,
    focus: false,
    height: bounds.height,
    url,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y,
    zoomHotkeysEnabled: true,
  });

  await waitForNativeBrowserCreated(webview);
  await setNativeBrowserBounds(webview, bounds);

  return webview;
}

function waitForNativeBrowserCreated(webview: Webview) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeout);
      callback();
    };
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("Timed out while opening the native browser view.")));
    }, NATIVE_BROWSER_CREATE_TIMEOUT_MS);

    void webview.once("tauri://created", () => finish(resolve));
    void webview.once("tauri://error", (event) => {
      finish(() => reject(new Error(String(event.payload || "Could not open the native browser view."))));
    });
  });
}

function closeNativeBrowserInstance(instance: NativeBrowserInstance | null) {
  if (!instance) {
    return;
  }

  void (async () => {
    try {
      await instance.webview.hide();
    } catch {
      // Hiding is best effort; the webview may already be disposed.
    }

    try {
      await setNativeBrowserBounds(instance.webview, HIDDEN_NATIVE_BROWSER_BOUNDS);
    } catch {
      // The webview may already be disposed; close remains best effort.
    }

    try {
      await instance.webview.close();
    } catch {
      // Retry by label below in case the original handle is already stale.
    }

    window.setTimeout(() => {
      void closeNativeBrowserLabel(instance.label);
    }, 80);
  })();
}

async function hideNativeBrowserInstance(instance: NativeBrowserInstance) {
  try {
    await instance.webview.hide();
  } catch {
    // The webview may already be hidden or disposed.
  }

  try {
    await setNativeBrowserBounds(instance.webview, HIDDEN_NATIVE_BROWSER_BOUNDS);
  } catch {
    // Bounds updates are best effort for inactive tabs.
  }
}

async function showNativeBrowserInstance(instance: NativeBrowserInstance) {
  try {
    await instance.webview.show();
  } catch {
    // The next bounds sync can still make an already-visible view usable.
  }
}

async function closeNativeBrowserLabel(label: string) {
  try {
    const { Webview } = await loadTauriWebviewModule();
    const webviews = await Webview.getAll();

    await Promise.all(webviews.filter((webview) => webview.label === label).map((webview) => hideAndCloseNativeBrowser(webview)));
  } catch {
    // Best effort cleanup for a native webview that may already be gone.
  }
}

async function closeStaleNativeBrowserInstances(currentLabel?: string) {
  try {
    const { Webview } = await loadTauriWebviewModule();
    const webviews = await Webview.getAll();

    await Promise.all(
      webviews
        .filter((webview) => webview.label.startsWith("browser-preview-") && webview.label !== currentLabel)
        .map(hideAndCloseNativeBrowser),
    );
  } catch {
    // Best effort cleanup for native webviews that may survive a hot reload.
  }
}

async function hideAndCloseNativeBrowser(webview: Webview) {
  try {
    await webview.hide();
  } catch {
    // Continue to close even if hide is unavailable for a stale handle.
  }

  try {
    await webview.close();
  } catch {
    return;
  }
}

function getNativeBrowserBounds(element: HTMLElement): NativeBrowserBounds | null {
  const rect = element.getBoundingClientRect();

  if (!element.isConnected || !Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width < 2 || rect.height < 2) {
    return null;
  }

  return {
    height: Math.max(1, Math.round(rect.height)),
    width: Math.max(1, Math.round(rect.width)),
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
  };
}

async function setNativeBrowserBounds(webview: Webview, bounds: NativeBrowserBounds) {
  const { LogicalPosition, LogicalSize } = await loadTauriDpiModule();

  await Promise.all([
    webview.setPosition(new LogicalPosition(bounds.x, bounds.y)),
    webview.setSize(new LogicalSize(bounds.width, bounds.height)),
  ]);
}

function createNativeBrowserLabel(tabId: string, generation: number) {
  const safeTabId = tabId.replace(/[^a-zA-Z0-9_:/-]/g, "_").slice(-42) || "tab";
  return `browser-preview-${generation}-${safeTabId}`;
}
