import { Activity, Ban, CheckCircle2, Clock3, Database, ExternalLink, Globe2, History, ListPlus, Search, ShieldCheck, Trash2, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ConfirmDialog } from "../../../components/dialogs/AppDialog";
import { clearBrowserConsoleEntries } from "../../../lib/browserConsole";
import {
  MAX_WEB_SEARCH_RESULTS,
  formatWebSearchErrorMessage,
  searchWebWithProvider,
} from "../../../services/webSearchClient";
import {
  addBrowserDomain,
  clearBrowserHistory,
  clearBrowserPreviewSessionStorage,
  clearNativeBrowserBrowsingData,
  loadBrowserHistory,
  loadBrowserSettings,
  normalizeBrowserDomain,
  patchBrowserSettings,
  removeBrowserDomain,
  removeBrowserHistoryEntry,
  subscribeBrowserHistory,
  subscribeBrowserSettings,
  type BrowserApprovalMode,
  type BrowserSearchEngineId,
  type BrowserSettings,
} from "../../../services/browserSettings";
import { WEB_SEARCH_PROVIDER_LABELS, type ProviderSettings, type WebSearchSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface BrowserSettingsPageProps {
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  settings: ProviderSettings;
}

const searchEngineOptions: Array<{ id: BrowserSearchEngineId; label: string }> = [
  { id: "duckduckgo", label: "DuckDuckGo" },
  { id: "google", label: "Google" },
  { id: "github", label: "GitHub" },
  { id: "youtube", label: "YouTube" },
];

const approvalModeOptions: Array<{ detail: string; id: BrowserApprovalMode; label: string }> = [
  { detail: "Prompt before external sites unless the domain is allowed.", id: "alwaysAsk", label: "Always ask" },
  { detail: "Prompt the first time, then allow domains already in history.", id: "askUnknown", label: "Ask unknown" },
  { detail: "Open external sites unless they match the blocked list.", id: "neverAsk", label: "Do not ask" },
];

export function BrowserSettingsPage({ onSettingsPatch, settings }: BrowserSettingsPageProps) {
  const [browserSettings, setBrowserSettings] = useState<BrowserSettings>(() => loadBrowserSettings());
  const [history, setHistory] = useState(() => loadBrowserHistory());
  const [domainDraft, setDomainDraft] = useState("");
  const [historyQuery, setHistoryQuery] = useState("");
  const [clearHistoryConfirmOpen, setClearHistoryConfirmOpen] = useState(false);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [clearingData, setClearingData] = useState(false);
  const [testStatus, setTestStatus] = useState<SettingsStatusMessage | null>(null);
  const [dataStatus, setDataStatus] = useState<SettingsStatusMessage | null>(null);
  const [testingSearch, setTestingSearch] = useState(false);
  const webSearch = settings.webSearch;
  const sourceLimit = Math.min(Math.max(webSearch.maxResults, 1), MAX_WEB_SEARCH_RESULTS);
  const sortedHistory = useMemo(
    () => [...history.entries].sort((left, right) => new Date(right.lastVisitedAt).getTime() - new Date(left.lastVisitedAt).getTime()),
    [history.entries],
  );
  const filteredHistory = useMemo(() => {
    const query = historyQuery.trim().toLowerCase();

    if (!query) {
      return sortedHistory;
    }

    return sortedHistory.filter((entry) => [entry.title, entry.url].some((value) => value.toLowerCase().includes(query)));
  }, [historyQuery, sortedHistory]);

  useEffect(() => {
    const unsubscribeSettings = subscribeBrowserSettings(setBrowserSettings);
    const unsubscribeHistory = subscribeBrowserHistory(setHistory);

    return () => {
      unsubscribeSettings();
      unsubscribeHistory();
    };
  }, []);

  function updateBrowserSettings(patch: Partial<BrowserSettings>) {
    setBrowserSettings(patchBrowserSettings(patch));
    setDataStatus(null);
  }

  function updateWebSearch(patch: Partial<WebSearchSettings>) {
    onSettingsPatch({
      webSearch: {
        ...webSearch,
        ...patch,
        brave: {
          ...webSearch.brave,
          ...(patch.brave ?? {}),
        },
      },
    });
    setTestStatus(null);
  }

  function addDomain(kind: "allowed" | "blocked") {
    const domain = normalizeBrowserDomain(domainDraft);

    if (!domain) {
      setDataStatus({ kind: "error", text: "Enter a valid domain such as example.com." });
      return;
    }

    updateBrowserSettings(
      kind === "allowed"
        ? {
            allowedDomains: addBrowserDomain(browserSettings.allowedDomains, domain),
            blockedDomains: removeBrowserDomain(browserSettings.blockedDomains, domain),
          }
        : {
            allowedDomains: removeBrowserDomain(browserSettings.allowedDomains, domain),
            blockedDomains: addBrowserDomain(browserSettings.blockedDomains, domain),
          },
    );
    setDomainDraft("");
    setDataStatus({ kind: "success", text: `${domain} ${kind === "allowed" ? "allowed" : "blocked"}.` });
  }

  function removeDomain(kind: "allowed" | "blocked", domain: string) {
    updateBrowserSettings(
      kind === "allowed"
        ? { allowedDomains: removeBrowserDomain(browserSettings.allowedDomains, domain) }
        : { blockedDomains: removeBrowserDomain(browserSettings.blockedDomains, domain) },
    );
  }

  function confirmClearHistory() {
    setHistory(clearBrowserHistory());
    setClearHistoryConfirmOpen(false);
    setDataStatus({ kind: "success", text: "Browser history cleared." });
  }

  async function confirmClearAllData() {
    setClearingData(true);
    setDataStatus(null);

    try {
      setHistory(clearBrowserHistory());
      clearBrowserConsoleEntries();
      clearBrowserPreviewSessionStorage();
      const result = await clearNativeBrowserBrowsingData();
      setDataStatus({
        kind: "success",
        text: result.desktop
          ? "Browser history, tabs, console events, cookies, cache, and WebView data cleared."
          : "Browser history, tabs, and console events cleared. WebView cookies and cache clear in the desktop app.",
      });
    } catch (error) {
      setDataStatus({ kind: "error", text: error instanceof Error ? error.message : "Could not clear all browsing data." });
    } finally {
      setClearingData(false);
      setClearAllConfirmOpen(false);
    }
  }

  async function testDuckDuckGo() {
    setTestingSearch(true);
    setTestStatus(null);

    try {
      const response = await searchWebWithProvider("Gilbert Codex browser test", {
        ...webSearch,
        maxResults: Math.min(sourceLimit, 3),
        provider: "duckduckgo",
      }, {
        includeVisualResults: false,
        maxResults: Math.min(sourceLimit, 3),
      });
      setTestStatus({
        kind: "success",
        text: `${WEB_SEARCH_PROVIDER_LABELS[response.provider]} returned ${response.results.length} source${response.results.length === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      setTestStatus({ kind: "error", text: formatWebSearchErrorMessage(error, "DuckDuckGo test failed.") });
    } finally {
      setTestingSearch(false);
    }
  }

  function removeHistoryEntry(url: string) {
    setHistory(removeBrowserHistoryEntry(url));
  }

  return (
    <>
      <SettingsSectionHeading detail="In-app browser privacy, history, website permissions, and web-search readiness." icon={Globe2} title="Browser" />
      <div className="settings-section-grid browser-settings-grid">
        <article className="settings-card settings-card-wide browser-settings-hero">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Browser mode</h2>
              <p>Incognito uses a private desktop WebView session and stops Gilbert from saving tabs or history.</p>
            </div>
          </div>
          <div className="browser-settings-metrics">
            <BrowserMetric icon={History} label="History" value={formatCount(history.entries.length)} />
            <BrowserMetric icon={Globe2} label="Allowed" value={formatCount(browserSettings.allowedDomains.length)} />
            <BrowserMetric icon={Ban} label="Blocked" value={formatCount(browserSettings.blockedDomains.length)} />
            <BrowserMetric icon={Search} label="Search" value={searchEngineOptions.find((option) => option.id === browserSettings.defaultSearchEngine)?.label ?? "DuckDuckGo"} />
          </div>
          <div className="settings-row-list">
            <BrowserToggleRow
              detail={browserSettings.incognitoEnabled ? "Private desktop WebViews; no saved tabs or history." : "Normal browsing with saved tabs and history."}
              label="Incognito mode"
              value={browserSettings.incognitoEnabled}
              onToggle={() => updateBrowserSettings({ incognitoEnabled: !browserSettings.incognitoEnabled })}
            />
            <BrowserToggleRow
              detail={browserSettings.saveHistory && !browserSettings.incognitoEnabled ? "Visited pages appear in browser history." : "Visited pages are not added to history."}
              disabled={browserSettings.incognitoEnabled}
              label="Save history"
              value={browserSettings.saveHistory && !browserSettings.incognitoEnabled}
              onToggle={() => updateBrowserSettings({ saveHistory: !browserSettings.saveHistory })}
            />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Search size={19} aria-hidden="true" />
            <div>
              <h2>Search</h2>
              <p>The browser address bar uses this engine. Model web search keeps its own provider setting below.</p>
            </div>
          </div>
          <div className="settings-segmented-control browser-search-engine-control" role="radiogroup" aria-label="Browser search engine">
            {searchEngineOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={browserSettings.defaultSearchEngine === option.id}
                data-selected={browserSettings.defaultSearchEngine === option.id}
                onClick={() => updateBrowserSettings({ defaultSearchEngine: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Model web tool</span>
              <strong>{webSearch.enabled ? `${WEB_SEARCH_PROVIDER_LABELS[webSearch.provider]} enabled` : "Disabled"}</strong>
              <button className="settings-switch" type="button" role="switch" aria-checked={webSearch.enabled} data-on={webSearch.enabled} onClick={() => updateWebSearch({ enabled: !webSearch.enabled })}>
                <span />
              </button>
            </div>
            <div className="settings-row">
              <span>Sources per search</span>
              <strong>{sourceLimit}</strong>
              <input
                aria-label="Sources per web search"
                max={MAX_WEB_SEARCH_RESULTS}
                min={1}
                type="number"
                value={sourceLimit}
                onChange={(event) => updateWebSearch({ maxResults: Math.min(Math.max(Number.parseInt(event.target.value, 10) || 1, 1), MAX_WEB_SEARCH_RESULTS) })}
              />
            </div>
          </div>
          <div className="settings-actions-row">
            <button className="settings-primary-button" type="button" disabled={testingSearch} onClick={testDuckDuckGo}>
              <CheckCircle2 size={16} aria-hidden="true" />
              {testingSearch ? "Testing" : "Test DuckDuckGo"}
            </button>
            {testStatus ? <span className="settings-status" data-kind={testStatus.kind}>{testStatus.text}</span> : null}
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <ShieldCheck size={19} aria-hidden="true" />
            <div>
              <h2>Website approval</h2>
              <p>Localhost opens directly. External domains follow the selected approval mode and domain lists.</p>
            </div>
          </div>
          <div className="settings-segmented-control browser-approval-control" role="radiogroup" aria-label="Browser website approval">
            {approvalModeOptions.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={browserSettings.approvalMode === option.id}
                data-selected={browserSettings.approvalMode === option.id}
                title={option.detail}
                onClick={() => updateBrowserSettings({ approvalMode: option.id })}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="settings-field">
            <span>Add domain</span>
            <div className="browser-domain-editor">
              <input placeholder="example.com" value={domainDraft} onChange={(event) => setDomainDraft(event.target.value)} />
              <button className="settings-ghost-button" type="button" onClick={() => addDomain("allowed")}>
                <ListPlus size={15} aria-hidden="true" />
                Allow
              </button>
              <button className="settings-danger-button" type="button" onClick={() => addDomain("blocked")}>
                <Ban size={15} aria-hidden="true" />
                Block
              </button>
            </div>
          </label>
          <div className="browser-domain-columns">
            <DomainList domains={browserSettings.allowedDomains} emptyLabel="No allowed domains" icon={Globe2} title="Allowed domains" onRemove={(domain) => removeDomain("allowed", domain)} />
            <DomainList domains={browserSettings.blockedDomains} emptyLabel="No blocked domains" icon={Ban} title="Blocked domains" onRemove={(domain) => removeDomain("blocked", domain)} />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Database size={19} aria-hidden="true" />
            <div>
              <h2>Browsing data</h2>
              <p>Clear local history, saved tabs, console diagnostics, and native WebView data.</p>
            </div>
          </div>
          <div className="settings-actions-row">
            <button className="settings-ghost-button" type="button" disabled={history.entries.length === 0} onClick={() => setClearHistoryConfirmOpen(true)}>
              <Trash2 size={16} aria-hidden="true" />
              Clear history
            </button>
            <button className="settings-danger-button" type="button" disabled={clearingData} onClick={() => setClearAllConfirmOpen(true)}>
              <Trash2 size={16} aria-hidden="true" />
              {clearingData ? "Clearing" : "Clear all browsing data"}
            </button>
            {dataStatus ? <span className="settings-status" data-kind={dataStatus.kind}>{dataStatus.text}</span> : null}
          </div>
        </article>

        <article className="settings-card settings-card-wide browser-history-card">
          <div className="settings-card-heading">
            <History size={19} aria-hidden="true" />
            <div>
              <h2>History</h2>
              <p>{filteredHistory.length === sortedHistory.length ? `${formatCount(sortedHistory.length)} saved page${sortedHistory.length === 1 ? "" : "s"}` : `${formatCount(filteredHistory.length)} of ${formatCount(sortedHistory.length)} shown`}</p>
            </div>
          </div>
          <label className="settings-field">
            <span>Search history</span>
            <input placeholder="Title or URL" value={historyQuery} onChange={(event) => setHistoryQuery(event.target.value)} />
          </label>
          <div className="browser-history-list" role="list" aria-label="Browser history">
            {filteredHistory.length > 0 ? (
              filteredHistory.map((entry) => (
                <article className="browser-history-row" role="listitem" key={entry.url}>
                  <div className="browser-history-main">
                    <a href={entry.url} target="_blank" rel="noreferrer">
                      {entry.title}
                      <ExternalLink size={13} aria-hidden="true" />
                    </a>
                    <span>{entry.url}</span>
                  </div>
                  <div className="browser-history-meta">
                    <span><Clock3 size={13} aria-hidden="true" /> {formatHistoryTime(entry.lastVisitedAt)}</span>
                    <span><Activity size={13} aria-hidden="true" /> {formatCount(entry.visitCount)}</span>
                  </div>
                  <button type="button" aria-label={`Remove ${entry.title} from history`} onClick={() => removeHistoryEntry(entry.url)}>
                    <X size={15} aria-hidden="true" />
                  </button>
                </article>
              ))
            ) : (
              <div className="database-empty-state">No browser history saved.</div>
            )}
          </div>
        </article>
      </div>

      <ConfirmDialog
        confirmLabel="Clear history"
        description="This removes saved browser history from this device. Saved tabs, cookies, and cache stay untouched."
        icon={Trash2}
        open={clearHistoryConfirmOpen}
        title="Clear browser history?"
        tone="danger"
        onClose={() => setClearHistoryConfirmOpen(false)}
        onConfirm={confirmClearHistory}
      />

      <ConfirmDialog
        confirmLabel="Clear all"
        description="This clears browser history, saved tabs, console entries, and native WebView browsing data on this device."
        icon={Trash2}
        open={clearAllConfirmOpen}
        title="Clear all browsing data?"
        tone="danger"
        onClose={() => setClearAllConfirmOpen(false)}
        onConfirm={() => void confirmClearAllData()}
      />
    </>
  );
}

function BrowserMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="browser-settings-metric">
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BrowserToggleRow({
  detail,
  disabled = false,
  label,
  onToggle,
  value,
}: {
  detail: string;
  disabled?: boolean;
  label: string;
  onToggle: () => void;
  value: boolean;
}) {
  return (
    <div className="settings-row">
      <span>{label}</span>
      <strong>{detail}</strong>
      <button className="settings-switch" disabled={disabled} type="button" role="switch" aria-checked={value} data-on={value} onClick={onToggle}>
        <span />
      </button>
    </div>
  );
}

function DomainList({
  domains,
  emptyLabel,
  icon: Icon,
  onRemove,
  title,
}: {
  domains: string[];
  emptyLabel: string;
  icon: LucideIcon;
  onRemove: (domain: string) => void;
  title: string;
}) {
  return (
    <section className="browser-domain-list">
      <div className="browser-domain-list-title">
        <Icon size={15} aria-hidden="true" />
        <span>{title}</span>
      </div>
      {domains.length > 0 ? (
        <div className="browser-domain-chips">
          {domains.map((domain) => (
            <span key={domain}>
              {domain}
              <button type="button" aria-label={`Remove ${domain}`} onClick={() => onRemove(domain)}>
                <X size={13} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className="database-empty-state">{emptyLabel}</div>
      )}
    </section>
  );
}

function formatCount(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatHistoryTime(value: string) {
  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
