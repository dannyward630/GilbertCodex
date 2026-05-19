export type BrowserConsoleLevel = "debug" | "info" | "log" | "warning" | "error";
export type BrowserConsoleFilter = BrowserConsoleLevel | "all";
export type BrowserConsoleKind = "browser" | "bridge" | "console" | "network" | "pageerror";

export interface BrowserConsoleEntry {
  column?: number;
  id: string;
  kind: BrowserConsoleKind;
  level: BrowserConsoleLevel;
  line?: number;
  message: string;
  source: string;
  stack?: string;
  tabId?: string;
  tabTitle?: string;
  timestamp: string;
  url?: string;
}

export interface BrowserConsoleCounts extends Record<BrowserConsoleLevel, number> {
  total: number;
}

export interface BrowserConsoleSnapshot {
  counts: BrowserConsoleCounts;
  entries: BrowserConsoleEntry[];
  filteredCount: number;
  retainedCount: number;
  truncated: boolean;
}

export interface BrowserConsoleSnapshotOptions {
  level?: BrowserConsoleFilter;
  maxEntries?: number;
  query?: string;
}

export type BrowserConsoleEntryInput = Partial<Omit<BrowserConsoleEntry, "id" | "level" | "message" | "timestamp">> & {
  level?: BrowserConsoleLevel | "warn";
  message: unknown;
  timestamp?: string;
};

type BrowserConsoleListener = () => void;

const BROWSER_CONSOLE_MAX_RETAINED_ENTRIES = 1_000;
const BROWSER_CONSOLE_LEVELS: BrowserConsoleLevel[] = ["debug", "info", "log", "warning", "error"];
const BROWSER_CONSOLE_BRIDGE_SOURCES = new Set(["gilbert-browser-console", "__gilbert_browser_console__"]);

let browserConsoleEntries: BrowserConsoleEntry[] = [];
let browserConsoleSequence = 0;
const browserConsoleListeners = new Set<BrowserConsoleListener>();

export function recordBrowserConsoleEntry(input: BrowserConsoleEntryInput) {
  const entry = normalizeBrowserConsoleEntry(input);
  browserConsoleEntries = [...browserConsoleEntries, entry].slice(-BROWSER_CONSOLE_MAX_RETAINED_ENTRIES);
  notifyBrowserConsoleListeners();
  return entry;
}

export function clearBrowserConsoleEntries() {
  if (browserConsoleEntries.length === 0) {
    return;
  }

  browserConsoleEntries = [];
  notifyBrowserConsoleListeners();
}

export function getBrowserConsoleEntries(options: BrowserConsoleSnapshotOptions = {}) {
  const query = options.query?.trim().toLowerCase();
  const filteredEntries = browserConsoleEntries.filter((entry) => {
    if (options.level && options.level !== "all" && entry.level !== options.level) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [entry.message, entry.source, entry.url, entry.stack, entry.tabTitle].filter(Boolean).some((value) => String(value).toLowerCase().includes(query));
  });
  const maxEntries = normalizeMaxEntries(options.maxEntries);

  return typeof maxEntries === "number" ? filteredEntries.slice(-maxEntries) : filteredEntries;
}

export function getBrowserConsoleSnapshot(options: BrowserConsoleSnapshotOptions = {}): BrowserConsoleSnapshot {
  const entries = getBrowserConsoleEntries(options);
  const filteredCount = getBrowserConsoleEntries({ ...options, maxEntries: undefined }).length;

  return {
    counts: createBrowserConsoleCounts(browserConsoleEntries),
    entries,
    filteredCount,
    retainedCount: browserConsoleEntries.length,
    truncated: entries.length < filteredCount,
  };
}

export function subscribeBrowserConsole(listener: BrowserConsoleListener) {
  browserConsoleListeners.add(listener);

  return () => {
    browserConsoleListeners.delete(listener);
  };
}

export function installBrowserConsoleMessageBridge(windowRef: Window = window) {
  const handleMessage = (event: MessageEvent) => {
    const payload = normalizeBrowserConsoleBridgePayload(event.data);

    if (!payload) {
      return;
    }

    recordBrowserConsoleEntry({
      column: payload.column,
      kind: payload.kind ?? "bridge",
      level: payload.level,
      line: payload.line,
      message: payload.message,
      source: payload.sourceName ?? "Preview page",
      stack: payload.stack,
      timestamp: payload.timestamp,
      url: payload.url ?? safeEventOrigin(event),
    });
  };

  windowRef.addEventListener("message", handleMessage);

  return () => {
    windowRef.removeEventListener("message", handleMessage);
  };
}

export function stringifyBrowserConsoleValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean" || value === null || value === undefined) {
    return String(value);
  }

  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === "object" && nestedValue !== null) {
        if (seen.has(nestedValue)) {
          return "[Circular]";
        }

        seen.add(nestedValue);
      }

      return nestedValue;
    });
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function normalizeBrowserConsoleEntry(input: BrowserConsoleEntryInput): BrowserConsoleEntry {
  const now = new Date().toISOString();
  const level = normalizeBrowserConsoleLevel(input.level);
  const timestamp = typeof input.timestamp === "string" && input.timestamp ? input.timestamp : now;

  browserConsoleSequence += 1;

  return {
    column: normalizeOptionalNumber(input.column),
    id: `browser-console-${Date.now()}-${browserConsoleSequence}`,
    kind: input.kind ?? "browser",
    level,
    line: normalizeOptionalNumber(input.line),
    message: stringifyBrowserConsoleValue(input.message).slice(0, 20_000),
    source: typeof input.source === "string" && input.source.trim() ? input.source.trim() : "Browser preview",
    stack: typeof input.stack === "string" && input.stack.trim() ? input.stack.trim().slice(0, 20_000) : undefined,
    tabId: typeof input.tabId === "string" && input.tabId.trim() ? input.tabId.trim() : undefined,
    tabTitle: typeof input.tabTitle === "string" && input.tabTitle.trim() ? input.tabTitle.trim() : undefined,
    timestamp,
    url: typeof input.url === "string" && input.url.trim() ? input.url.trim() : undefined,
  };
}

function normalizeBrowserConsoleLevel(level: BrowserConsoleEntryInput["level"]): BrowserConsoleLevel {
  if (level === "warn") {
    return "warning";
  }

  return level && BROWSER_CONSOLE_LEVELS.includes(level) ? level : "info";
}

function normalizeMaxEntries(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return undefined;
  }

  return Math.max(1, Math.min(BROWSER_CONSOLE_MAX_RETAINED_ENTRIES, Math.floor(numberValue)));
}

function normalizeOptionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function createBrowserConsoleCounts(entries: BrowserConsoleEntry[]): BrowserConsoleCounts {
  const counts = {
    debug: 0,
    error: 0,
    info: 0,
    log: 0,
    total: entries.length,
    warning: 0,
  };

  for (const entry of entries) {
    counts[entry.level] += 1;
  }

  return counts;
}

function notifyBrowserConsoleListeners() {
  for (const listener of browserConsoleListeners) {
    listener();
  }
}

function normalizeBrowserConsoleBridgePayload(data: unknown) {
  if (typeof data !== "object" || data === null) {
    return null;
  }

  const payload = data as Record<string, unknown>;
  const source = typeof payload.source === "string" ? payload.source : "";
  const type = typeof payload.type === "string" ? payload.type : "";

  if (!BROWSER_CONSOLE_BRIDGE_SOURCES.has(source) && type !== "gilbert:browser-console") {
    return null;
  }

  const message = payload.message ?? payload.args ?? payload.error ?? "";

  return {
    column: normalizeOptionalNumber(payload.column),
    kind: normalizeBridgeKind(payload.kind),
    level: normalizeBrowserConsoleLevel(payload.level as BrowserConsoleEntryInput["level"]),
    line: normalizeOptionalNumber(payload.line),
    message: Array.isArray(message) ? message.map(stringifyBrowserConsoleValue).join(" ") : message,
    sourceName: typeof payload.sourceName === "string" ? payload.sourceName : undefined,
    stack: typeof payload.stack === "string" ? payload.stack : undefined,
    timestamp: typeof payload.timestamp === "string" ? payload.timestamp : undefined,
    url: typeof payload.url === "string" ? payload.url : undefined,
  };
}

function normalizeBridgeKind(value: unknown): BrowserConsoleKind | undefined {
  return value === "browser" || value === "bridge" || value === "console" || value === "network" || value === "pageerror" ? value : undefined;
}

function safeEventOrigin(event: MessageEvent) {
  return typeof event.origin === "string" && event.origin !== "null" ? event.origin : undefined;
}
