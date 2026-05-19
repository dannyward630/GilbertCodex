import { CheckCircle2, Download, ExternalLink, KeyRound, Play, RefreshCcw, Route, ServerCog, UserCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ensureNineRouterLocal,
  finishNineRouterOAuthCallback,
  getNineRouterLocalStatus,
  installNineRouterLocal,
  isTauriDesktopRuntime,
  nineRouterLocalHttp,
  openExternalUrl,
  startNineRouterOAuthCallback,
  type NineRouterInstallEvent,
  type NineRouterLocalStatus,
} from "../../../app/tauriClient";
import { getDefaultBaseUrlForProvider, getDefaultModelForProvider } from "../../../lib/models";
import { headersToRecord, normalizeNativeRequestBody, normalizeNativeRequestMethod } from "../../../services/nativeHttp";
import {
  choosePreferredConnection,
  formatConnectionExpiry,
  formatConnectionIdentity,
  isConnectionActive,
  NINE_ROUTER_ACCOUNT_PROVIDERS,
  NINE_ROUTER_CODEX_MAX_POLL_ATTEMPTS,
  NINE_ROUTER_CODEX_POLL_INTERVAL_MS,
  NINE_ROUTER_CODEX_PROXY_APP_PORT,
  NINE_ROUTER_CODEX_REDIRECT_URI,
  NINE_ROUTER_DASHBOARD_FALLBACK,
  NINE_ROUTER_DEVICE_POLL_MAX_ATTEMPTS,
  NINE_ROUTER_PROVIDER_ID,
  type NineRouterAccountProvider,
  type NineRouterAuthorizeResponse,
  type NineRouterCodexPollResponse,
  type NineRouterCodexProxyResponse,
  type NineRouterConnection,
  type NineRouterDeviceCodeResponse,
  type NineRouterExchangeResponse,
  type NineRouterOAuthPollResponse,
} from "../../../services/nineRouterClient";
import type { ProviderSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface NineRouterSettingsPageProps {
  onSettingsChange: (settings: ProviderSettings) => void;
  settings: ProviderSettings;
}

type NineRouterBusyState = `account:${string}` | "install" | "start" | "status" | null;
type NineRouterModelCatalogState = {
  message: string;
  models: string[];
  status: "idle" | "loading" | "ready" | "error";
};
type NineRouterConnectionCatalogState = {
  connections: NineRouterConnection[];
  message: string;
  status: "idle" | "loading" | "ready" | "error";
};

interface NineRouterUsageQuota {
  displayName?: string | null;
  remaining?: number | null;
  remainingPercentage?: number | null;
  resetAt?: string | null;
  total?: number | null;
  unlimited?: boolean | null;
  used?: number | null;
}

interface NineRouterUsagePayload {
  error?: { message?: string } | string;
  extraUsage?: unknown;
  limitReached?: boolean;
  message?: string;
  plan?: string;
  quotas?: Record<string, NineRouterUsageQuota>;
  reviewLimitReached?: boolean;
}

type NineRouterUsageState = {
  message: string;
  status: "idle" | "loading" | "ready" | "error";
  usage?: NineRouterUsagePayload;
};

const NINE_ROUTER_MODEL_TEST_MESSAGE = "Reply with OK only.";

export function NineRouterSettingsPage({ onSettingsChange, settings }: NineRouterSettingsPageProps) {
  const [busy, setBusy] = useState<NineRouterBusyState>(null);
  const accountConnectRunRef = useRef(0);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [connectionCatalog, setConnectionCatalog] = useState<NineRouterConnectionCatalogState>({
    connections: [],
    message: "Not checked",
    status: "idle",
  });
  const [modelCatalog, setModelCatalog] = useState<NineRouterModelCatalogState>({
    message: "Not checked",
    models: [],
    status: "idle",
  });
  const [modelTestBusy, setModelTestBusy] = useState(false);
  const [status, setStatus] = useState<NineRouterLocalStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<SettingsStatusMessage | null>(null);
  const [usageByConnectionId, setUsageByConnectionId] = useState<Record<string, NineRouterUsageState>>({});
  const isNineRouterActive = settings.provider === NINE_ROUTER_PROVIDER_ID;
  const nineRouterBaseUrl = settings.baseUrls[NINE_ROUTER_PROVIDER_ID]?.trim() || status?.baseUrl || getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID);
  const nineRouterDashboardUrl = status?.dashboardUrl || NINE_ROUTER_DASHBOARD_FALLBACK;
  const accountRows = useMemo(
    () => NINE_ROUTER_ACCOUNT_PROVIDERS.map((provider) => {
      const connections = connectionCatalog.connections.filter((connection) => connection.provider === provider.id);
      const connection = choosePreferredConnection(connections);
      return {
        connection,
        connections,
        provider,
        usageState: connection?.id ? usageByConnectionId[connection.id] : undefined,
      };
    }),
    [connectionCatalog.connections, usageByConnectionId],
  );
  const savedNineRouterModel = settings.providerModels[NINE_ROUTER_PROVIDER_ID]?.trim() || "";
  const selectedNineRouterModel = useMemo(
    () => chooseNineRouterModel(savedNineRouterModel, modelCatalog),
    [modelCatalog, savedNineRouterModel],
  );
  const savedModelMissingFromCatalog =
    modelCatalog.status === "ready" &&
    modelCatalog.models.length > 0 &&
    Boolean(savedNineRouterModel) &&
    !modelCatalog.models.includes(savedNineRouterModel);
  const helperReady = Boolean(status?.running);
  const helperStatusLabel = !status ? "Checking" : status.running ? "Ready" : status.installed ? "Installed, waiting to start" : "Not installed";
  const helperActionLabel = status?.installed ? "Start helper" : "Install helper";
  const helperActionBusyLabel = status?.installed ? "Starting" : "Installing";
  const installBlocked = useMemo(() => {
    if (!status) {
      return "";
    }

    if (status.installed) {
      return "";
    }

    const missing = [
      status.gitVersion ? "" : "Git",
      status.nodeVersion ? "" : "Node.js",
      status.npmVersion ? "" : "npm",
    ].filter(Boolean);

    return missing.length > 0 ? `${missing.join(", ")} required` : "";
  }, [status]);
  const helperInstallBlocked = !status?.installed && installBlocked;
  const displayStatusMessage = statusMessage
    ? {
        ...statusMessage,
        text: formatSubscriptionHelperText(statusMessage.text),
      }
    : null;

  useEffect(() => {
    void refreshStatus({ quiet: true });

    return () => {
      accountConnectRunRef.current += 1;
      void stopCodexOAuthProxy();
    };
  }, []);

  useEffect(() => {
    if (status?.running) {
      void refreshProviderConnections({ quiet: true });
      void refreshModelCatalog({ quiet: true });
    }
  }, [nineRouterBaseUrl, status?.running]);

  async function refreshStatus(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setBusy("status");
    }
    if (!options.quiet) {
      setStatusMessage(null);
    }

    try {
      const nextStatus = await getNineRouterLocalStatus();
      setStatus(nextStatus);
      if (!options.quiet) {
        setStatusMessage({ kind: nextStatus.running ? "success" : "warning", text: nextStatus.message });
      }
      if (nextStatus.running) {
        void refreshProviderConnections({ quiet: true });
      }
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not check the subscription helper." });
    } finally {
      if (!options.quiet) {
        setBusy((current) => (current === "status" ? null : current));
      }
    }
  }

  async function startNineRouter() {
    setBusy("start");
    setStatusMessage(null);

    try {
      const nextStatus = await ensureNineRouterLocal();
      setStatus(nextStatus);
      setStatusMessage({ kind: nextStatus.running ? "success" : "warning", text: nextStatus.message });
      if (nextStatus.running) {
        void refreshProviderConnections({ quiet: true });
        void refreshModelCatalog({ quiet: true });
      }
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not start the subscription helper." });
    } finally {
      setBusy((current) => (current === "start" ? null : current));
    }
  }

  async function installAndStartNineRouter() {
    setBusy("install");
    setInstallLog([]);
    setStatusMessage(null);

    try {
      const installedStatus = await installNineRouterLocal((event) => {
        handleInstallEvent(event);
      });
      setStatus(installedStatus);
      const startedStatus = await ensureNineRouterLocal();
      setStatus(startedStatus);
      setStatusMessage({ kind: startedStatus.running ? "success" : "warning", text: startedStatus.message });
      if (startedStatus.running) {
        void refreshProviderConnections({ quiet: true });
        void refreshModelCatalog({ quiet: true });
      }
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not install the subscription helper." });
    } finally {
      setBusy((current) => (current === "install" ? null : current));
    }
  }

  function handleInstallEvent(event: NineRouterInstallEvent) {
    if (event.event === "started" || event.event === "step") {
      appendInstallLog(event.data.message);
      return;
    }

    if (event.event === "output") {
      const output = [event.data.stdout, event.data.stderr].filter(Boolean).join("\n").trim();
      appendInstallLog(output ? `${event.data.label}\n${output}` : `${event.data.label} complete`);
      return;
    }

    setStatus(event.data.status);
    appendInstallLog("Subscription helper install complete.");
  }

  function appendInstallLog(line: string) {
    setInstallLog((current) => [...current, formatSubscriptionHelperText(line)].slice(-8));
  }

  async function refreshProviderConnections(options: { quiet?: boolean; refreshUsage?: boolean } = {}) {
    setConnectionCatalog((current) => ({
      ...current,
      message: current.status === "ready" && current.connections.length > 0 ? current.message : "Checking accounts",
      status: "loading",
    }));

    try {
      const payload = await fetchNineRouterJson<{ connections?: NineRouterConnection[] }>(joinLocalUrl(nineRouterDashboardUrl, "/api/providers"));
      const connections = payload.connections ?? [];
      const activeCount = connections.filter((connection) => isConnectionActive(connection)).length;
      setConnectionCatalog({
        connections,
        message: connections.length > 0 ? `${activeCount}/${connections.length} active` : "No accounts connected",
        status: "ready",
      });
      if (options.refreshUsage !== false) {
        void refreshAccountUsage(connections);
      }

      if (!options.quiet) {
        setStatusMessage({ kind: connections.length > 0 ? "success" : "warning", text: connections.length > 0 ? `${connections.length} subscription account${connections.length === 1 ? "" : "s"} connected.` : "No subscription accounts are connected yet." });
      }

      return connections;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load subscription accounts.";
      setConnectionCatalog({
        connections: [],
        message,
        status: "error",
      });

      if (!options.quiet) {
        setStatusMessage({ kind: "error", text: message });
      }

      return [];
    }
  }

  async function refreshModelCatalog(options: { quiet?: boolean } = {}) {
    setModelCatalog((current) => ({
      ...current,
      message: current.status === "ready" && current.models.length > 0 ? current.message : "Checking models",
      status: "loading",
    }));

    try {
      const payload = await fetchNineRouterJson<{ data?: Array<{ id?: string }>; error?: { message?: string } }>(joinLocalUrl(nineRouterBaseUrl, "/models"));
      const models = Array.from(new Set((payload.data ?? [])
        .map((model) => model.id?.trim())
        .filter((model): model is string => typeof model === "string" && model.length > 0)));
      const message = models.length > 0 ? `${models.length} live subscription ${models.length === 1 ? "route" : "routes"}` : "No live subscription routes";
      setModelCatalog({
        message,
        models,
        status: "ready",
      });

      if (!options.quiet) {
        setStatusMessage({ kind: models.length > 0 ? "success" : "warning", text: models.length > 0 ? `${message} loaded.` : "The subscription helper is running, but it did not report any live models." });
      }

      return models;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not load subscription models.";
      setModelCatalog({
        message,
        models: [],
        status: "error",
      });

      if (!options.quiet) {
        setStatusMessage({ kind: "error", text: message });
      }

      return [];
    }
  }

  async function refreshAccountUsage(connections = connectionCatalog.connections) {
    const trackedConnections = NINE_ROUTER_ACCOUNT_PROVIDERS
      .map((provider) => choosePreferredConnection(connections.filter((connection) => connection.provider === provider.id)))
      .filter((connection): connection is NineRouterConnection => Boolean(connection?.id));

    if (trackedConnections.length === 0) {
      setUsageByConnectionId({});
      return;
    }

    setUsageByConnectionId((current) => {
      const next = { ...current };
      for (const connection of trackedConnections) {
        next[connection.id] = {
          message: current[connection.id]?.status === "ready" ? current[connection.id].message : "Checking usage",
          status: "loading",
          usage: current[connection.id]?.usage,
        };
      }
      return next;
    });

    await Promise.allSettled(
      trackedConnections.map(async (connection) => {
        try {
          const usage = await fetchNineRouterJson<NineRouterUsagePayload>(joinLocalUrl(nineRouterDashboardUrl, `/api/usage/${encodeURIComponent(connection.id)}`));
          setUsageByConnectionId((current) => ({
            ...current,
            [connection.id]: {
              message: formatUsageHeadline(usage),
              status: "ready",
              usage,
            },
          }));
        } catch (error) {
          setUsageByConnectionId((current) => ({
            ...current,
            [connection.id]: {
              message: error instanceof Error ? error.message : "Could not load usage.",
              status: "error",
            },
          }));
        }
      }),
    );
  }

  async function connectCodexAccount() {
    const runId = accountConnectRunRef.current + 1;
    accountConnectRunRef.current = runId;
    setBusy("account:codex");
    setStatusMessage(null);

    try {
      let nextStatus = status;
      if (!nextStatus?.running) {
        nextStatus = await ensureNineRouterLocal();
        setStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || "Install and start the subscription helper before connecting Codex.");
      }

      await stopCodexOAuthProxy();
      const authUrl = createNineRouterUrl(nineRouterDashboardUrl, "/api/oauth/codex/authorize", {
        redirect_uri: NINE_ROUTER_CODEX_REDIRECT_URI,
      });
      const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(authUrl);

      if (!authData.authUrl || !authData.state || !authData.codeVerifier) {
        throw new Error("The subscription helper did not return a complete Codex sign-in request.");
      }

      const proxyUrl = createNineRouterUrl(nineRouterDashboardUrl, "/api/oauth/codex/start-proxy", {
        app_port: NINE_ROUTER_CODEX_PROXY_APP_PORT,
        code_verifier: authData.codeVerifier,
        redirect_uri: NINE_ROUTER_CODEX_REDIRECT_URI,
        state: authData.state,
      });
      const proxy = await fetchNineRouterJson<NineRouterCodexProxyResponse>(proxyUrl);

      if (!proxy.success || !proxy.serverSide) {
        throw new Error(proxy.reason === "port_busy" ? "Codex sign-in is already open. Finish or close the previous sign-in window, then retry." : "The subscription helper could not start the Codex sign-in callback.");
      }

      setStatusMessage({ kind: "warning", text: "Finish the OpenAI sign-in in your browser. Gilbert will pick it up automatically." });
      await openExternalUrl(authData.authUrl);
      await waitForCodexConnection(authData.state, runId);

      if (accountConnectRunRef.current !== runId) {
        return;
      }

      const [connections, models] = await Promise.all([
        refreshProviderConnections({ quiet: true, refreshUsage: false }),
        refreshModelCatalog({ quiet: true }),
      ]);
      void refreshAccountUsage(connections);
      const connectedCodex = choosePreferredConnection(connections.filter((connection) => connection.provider === "codex"));
      const nextModel = chooseNineRouterModel(savedNineRouterModel, {
        message: "",
        models,
        status: models.length > 0 ? "ready" : "idle",
      });
      useNineRouterProvider(nextModel);
      setStatusMessage({
        kind: "success",
        text: `${formatConnectionIdentity(connectedCodex) || "Codex"} is connected. Gilbert is using ${nextModel} through your subscriptions.`,
      });
    } catch (error) {
      if (accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not connect Codex." });
      }
    } finally {
      void stopCodexOAuthProxy();
      if (accountConnectRunRef.current === runId) {
        setBusy((current) => (current === "account:codex" ? null : current));
      }
    }
  }

  async function connectProviderAccount(provider: NineRouterAccountProvider) {
    if (provider.flow === "codex") {
      await connectCodexAccount();
      return;
    }

    const runId = accountConnectRunRef.current + 1;
    accountConnectRunRef.current = runId;
    setBusy(`account:${provider.id}`);
    setStatusMessage(null);

    try {
      let nextStatus = status;
      if (!nextStatus?.running) {
        nextStatus = await ensureNineRouterLocal();
        setStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || `Install and start the subscription helper before connecting ${provider.name}.`);
      }

      if (provider.flow === "device_code") {
        await connectDeviceCodeProvider(provider, runId);
      } else {
        await connectAuthorizationCodeProvider(provider, runId);
      }
    } catch (error) {
      if (accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : `Could not connect ${provider.name}.` });
      }
    } finally {
      if (accountConnectRunRef.current === runId) {
        setBusy((current) => (current === `account:${provider.id}` ? null : current));
      }
    }
  }

  async function connectDeviceCodeProvider(provider: NineRouterAccountProvider, runId: number) {
    const deviceData = await fetchNineRouterJson<NineRouterDeviceCodeResponse>(joinLocalUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/device-code`));
    const deviceCode = deviceData.device_code?.trim();
    const verifyUrl = deviceData.verification_uri_complete || deviceData.verification_uri;

    if (!deviceCode || !verifyUrl) {
      throw new Error(`The subscription helper did not return a complete ${provider.name} device sign-in request.`);
    }

    const userCode = deviceData.user_code?.trim();
    setStatusMessage({
      kind: "warning",
      text: userCode ? `Finish ${provider.name} sign-in in your browser. Code: ${userCode}` : `Finish ${provider.name} sign-in in your browser. Gilbert will pick it up automatically.`,
    });
    await openExternalUrl(verifyUrl);
    await waitForDeviceCodeConnection(provider, deviceData, runId);

    if (accountConnectRunRef.current !== runId) {
      return;
    }

    const connections = await refreshProviderConnections({ quiet: true, refreshUsage: false });
    void refreshAccountUsage(connections);
    setStatusMessage({ kind: "success", text: `${provider.name} is connected.` });
  }

  async function connectAuthorizationCodeProvider(provider: NineRouterAccountProvider, runId: number) {
    const callback = await startNineRouterOAuthCallback();
    const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(createNineRouterUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/authorize`, {
      redirect_uri: callback.redirectUri,
    }));

    if (!authData.authUrl || !authData.state) {
      throw new Error(`The subscription helper did not return a complete ${provider.name} sign-in request.`);
    }

    if (provider.id !== "cline" && !authData.codeVerifier) {
      throw new Error(`The subscription helper did not return a code verifier for ${provider.name}.`);
    }

    setStatusMessage({ kind: "warning", text: `Finish ${provider.name} sign-in in your browser. Gilbert will close the loop automatically.` });
    await openExternalUrl(authData.authUrl);
    const callbackData = await finishNineRouterOAuthCallback(callback.id, 300_000);

    if (accountConnectRunRef.current !== runId) {
      return;
    }

    if (callbackData.error) {
      throw new Error(callbackData.errorDescription || callbackData.error);
    }

    if (!callbackData.code) {
      throw new Error(`${provider.name} did not return an authorization code.`);
    }

    const exchange = await postNineRouterJson<NineRouterExchangeResponse>(joinLocalUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/exchange`), {
      code: callbackData.code,
      codeVerifier: authData.codeVerifier,
      redirectUri: callback.redirectUri,
      state: callbackData.state || authData.state,
    });

    if (!exchange.success) {
      throw new Error(exchange.errorDescription || exchange.error || `${provider.name} sign-in did not complete.`);
    }

    const connections = await refreshProviderConnections({ quiet: true, refreshUsage: false });
    void refreshAccountUsage(connections);
    setStatusMessage({ kind: "success", text: `${provider.name} is connected.` });
  }

  async function waitForDeviceCodeConnection(provider: NineRouterAccountProvider, deviceData: NineRouterDeviceCodeResponse, runId: number) {
    let intervalSeconds = Math.max(2, Number(deviceData.interval ?? 5) || 5);
    const extraData = provider.id === "kiro"
      ? {
          _authMethod: deviceData._authMethod,
          _clientId: deviceData._clientId,
          _clientSecret: deviceData._clientSecret,
          _region: deviceData._region,
          _startUrl: deviceData._startUrl,
        }
      : null;

    for (let attempt = 0; attempt < NINE_ROUTER_DEVICE_POLL_MAX_ATTEMPTS; attempt += 1) {
      if (accountConnectRunRef.current !== runId) {
        return;
      }

      await delay(intervalSeconds * 1_000);

      const payload = await postNineRouterJson<NineRouterOAuthPollResponse>(joinLocalUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/poll`), {
        codeVerifier: deviceData.codeVerifier,
        deviceCode: deviceData.device_code,
        extraData,
      });

      if (payload.success) {
        return payload;
      }

      if (payload.error === "slow_down") {
        intervalSeconds = Math.min(intervalSeconds + 5, 30);
        continue;
      }

      if (payload.pending || payload.error === "authorization_pending" || !payload.error) {
        continue;
      }

      throw new Error(payload.errorDescription || payload.error || `${provider.name} sign-in failed.`);
    }

    throw new Error(`${provider.name} sign-in timed out. Try again from Subscriptions settings.`);
  }

  async function testSelectedModel() {
    setModelTestBusy(true);
    setStatusMessage(null);

    try {
      const response = await fetchWithTimeout(joinLocalUrl(nineRouterBaseUrl, "/chat/completions"), {
        body: JSON.stringify({
          max_completion_tokens: 32,
          messages: [{ content: NINE_ROUTER_MODEL_TEST_MESSAGE, role: "user" }],
          model: selectedNineRouterModel,
          stream: false,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await readJsonResponse<{ error?: { message?: string } }>(response);

      if (!response.ok) {
        throw new Error(formatNineRouterUiError(selectedNineRouterModel, payload.error?.message, response.status));
      }

      setStatusMessage({ kind: "success", text: `${selectedNineRouterModel} responded through your subscription route.` });
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not test the selected subscription model." });
    } finally {
      setModelTestBusy(false);
    }
  }

  function useNineRouterProvider(modelOverride = selectedNineRouterModel) {
    onSettingsChange({
      ...settings,
      baseUrls: {
        ...settings.baseUrls,
        [NINE_ROUTER_PROVIDER_ID]: getDefaultBaseUrlForProvider(NINE_ROUTER_PROVIDER_ID),
      },
      model: modelOverride,
      provider: NINE_ROUTER_PROVIDER_ID,
      providerModels: {
        ...settings.providerModels,
        [settings.provider]: settings.model,
        [NINE_ROUTER_PROVIDER_ID]: modelOverride,
      },
    });
    setStatusMessage({ kind: "success", text: "Subscription routing is now active." });
  }

  return (
    <>
      <SettingsSectionHeading detail="Connect the provider accounts you already pay for and keep their quota visible." icon={Route} title="Subscriptions" />
      {displayStatusMessage ? (
        <div className="settings-status-banner" data-kind={displayStatusMessage.kind} role="status" aria-live="polite">
          {displayStatusMessage.text}
        </div>
      ) : null}
      <div className="settings-section-grid">
        {!helperReady ? (
          <article className="settings-card settings-card-wide">
            <div className="settings-card-heading">
              <Download size={19} aria-hidden="true" />
              <div>
                <h2>Set up subscriptions</h2>
                <p>Install the local helper once. Gilbert starts it when you use subscription routing.</p>
              </div>
            </div>
            <div className="settings-row-list">
              <div className="settings-row">
                <span>Status</span>
                <strong>{helperStatusLabel}</strong>
                <span className="settings-row-static-pill">{status?.installed ? "Installed" : "Needed"}</span>
              </div>
              <div className="settings-row">
                <span>Launch</span>
                <strong>Starts only when you use subscription routing</strong>
                <span className="settings-row-static-pill">Manual</span>
              </div>
              {helperInstallBlocked ? (
                <div className="settings-row">
                  <span>Missing</span>
                  <strong>{helperInstallBlocked}</strong>
                  <span className="settings-row-static-pill">Required</span>
                </div>
              ) : null}
            </div>
            <div className="settings-actions-row">
              <button
                className="settings-primary-button"
                type="button"
                disabled={busy !== null || !status || Boolean(helperInstallBlocked)}
                onClick={status?.installed ? startNineRouter : installAndStartNineRouter}
              >
                {status?.installed ? <Play size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                {busy === "install" || busy === "start" ? helperActionBusyLabel : helperActionLabel}
              </button>
              <button className="settings-ghost-button" type="button" disabled={busy !== null} onClick={() => refreshStatus()}>
                <RefreshCcw size={16} aria-hidden="true" />
                {busy === "status" ? "Checking" : "Check again"}
              </button>
            </div>
          </article>
        ) : (
          <>
            <article className="settings-card settings-card-wide">
              <div className="settings-card-heading">
                <UserCheck size={19} aria-hidden="true" />
                <div>
                  <h2>Account subscriptions</h2>
                  <p>Sign in with the provider accounts you already pay for.</p>
                </div>
              </div>
              <div className="nine-router-account-grid">
                {accountRows.map(({ connection, connections, provider, usageState }) => {
                  const providerBusy = busy === `account:${provider.id}`;
                  const connected = Boolean(connection);

                  return (
                    <section className="nine-router-account-row" data-connected={connected} key={provider.id}>
                      <div className="nine-router-account-row-heading">
                        <div>
                          <strong>{provider.name}</strong>
                          <span>{provider.description}</span>
                        </div>
                        <span className="settings-row-static-pill">{connected ? "Connected" : "Sign in"}</span>
                      </div>

                      <div className="settings-row-list nine-router-account-meta">
                        <div className="settings-row">
                          <span>Status</span>
                          <strong>{formatSubscriptionHelperText(formatConnectionStatus(connection, connectionCatalog))}</strong>
                          <span className="settings-row-static-pill">{connections.length > 1 ? `${connections.length} saved` : connected ? "Ready" : "Needed"}</span>
                        </div>
                        <div className="settings-row">
                          <span>Account</span>
                          <strong>{formatConnectionIdentity(connection) || "Not connected"}</strong>
                        </div>
                        <div className="settings-row">
                          <span>Plan</span>
                          <strong>{formatUsagePlan(usageState, connection)}</strong>
                        </div>
                        <div className="settings-row">
                          <span>Token</span>
                          <strong>{formatConnectionExpiry(connection)}</strong>
                        </div>
                      </div>

                      <UsageQuotaList provider={provider} usageState={usageState} />
                      {connection?.lastError ? <span className="settings-status" data-kind="error">{formatSubscriptionHelperText(connection.lastError)}</span> : null}
                      {!connected ? <span className="settings-status">{provider.usageNote}</span> : null}

                      <button className="settings-primary-button settings-full-width-button" type="button" disabled={busy !== null} onClick={() => connectProviderAccount(provider)}>
                        {provider.flow === "device_code" ? <ExternalLink size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
                        {providerBusy ? "Waiting for sign-in" : connected ? `Reconnect ${provider.name}` : `Sign in with ${provider.name}`}
                      </button>
                    </section>
                  );
                })}
              </div>
              <button className="settings-ghost-button settings-full-width-button" type="button" disabled={connectionCatalog.status === "loading"} onClick={() => refreshProviderConnections()}>
                <RefreshCcw size={16} aria-hidden="true" />
                {connectionCatalog.status === "loading" ? "Checking" : "Refresh accounts"}
              </button>
            </article>

            <article className="settings-card">
              <div className="settings-card-heading">
                <ServerCog size={19} aria-hidden="true" />
                <div>
                  <h2>Model routing</h2>
                  <p>{isNineRouterActive ? "Subscription routing is active." : "Use connected accounts from the model picker."}</p>
                </div>
              </div>
              <div className="settings-row-list">
                <div className="settings-row">
                  <span>Routing</span>
                  <strong>{isNineRouterActive ? "Subscriptions" : "Not selected"}</strong>
                  <span className="settings-row-static-pill">{isNineRouterActive ? "Active" : "Ready"}</span>
                </div>
                <div className="settings-row">
                  <span>Live catalog</span>
                  <strong>{formatSubscriptionHelperText(formatModelCatalog(modelCatalog))}</strong>
                  <span className="settings-row-static-pill">{modelCatalog.status === "ready" ? "Live" : modelCatalog.status === "error" ? "Check" : "Local"}</span>
                </div>
                <div className="settings-row">
                  <span>Selected route</span>
                  <strong>{selectedNineRouterModel}</strong>
                </div>
              </div>
              {savedModelMissingFromCatalog ? (
                <span className="settings-status" data-kind="warning">
                  Saved model {savedNineRouterModel} is not in the live catalog. Gilbert will use {selectedNineRouterModel} when you switch.
                </span>
              ) : null}
              {modelCatalog.models.length > 0 ? (
                <div className="settings-model-chip-list" aria-label="Live subscription models">
                  {modelCatalog.models.slice(0, 6).map((model) => (
                    <span className="settings-mini-chip" key={model}>{model}</span>
                  ))}
                </div>
              ) : null}
              <button className="settings-ghost-button settings-full-width-button" type="button" onClick={() => useNineRouterProvider()}>
                <CheckCircle2 size={16} aria-hidden="true" />
                Use subscription routing
              </button>
              <button className="settings-ghost-button settings-full-width-button" type="button" disabled={modelTestBusy} onClick={testSelectedModel}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {modelTestBusy ? "Testing" : "Test selected model"}
              </button>
            </article>
          </>
        )}

        {!helperReady && installLog.length > 0 ? (
          <article className="settings-card settings-card-wide">
            <div className="settings-card-heading">
              <CheckCircle2 size={19} aria-hidden="true" />
              <div>
                <h2>Install log</h2>
                <p>Latest install steps.</p>
              </div>
            </div>
            <div className="settings-install-log" aria-live="polite">
              {installLog.map((line, index) => (
                <code key={`${index}-${line.slice(0, 20)}`}>{line}</code>
              ))}
            </div>
          </article>
        ) : null}
      </div>
    </>
  );
}

function UsageQuotaList({ provider, usageState }: { provider: NineRouterAccountProvider; usageState?: NineRouterUsageState }) {
  if (!usageState || usageState.status === "idle") {
    return <span className="nine-router-usage-empty">{provider.usageNote}</span>;
  }

  if (usageState.status === "loading") {
    return <span className="nine-router-usage-empty">Checking usage limits...</span>;
  }

  if (usageState.status === "error") {
    return <span className="settings-status" data-kind="warning">{formatSubscriptionHelperText(usageState.message)}</span>;
  }

  const quotaEntries = getUsageQuotaEntries(usageState.usage);

  if (quotaEntries.length === 0) {
    return <span className="nine-router-usage-empty">{formatSubscriptionHelperText(usageState.usage?.message || usageState.message || provider.usageNote)}</span>;
  }

  return (
    <div className="nine-router-quota-list" aria-label={`${provider.name} usage limits`}>
      {quotaEntries.map(([key, quota]) => {
        const usedPercent = getQuotaUsedPercent(quota);
        return (
          <div className="nine-router-quota-row" key={key}>
            <div>
              <strong>{formatQuotaLabel(key, quota)}</strong>
              <span>{formatQuotaValue(quota)}</span>
            </div>
            <div className="nine-router-quota-meter" aria-hidden="true">
              <span style={{ width: `${usedPercent}%` }} />
            </div>
            <small>{formatQuotaReset(quota)}</small>
          </div>
        );
      })}
    </div>
  );
}

function formatSubscriptionHelperText(text: string) {
  return text
    .replace(/\b[9]Router Local\b/g, "the subscription helper")
    .replace(/\b[9]Router\b/g, "the subscription helper")
    .replace(/\b(from|in) the subscription helper settings\b/gi, "$1 Subscriptions settings")
    .replace(/\bStart the subscription helper, then retry\b/g, "Open Subscriptions, then retry");
}

function chooseNineRouterModel(savedModel: string, catalog: NineRouterModelCatalogState) {
  const normalizedSavedModel = savedModel.trim();
  if (catalog.status === "ready" && catalog.models.length > 0) {
    return normalizedSavedModel && catalog.models.includes(normalizedSavedModel) ? normalizedSavedModel : catalog.models[0];
  }

  return normalizedSavedModel || getDefaultModelForProvider(NINE_ROUTER_PROVIDER_ID);
}

function formatModelCatalog(catalog: NineRouterModelCatalogState) {
  if (catalog.status === "ready") {
    return catalog.message;
  }

  if (catalog.status === "loading") {
    return "Checking models";
  }

  if (catalog.status === "error") {
    return catalog.message;
  }

  return "Not checked";
}

function formatConnectionStatus(connection: NineRouterConnection | null | undefined, catalog: NineRouterConnectionCatalogState) {
  if (catalog.status === "loading") {
    return "Checking";
  }

  if (!connection) {
    return catalog.status === "error" ? catalog.message : "Not connected";
  }

  if (isConnectionActive(connection)) {
    return "Connected";
  }

  return connection.lastError ? "Needs attention" : connection.testStatus || "Connected";
}

function formatUsagePlan(usageState: NineRouterUsageState | undefined, connection: NineRouterConnection | null | undefined) {
  if (!connection) {
    return "Sign in to view";
  }

  const plan = usageState?.usage?.plan?.trim() || connection.providerSpecificData?.chatgptPlanType?.trim();

  if (plan) {
    return titleCaseProviderText(plan);
  }

  if (usageState?.status === "loading") {
    return "Checking usage";
  }

  if (usageState?.status === "error") {
    return "Usage unavailable";
  }

  return "Connected";
}

function formatUsageHeadline(usage: NineRouterUsagePayload) {
  if (usage.message?.trim()) {
    return usage.message.trim();
  }

  if (usage.plan?.trim()) {
    return titleCaseProviderText(usage.plan);
  }

  const quotaCount = getUsageQuotaEntries(usage).length;
  if (quotaCount > 0) {
    return `${quotaCount} usage ${quotaCount === 1 ? "window" : "windows"}`;
  }

  return "Usage loaded";
}

function getUsageQuotaEntries(usage: NineRouterUsagePayload | undefined) {
  return Object.entries(usage?.quotas ?? {}).filter(([, quota]) => Boolean(quota)) as Array<[string, NineRouterUsageQuota]>;
}

function formatQuotaLabel(key: string, quota: NineRouterUsageQuota) {
  const displayName = quota.displayName?.trim();
  if (displayName) {
    return titleCaseProviderText(displayName);
  }

  const labels: Record<string, string> = {
    review_session: "Review 5-hour window",
    review_weekly: "Review weekly window",
    session: "5-hour window",
    weekly: "Weekly window",
  };

  return labels[key] ?? titleCaseProviderText(key);
}

function formatQuotaValue(quota: NineRouterUsageQuota) {
  if (quota.unlimited) {
    return "Unlimited";
  }

  const used = typeof quota.used === "number" ? quota.used : null;
  const total = typeof quota.total === "number" ? quota.total : null;
  const remaining = typeof quota.remaining === "number" ? quota.remaining : null;

  if (used !== null && total !== null) {
    return `${formatQuotaNumber(used)} / ${formatQuotaNumber(total)} used`;
  }

  if (remaining !== null && total !== null) {
    return `${formatQuotaNumber(remaining)} / ${formatQuotaNumber(total)} left`;
  }

  if (typeof quota.remainingPercentage === "number") {
    return `${Math.round(quota.remainingPercentage)}% left`;
  }

  return "Usage reported";
}

function getQuotaUsedPercent(quota: NineRouterUsageQuota) {
  if (quota.unlimited) {
    return 0;
  }

  if (typeof quota.used === "number" && typeof quota.total === "number" && quota.total > 0) {
    return clampPercent((quota.used / quota.total) * 100);
  }

  if (typeof quota.remaining === "number" && typeof quota.total === "number" && quota.total > 0) {
    return clampPercent(((quota.total - quota.remaining) / quota.total) * 100);
  }

  if (typeof quota.remainingPercentage === "number") {
    return clampPercent(100 - quota.remainingPercentage);
  }

  return 0;
}

function formatQuotaReset(quota: NineRouterUsageQuota) {
  if (!quota.resetAt) {
    return quota.unlimited ? "No reset needed" : "Reset not reported";
  }

  const resetAt = new Date(quota.resetAt);
  if (Number.isNaN(resetAt.getTime())) {
    return "Reset not reported";
  }

  const diffMs = resetAt.getTime() - Date.now();
  if (diffMs <= 0) {
    return "Reset due now";
  }

  const hours = Math.floor(diffMs / 3_600_000);
  const minutes = Math.round((diffMs % 3_600_000) / 60_000);
  if (hours >= 24) {
    const days = Math.ceil(diffMs / 86_400_000);
    return `Resets in ${days}d`;
  }

  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`;
  }

  return `Resets in ${Math.max(minutes, 1)}m`;
}

function formatQuotaNumber(value: number) {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1);
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function titleCaseProviderText(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => {
      const lower = part.toLowerCase();
      if (["api", "gpt", "ide", "qwen"].includes(lower)) {
        return part.toUpperCase();
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

async function waitForCodexConnection(state: string, _runId: number) {
  for (let attempt = 0; attempt < NINE_ROUTER_CODEX_MAX_POLL_ATTEMPTS; attempt += 1) {
    const payload = await fetchNineRouterJson<NineRouterCodexPollResponse>(createNineRouterUrl(NINE_ROUTER_DASHBOARD_FALLBACK, "/api/oauth/codex/poll-status", {
      state,
    }));

    if (payload.status === "done") {
      return payload;
    }

    if (payload.status === "error") {
      throw new Error(payload.error || "Codex sign-in failed.");
    }

    await delay(NINE_ROUTER_CODEX_POLL_INTERVAL_MS);
  }

  throw new Error("Codex sign-in timed out. Try again from Subscriptions settings.");
}

async function stopCodexOAuthProxy() {
  try {
    await fetchNineRouterJson<{ success?: boolean }>(createNineRouterUrl(NINE_ROUTER_DASHBOARD_FALLBACK, "/api/oauth/codex/stop-proxy"));
  } catch {
    // The proxy may not be running yet.
  }
}

function delay(ms: number) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}

async function fetchNineRouterJson<T>(url: string) {
  const response = await fetchWithTimeout(url, { method: "GET" });
  const payload = await readJsonResponse<T & { error?: { message?: string } }>(response);

  if (!response.ok) {
    throw new Error(payload.error?.message || `Subscription helper request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function postNineRouterJson<T>(url: string, body: unknown) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const payload = await readJsonResponse<T & { error?: { message?: string } | string }>(response);

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscription helper request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 10_000);

  try {
    if (isTauriDesktopRuntime()) {
      const nativeResponse = await nineRouterLocalHttp({
        body: normalizeNativeRequestBody(init.body, "The subscription helper bridge"),
        headers: headersToRecord(init.headers),
        method: normalizeNativeRequestMethod(init.method, "The subscription helper bridge"),
        timeoutMs: 10_000,
        url,
      });

      return new Response(nativeResponse.body, {
        headers: nativeResponse.headers,
        status: nativeResponse.status,
      });
    }

    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`The subscription helper did not answer ${url} within 10 seconds.`);
    }

    const message = error instanceof Error ? error.message : String(error);
    if (/failed to fetch|load failed|networkerror|request failed|connection refused|could not connect/i.test(message)) {
      throw new Error(`Could not reach the subscription helper at ${url}. Open Subscriptions, then retry.`);
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeoutId);
  }
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();

  if (!text) {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

function joinLocalUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}

function createNineRouterUrl(baseUrl: string, path: string, params?: Record<string, string>) {
  const url = new URL(joinLocalUrl(baseUrl, path));

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function formatNineRouterUiError(model: string, providerMessage: string | undefined, status: number) {
  const credentialMatch = providerMessage?.match(/No active credentials for provider:\s*([a-z0-9_-]+)/i);

  if (credentialMatch) {
    const providerName = formatNineRouterProviderName(credentialMatch[1]);

    if (model === "free-combo") {
      return `free-combo is falling through to ${providerName}, but ${providerName} is not connected.`;
    }

    return `${providerName} is not connected for ${model}.`;
  }

  if (status === 404 && model === "free-combo") {
    return "free-combo is not available in the local subscription catalog.";
  }

  return providerMessage || `Subscription helper request failed with HTTP ${status}.`;
}

function formatNineRouterProviderName(providerId: string) {
  const labels: Record<string, string> = {
    bazaarlink: "BazaarLink",
    claude: "Claude Code",
    codex: "Codex",
    freetheai: "FreeTheAI",
    github: "GitHub Copilot",
    kiro: "Kiro",
    openai: "OpenAI",
    opencode: "OpenCode Free",
    vertex: "Vertex AI",
  };

  return labels[providerId.toLowerCase()] ?? providerId;
}
