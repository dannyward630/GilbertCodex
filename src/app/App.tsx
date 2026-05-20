import { useEffect, useRef, useState } from "react";

import { initializeDeviceStorage, loadDiscordBridgeSettings, saveDiscordBridgeSettings, setStorageNamespace } from "../lib/appStorage";
import { scheduleIdleTask } from "../lib/idleTask";
import { AuthPage } from "../pages/AuthPage";
import type { AuthSession } from "../types/auth";
import { getAuthState, logoutLocalAccount } from "./authClient";
import { AppStartupScreen } from "./bootstrap/AppStartupScreen";
import { useExternalLinkRouting } from "./bootstrap/useExternalLinkRouting";
import { createDiscordBridgeAutoStartKey, ensureDiscordBridgeAutoStarted } from "./discordBridgeAutoStart";
import { isTauriDesktopRuntime, stopDiscordBridge, stopNineRouterLocal } from "./tauriClient";
import { WorkspaceApp } from "./workspace/WorkspaceApp";

export function App() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authBootstrapped, setAuthBootstrapped] = useState(false);
  const [authHasAccounts, setAuthHasAccounts] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const discordAppAutoStartKeyRef = useRef<string | null>(null);

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
      discordAppAutoStartKeyRef.current = null;
      return;
    }

    const settings = loadDiscordBridgeSettings();
    const autoStartKey = createDiscordBridgeAutoStartKey(settings);

    if (!autoStartKey || discordAppAutoStartKeyRef.current === autoStartKey) {
      return;
    }

    discordAppAutoStartKeyRef.current = autoStartKey;

    return scheduleIdleTask(() => {
      void ensureDiscordBridgeAutoStarted(settings)
        .then((result) => {
          if (result.settings !== settings) {
            saveDiscordBridgeSettings(result.settings);
          }
        })
        .catch(() => {
          discordAppAutoStartKeyRef.current = null;
        });
    }, 500);
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
