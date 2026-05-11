import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  GripVertical,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MoreVertical,
  PanelRight,
  Plus,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { loadPersistentString, savePersistentString } from "../../lib/appStorage";

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
  url?: string;
}

interface BrowserPreviewSession {
  activeTabId: string;
  tabs: BrowserPreviewTab[];
}

type LocalPreviewStatus = "available" | "checking" | "unavailable";
type SearchEngineId = "duckduckgo" | "github" | "google" | "youtube";

interface SearchEngine {
  homeUrl: string;
  id: SearchEngineId;
  label: string;
  searchUrl: (query: string) => string;
}

const BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v2";
const LEGACY_BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v1";
const LOCAL_PROBE_TIMEOUT_MS = 900;
const LOCAL_PREVIEW_PORTS = [1420, 3000, 3001, 4173, 4200, 4321, 5000, 5001, 5173, 5174, 5500, 8000, 8080, 8787];
const SEARCH_ENGINES: SearchEngine[] = [
  {
    homeUrl: "https://www.google.com/",
    id: "google",
    label: "Google",
    searchUrl: (query) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
  {
    homeUrl: "https://www.youtube.com/",
    id: "youtube",
    label: "YouTube",
    searchUrl: (query) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
  },
  {
    homeUrl: "https://github.com/",
    id: "github",
    label: "GitHub",
    searchUrl: (query) => `https://github.com/search?q=${encodeURIComponent(query)}&type=repositories`,
  },
  {
    homeUrl: "https://duckduckgo.com/",
    id: "duckduckgo",
    label: "DuckDuckGo",
    searchUrl: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  },
];

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
  const normalizedInitialUrl = useMemo(() => {
    const url = normalizePreviewUrl(initialUrl);
    return url && !isCurrentAppUrl(url) ? url : null;
  }, [initialUrl]);
  const [session, setSession] = useState<BrowserPreviewSession>(() => loadBrowserPreviewSession(normalizedInitialUrl));
  const [searchEngineId, setSearchEngineId] = useState<SearchEngineId>("google");
  const [localPreview, setLocalPreview] = useState<{ status: LocalPreviewStatus; url?: string }>({ status: "checking" });
  const activeTab = getActiveTab(session);
  const activeUrl = activeTab.url;
  const [addressDraft, setAddressDraft] = useState(activeUrl ?? "");
  const [addressInvalid, setAddressInvalid] = useState(false);
  const [activeLocalStatus, setActiveLocalStatus] = useState<LocalPreviewStatus>("available");
  const selectedSearchEngine = getSearchEngine(searchEngineId);
  const previewTitle = formatPreviewTitle(activeUrl);
  const activeUrlIsLocal = Boolean(activeUrl && isLocalHttpUrl(activeUrl));
  const showFrame = Boolean(activeUrl && (!activeUrlIsLocal || activeLocalStatus === "available"));

  useEffect(() => {
    saveBrowserPreviewSession(session);
  }, [session]);

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
    if (!activeUrl || !isLocalHttpUrl(activeUrl)) {
      setActiveLocalStatus("available");
      return;
    }

    let cancelled = false;

    setActiveLocalStatus("checking");
    void probeUrl(activeUrl).then((available) => {
      if (!cancelled) {
        setActiveLocalStatus(available ? "available" : "unavailable");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab.reloadKey, activeUrl]);

  function submitAddress(value = addressDraft, engineId = searchEngineId) {
    const nextUrl = createNavigationUrl(value, engineId);

    if (!nextUrl) {
      setAddressInvalid(true);
      return;
    }

    navigateToUrl(nextUrl);
  }

  function navigateToUrl(nextUrl: string) {
    updateActiveTab((tab) => ({
      ...tab,
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

  function closeTab(tabId: string) {
    setSession((currentSession) => {
      const ensuredSession = ensureSession(currentSession);
      const currentTabIndex = ensuredSession.tabs.findIndex((tab) => tab.id === tabId);
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
    });
  }

  function reloadActiveTab() {
    if (!activeUrl) {
      return;
    }

    updateActiveTab((tab) => ({
      ...tab,
      reloadKey: tab.reloadKey + 1,
      updatedAt: new Date().toISOString(),
    }));
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
            <div className="browser-preview-badge">
              <Globe2 size={14} aria-hidden="true" />
              <span>Browser</span>
            </div>
            <div className="browser-preview-tabs" role="tablist" aria-label="Browser tabs">
              {session.tabs.map((tab) => {
                const tabTitle = formatPreviewTitle(tab.url);
                const selected = tab.id === activeTab.id;

                return (
                  <div className="browser-preview-tab" data-selected={selected} key={tab.id}>
                    <button
                      className="browser-preview-tab-select"
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      title={tab.url ?? "New tab"}
                      onClick={() => setSession((current) => ({ ...ensureSession(current), activeTabId: tab.id }))}
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
            <button type="button" aria-label="Close browser" onClick={onClose}>
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

          <select className="browser-preview-search-select" aria-label="Search engine" value={searchEngineId} onChange={(event) => setSearchEngineId(event.target.value as SearchEngineId)}>
            {SEARCH_ENGINES.map((engine) => (
              <option key={engine.id} value={engine.id}>
                {engine.label}
              </option>
            ))}
          </select>

          <div className="browser-preview-tools">
            {activeUrl ? (
              <a className="browser-preview-icon-link" href={activeUrl} target="_blank" rel="noreferrer" aria-label="Open page externally" title="Open page externally">
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            ) : null}
            <button type="button" aria-label="Preview layout" disabled>
              <PanelRight size={15} aria-hidden="true" />
            </button>
            <button type="button" aria-label="Browser menu" disabled>
              <MoreVertical size={16} aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="browser-preview-content" aria-label={activeUrl ? `Browser content for ${activeUrl}` : "Browser start page"}>
          {showFrame ? <iframe className="browser-preview-frame" key={`${activeTab.id}-${activeTab.reloadKey}-${activeUrl}`} title={previewTitle} src={activeUrl} /> : null}
          {!showFrame ? (
            <BrowserStartPage
              activeLocalStatus={activeUrlIsLocal ? activeLocalStatus : "available"}
              activeUrl={activeUrl}
              addressDraft={addressDraft}
              localPreview={localPreview}
              searchEngineId={searchEngineId}
              onNavigate={navigateToUrl}
              onSearchEngineChange={setSearchEngineId}
              onSubmit={submitAddress}
            />
          ) : null}
        </div>
      </div>
    </aside>
  );
}

interface BrowserStartPageProps {
  activeLocalStatus: LocalPreviewStatus;
  activeUrl?: string;
  addressDraft: string;
  localPreview: { status: LocalPreviewStatus; url?: string };
  searchEngineId: SearchEngineId;
  onNavigate: (url: string) => void;
  onSearchEngineChange: (engineId: SearchEngineId) => void;
  onSubmit: (value: string, engineId?: SearchEngineId) => void;
}

function BrowserStartPage({
  activeLocalStatus,
  activeUrl,
  addressDraft,
  localPreview,
  searchEngineId,
  onNavigate,
  onSearchEngineChange,
  onSubmit,
}: BrowserStartPageProps) {
  const selectedSearchEngine = getSearchEngine(searchEngineId);
  const [startDraft, setStartDraft] = useState(addressDraft);

  useEffect(() => {
    setStartDraft(addressDraft);
  }, [addressDraft]);

  if (activeUrl && activeLocalStatus !== "available") {
    return (
      <section className="browser-preview-start" aria-label="Local server status">
        {activeLocalStatus === "checking" ? <LoaderCircle className="browser-preview-start-spinner" size={22} aria-hidden="true" /> : <Globe2 size={22} aria-hidden="true" />}
        <h2>{activeLocalStatus === "checking" ? "Checking localhost" : "Localhost unavailable"}</h2>
        <span>{formatPreviewTitle(activeUrl)}</span>
      </section>
    );
  }

  return (
    <section className="browser-preview-start" aria-label="Browser start">
      <form
        className="browser-preview-start-search"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(startDraft, searchEngineId);
        }}
      >
        <Search size={18} aria-hidden="true" />
        <input aria-label="Search the web" value={startDraft} placeholder={`Search ${selectedSearchEngine.label} or enter URL`} onChange={(event) => setStartDraft(event.target.value)} />
        <button type="submit">Search</button>
      </form>

      <div className="browser-preview-shortcuts" aria-label="Search shortcuts">
        {SEARCH_ENGINES.map((engine) => (
          <button
            key={engine.id}
            type="button"
            onClick={() => {
              onSearchEngineChange(engine.id);

              if (startDraft.trim()) {
                onSubmit(startDraft, engine.id);
                return;
              }

              onNavigate(engine.homeUrl);
            }}
          >
            {engine.label}
          </button>
        ))}
        {localPreview.status === "available" && localPreview.url ? (
          <button type="button" onClick={() => onNavigate(localPreview.url!)}>
            Localhost
          </button>
        ) : null}
      </div>
    </section>
  );
}

function createNavigationUrl(value: string, engineId: SearchEngineId) {
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

function formatPreviewTitle(value?: string) {
  if (!value) {
    return "New tab";
  }

  try {
    const url = new URL(value);
    const path = url.pathname === "/" ? "" : url.pathname;

    return `${url.host}${path}`;
  } catch {
    return value;
  }
}

function createPreviewTab(url?: string): BrowserPreviewTab {
  const now = new Date().toISOString();

  return {
    createdAt: now,
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

function ensureSession(session: BrowserPreviewSession) {
  return session.tabs.length > 0 ? session : createBrowserPreviewSession();
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
    return {
      activeTabId: activeTab.id,
      tabs: ensuredSession.tabs.map((tab) =>
        tab.id === activeTab.id
          ? {
              ...tab,
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

  return {
    createdAt: typeof tab.createdAt === "string" && tab.createdAt ? tab.createdAt : new Date().toISOString(),
    id: typeof tab.id === "string" && tab.id ? tab.id : createPreviewTabId(),
    reloadKey: typeof tab.reloadKey === "number" && Number.isFinite(tab.reloadKey) ? tab.reloadKey : 0,
    updatedAt: typeof tab.updatedAt === "string" && tab.updatedAt ? tab.updatedAt : new Date().toISOString(),
    url: url ?? undefined,
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
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), LOCAL_PROBE_TIMEOUT_MS);

  try {
    await fetch(url, {
      cache: "no-store",
      mode: "no-cors",
      signal: controller.signal,
    });

    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
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

function isLocalHostName(hostname: string) {
  const host = hostname.toLowerCase();

  return host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1" || host === "[::1]";
}

function getSearchEngine(engineId: SearchEngineId) {
  return SEARCH_ENGINES.find((engine) => engine.id === engineId) ?? SEARCH_ENGINES[0];
}
