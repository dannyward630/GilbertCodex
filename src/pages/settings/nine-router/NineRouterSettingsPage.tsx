import { CheckCircle2, Download, ExternalLink, KeyRound, LogOut, Play, RefreshCcw, Route, ServerCog, Trash2, UserCheck } from "lucide-react";
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
  uninstallNineRouterLocal,
  type NineRouterInstallEvent,
  type NineRouterLocalStatus,
} from "../../../app/tauriClient";
import { formatModelCapabilitySummary, getChatModelOption, getDefaultBaseUrlForProvider, getDefaultModelForProvider, getModelRouteSourceInfo, NINE_ROUTER_ALWAYS_FREE_MODEL, NINE_ROUTER_SMART_SAVER_MODEL } from "../../../lib/models";
import { scheduleIdleTask } from "../../../lib/idleTask";
import { headersToRecord, normalizeNativeRequestBody, normalizeNativeRequestMethod } from "../../../services/nativeHttp";
import {
  buildNineRouterFallbackModels,
  dedupeNineRouterFallbackModels,
  hasUnusableNineRouterFallbackModels,
  isOpenCodeFreeModel,
} from "../../../services/nineRouterFallbackRouting";
import {
  chooseNineRouterConnectedAccountProvider,
  chooseNineRouterModelForAccount,
  chooseNineRouterModelForConnectedAccounts,
  getNineRouterAccountProviderForModel,
  hasNineRouterAccountConnection,
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
  shouldShowNineRouterCodexContextSettings,
  type NineRouterAccountProvider,
  type NineRouterAuthorizeResponse,
  type NineRouterCodexPollResponse,
  type NineRouterCodexProxyResponse,
  type NineRouterConnection,
  type NineRouterDeviceCodeResponse,
  type NineRouterExchangeResponse,
  type NineRouterOAuthPollResponse,
} from "../../../services/nineRouterClient";
import type { ProviderSettings, SubscriptionCodexContextWindow, SubscriptionTokenSaverLevel } from "../../../types/settings";
import { ConfirmDialog } from "../../../components/dialogs/AppDialog";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface NineRouterSettingsPageProps {
  onActivateProvider?: (provider: ProviderSettings["provider"], model: string) => void;
  onSettingsChange: (settings: ProviderSettings) => void;
  onSubscriptionSandboxUninstalled?: (settings: ProviderSettings) => void;
  settings: ProviderSettings;
}

type NineRouterBusyState = `account:${string}` | `disconnect:${string}` | "install" | "settings" | "start" | "status" | "tokenSaver" | "uninstall" | null;
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
type NineRouterComboCatalogState = {
  combos: NineRouterCombo[];
  message: string;
  status: "idle" | "loading" | "ready" | "error";
};

interface NineRouterCombo {
  id?: string;
  kind?: string | null;
  modelIds?: string[];
  models?: string[];
  name?: string;
}

interface NineRouterSettingsPayload {
  error?: { message?: string } | string;
  rtkEnabled?: boolean;
}

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
type NineRouterInstallProgressState = {
  detail: string;
  label: string;
  percent: number;
  status: "error" | "idle" | "running" | "success";
};
type NineRouterDisconnectTarget = {
  connections: NineRouterConnection[];
  provider: NineRouterAccountProvider;
};

const SUBSCRIPTION_OPTIMIZATION_DEFAULT: ProviderSettings["subscriptionOptimization"] = {
  codexContextWindow: "standard",
  fallbackMode: "off",
  tokenSaverLevel: "low",
};
const CODEX_CONTEXT_WINDOW_OPTIONS: Array<{ detail: string; label: string; mode: SubscriptionCodexContextWindow }> = [
  { detail: "Default 262k context for lower normal subscription usage.", label: "262k", mode: "standard" },
  { detail: "Allow 1M context for higher-cost long-context Codex runs.", label: "1M", mode: "extended" },
];

const NINE_ROUTER_MODEL_TEST_MESSAGE = "Reply with OK only.";
const NINE_ROUTER_INSTALL_PROGRESS_IDLE: NineRouterInstallProgressState = {
  detail: "",
  label: "Ready to install",
  percent: 0,
  status: "idle",
};
const NINE_ROUTER_ALWAYS_FREE_COMBO_NAME = NINE_ROUTER_ALWAYS_FREE_MODEL;
export function NineRouterSettingsPage({ onActivateProvider, onSettingsChange, onSubscriptionSandboxUninstalled, settings }: NineRouterSettingsPageProps) {
  const [busy, setBusy] = useState<NineRouterBusyState>(null);
  const accountConnectRunRef = useRef(0);
  const uninstallInFlightRef = useRef(false);
  const [installProgress, setInstallProgress] = useState<NineRouterInstallProgressState>(NINE_ROUTER_INSTALL_PROGRESS_IDLE);
  const [uninstallProgress, setUninstallProgress] = useState<NineRouterInstallProgressState | null>(null);
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
  const [, setComboCatalog] = useState<NineRouterComboCatalogState>({
    combos: [],
    message: "Not checked",
    status: "idle",
  });
  const [modelTestBusy, setModelTestBusy] = useState(false);
  const [status, setStatus] = useState<NineRouterLocalStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<SettingsStatusMessage | null>(null);
  const [disconnectTarget, setDisconnectTarget] = useState<NineRouterDisconnectTarget | null>(null);
  const [uninstallConfirmOpen, setUninstallConfirmOpen] = useState(false);
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
  const connectedAccountCount = useMemo(
    () => accountRows.filter((row) => Boolean(row.connection)).length,
    [accountRows],
  );
  const savedNineRouterModel = settings.providerModels[NINE_ROUTER_PROVIDER_ID]?.trim() || "";
  const selectedNineRouterModel = useMemo(
    () => chooseNineRouterModelForConnectedAccounts(savedNineRouterModel, modelCatalog.models, connectionCatalog.connections) || chooseNineRouterModel(savedNineRouterModel, modelCatalog),
    [connectionCatalog.connections, modelCatalog, savedNineRouterModel],
  );
  const selectedRouteProviderId = getNineRouterAccountProviderForModel(selectedNineRouterModel);
  const selectedRouteHasConnectedAccount = selectedRouteProviderId ? hasNineRouterAccountConnection(connectionCatalog.connections, selectedRouteProviderId) : false;
  const showModelRoutingCard = connectedAccountCount > 0 && selectedRouteHasConnectedAccount;
  const subscriptionOptimization = settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT;
  const tokenSaverLevel = subscriptionOptimization.tokenSaverLevel;
  const fallbackMode = subscriptionOptimization.fallbackMode;
  const effectiveFallbackMode = fallbackMode === "smart-saver" ? "always-free" : fallbackMode;
  const codexContextWindow = subscriptionOptimization.codexContextWindow;
  const showCodexContextSettings = shouldShowNineRouterCodexContextSettings(connectionCatalog.connections, selectedNineRouterModel);
  const savedModelMissingFromCatalog =
    modelCatalog.status === "ready" &&
    modelCatalog.models.length > 0 &&
    Boolean(savedNineRouterModel) &&
    !modelCatalog.models.includes(savedNineRouterModel);
  const desktopRuntime = isTauriDesktopRuntime();
  const helperReady = Boolean(status?.running && status.installed);
  const helperInstalled = Boolean(status?.installed);
  const helperInstalling = busy === "install" || installProgress.status === "running";
  const helperStarting = busy === "start";
  const helperStatusLabel = getSubscriptionSetupStatusLabel(status, busy, installProgress, desktopRuntime);
  const helperStatusPill = getSubscriptionSetupStatusPill(status, busy, installProgress, desktopRuntime);
  const helperActionLabel = helperInstalled ? "Start subscriptions" : "Install subscriptions";
  const helperActionBusyLabel = helperStarting ? "Starting subscriptions" : "Installing subscriptions";
  const hasRecoverableSubscriptionFootprint = !helperInstalled && Boolean(status?.dataDir || status?.installDir);
  const showInstalledRuntimeRemoval = helperInstalled && !helperInstalling && !helperStarting;
  const showInstallProgress = busy === "install" || installProgress.status === "running" || installProgress.status === "error";
  const showUninstallProgress = busy === "uninstall" || uninstallProgress?.status === "running" || uninstallProgress?.status === "error";
  const installBlocked = useMemo(() => {
    if (!status || !desktopRuntime) {
      return "";
    }

    const missing = [
      status.gitVersion ? "" : "Git",
      status.nodeVersion ? "" : "Node.js",
      status.npmVersion ? "" : "npm",
    ].filter(Boolean);

    return missing.length > 0 ? `${missing.join(", ")} required` : "";
  }, [desktopRuntime, status]);
  const helperInstallBlocked = !status?.installed && (desktopRuntime ? installBlocked : "Open the desktop app to install subscriptions");
  const displayStatusMessage = statusMessage
    ? {
        ...statusMessage,
        text: formatSubscriptionHelperText(statusMessage.text),
      }
    : null;

  useEffect(() => {
    const cancelStartup = scheduleIdleTask(() => {
      void startNineRouter({ quiet: true });
    }, 350);

    return () => {
      cancelStartup();
      accountConnectRunRef.current += 1;
      void stopCodexOAuthProxy();
    };
  }, []);

  useEffect(() => {
    if (status?.running) {
      void refreshProviderConnections({ quiet: true });
      void refreshModelCatalog({ quiet: true });
      void refreshSubscriptionOptimizer({ quiet: true });
      void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
    }
  }, [nineRouterBaseUrl, status?.running, tokenSaverLevel]);

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
        void refreshModelCatalog({ quiet: true });
        void refreshSubscriptionOptimizer({ quiet: true });
        void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
      }
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not check subscriptions." });
    } finally {
      if (!options.quiet) {
        setBusy((current) => (current === "status" ? null : current));
      }
    }
  }

  async function startNineRouter(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setBusy("start");
      setStatusMessage(null);
    }

    try {
      const nextStatus = await ensureNineRouterLocal();
      setStatus(nextStatus);
      if (!options.quiet) {
        setStatusMessage({ kind: nextStatus.running ? "success" : "warning", text: nextStatus.message });
      }
      if (nextStatus.running) {
        void refreshProviderConnections({ quiet: true });
        void refreshModelCatalog({ quiet: true });
        void refreshSubscriptionOptimizer({ quiet: true });
        void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
      }
    } catch (error) {
      setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : "Could not start subscription routing." });
    } finally {
      if (!options.quiet) {
        setBusy((current) => (current === "start" ? null : current));
      }
    }
  }

  async function installAndStartNineRouter() {
    setBusy("install");
    setUninstallProgress(null);
    setInstallProgress({
      detail: "Checking local tools and folders.",
      label: "Preparing subscriptions",
      percent: 6,
      status: "running",
    });
    setStatusMessage(null);

    try {
      const installedStatus = await installNineRouterLocal((event) => {
        handleInstallEvent(event);
      });
      setStatus(installedStatus);
      setInstallProgress({
        detail: "Launching the local routing API.",
        label: "Starting subscriptions",
        percent: 96,
        status: "running",
      });
      const startedStatus = await ensureNineRouterLocal();
      setStatus(startedStatus);
      setStatusMessage({ kind: startedStatus.running ? "success" : "warning", text: startedStatus.message });
      setInstallProgress({
        detail: startedStatus.message,
        label: startedStatus.running ? "Subscriptions are ready" : "Start needs attention",
        percent: startedStatus.running ? 100 : 96,
        status: startedStatus.running ? "success" : "error",
      });
      if (startedStatus.running) {
        void refreshProviderConnections({ quiet: true });
        void refreshModelCatalog({ quiet: true });
        void refreshSubscriptionOptimizer({ quiet: true });
        void syncTokenSaverToHelper(tokenSaverLevel, { quiet: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not install subscriptions.";
      setInstallProgress((current) => ({
        ...current,
        detail: message,
        label: "Install could not finish",
        status: "error",
      }));
      setStatusMessage({ kind: "error", text: message });
    } finally {
      setBusy((current) => (current === "install" ? null : current));
    }
  }

  async function uninstallSandboxSubscriptions() {
    if (uninstallInFlightRef.current) {
      return;
    }

    uninstallInFlightRef.current = true;
    accountConnectRunRef.current += 1;
    setUninstallConfirmOpen(false);
    setBusy("uninstall");
    setStatusMessage({ kind: "warning", text: "Uninstalling subscriptions. Stopping the local runtime and removing saved subscription data." });
    setUninstallProgress({
      detail: "Stopping the local routing process.",
      label: "Uninstalling subscriptions",
      percent: 20,
      status: "running",
    });

    try {
      void stopCodexOAuthProxy();
      setUninstallProgress({
        detail: "Removing the local runtime, saved sign-ins, and cached routing data.",
        label: "Removing subscription files",
        percent: 58,
        status: "running",
      });
      const nextStatus = await uninstallNineRouterLocal();
      setStatus(nextStatus);
      setInstallProgress(NINE_ROUTER_INSTALL_PROGRESS_IDLE);
      setUninstallProgress(nextStatus.running
        ? {
            detail: nextStatus.message,
            label: "Uninstall needs attention",
            percent: 92,
            status: "error",
          }
        : null);
      setConnectionCatalog({
        connections: [],
        message: "Subscriptions uninstalled",
        status: "idle",
      });
      setModelCatalog({
        message: "Not checked",
        models: [],
        status: "idle",
      });
      setComboCatalog({
        combos: [],
        message: "Not checked",
        status: "idle",
      });
      setUsageByConnectionId({});

      const openRouterModel = settings.providerModels.openrouter?.trim() || getDefaultModelForProvider("openrouter");
      const nextSettings = createOpenRouterFallbackSettings(settings, openRouterModel);
      if (onSubscriptionSandboxUninstalled) {
        onSubscriptionSandboxUninstalled(nextSettings);
      } else {
        onSettingsChange(nextSettings);
      }

      setUninstallConfirmOpen(false);
      setStatusMessage({
        kind: nextStatus.running ? "warning" : "success",
        text: nextStatus.running ? nextStatus.message : "Subscriptions were uninstalled. You can install them again whenever you need subscription routing.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not uninstall subscriptions.";
      setUninstallProgress((current) => ({
        detail: message,
        label: "Uninstall could not finish",
        percent: current?.percent ?? 58,
        status: "error",
      }));
      setStatusMessage({ kind: "error", text: message });
    } finally {
      uninstallInFlightRef.current = false;
      setBusy((current) => (current === "uninstall" ? null : current));
    }
  }

  function handleInstallEvent(event: NineRouterInstallEvent) {
    if (event.event === "started") {
      setInstallProgress({
        detail: "Checking local tools and folders.",
        label: "Preparing subscriptions",
        percent: 8,
        status: "running",
      });
      return;
    }

    if (event.event === "step") {
      const step = getInstallStepProgress(event.data.message);
      setInstallProgress({
        detail: step.detail,
        label: step.label,
        percent: step.startPercent,
        status: "running",
      });
      return;
    }

    if (event.event === "output") {
      const step = getInstallStepProgress(event.data.label);
      setInstallProgress({
        detail: step.doneDetail,
        label: step.doneLabel,
        percent: step.donePercent,
        status: "running",
      });
      return;
    }

    setStatus(event.data.status);
    setInstallProgress({
      detail: "Launching the local routing API.",
      label: "Subscriptions installed",
      percent: 94,
      status: "running",
    });
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
        setStatusMessage({ kind: models.length > 0 ? "success" : "warning", text: models.length > 0 ? `${message} loaded.` : "Subscriptions are running, but no live models were reported yet." });
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

  async function refreshSubscriptionOptimizer(options: { quiet?: boolean } = {}) {
    if (!options.quiet) {
      setBusy("settings");
      setStatusMessage(null);
    }
    setComboCatalog((current) => ({
      ...current,
      message: current.status === "ready" ? current.message : "Checking fallback routes",
      status: "loading",
    }));

    const combosResult = await Promise.allSettled([
      loadNineRouterCombos(nineRouterDashboardUrl),
    ]);
    const comboResult = combosResult[0];

    if (comboResult.status === "fulfilled") {
      const combos = await repairActiveFallbackRouteIfNeeded(comboResult.value);
      setComboCatalog({
        combos,
        message: combos.length > 0 ? `${combos.length} fallback ${combos.length === 1 ? "route" : "routes"}` : "No fallback routes yet",
        status: "ready",
      });
    } else {
      setComboCatalog({
        combos: [],
        message: comboResult.reason instanceof Error ? comboResult.reason.message : "Could not load fallback routes.",
        status: "error",
      });
    }

    if (!options.quiet) {
      const ok = comboResult.status === "fulfilled";
      setStatusMessage({ kind: ok ? "success" : "warning", text: ok ? "Fallback routes are up to date." : "Some fallback route details could not be refreshed." });
      setBusy((current) => (current === "settings" ? null : current));
    }
  }

  async function repairActiveFallbackRouteIfNeeded(combos: NineRouterCombo[]) {
    if (effectiveFallbackMode === "off") {
      return combos;
    }

    const comboName = NINE_ROUTER_ALWAYS_FREE_COMBO_NAME;
    const combo = findNineRouterCombo(combos, comboName);
    const installedModels = getNineRouterComboModels(combo);
    const liveModels = modelCatalog.status === "ready" ? modelCatalog.models : await refreshModelCatalog({ quiet: true });
    const needsRepair =
      !combo ||
      installedModels.length === 0 ||
      hasUnusableNineRouterFallbackModels(installedModels, liveModels) ||
      !installedModels.some(isOpenCodeFreeModel);

    if (!needsRepair) {
      return combos;
    }

    const models = buildNineRouterFallbackModels(effectiveFallbackMode, selectedNineRouterModel, liveModels);
    if (models.length === 0) {
      return combos;
    }

    await upsertNineRouterCombo(nineRouterDashboardUrl, comboName, models, "fallback");
    return loadNineRouterCombos(nineRouterDashboardUrl);
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
        throw new Error(nextStatus.message || "Set up subscriptions before connecting Codex.");
      }

      await stopCodexOAuthProxy();
      const authUrl = createNineRouterUrl(nineRouterDashboardUrl, "/api/oauth/codex/authorize", {
        redirect_uri: NINE_ROUTER_CODEX_REDIRECT_URI,
      });
      const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(authUrl);

      if (!authData.authUrl || !authData.state || !authData.codeVerifier) {
        throw new Error("Subscriptions did not return a complete Codex sign-in request.");
      }

      const proxyUrl = createNineRouterUrl(nineRouterDashboardUrl, "/api/oauth/codex/start-proxy", {
        app_port: NINE_ROUTER_CODEX_PROXY_APP_PORT,
        code_verifier: authData.codeVerifier,
        redirect_uri: NINE_ROUTER_CODEX_REDIRECT_URI,
        state: authData.state,
      });
      const proxy = await fetchNineRouterJson<NineRouterCodexProxyResponse>(proxyUrl);

      if (!proxy.success || !proxy.serverSide) {
        throw new Error(proxy.reason === "port_busy" ? "Codex sign-in is already open. Finish or close the previous sign-in window, then retry." : "Subscriptions could not start the Codex sign-in callback.");
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
      const nextModel = chooseNineRouterModelForAccount("codex", savedNineRouterModel, models);
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
        throw new Error(nextStatus.message || `Set up subscriptions before connecting ${provider.name}.`);
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

  async function disconnectProviderAccount(target = disconnectTarget) {
    if (!target || target.connections.length === 0) {
      setDisconnectTarget(null);
      return;
    }
    if (busy === `disconnect:${target.provider.id}`) {
      return;
    }

    const runId = accountConnectRunRef.current + 1;
    accountConnectRunRef.current = runId;
    setBusy(`disconnect:${target.provider.id}`);
    setStatusMessage(null);

    try {
      let nextStatus = status;
      if (!nextStatus?.running) {
        nextStatus = await ensureNineRouterLocal();
        setStatus(nextStatus);
      }

      if (!nextStatus.running) {
        throw new Error(nextStatus.message || `Start subscriptions before signing out from ${target.provider.name}.`);
      }

      const results = await Promise.allSettled(
        target.connections.map((connection) => deleteNineRouterConnection(nineRouterDashboardUrl, connection.id)),
      );
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

      if (failures.length > 0) {
        throw new Error(failures[0]);
      }

      if (accountConnectRunRef.current !== runId) {
        return;
      }

      const [connections, models] = await Promise.all([
        refreshProviderConnections({ quiet: true, refreshUsage: false }),
        refreshModelCatalog({ quiet: true }),
      ]);
      void refreshAccountUsage(connections);
      const nextProvider = chooseNineRouterConnectedAccountProvider(connections, target.provider.id);
      if (nextProvider) {
        const nextModel = chooseNineRouterModelForAccount(nextProvider.id, savedNineRouterModel, models);
        useNineRouterProvider(nextModel, undefined, {
          statusText: `${target.provider.name} signed out. Gilbert is using ${nextProvider.name}.`,
        });
      } else {
        const openRouterModel = settings.providerModels.openrouter?.trim() || getDefaultModelForProvider("openrouter");
        useOpenRouterProvider(openRouterModel, `${target.provider.name} signed out. Gilbert is using OpenRouter.`);
      }
      setDisconnectTarget(null);
    } catch (error) {
      if (accountConnectRunRef.current === runId) {
        setStatusMessage({ kind: "error", text: error instanceof Error ? error.message : `Could not sign out from ${target.provider.name}.` });
      }
    } finally {
      if (accountConnectRunRef.current === runId) {
        setBusy((current) => (current === `disconnect:${target.provider.id}` ? null : current));
      }
    }
  }

  async function connectDeviceCodeProvider(provider: NineRouterAccountProvider, runId: number) {
    const deviceData = await fetchNineRouterJson<NineRouterDeviceCodeResponse>(joinLocalUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/device-code`));
    const deviceCode = deviceData.device_code?.trim();
    const verifyUrl = deviceData.verification_uri_complete || deviceData.verification_uri;

    if (!deviceCode || !verifyUrl) {
      throw new Error(`Subscriptions did not return a complete ${provider.name} device sign-in request.`);
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

    const [connections, models] = await Promise.all([
      refreshProviderConnections({ quiet: true, refreshUsage: false }),
      refreshModelCatalog({ quiet: true }),
    ]);
    void refreshAccountUsage(connections);
    const nextModel = chooseNineRouterModelForAccount(provider.id, savedNineRouterModel, models);
    useNineRouterProvider(nextModel);
    setStatusMessage({ kind: "success", text: `${provider.name} is connected. Gilbert is using ${nextModel} through your subscriptions.` });
  }

  async function connectAuthorizationCodeProvider(provider: NineRouterAccountProvider, runId: number) {
    const callback = await startNineRouterOAuthCallback();
    const authData = await fetchNineRouterJson<NineRouterAuthorizeResponse>(createNineRouterUrl(nineRouterDashboardUrl, `/api/oauth/${provider.id}/authorize`, {
      redirect_uri: callback.redirectUri,
    }));

    if (!authData.authUrl || !authData.state) {
      throw new Error(`Subscriptions did not return a complete ${provider.name} sign-in request.`);
    }

    if (provider.id !== "cline" && !authData.codeVerifier) {
      throw new Error(`Subscriptions did not return a code verifier for ${provider.name}.`);
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

    const [connections, models] = await Promise.all([
      refreshProviderConnections({ quiet: true, refreshUsage: false }),
      refreshModelCatalog({ quiet: true }),
    ]);
    void refreshAccountUsage(connections);
    const nextModel = chooseNineRouterModelForAccount(provider.id, savedNineRouterModel, models);
    useNineRouterProvider(nextModel);
    setStatusMessage({ kind: "success", text: `${provider.name} is connected. Gilbert is using ${nextModel} through your subscriptions.` });
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

  async function syncTokenSaverToHelper(level: SubscriptionTokenSaverLevel, options: { quiet?: boolean } = {}) {
    if (!status?.running) {
      if (!options.quiet) {
        setStatusMessage({ kind: "warning", text: "Start subscriptions before syncing optimizer settings." });
      }
      return;
    }

    if (!options.quiet) {
      setBusy("tokenSaver");
      setStatusMessage(null);
    }

    try {
      await patchNineRouterJson<NineRouterSettingsPayload>(joinLocalUrl(nineRouterDashboardUrl, "/api/settings"), {
        rtkEnabled: level !== "off",
      });

      if (!options.quiet) {
        setStatusMessage({
          kind: "success",
          text: "Optimizer settings are synced.",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not sync optimizer settings.";
      if (!options.quiet) {
        setStatusMessage({ kind: "error", text: message });
      }
    } finally {
      if (!options.quiet) {
        setBusy((current) => (current === "tokenSaver" ? null : current));
      }
    }
  }

  function useNineRouterProvider(
    modelOverride = selectedNineRouterModel,
    optimizationOverride?: Partial<ProviderSettings["subscriptionOptimization"]>,
    options: { statusText?: string } = {},
  ) {
    const currentOptimization: ProviderSettings["subscriptionOptimization"] = settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT;
    const nextSettings = {
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
      subscriptionOptimization: {
        ...currentOptimization,
        ...optimizationOverride,
      },
    };
    onSettingsChange(nextSettings);
    onActivateProvider?.(NINE_ROUTER_PROVIDER_ID, modelOverride);
    setStatusMessage({ kind: "success", text: options.statusText ?? "Subscription routing is now active." });
  }

  function useOpenRouterProvider(modelOverride: string, statusText: string) {
    const nextSettings = createOpenRouterFallbackSettings(settings, modelOverride);

    onSettingsChange(nextSettings);
    onActivateProvider?.("openrouter", modelOverride);
    setStatusMessage({ kind: "success", text: statusText });
  }

  function updateCodexContextWindow(mode: SubscriptionCodexContextWindow) {
    onSettingsChange({
      ...settings,
      subscriptionOptimization: {
        ...(settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT),
        codexContextWindow: mode,
      },
    });
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
          <>
            <article className="settings-card settings-card-wide" aria-busy={helperInstalling || helperStarting || !status}>
            <div className="settings-card-heading">
              <Download size={19} aria-hidden="true" />
              <div>
                <h2>Set up subscriptions</h2>
                <p>{getSubscriptionSetupDescription(status, busy, installProgress, desktopRuntime)}</p>
              </div>
            </div>
            <div className="nine-router-setup-steps" aria-label="Subscription setup steps">
              <div className="nine-router-setup-step" data-state={helperInstalled ? "done" : helperInstalling || !status ? "active" : "next"}>
                <strong>1. Install</strong>
                <span>Add the local subscription runtime.</span>
              </div>
              <div className="nine-router-setup-step" data-state={helperInstalled ? "next" : "locked"}>
                <strong>2. Sign in</strong>
                <span>Connect Codex, Copilot, Claude, Gemini, or another paid account.</span>
              </div>
              <div className="nine-router-setup-step" data-state="locked">
                <strong>3. Pick model</strong>
                <span>Model picker labels the provider source.</span>
              </div>
            </div>
            <div className="settings-row-list">
              <div className="settings-row">
                <span>Status</span>
                <strong>{helperStatusLabel}</strong>
                <span className="settings-row-static-pill">{helperStatusPill}</span>
              </div>
              <div className="settings-row">
                <span>Launch</span>
                <strong>Starts automatically when Subscriptions opens or when a route needs it</strong>
                <span className="settings-row-static-pill">Automatic</span>
              </div>
              {hasRecoverableSubscriptionFootprint ? (
                <div className="settings-row">
                  <span>Existing files</span>
                  <strong>Setup can reuse or repair local subscription files.</strong>
                  <span className="settings-row-static-pill">Recoverable</span>
                </div>
              ) : null}
              {helperInstallBlocked ? (
                <div className="settings-row">
                  <span>{desktopRuntime ? "Missing" : "Runtime"}</span>
                  <strong>{helperInstallBlocked}</strong>
                  <span className="settings-row-static-pill">{desktopRuntime ? "Required" : "Desktop"}</span>
                </div>
              ) : null}
            </div>
            <div className="settings-actions-row">
              <button
                className="settings-primary-button"
                type="button"
                disabled={busy !== null || !status || Boolean(helperInstallBlocked)}
                onClick={status?.installed ? () => startNineRouter() : installAndStartNineRouter}
              >
                {status?.installed ? <Play size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
                {helperInstalling || helperStarting ? helperActionBusyLabel : helperActionLabel}
              </button>
              <button className="settings-ghost-button" type="button" disabled={busy !== null} onClick={() => refreshStatus()}>
                <RefreshCcw size={16} aria-hidden="true" />
                {busy === "status" ? "Checking" : "Check again"}
              </button>
            </div>
            {showInstallProgress ? <InstallProgressMeter progress={installProgress} /> : null}
            </article>

          </>
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
                  const providerDisconnecting = busy === `disconnect:${provider.id}`;
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

                      <button
                        className={`${connected ? "settings-danger-button" : "settings-primary-button"} settings-full-width-button`}
                        type="button"
                        disabled={busy !== null}
                        onClick={() => {
                          if (connected) {
                            setDisconnectTarget({ connections, provider });
                            return;
                          }

                          void connectProviderAccount(provider);
                        }}
                      >
                        {connected ? <LogOut size={16} aria-hidden="true" /> : provider.flow === "device_code" ? <ExternalLink size={16} aria-hidden="true" /> : <KeyRound size={16} aria-hidden="true" />}
                        {providerDisconnecting ? "Signing out" : providerBusy ? "Waiting for sign-in" : connected ? `Sign out from ${provider.name}` : `Sign in with ${provider.name}`}
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

            {showModelRoutingCard ? (
              <article className="settings-card nine-router-routing-card">
              <div className="settings-card-heading">
                <ServerCog size={19} aria-hidden="true" />
                <div>
                  <h2>Model routing</h2>
                  <p>{isNineRouterActive ? "Active subscription route." : "Use connected accounts from the model picker."}</p>
                </div>
              </div>

              <div className="nine-router-routing-summary" aria-label="Subscription routing summary">
                <div className="nine-router-routing-main">
                  <span>{isNineRouterActive ? "Subscriptions active" : "Subscriptions ready"}</span>
                  <strong title={formatSubscriptionRouteSummary(selectedNineRouterModel)}>{formatSubscriptionRouteSummary(selectedNineRouterModel)}</strong>
                  <small>{formatSubscriptionRouteCapabilities(selectedNineRouterModel)}</small>
                </div>
                <div className="nine-router-routing-badges">
                  <span className="settings-row-static-pill">{isNineRouterActive ? "Active" : "Ready"}</span>
                  <span className="settings-row-static-pill">{modelCatalog.status === "ready" ? `${modelCatalog.models.length} routes` : modelCatalog.status === "error" ? "Check catalog" : "Local catalog"}</span>
                </div>
              </div>

              <div className="settings-row-list nine-router-routing-details">
                {showCodexContextSettings ? (
                  <div className="settings-row">
                    <span>Codex context</span>
                    <strong>{codexContextWindow === "extended" ? "1M" : "262k"}</strong>
                    <span className="settings-row-static-pill">{codexContextWindow === "extended" ? "Higher cost" : "Default"}</span>
                  </div>
                ) : null}
                <div className="settings-row">
                  <span>Image generation</span>
                  <strong>{settings.tools.imageGeneration ? "Available in chat" : "Disabled"}</strong>
                  <button
                    className="settings-switch"
                    type="button"
                    role="switch"
                    aria-checked={settings.tools.imageGeneration}
                    data-on={settings.tools.imageGeneration}
                    onClick={() =>
                      onSettingsChange({
                        ...settings,
                        tools: {
                          ...settings.tools,
                          imageGeneration: !settings.tools.imageGeneration,
                        },
                      })
                    }
                  >
                    <span />
                  </button>
                </div>
              </div>

              {showCodexContextSettings ? (
                <div className="settings-stack">
                  <strong>Codex subscription context</strong>
                  <span className="settings-subtle-text">262k is the default cost-saving context limit. 1M is available for long-context Codex work at higher cost.</span>
                  <div className="settings-segmented-control settings-segmented-control-compact" aria-label="Codex subscription context window">
                    {CODEX_CONTEXT_WINDOW_OPTIONS.map((option) => (
                      <button
                        aria-pressed={codexContextWindow === option.mode}
                        data-selected={codexContextWindow === option.mode}
                        key={option.mode}
                        title={option.detail}
                        type="button"
                        onClick={() => updateCodexContextWindow(option.mode)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {savedModelMissingFromCatalog ? (
                <span className="settings-status" data-kind="warning">
                  Saved model {savedNineRouterModel} is not in the live catalog. Gilbert will use {selectedNineRouterModel} when you switch.
                </span>
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
            ) : null}

          </>
        )}

        {showInstalledRuntimeRemoval ? (
          <article className="settings-card settings-card-wide settings-danger-card" aria-busy={busy === "uninstall"}>
            <div className="settings-card-heading">
              <Trash2 size={19} aria-hidden="true" />
              <div>
                <h2>Installed subscriptions</h2>
                <p>Remove the local subscription runtime, saved subscription sign-ins, and cached routing data from this device.</p>
              </div>
            </div>
            <div className="settings-row-list">
              <div className="settings-row">
                <span>Subscriptions</span>
                <strong>{status?.running ? "Running" : "Installed"}</strong>
                <span className="settings-row-static-pill">{status?.running ? "Active" : "Local"}</span>
              </div>
              <div className="settings-row">
                <span>Reinstall</span>
                <strong>After uninstall, use Set up subscriptions to install a fresh copy.</strong>
              </div>
            </div>
            <button className="settings-danger-button settings-full-width-button" type="button" disabled={busy !== null || !showInstalledRuntimeRemoval} onClick={() => setUninstallConfirmOpen(true)}>
              <Trash2 size={16} aria-hidden="true" />
              {busy === "uninstall" ? "Uninstalling subscriptions" : "Uninstall subscriptions"}
            </button>
            {showUninstallProgress && uninstallProgress ? <InstallProgressMeter progress={uninstallProgress} /> : null}
          </article>
        ) : null}
      </div>
      <ConfirmDialog
        confirmLabel={disconnectTarget && busy === `disconnect:${disconnectTarget.provider.id}` ? "Signing out..." : "Sign out"}
        description={disconnectTarget ? `This removes ${disconnectTarget.connections.length} saved ${disconnectTarget.provider.name} subscription account${disconnectTarget.connections.length === 1 ? "" : "s"} from this device.` : ""}
        icon={LogOut}
        onClose={() => {
          if (!disconnectTarget || busy !== `disconnect:${disconnectTarget.provider.id}`) {
            setDisconnectTarget(null);
          }
        }}
        onConfirm={() => {
          void disconnectProviderAccount();
        }}
        open={Boolean(disconnectTarget)}
        title={disconnectTarget ? `Sign out from ${disconnectTarget.provider.name}?` : "Sign out?"}
        tone="danger"
      />
      <ConfirmDialog
        confirmLabel="Uninstall subscriptions"
        description="This removes the local subscription runtime from this device, including saved subscription sign-ins and local routing data. You can reinstall it from Subscriptions."
        onClose={() => {
          if (busy !== "uninstall") {
            setUninstallConfirmOpen(false);
          }
        }}
        onConfirm={uninstallSandboxSubscriptions}
        open={uninstallConfirmOpen}
        title="Uninstall subscriptions?"
        tone="danger"
      />
    </>
  );
}

function getSubscriptionSetupStatusLabel(
  status: NineRouterLocalStatus | null,
  busy: NineRouterBusyState,
  installProgress: NineRouterInstallProgressState,
  desktopRuntime: boolean,
) {
  if (busy === "install" || installProgress.status === "running") {
    return installProgress.label || "Installing subscriptions";
  }

  if (busy === "start") {
    return "Starting subscriptions";
  }

  if (!status) {
    return "Checking setup";
  }

  if (status.running && status.installed) {
    return "Ready";
  }

  if (status.installed) {
    return "Installed, not running";
  }

  if (!desktopRuntime) {
    return "Desktop app required";
  }

  if (installProgress.status === "error") {
    return "Install needs attention";
  }

  return "Not installed";
}

function getSubscriptionSetupStatusPill(
  status: NineRouterLocalStatus | null,
  busy: NineRouterBusyState,
  installProgress: NineRouterInstallProgressState,
  desktopRuntime: boolean,
) {
  if (busy === "install" || busy === "start" || installProgress.status === "running") {
    return "In progress";
  }

  if (!status) {
    return "Checking";
  }

  if (status.running && status.installed) {
    return "Ready";
  }

  if (status.installed) {
    return "Installed";
  }

  if (!desktopRuntime) {
    return "Desktop";
  }

  if (installProgress.status === "error") {
    return "Retry";
  }

  return "Needed";
}

function getSubscriptionSetupDescription(
  status: NineRouterLocalStatus | null,
  busy: NineRouterBusyState,
  installProgress: NineRouterInstallProgressState,
  desktopRuntime: boolean,
) {
  if (busy === "install" || installProgress.status === "running") {
    return "Installing the local subscription runtime. Progress updates appear below.";
  }

  if (busy === "start") {
    return "Starting the local subscription runtime. This usually takes a moment.";
  }

  if (!status) {
    return "Checking whether subscriptions are already installed on this device.";
  }

  if (!desktopRuntime) {
    return "Subscription setup runs in the desktop app. API-key and OpenRouter routes are still available in previews.";
  }

  if (status.installed && !status.running) {
    return "Subscriptions are installed but not running yet. Start them to connect account subscriptions.";
  }

  if (installProgress.status === "error") {
    return "Setup did not finish. Review the status below and try again when ready.";
  }

  return "Install the local subscription runtime once. Gilbert starts it automatically for subscription routing.";
}

function normalizeNineRouterCombosPayload(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload.filter(isNineRouterCombo);
  }

  if (typeof payload !== "object" || !payload) {
    return [];
  }

  const record = payload as { combos?: unknown; data?: unknown };
  const combos = Array.isArray(record.combos) ? record.combos : Array.isArray(record.data) ? record.data : [];

  return combos.filter(isNineRouterCombo);
}

function isNineRouterCombo(value: unknown): value is NineRouterCombo {
  if (typeof value !== "object" || !value) {
    return false;
  }

  const combo = value as Partial<NineRouterCombo>;
  return typeof combo.name === "string" || typeof combo.id === "string";
}

function findNineRouterCombo(combos: NineRouterCombo[], name: string) {
  return combos.find((combo) => combo.name === name || combo.id === name) ?? null;
}

function getNineRouterComboModels(combo: NineRouterCombo | null | undefined) {
  if (!combo) {
    return [];
  }

  const models = Array.isArray(combo.models) ? combo.models : Array.isArray(combo.modelIds) ? combo.modelIds : [];
  return dedupeNineRouterFallbackModels(models);
}

async function loadNineRouterCombos(dashboardUrl: string) {
  const payload = await fetchNineRouterJson<NineRouterCombo[] | { combos?: NineRouterCombo[]; data?: NineRouterCombo[] }>(joinLocalUrl(dashboardUrl, "/api/combos"));
  return normalizeNineRouterCombosPayload(payload);
}

async function upsertNineRouterCombo(dashboardUrl: string, name: string, models: string[], kind: string) {
  const combos = await loadNineRouterCombos(dashboardUrl);
  const existing = findNineRouterCombo(combos, name);
  const body = {
    kind,
    models,
    name,
  };

  if (existing?.id) {
    return putNineRouterJson<NineRouterCombo>(joinLocalUrl(dashboardUrl, `/api/combos/${encodeURIComponent(existing.id)}`), body);
  }

  return postNineRouterJson<NineRouterCombo>(joinLocalUrl(dashboardUrl, "/api/combos"), body);
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

function createOpenRouterFallbackSettings(settings: ProviderSettings, openRouterModel: string): ProviderSettings {
  const fallbackModel = openRouterModel.trim() || getDefaultModelForProvider("openrouter");
  const providerModels = {
    ...settings.providerModels,
    openrouter: fallbackModel,
    [NINE_ROUTER_PROVIDER_ID]: "",
  };

  if (settings.provider !== NINE_ROUTER_PROVIDER_ID) {
    providerModels[settings.provider] = settings.model;
  }

  return {
    ...settings,
    model: fallbackModel,
    provider: "openrouter",
    providerModels,
    subscriptionOptimization: {
      ...(settings.subscriptionOptimization ?? SUBSCRIPTION_OPTIMIZATION_DEFAULT),
      fallbackMode: "off",
    },
  };
}

function InstallProgressMeter({ progress }: { progress: NineRouterInstallProgressState }) {
  const percent = clampPercent(progress.percent);

  return (
    <div className="settings-install-progress" data-status={progress.status} aria-live="polite">
      <div className="settings-install-progress-heading">
        <strong>{progress.label}</strong>
        <span>{percent}%</span>
      </div>
      <div className="settings-install-progress-track" role="progressbar" aria-label="Subscriptions install progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
        <span style={{ width: `${percent}%` }} />
      </div>
      {progress.detail ? <small>{formatSubscriptionHelperText(progress.detail)}</small> : null}
    </div>
  );
}

function getInstallStepProgress(rawLabel: string) {
  const label = formatSubscriptionHelperText(rawLabel);
  const normalized = rawLabel.toLowerCase();

  if (/clone|update|source/.test(normalized)) {
    return {
      detail: "Preparing the local subscription source.",
      doneDetail: "Source is ready.",
      doneLabel: "Source ready",
      donePercent: 42,
      label: /update/.test(normalized) ? "Updating subscriptions" : "Downloading subscriptions",
      startPercent: 22,
    };
  }

  if (/dependencies|npm|install/.test(normalized)) {
    return {
      detail: "Installing dependencies. This can take a few minutes.",
      doneDetail: "Dependencies are installed.",
      doneLabel: "Dependencies installed",
      donePercent: 68,
      label: "Installing dependencies",
      startPercent: 48,
    };
  }

  if (/build/.test(normalized)) {
    return {
      detail: "Building the local routing runtime.",
      doneDetail: "Build complete.",
      doneLabel: "Build complete",
      donePercent: 92,
      label: "Building subscriptions",
      startPercent: 76,
    };
  }

  return {
    detail: label,
    doneDetail: "Step complete.",
    doneLabel: "Step complete",
    donePercent: 90,
    label,
    startPercent: 16,
  };
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

function chooseNineRouterModel(savedModel: string, catalog: NineRouterModelCatalogState) {
  const normalizedSavedModel = savedModel.trim();
  if (catalog.status === "ready" && catalog.models.length > 0) {
    return normalizedSavedModel && catalog.models.includes(normalizedSavedModel) ? normalizedSavedModel : catalog.models[0];
  }

  return normalizedSavedModel || getDefaultModelForProvider(NINE_ROUTER_PROVIDER_ID);
}

function formatSubscriptionRouteSummary(model: string) {
  const routeSource = getModelRouteSourceInfo(NINE_ROUTER_PROVIDER_ID, model);
  const option = getChatModelOption(model, NINE_ROUTER_PROVIDER_ID);
  const label = option?.label || model;

  return `${routeSource.sourceLabel} - ${label}`;
}

function formatSubscriptionRouteCapabilities(model: string) {
  return formatModelCapabilitySummary(getChatModelOption(model, NINE_ROUTER_PROVIDER_ID));
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
    throw new Error(payload.error?.message || `Subscription request failed with HTTP ${response.status}.`);
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
    throw new Error(typeof error === "string" ? error : error?.message || `Subscription request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function patchNineRouterJson<T>(url: string, body: unknown) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const payload = await readJsonResponse<T & { error?: { message?: string } | string }>(response);

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscription request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function putNineRouterJson<T>(url: string, body: unknown) {
  const response = await fetchWithTimeout(url, {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PUT",
  });
  const payload = await readJsonResponse<T & { error?: { message?: string } | string }>(response);

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscription request failed with HTTP ${response.status}.`);
  }

  return payload;
}

async function deleteNineRouterConnection(dashboardUrl: string, connectionId: string) {
  const response = await fetchWithTimeout(joinLocalUrl(dashboardUrl, `/api/providers/${encodeURIComponent(connectionId)}`), {
    method: "DELETE",
  });
  const payload = await readJsonResponse<{ error?: { message?: string } | string }>(response);

  if (response.status === 404) {
    return;
  }

  if (!response.ok) {
    const error = payload.error;
    throw new Error(typeof error === "string" ? error : error?.message || `Subscription sign-out failed with HTTP ${response.status}.`);
  }
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 10_000);

  try {
    if (isTauriDesktopRuntime()) {
      const nativeResponse = await nineRouterLocalHttp({
        body: normalizeNativeRequestBody(init.body, "The subscriptions bridge"),
        headers: headersToRecord(init.headers),
        method: normalizeNativeRequestMethod(init.method, "The subscriptions bridge"),
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
      throw new Error(`Subscriptions did not answer ${url} within 10 seconds.`);
    }

    const message = error instanceof Error ? error.message : String(error);
    if (/failed to fetch|load failed|networkerror|request failed|connection refused|could not connect/i.test(message)) {
      throw new Error(`Could not reach subscriptions at ${url}. Open Subscriptions, then retry.`);
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

    if (model === "free-combo" || model === NINE_ROUTER_SMART_SAVER_MODEL || model === NINE_ROUTER_ALWAYS_FREE_MODEL) {
      return `Free Auto routing is falling through to ${providerName}, but ${providerName} is not connected.`;
    }

    return `${providerName} is not connected for ${model}.`;
  }

  if (status === 404 && (model === "free-combo" || model === NINE_ROUTER_SMART_SAVER_MODEL || model === NINE_ROUTER_ALWAYS_FREE_MODEL)) {
    return "Free Auto routing is not available in the local subscription catalog.";
  }

  return providerMessage || `Subscription request failed with HTTP ${status}.`;
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
