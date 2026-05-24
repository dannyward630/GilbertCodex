import { useEffect, useRef, useState } from "react";

import { initializeDeviceStorage, setStorageNamespace } from "../lib/appStorage";
import { scheduleDelayedIdleTask } from "../lib/idleTask";
import { AuthPage } from "../pages/AuthPage";
import type { AuthSession } from "../types/auth";
import { getAuthState, logoutLocalAccount } from "./authClient";
import { AppStartupScreen } from "./bootstrap/AppStartupScreen";
import { useExternalLinkRouting } from "./bootstrap/useExternalLinkRouting";
import {
  ensureNineRouterLocal,
  getAppInfo,
  getNineRouterLocalStatus,
  installNineRouterLocal,
  isTauriDesktopRuntime,
  setNineRouterLocalAutoStart,
  stopDiscordBridge,
  stopNineRouterLocal,
} from "./tauriClient";
import { WorkspaceApp } from "./workspace/WorkspaceApp";

const NINE_ROUTER_APP_BOOTSTRAP_VERSION_PREFIX = "gilbert-codex.nine-router.bootstrap-version.v1.";
const NINE_ROUTER_APP_BOOTSTRAP_DELAY_MS = 8_000;
const NINE_ROUTER_APP_BOOTSTRAP_IDLE_TIMEOUT_MS = 5_000;

export function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBootstrapped, setAuthBootstrapped] = useState(false);
  const [authHasAccounts, setAuthHasAccounts] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const nineRouterAppBootstrapKeyRef = useRef<string | null>(null);

  useExternalLinkRouting();

  useEffect(() => {
    let cancelled = false;

    async function loadAuthState() {
      setAuthLoading(true);
      setAuthError(null);
      try {
        const state = await getAuthState();
        if (cancelled) {
          return;
        }
        if (state.session) {
          await initializeDeviceStorage(state.session.user.id);
          if (cancelled) {
            return;
          }
        }
        setAuthSession(state.session);
        setAuthHasAccounts(state.hasAccounts);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load auth state", error);
          setAuthError(error instanceof Error ? error.message : "Failed to load authentication state.");
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
          setAuthBootstrapped(true);
        }
      }
    }

    void loadAuthState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!authSession || !isTauriDesktopRuntime()) {
      nineRouterAppBootstrapKeyRef.current = null;
      return;
    }

    const bootstrapKey = authSession.user.id;
    if (nineRouterAppBootstrapKeyRef.current === bootstrapKey) {
      return;
    }

    nineRouterAppBootstrapKeyRef.current = bootstrapKey;

    return scheduleDelayedIdleTask(() => {
      void bootstrapNineRouterForAppStart(bootstrapKey).catch((error) => {
        console.warn("Background subscription bootstrap failed", error);
      });
    }, NINE_ROUTER_APP_BOOTSTRAP_DELAY_MS, NINE_ROUTER_APP_BOOTSTRAP_IDLE_TIMEOUT_MS);
  }, [authSession]);

  async function handleLogout() {
    if (isTauriDesktopRuntime()) {
      await stopNineRouterLocal().catch(() => undefined);
      await stopDiscordBridge().catch(() => undefined);
      await logoutLocalAccount();
    }

    setStorageNamespace(null);
    setAuthSession(null);
    setAuthHasAccounts(true);
  }

  if (!authBootstrapped || authLoading) {
    return <AppStartupScreen />;
  }

  if (!authSession) {
    return (
      <AuthPage
        initialError={authError}
        hasAccounts={authHasAccounts}
        onAuthenticated={async (session) => {
          await initializeDeviceStorage(session.user.id);
          setAuthSession(session);
          setAuthHasAccounts(true);
        }}
      />
    );
  }

  return <WorkspaceApp authSession={authSession} onLogout={handleLogout} />;
}

async function bootstrapNineRouterForAppStart(userId: string) {
  let status = await getNineRouterLocalStatus();
  const appInfo = await getAppInfo().catch(() => null);
  const appVersion = appInfo?.version?.trim() || "unknown";
  const bootstrapVersionKey = `${NINE_ROUTER_APP_BOOTSTRAP_VERSION_PREFIX}${userId}`;
  const bootstrappedVersion = readLocalString(bootstrapVersionKey);
  const appVersionChanged = bootstrappedVersion !== appVersion;
  const shouldInstallOrRefresh = !status.installed || appVersionChanged;

  if (shouldInstallOrRefresh) {
    if (status.installed && status.running && appVersionChanged) {
      status = await stopNineRouterLocal().catch(() => status);
    }

    try {
      status = await installNineRouterLocal(() => undefined);
      writeLocalString(bootstrapVersionKey, appVersion);
    } catch (error) {
      console.warn("Could not install or update subscription routing in the background", error);
      if (!status.installed) {
        return;
      }
    }
  }

  if (!status.installed) {
    return;
  }

  if (!status.running || !status.autoStartEnabled) {
    status = await setNineRouterLocalAutoStart(true).catch(async (error) => {
      console.warn("Could not enable subscription auto-start", error);
      return status.running ? status : await ensureNineRouterLocal();
    });
  }

  if (!status.running) {
    await ensureNineRouterLocal();
  }
}

function readLocalString(key: string) {
  try {
    return globalThis.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function writeLocalString(key: string, value: string) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Startup should not fail just because browser storage is unavailable.
  }
}
