import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ExternalLink, KeyRound, Route } from "lucide-react";
import { ensureNineRouterLocal, getNineRouterLocalStatus, isTauriDesktopRuntime, type NineRouterLocalStatus } from "../../app/tauriClient";
import {
  chooseNineRouterModel,
  choosePreferredConnection,
  connectNineRouterAccount,
  formatConnectionExpiry,
  formatConnectionIdentity,
  isConnectionActive,
  loadNineRouterConnections,
  loadNineRouterModels,
  NINE_ROUTER_ACCOUNT_PROVIDERS,
  NINE_ROUTER_DASHBOARD_FALLBACK,
  NINE_ROUTER_PROVIDER_ID,
  type NineRouterAccountProvider,
  type NineRouterConnection,
  type NineRouterStatusMessage,
} from "../../services/nineRouterClient";
import { getDefaultBaseUrlForProvider, OPENROUTER_AUTO_MODEL, OPENROUTER_FREE_AUTO_MODEL } from "../../lib/models";
import { scheduleIdleTask } from "../../lib/idleTask";
import type { ModelProviderId, ProviderSettings } from "../../types/settings";
import { DialogShell } from "../dialogs/AppDialog";

type ProviderConnectionBusy = "activate-subscriptions" | "fallback" | "refresh" | "start" | `account:${string}` | null;

interface ProviderConnectionDialogProps {
  onActivateProvider: (provider: ModelProviderId, model: string) => void;
  onClose: () => void;
  onNeverShowAgain: () => void;
  onOpenNineRouterSettings: () => void;
  onOpenProviderSettings: () => void;
  open: boolean;
  settings: ProviderSettings;
}

interface AccountRow {
  connection: NineRouterConnection | null;
  connections: NineRouterConnection[];
  provider: NineRouterAccountProvider;
}

export function ProviderConnectionDialog({
  onActivateProvider,
  onClose,
  onNeverShowAgain,
  onOpenNineRouterSettings,
  onOpenProviderSettings,
  open,
  settings,
}: ProviderConnectionDialogProps) {
  const mountedRef = useRef(true);
  const accountConnectRunRef = useRef(0);
  const [busy, setBusy] = useState<ProviderConnectionBusy>(null);
  const [connections, setConnections] = useState<NineRouterConnection[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [runtimeStatus, setRuntimeStatus] = useState<NineRouterLocalStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<NineRouterStatusMessage | null>(null);
  const nineRouterBaseUrl = settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || runtimeStatus?.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID);
  const savedNineRouterModel = settings.providerModels[NINE_ROUTER_PROVIDER_ID]?.trim() || "";
  const openRouterHasKey = Boolean((settings.apiKeys.openrouter || settings.openRouterApiKey || "").trim());
  const openRouterFallbackModel = openRouterHasKey ? OPENROUTER_AUTO_MODEL : OPENROUTER_FREE_AUTO_MODEL;
  const activeConnectionCount = connections.filter(isConnectionActive).length;
  const connectedAccountCount = connections.length;
  const accountRows = useMemo<AccountRow[]>(
    () => NINE_ROUTER_ACCOUNT_PROVIDERS.map((provider) => {
      const providerConnections = connections.filter((connection) => connection.provider === provider.id);

      return {
        connection: choosePreferredConnection(providerConnections),
        connections: providerConnections,
        provider,
      };
    }),
    [connections],
  );

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      accountConnectRunRef.current += 1;
    };
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    setStatusMessage(null);
    return scheduleIdleTask(() => {
      void refreshNineRouterState({ quiet: true, start: true });
    }, 700);
  }, [open]);

  async function refreshNineRouterState(options: { quiet?: boolean; start?: boolean } = {}) {
    const runId = accountConnectRunRef.current;
    setBusy((current) => current ?? "refresh");

    try {
      const nextStatus = options.start ? await ensureNineRouterLocal() : await getNineRouterLocalStatus();

      if (!mountedRef.current || accountConnectRunRef.current !== runId) {
        return;
      }

      setRuntimeStatus(nextStatus);

      if (!nextStatus.running) {
        setConnections([]);
        setModels([]);
        if (!options.quiet) {
          setStatusMessage({ kind: "warning", text: nextStatus.message });
        }
        return;
      }

      const [nextConnections, nextModels] = await Promise.all([
        loadNineRouterConnections(nextStatus.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK),
        loadNineRouterModels(settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || nextStatus.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID)),
      ]);

      if (!mountedRef.current || accountConnectRunRef.current !== runId) {
        return;
      }

      setConnections(nextConnections);
      setModels(nextModels);
      if (!options.quiet) {
        setStatusMessage({
          kind: nextConnections.length > 0 ? "success" : "warning",
          text: nextConnections.length > 0 ? `${nextConnections.length} subscription account${nextConnections.length === 1 ? "" : "s"} found.` : "Subscriptions are running with no connected accounts yet.",
        });
      }
    } catch (error) {
      if (mountedRef.current && accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not check subscriptions." });
      }
    } finally {
      if (mountedRef.current && accountConnectRunRef.current === runId) {
        setBusy((current) => (current === "refresh" ? null : current));
      }
    }
  }

  async function connectAccount(provider: NineRouterAccountProvider) {
    const runId = accountConnectRunRef.current + 1;
    accountConnectRunRef.current = runId;
    setBusy(`account:${provider.id}`);
    setStatusMessage(null);

    try {
      let nextStatus = runtimeStatus;
      if (!nextStatus?.running) {
        nextStatus = await ensureNineRouterLocal();
        if (!mountedRef.current || accountConnectRunRef.current !== runId) {
          return;
        }
        setRuntimeStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || `Set up subscriptions before connecting ${provider.name}.`);
      }

      await connectNineRouterAccount(provider, nextStatus.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK, {
        isActive: () => mountedRef.current && accountConnectRunRef.current === runId,
        onStatus: setStatusMessage,
      });

      if (!mountedRef.current || accountConnectRunRef.current !== runId) {
        return;
      }

      const [nextConnections, nextModels] = await Promise.all([
        loadNineRouterConnections(nextStatus.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK),
        loadNineRouterModels(settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || nextStatus.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID)),
      ]);
      const preferredConnection = choosePreferredConnection(nextConnections.filter((connection) => connection.provider === provider.id));
      const nextModel = chooseNineRouterModel(savedNineRouterModel, nextModels);

      if (!mountedRef.current || accountConnectRunRef.current !== runId) {
        return;
      }

      setConnections(nextConnections);
      setModels(nextModels);

      if (nextModels.length > 0 || provider.id === "codex") {
        onActivateProvider(NINE_ROUTER_PROVIDER_ID, nextModel);
        setStatusMessage({
          kind: "success",
          text: `${formatConnectionIdentity(preferredConnection) || provider.name} is connected. Gilbert is using ${nextModel} through your subscriptions.`,
        });
        onClose();
        return;
      }

      setStatusMessage({
        kind: "warning",
        text: `${provider.name} connected, but no live model route was reported yet. Open Subscriptions settings to refresh the catalog.`,
      });
    } catch (error) {
      if (mountedRef.current && accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : `Could not connect ${provider.name}.` });
      }
    } finally {
      if (mountedRef.current && accountConnectRunRef.current === runId) {
        setBusy((current) => (current === `account:${provider.id}` ? null : current));
      }
    }
  }

  async function activateNineRouter() {
    setBusy("activate-subscriptions");
    setStatusMessage(null);

    try {
      let nextModels = models;
      let nextStatus = runtimeStatus;

      if (!nextStatus?.running) {
        nextStatus = await ensureNineRouterLocal();
        if (!mountedRef.current) {
          return;
        }
        setRuntimeStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || "Set up subscriptions before switching to them.");
      }

      if (nextModels.length === 0) {
        nextModels = await loadNineRouterModels(nineRouterBaseUrl);
        if (!mountedRef.current) {
          return;
        }
        setModels(nextModels);
      }

      const nextModel = chooseNineRouterModel(savedNineRouterModel, nextModels);
      onActivateProvider(NINE_ROUTER_PROVIDER_ID, nextModel);
      setStatusMessage({ kind: "success", text: `Gilbert is using ${nextModel} through your subscriptions.` });
      onClose();
    } catch (error) {
      if (mountedRef.current) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not activate subscription routing." });
      }
    } finally {
      if (mountedRef.current) {
        setBusy((current) => (current === "activate-subscriptions" ? null : current));
      }
    }
  }

  function useOpenRouterFallback() {
    setBusy("fallback");
    onActivateProvider("openrouter", openRouterFallbackModel);
    setStatusMessage({
      kind: "success",
      text: openRouterHasKey ? "Gilbert is using OpenRouter Auto with the saved OpenRouter key." : "Gilbert is using the OpenRouter free fallback route.",
    });
    setBusy(null);
    onClose();
  }

  const runtimeReady = Boolean(runtimeStatus?.running);
  const runtimeInstalled = Boolean(runtimeStatus?.installed);
  const subscriptionSetupNeeded = isTauriDesktopRuntime() && Boolean(runtimeStatus) && !runtimeInstalled;
  const useSubscriptionsAsPrimaryAction = runtimeReady && (activeConnectionCount > 0 || models.length > 0);
  const primaryActionLabel = subscriptionSetupNeeded ? "Set up subscriptions" : useSubscriptionsAsPrimaryAction ? "Use subscriptions" : openRouterHasKey ? "Use OpenRouter Auto" : "Use Free Fallback";
  const primaryBusyLabel = busy === "activate-subscriptions" ? "Using subscriptions" : busy === "fallback" ? "Switching" : primaryActionLabel;
  const displayStatusMessage = statusMessage
    ? {
        ...statusMessage,
        text: formatSubscriptionHelperText(statusMessage.text),
      }
    : null;

  function handlePrimaryAction() {
    if (subscriptionSetupNeeded) {
      onOpenNineRouterSettings();
      return;
    }

    if (useSubscriptionsAsPrimaryAction) {
      void activateNineRouter();
      return;
    }

    useOpenRouterFallback();
  }

  return (
    <DialogShell
      description="Use subscriptions first, fall back cleanly. Sign in with the provider accounts you already pay for; Gilbert keeps OpenRouter ready when nothing is connected."
      icon={Route}
      onClose={onClose}
      open={open}
      title="Connect an AI provider"
      actions={
        <>
          <button className="dialog-button provider-connection-secondary-action" type="button" onClick={onOpenNineRouterSettings}>
            <Route size={15} aria-hidden="true" />
            Subscriptions
          </button>
          <button className="dialog-button provider-connection-secondary-action" type="button" onClick={onOpenProviderSettings}>
            <KeyRound size={15} aria-hidden="true" />
            Provider Keys
          </button>
          <button className="dialog-button" type="button" onClick={onClose}>
            Later
          </button>
          <button className="dialog-button provider-connection-secondary-action" type="button" onClick={onNeverShowAgain}>
            Do not show again
          </button>
          <button className="dialog-button dialog-button-primary provider-connection-primary-action" type="button" disabled={busy !== null} onClick={handlePrimaryAction}>
            {primaryBusyLabel}
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </>
      }
    >
      <div className="provider-connection-dialog-content">
        {displayStatusMessage ? (
          <div className="provider-connection-status" data-kind={displayStatusMessage.kind} role="status" aria-live="polite">
            {displayStatusMessage.text}
          </div>
        ) : null}

        <section className="provider-account-panel" aria-label="Subscription account providers">
          <div className="provider-account-panel-heading" aria-label="Subscription account summary">
            <div>
              <h4>Subscription accounts</h4>
              <span>{runtimeReady ? "Ready for provider sign-in." : isTauriDesktopRuntime() ? runtimeInstalled ? "Starting subscriptions automatically." : "Install subscriptions once, then sign in." : "Open the desktop app to connect subscription accounts."}</span>
            </div>
            <div className="provider-account-counts" aria-label="Saved subscription accounts">
              <strong>{activeConnectionCount}/{NINE_ROUTER_ACCOUNT_PROVIDERS.length}</strong>
              <span>{connectedAccountCount > 0 ? `${connectedAccountCount} saved` : "none saved"}</span>
            </div>
          </div>

          <div className="provider-account-grid">
            {accountRows.map(({ connection, connections: providerConnections, provider }) => {
              const providerBusy = busy === `account:${provider.id}`;
              const connected = Boolean(connection);

              return (
                <section className="provider-account-card" data-connected={connected} key={provider.id}>
                  <div className="provider-account-card-heading">
                    <div>
                      <strong>{provider.name}</strong>
                      <span>{provider.description}</span>
                    </div>
                    <em>{connected ? "Connected" : provider.flow === "device_code" ? "Device" : "OAuth"}</em>
                  </div>
                  <dl>
                    <div>
                      <dt>Account</dt>
                      <dd>{formatConnectionIdentity(connection) || "Not connected"}</dd>
                    </div>
                    <div>
                      <dt>Token</dt>
                      <dd>{formatConnectionExpiry(connection)}</dd>
                    </div>
                    {providerConnections.length > 1 ? (
                      <div>
                        <dt>Saved</dt>
                        <dd>{providerConnections.length}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {connection?.lastError ? <p className="provider-account-error">{connection.lastError}</p> : null}
                  <button type="button" disabled={busy !== null || !runtimeReady} onClick={() => connectAccount(provider)}>
                    {provider.flow === "device_code" ? <ExternalLink size={15} aria-hidden="true" /> : <KeyRound size={15} aria-hidden="true" />}
                    {providerBusy ? "Waiting" : connected ? "Reconnect" : "Sign in"}
                  </button>
                </section>
              );
            })}
          </div>
        </section>

      </div>
    </DialogShell>
  );
}

function formatSubscriptionHelperText(text: string) {
  return text
    .replace(/\b[9]Router Local started and is ready\./g, "Subscriptions are ready.")
    .replace(/\b[9]Router Local is already running\./g, "Subscriptions are ready.")
    .replace(/\b[9]Router Local is installed\./g, "Subscriptions are installed.")
    .replace(/\b[9]Router Local was started, but the API is not ready yet\./g, "Subscriptions are still starting. Try again in a moment.")
    .replace(/\b[9]Router Local\b/g, "subscriptions")
    .replace(/\b[9]Router\b/g, "subscriptions")
    .replace(/\s+at\s+https?:\/\/(?:127\.0\.0\.1|localhost):20128(?:\/[^\s.]*)?/gi, "")
    .replace(/\bhttps?:\/\/(?:127\.0\.0\.1|localhost):20128(?:\/[^\s.]*)?/gi, "Subscriptions")
    .replace(/\b(from|in) subscriptions settings\b/gi, "$1 Subscriptions settings")
    .replace(/\bStart subscriptions, then retry\b/g, "Open Subscriptions, then retry")
    .replace(/\bsubscription helper\b/gi, "subscriptions");
}
