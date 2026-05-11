import {
  AlertTriangle,
  Archive,
  Clock3,
  Database,
  Eraser,
  FileText,
  HardDrive,
  ListTree,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DialogShell } from "../../../components/dialogs/AppDialog";
import {
  cleanupLegacyDeviceStorage,
  getDeviceDatabaseOverview,
  isDeviceDatabaseAvailable,
  resetDeviceDatabase,
  type DeviceDatabaseOverview,
} from "../../../lib/deviceDatabase";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

const RESET_PHRASE = "DELETE GILBERT DATABASE";

export function DatabaseSettingsPage() {
  const [overview, setOverview] = useState<DeviceDatabaseOverview | null>(null);
  const [status, setStatus] = useState<SettingsStatusMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetting, setResetting] = useState(false);

  const sortedCategories = useMemo(
    () => overview?.categories.slice().sort((left, right) => right.storageBytes - left.storageBytes) ?? [],
    [overview],
  );
  const sortedRecords = useMemo(
    () => overview?.records.slice().sort((left, right) => right.sizeBytes - left.sizeBytes) ?? [],
    [overview],
  );
  const maxCategoryBytes = Math.max(...sortedCategories.map((category) => category.storageBytes), 1);
  const resetAllowed = resetPhrase.trim() === RESET_PHRASE && !resetting;
  const desktopAvailable = isDeviceDatabaseAvailable();

  useEffect(() => {
    void refreshOverview({ quiet: true });
  }, []);

  async function refreshOverview(options: { quiet?: boolean } = {}) {
    if (!desktopAvailable) {
      setOverview(null);
      setStatus({ kind: "warning", text: "Open the desktop app to inspect the on-device SQL database." });
      return;
    }

    setLoading(true);
    if (!options.quiet) {
      setStatus(null);
    }

    try {
      const nextOverview = await getDeviceDatabaseOverview();
      setOverview(nextOverview);
      if (!options.quiet) {
        setStatus({ kind: "success", text: "Database view refreshed." });
      }
    } catch (error) {
      setStatus({ kind: "error", text: readErrorMessage(error, "Could not inspect the local database.") });
    } finally {
      setLoading(false);
    }
  }

  async function handleCleanupLegacyStorage() {
    if (!desktopAvailable) {
      setStatus({ kind: "warning", text: "Open the desktop app to clean legacy storage." });
      return;
    }

    setCleanupBusy(true);
    setStatus(null);

    try {
      const cleanup = await cleanupLegacyDeviceStorage();
      const count = cleanup?.removedPaths.length ?? 0;
      setStatus({
        kind: "success",
        text: count > 0 ? `Removed ${count} old storage path${count === 1 ? "" : "s"}.` : "No old storage paths found.",
      });
      await refreshOverview({ quiet: true });
    } catch (error) {
      setStatus({ kind: "error", text: readErrorMessage(error, "Could not clean old storage.") });
    } finally {
      setCleanupBusy(false);
    }
  }

  async function handleResetDatabase() {
    setResetting(true);
    setStatus(null);

    try {
      const reset = await resetDeviceDatabase();
      clearBrowserStorage();
      setResetConfirmOpen(false);
      setResetPhrase("");
      const count = reset?.removedPaths.length ?? 0;
      const failedCount = reset?.failedPaths.length ?? 0;
      setStatus({
        kind: failedCount > 0 ? "warning" : "success",
        text:
          failedCount > 0
            ? `Database reset complete. Removed ${count} local path${count === 1 ? "" : "s"}; ${failedCount} legacy path${failedCount === 1 ? "" : "s"} stayed locked until restart.`
            : `Clean slate complete. Removed ${count} local path${count === 1 ? "" : "s"} and reloading now.`,
      });
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      setStatus({ kind: "error", text: readErrorMessage(error, "Could not reset the local database.") });
      setResetting(false);
    }
  }

  return (
    <>
      <SettingsSectionHeading detail="Inspect this account's local SQL records, context footprint, legacy storage, and reset controls." icon={Database} title="Database" />
      <div className="settings-section-grid database-settings-grid">
        {status ? (
          <div className="settings-status-banner settings-card-wide" data-kind={status.kind}>
            {status.text}
          </div>
        ) : null}

        <article className="settings-card settings-card-wide database-storage-hero">
          <div className="settings-card-heading">
            <HardDrive size={19} aria-hidden="true" />
            <div>
              <h2>Gilbert Database</h2>
              <p>{overview?.databasePath ?? "Documents\\GilbertCodex\\Gilbert Database.sqlite3"}</p>
            </div>
          </div>
          <div className="database-metric-grid">
            <DatabaseMetric icon={Archive} label="Total storage" value={formatBytes(overview?.fileSizeBytes ?? 0)} detail={overview?.exists ? "SQLite file on this device" : "Database not created yet"} />
            <DatabaseMetric icon={ListTree} label="Records" value={formatNumber(overview?.recordCount ?? 0)} detail={`${formatNumber(overview?.namespaceCount ?? 0)} namespace${overview?.namespaceCount === 1 ? "" : "s"}`} />
            <DatabaseMetric icon={MessageSquareText} label="Estimated context" value={formatNumber(overview?.context.estimatedTokens ?? 0)} detail="tokens from saved message text" />
            <DatabaseMetric icon={Clock3} label="Last modified" value={formatTimestamp(overview?.lastModified ?? null)} detail={loading ? "Refreshing" : "Current snapshot"} />
          </div>
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <ListTree size={19} aria-hidden="true" />
            <div>
              <h2>Storage usage</h2>
              <p>What this signed-in account is using right now.</p>
            </div>
          </div>
          <div className="database-usage-list">
            {sortedCategories.length > 0 ? (
              sortedCategories.map((category) => (
                <div className="database-usage-row" key={category.id}>
                  <div>
                    <strong>{category.label}</strong>
                    <span>{category.description}</span>
                  </div>
                  <div className="database-usage-meter" aria-hidden="true">
                    <span style={{ width: `${Math.max(3, (category.storageBytes / maxCategoryBytes) * 100)}%` }} />
                  </div>
                  <div>
                    <strong>{formatBytes(category.storageBytes)}</strong>
                    <span>{formatNumber(category.recordCount)} record{category.recordCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="database-empty-state">No saved database records yet.</div>
            )}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <MessageSquareText size={19} aria-hidden="true" />
            <div>
              <h2>Context inventory</h2>
              <p>Saved chat, source, image, tool, and reasoning counts.</p>
            </div>
          </div>
          <div className="database-context-grid">
            <DatabaseStat label="Chats" value={overview?.context.chatCount ?? 0} />
            <DatabaseStat label="Messages" value={overview?.context.messageCount ?? 0} />
            <DatabaseStat label="User" value={overview?.context.userMessageCount ?? 0} />
            <DatabaseStat label="Assistant" value={overview?.context.assistantMessageCount ?? 0} />
            <DatabaseStat label="Sources" value={overview?.context.sourceCount ?? 0} />
            <DatabaseStat label="Images" value={overview?.context.imageCount ?? 0} />
            <DatabaseStat label="Files" value={overview?.context.fileAttachmentCount ?? 0} />
            <DatabaseStat label="Tool calls" value={overview?.context.toolCallCount ?? 0} />
            <DatabaseStat label="Approvals" value={overview?.context.approvalCount ?? 0} />
            <DatabaseStat label="Artifacts" value={overview?.context.artifactCount ?? 0} />
            <DatabaseStat label="Compactions" value={overview?.context.contextCompactionCount ?? 0} />
            <DatabaseStat label="Agent runs" value={overview?.context.agentRunCount ?? 0} />
          </div>
          <div className="settings-row-list database-context-detail">
            <div className="settings-row">
              <span>Saved message text</span>
              <strong>{formatBytes(overview?.context.contentBytes ?? 0)}</strong>
            </div>
            <div className="settings-row">
              <span>Thinking and reasoning</span>
              <strong>{formatBytes((overview?.context.thinkingBytes ?? 0) + (overview?.context.reasoningBytes ?? 0))}</strong>
            </div>
            <div className="settings-row">
              <span>Largest chat</span>
              <strong>{overview?.context.largestChatTitle || "None"}</strong>
              <em>{formatBytes(overview?.context.largestChatBytes ?? 0)}</em>
            </div>
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <FileText size={19} aria-hidden="true" />
            <div>
              <h2>Records</h2>
              <p>Saved objects for this account without exposing raw sensitive values.</p>
            </div>
          </div>
          <div className="database-record-list">
            {sortedRecords.length > 0 ? (
              sortedRecords.map((record) => (
                <div className="database-record-row" key={`${record.namespace}:${record.key}`}>
                  <div>
                    <strong>
                      {record.label}
                      {record.sensitive ? <LockKeyhole size={14} aria-label="Sensitive" /> : null}
                    </strong>
                    <span>{record.summary}</span>
                    <code>{record.namespace} / {record.key}</code>
                  </div>
                  <div>
                    <strong>{formatBytes(record.sizeBytes)}</strong>
                    <span>{formatTimestamp(record.updatedAt)}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="database-empty-state">Nothing saved yet.</div>
            )}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Eraser size={19} aria-hidden="true" />
            <div>
              <h2>Maintenance</h2>
              <p>Refresh this view or remove leftover storage from older builds.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Current database</span>
              <strong>{overview?.exists ? "Connected" : "Not created"}</strong>
              <button className="settings-ghost-button" type="button" disabled={loading} onClick={() => refreshOverview()}>
                <RefreshCw size={16} aria-hidden="true" />
                {loading ? "Refreshing" : "Refresh"}
              </button>
            </div>
            <div className="settings-row">
              <span>Legacy storage</span>
              <strong>{formatBytes(overview?.legacyStorage.totalBytes ?? 0)}</strong>
              <button className="settings-ghost-button" type="button" disabled={cleanupBusy} onClick={handleCleanupLegacyStorage}>
                <Eraser size={16} aria-hidden="true" />
                {cleanupBusy ? "Cleaning" : "Clean"}
              </button>
            </div>
          </div>
          <div className="database-legacy-list">
            {overview?.legacyStorage.files.map((file) => (
              <div className="database-legacy-row" key={file.path} data-exists={file.exists}>
                <span>{file.exists ? "Found" : "Clear"}</span>
                <code>{file.path}</code>
                <strong>{formatBytes(file.sizeBytes)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="settings-card database-danger-card">
          <div className="settings-card-heading">
            <ShieldAlert size={19} aria-hidden="true" />
            <div>
              <h2>Danger zone</h2>
              <p>Reset this app to a clean slate on this device.</p>
            </div>
          </div>
          <div className="settings-warning">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>Deleting the database removes all local accounts, chats, projects, sources, images, settings, tool history, and local integrations.</span>
          </div>
          <button className="settings-danger-button database-danger-button" type="button" onClick={() => setResetConfirmOpen(true)}>
            <Trash2 size={16} aria-hidden="true" />
            Delete database
          </button>
        </article>
      </div>

      <DialogShell
        actions={
          <>
            <button className="dialog-button" type="button" disabled={resetting} onClick={() => setResetConfirmOpen(false)}>
              Cancel
            </button>
            <button className="dialog-button dialog-button-primary" data-tone="danger" type="button" disabled={!resetAllowed} onClick={handleResetDatabase}>
              {resetting ? "Deleting" : "Delete database"}
            </button>
          </>
        }
        description="This deletes Gilbert Database for every local account and resets the app to a clean slate on this device."
        icon={Trash2}
        open={resetConfirmOpen}
        title="Delete Gilbert Database?"
        tone="danger"
        onClose={() => {
          if (!resetting) {
            setResetConfirmOpen(false);
          }
        }}
      >
        <div className="database-reset-dialog">
          <div className="settings-warning">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>This cannot be undone unless the user kept their own backup of the database file.</span>
          </div>
          <label>
            <span>Type {RESET_PHRASE}</span>
            <input autoFocus value={resetPhrase} onChange={(event) => setResetPhrase(event.target.value)} />
          </label>
        </div>
      </DialogShell>
    </>
  );
}

interface DatabaseMetricProps {
  detail: string;
  icon: typeof Database;
  label: string;
  value: string;
}

function DatabaseMetric({ detail, icon: Icon, label, value }: DatabaseMetricProps) {
  return (
    <div className="database-metric">
      <Icon size={17} aria-hidden="true" />
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </div>
  );
}

interface DatabaseStatProps {
  label: string;
  value: number;
}

function DatabaseStat({ label, value }: DatabaseStatProps) {
  return (
    <div className="database-stat">
      <strong>{formatNumber(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function clearBrowserStorage() {
  try {
    window.localStorage.clear();
  } catch {
    // Ignore locked browser storage during reset.
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // Ignore locked browser storage during reset.
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value);
}

function formatTimestamp(timestamp: number | null) {
  if (!timestamp) {
    return "Never";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}
