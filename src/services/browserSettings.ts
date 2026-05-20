import { loadPersistentString, savePersistentString } from "../lib/appStorage";

export type BrowserApprovalMode = "alwaysAsk" | "askUnknown" | "neverAsk";
export type BrowserSearchEngineId = "duckduckgo" | "github" | "google" | "youtube";

export interface BrowserSettings {
  allowedDomains: string[];
  approvalMode: BrowserApprovalMode;
  blockedDomains: string[];
  defaultSearchEngine: BrowserSearchEngineId;
  incognitoEnabled: boolean;
  saveHistory: boolean;
}

export interface BrowserHistoryEntry {
  firstVisitedAt: string;
  lastVisitedAt: string;
  title: string;
  url: string;
  visitCount: number;
}

export interface BrowserHistoryState {
  entries: BrowserHistoryEntry[];
  updatedAt: string;
  version: 1;
}

export type BrowserNavigationDecision =
  | { decision: "allow"; domain: string; reason: "allowed-domain" | "known-domain" | "local" | "never-ask" }
  | { decision: "block"; domain: string; reason: "blocked-domain" | "invalid-url" }
  | { decision: "ask"; domain: string; reason: "approval-required" };

export const BROWSER_SETTINGS_KEY = "gilbert-codex.browser-settings.v1";
export const BROWSER_HISTORY_KEY = "gilbert-codex.browser-history.v1";
export const BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v2";
export const LEGACY_BROWSER_PREVIEW_SESSION_KEY = "gilbert-codex.browser-preview.v1";

export const DEFAULT_BROWSER_SETTINGS: BrowserSettings = {
  allowedDomains: [],
  approvalMode: "alwaysAsk",
  blockedDomains: [],
  defaultSearchEngine: "google",
  incognitoEnabled: false,
  saveHistory: true,
};

const BROWSER_SETTINGS_CHANGED_EVENT = "gilbert-codex:browser-settings-changed";
const BROWSER_HISTORY_CHANGED_EVENT = "gilbert-codex:browser-history-changed";
const BROWSER_PREVIEW_SESSION_CLEARED_EVENT = "gilbert-codex:browser-preview-session-cleared";
const BROWSER_HISTORY_MAX_ENTRIES = 10_000;

export function loadBrowserSettings(): BrowserSettings {
  try {
    return normalizeBrowserSettings(JSON.parse(loadPersistentString(BROWSER_SETTINGS_KEY) ?? "null"));
  } catch {
    return DEFAULT_BROWSER_SETTINGS;
  }
}

export function saveBrowserSettings(settings: BrowserSettings) {
  const normalizedSettings = normalizeBrowserSettings(settings);
  savePersistentString(BROWSER_SETTINGS_KEY, JSON.stringify(normalizedSettings));
  dispatchBrowserSettingsChanged(normalizedSettings);
  return normalizedSettings;
}

export function patchBrowserSettings(patch: Partial<BrowserSettings>) {
  return saveBrowserSettings({
    ...loadBrowserSettings(),
    ...patch,
  });
}

export function subscribeBrowserSettings(listener: (settings: BrowserSettings) => void) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => undefined;
  }

  function handleSettingsChanged(event: Event) {
    listener(event instanceof CustomEvent ? normalizeBrowserSettings(event.detail) : loadBrowserSettings());
  }

  window.addEventListener(BROWSER_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
  return () => window.removeEventListener(BROWSER_SETTINGS_CHANGED_EVENT, handleSettingsChanged);
}

export function loadBrowserHistory(): BrowserHistoryState {
  try {
    return normalizeBrowserHistory(JSON.parse(loadPersistentString(BROWSER_HISTORY_KEY) ?? "null"));
  } catch {
    return createEmptyBrowserHistory();
  }
}

export function saveBrowserHistory(history: BrowserHistoryState) {
  const normalizedHistory = normalizeBrowserHistory(history);
  savePersistentString(BROWSER_HISTORY_KEY, JSON.stringify(normalizedHistory));
  dispatchBrowserHistoryChanged(normalizedHistory);
  return normalizedHistory;
}

export function subscribeBrowserHistory(listener: (history: BrowserHistoryState) => void) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => undefined;
  }

  function handleHistoryChanged(event: Event) {
    listener(event instanceof CustomEvent ? normalizeBrowserHistory(event.detail) : loadBrowserHistory());
  }

  window.addEventListener(BROWSER_HISTORY_CHANGED_EVENT, handleHistoryChanged);
  return () => window.removeEventListener(BROWSER_HISTORY_CHANGED_EVENT, handleHistoryChanged);
}

export function subscribeBrowserPreviewSessionCleared(listener: () => void) {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") {
    return () => undefined;
  }

  window.addEventListener(BROWSER_PREVIEW_SESSION_CLEARED_EVENT, listener);
  return () => window.removeEventListener(BROWSER_PREVIEW_SESSION_CLEARED_EVENT, listener);
}

export function clearBrowserHistory() {
  return saveBrowserHistory(createEmptyBrowserHistory());
}

export function removeBrowserHistoryEntry(url: string) {
  const normalizedUrl = normalizeBrowserUrl(url);

  if (!normalizedUrl) {
    return loadBrowserHistory();
  }

  const history = loadBrowserHistory();
  return saveBrowserHistory({
    entries: history.entries.filter((entry) => entry.url !== normalizedUrl),
    updatedAt: new Date().toISOString(),
    version: 1,
  });
}

export function recordBrowserHistoryVisit(url: string, title: string, settings = loadBrowserSettings()) {
  if (settings.incognitoEnabled || !settings.saveHistory) {
    return loadBrowserHistory();
  }

  const normalizedUrl = normalizeBrowserUrl(url);

  if (!normalizedUrl) {
    return loadBrowserHistory();
  }

  const now = new Date().toISOString();
  const history = loadBrowserHistory();
  const existingEntry = history.entries.find((entry) => entry.url === normalizedUrl);
  const nextEntry: BrowserHistoryEntry = existingEntry
    ? {
        ...existingEntry,
        lastVisitedAt: now,
        title: normalizeHistoryTitle(title, normalizedUrl),
        visitCount: Math.max(existingEntry.visitCount, 0) + 1,
      }
    : {
        firstVisitedAt: now,
        lastVisitedAt: now,
        title: normalizeHistoryTitle(title, normalizedUrl),
        url: normalizedUrl,
        visitCount: 1,
      };

  const entries = [
    ...history.entries.filter((entry) => entry.url !== normalizedUrl),
    nextEntry,
  ]
    .sort((left, right) => new Date(left.lastVisitedAt).getTime() - new Date(right.lastVisitedAt).getTime())
    .slice(-BROWSER_HISTORY_MAX_ENTRIES);

  return saveBrowserHistory({
    entries,
    updatedAt: now,
    version: 1,
  });
}

export function evaluateBrowserNavigationPolicy(url: string, settings = loadBrowserSettings(), history = loadBrowserHistory()): BrowserNavigationDecision {
  const normalizedUrl = normalizeBrowserUrl(url);

  if (!normalizedUrl) {
    return { decision: "block", domain: "", reason: "invalid-url" };
  }

  const domain = getBrowserUrlDomain(normalizedUrl);

  if (!domain || isLocalBrowserDomain(domain)) {
    return { decision: "allow", domain, reason: "local" };
  }

  if (domainMatchesList(domain, settings.blockedDomains)) {
    return { decision: "block", domain, reason: "blocked-domain" };
  }

  if (domainMatchesList(domain, settings.allowedDomains)) {
    return { decision: "allow", domain, reason: "allowed-domain" };
  }

  if (settings.approvalMode === "neverAsk") {
    return { decision: "allow", domain, reason: "never-ask" };
  }

  if (settings.approvalMode === "askUnknown" && history.entries.some((entry) => domainMatchesList(domain, [getBrowserUrlDomain(entry.url)]))) {
    return { decision: "allow", domain, reason: "known-domain" };
  }

  return { decision: "ask", domain, reason: "approval-required" };
}

export function addBrowserDomain(list: string[], domain: string) {
  const normalizedDomain = normalizeBrowserDomain(domain);

  if (!normalizedDomain) {
    return normalizeBrowserDomainList(list);
  }

  return normalizeBrowserDomainList([...list, normalizedDomain]);
}

export function removeBrowserDomain(list: string[], domain: string) {
  const normalizedDomain = normalizeBrowserDomain(domain);

  if (!normalizedDomain) {
    return normalizeBrowserDomainList(list);
  }

  return normalizeBrowserDomainList(list).filter((item) => item !== normalizedDomain);
}

export function normalizeBrowserDomain(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmedValue = value.trim().toLowerCase();

  if (!trimmedValue) {
    return "";
  }

  const withoutScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedValue) ? safeHostname(trimmedValue) : trimmedValue;
  const hostCandidate = withoutScheme
    .replace(/^\*\./, "")
    .replace(/^\.+/, "")
    .split(/[/?#]/, 1)[0]
    .replace(/:\d{1,5}$/, "")
    .trim();
  const normalizedHost = hostCandidate.replace(/[^a-z0-9.-]/g, "").replace(/\.+/g, ".").replace(/^\.+|\.+$/g, "");

  if (!normalizedHost || normalizedHost.length > 253 || normalizedHost.includes("..")) {
    return "";
  }

  if (normalizedHost === "localhost" || normalizedHost === "127.0.0.1" || normalizedHost === "0.0.0.0") {
    return normalizedHost;
  }

  if (!normalizedHost.includes(".")) {
    return "";
  }

  return normalizedHost;
}

export function getBrowserUrlDomain(url: string) {
  try {
    return normalizeBrowserDomain(new URL(url).hostname);
  } catch {
    return "";
  }
}

export function normalizeBrowserUrl(url: string) {
  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return "";
    }

    return parsedUrl.href;
  } catch {
    return "";
  }
}

export function clearBrowserPreviewSessionStorage(options: { notify?: boolean } = {}) {
  savePersistentString(BROWSER_PREVIEW_SESSION_KEY, JSON.stringify({ activeTabId: "", tabs: [] }));
  savePersistentString(LEGACY_BROWSER_PREVIEW_SESSION_KEY, JSON.stringify({ activeTabId: "", tabs: [] }));

  if (options.notify !== false && canDispatchBrowserEvent()) {
    window.dispatchEvent(new CustomEvent(BROWSER_PREVIEW_SESSION_CLEARED_EVENT));
  }
}

export async function clearNativeBrowserBrowsingData() {
  if (!isTauriRuntime()) {
    return { desktop: false };
  }

  const { getCurrentWebview, Webview } = await import("@tauri-apps/api/webview");
  const currentWebview = getCurrentWebview();
  await currentWebview.clearAllBrowsingData();

  try {
    const webviews = await Webview.getAll();
    await Promise.all(webviews.map((webview) => webview.clearAllBrowsingData().catch(() => undefined)));
  } catch {
    return { desktop: true };
  }

  return { desktop: true };
}

function normalizeBrowserSettings(value: unknown): BrowserSettings {
  const storedSettings = typeof value === "object" && value ? (value as Partial<BrowserSettings>) : {};

  return {
    allowedDomains: normalizeBrowserDomainList(storedSettings.allowedDomains),
    approvalMode: normalizeBrowserApprovalMode(storedSettings.approvalMode),
    blockedDomains: normalizeBrowserDomainList(storedSettings.blockedDomains),
    defaultSearchEngine: normalizeBrowserSearchEngine(storedSettings.defaultSearchEngine),
    incognitoEnabled: typeof storedSettings.incognitoEnabled === "boolean" ? storedSettings.incognitoEnabled : DEFAULT_BROWSER_SETTINGS.incognitoEnabled,
    saveHistory: typeof storedSettings.saveHistory === "boolean" ? storedSettings.saveHistory : DEFAULT_BROWSER_SETTINGS.saveHistory,
  };
}

function normalizeBrowserHistory(value: unknown): BrowserHistoryState {
  const storedHistory = typeof value === "object" && value ? (value as Partial<BrowserHistoryState>) : {};
  const entries = Array.isArray(storedHistory.entries)
    ? storedHistory.entries.flatMap((entry) => {
        const normalizedEntry = normalizeBrowserHistoryEntry(entry);
        return normalizedEntry ? [normalizedEntry] : [];
      })
    : [];

  return {
    entries: entries
      .sort((left, right) => new Date(left.lastVisitedAt).getTime() - new Date(right.lastVisitedAt).getTime())
      .slice(-BROWSER_HISTORY_MAX_ENTRIES),
    updatedAt: normalizeIsoTimestamp(storedHistory.updatedAt),
    version: 1,
  };
}

function normalizeBrowserHistoryEntry(value: unknown): BrowserHistoryEntry | null {
  if (typeof value !== "object" || !value) {
    return null;
  }

  const entry = value as Partial<BrowserHistoryEntry>;
  const url = typeof entry.url === "string" ? normalizeBrowserUrl(entry.url) : "";

  if (!url) {
    return null;
  }

  const lastVisitedAt = normalizeIsoTimestamp(entry.lastVisitedAt);

  return {
    firstVisitedAt: normalizeIsoTimestamp(entry.firstVisitedAt),
    lastVisitedAt,
    title: normalizeHistoryTitle(entry.title, url),
    url,
    visitCount: normalizeVisitCount(entry.visitCount),
  };
}

function createEmptyBrowserHistory(): BrowserHistoryState {
  return {
    entries: [],
    updatedAt: new Date().toISOString(),
    version: 1,
  };
}

function normalizeBrowserDomainList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map(normalizeBrowserDomain).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function normalizeBrowserApprovalMode(value: unknown): BrowserApprovalMode {
  return value === "askUnknown" || value === "neverAsk" || value === "alwaysAsk" ? value : DEFAULT_BROWSER_SETTINGS.approvalMode;
}

function normalizeBrowserSearchEngine(value: unknown): BrowserSearchEngineId {
  return value === "github" || value === "google" || value === "youtube" || value === "duckduckgo" ? value : DEFAULT_BROWSER_SETTINGS.defaultSearchEngine;
}

function normalizeHistoryTitle(value: unknown, url: string) {
  if (typeof value === "string" && value.trim()) {
    return value.trim().replace(/\s+/g, " ").slice(0, 180);
  }

  return getBrowserUrlDomain(url) || url;
}

function normalizeVisitCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function normalizeIsoTimestamp(value: unknown) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);

    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
}

function domainMatchesList(domain: string, list: string[]) {
  const normalizedDomain = normalizeBrowserDomain(domain);

  if (!normalizedDomain) {
    return false;
  }

  return normalizeBrowserDomainList(list).some((item) => normalizedDomain === item || normalizedDomain.endsWith(`.${item}`));
}

function isLocalBrowserDomain(domain: string) {
  return domain === "localhost" || domain === "127.0.0.1" || domain === "0.0.0.0";
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function isTauriRuntime() {
  return typeof window !== "undefined" && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));
}

function dispatchBrowserSettingsChanged(settings: BrowserSettings) {
  if (canDispatchBrowserEvent()) {
    window.dispatchEvent(new CustomEvent(BROWSER_SETTINGS_CHANGED_EVENT, { detail: settings }));
  }
}

function dispatchBrowserHistoryChanged(history: BrowserHistoryState) {
  if (canDispatchBrowserEvent()) {
    window.dispatchEvent(new CustomEvent(BROWSER_HISTORY_CHANGED_EVENT, { detail: history }));
  }
}

function canDispatchBrowserEvent() {
  return typeof window !== "undefined" && typeof window.dispatchEvent === "function" && typeof CustomEvent === "function";
}
