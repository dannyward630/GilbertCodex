import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "../types/app";
import type { TerminalCreateSessionRequest, TerminalCreateSessionResponse, TerminalDrainResponse } from "../types/terminal";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

const fallbackAppInfo: AppInfo = {
  name: "Gilbert Codex",
  version: "0.1.0",
  phase: "Phase 1",
  runtime: "Browser preview",
};

export function isTauriDesktopRuntime() {
  return typeof window !== "undefined" && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));
}

export async function getAppInfo(): Promise<AppInfo> {
  try {
    return await invoke<AppInfo>("get_app_info");
  } catch {
    return fallbackAppInfo;
  }
}

export async function createTerminalSession(request: TerminalCreateSessionRequest): Promise<TerminalCreateSessionResponse> {
  return invoke<TerminalCreateSessionResponse>("terminal_create_session", { request });
}

export async function writeTerminalSession(sessionId: string, input: string): Promise<void> {
  return invoke<void>("terminal_write_session", {
    request: {
      input,
      sessionId,
    },
  });
}

export async function drainTerminalSession(sessionId: string): Promise<TerminalDrainResponse> {
  return invoke<TerminalDrainResponse>("terminal_drain_session", {
    request: {
      sessionId,
    },
  });
}

export async function killTerminalSession(sessionId: string): Promise<void> {
  return invoke<void>("terminal_kill_session", {
    request: {
      sessionId,
    },
  });
}
