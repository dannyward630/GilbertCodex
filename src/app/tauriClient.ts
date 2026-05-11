import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppInfo } from "../types/app";
import type { DiscordBridgeResponseStyle, DiscordTunnelProvider } from "../types/discord";
import type {
  TerminalCreateSessionRequest,
  TerminalCreateSessionResponse,
  TerminalDrainResponse,
  TerminalRunCommandRequest,
  TerminalRunCommandResponse,
} from "../types/terminal";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

const fallbackAppInfo: AppInfo = {
  name: "Gilbert Codex",
  version: "0.2.1",
  phase: "Public alpha",
  runtime: "Browser preview",
};

const DISCORD_INTERACTION_EVENT = "discord-interaction";
const DISCORD_BRIDGE_STATUS_EVENT = "discord-bridge-status";

/** Request shape for the native browser-preview helper. */
export interface BrowserAutomationRequest {
  action: "assert_text" | "click_link" | "inspect" | "open";
  text?: string;
  url: string;
}

/** Normalized browser inspection result returned by Rust. */
export interface BrowserAutomationResponse {
  action: string;
  links: Array<{
    href: string;
    text: string;
  }>;
  matched: boolean;
  status: number;
  targetUrl?: string | null;
  textSnippet: string;
  title: string;
  url: string;
}

export interface UserConfigInfo {
  exists: boolean;
  hasDeprecatedHooksFlag: boolean;
  message: string;
  path: string;
}

export interface WorkspaceDependencyDiagnostic {
  codexVersion?: string | null;
  details: string[];
  message: string;
  nodePath: string;
  nodeVersion?: string | null;
  pythonPath: string;
  pythonVersion?: string | null;
  status: "error" | "success" | string;
  version: string;
}

export interface DiscordBridgeStartRequest {
  allowedChannelIds?: string;
  allowedGuildIds?: string;
  applicationId: string;
  localPort?: number;
  ngrokAuthToken?: string;
  ngrokPath?: string;
  publicKey: string;
  responseStyle?: DiscordBridgeResponseStyle;
  tunnelProvider?: DiscordTunnelProvider;
}

export interface DiscordBridgeStatus {
  error?: string | null;
  localUrl?: string | null;
  message: string;
  port?: number | null;
  publicUrl?: string | null;
  running: boolean;
  tunnelProvider?: DiscordTunnelProvider | null;
}

export interface DiscordSlashCommandRegisterResponse {
  commandId: string;
  commandName: string;
  guildId?: string | null;
  message: string;
  scope: "guild" | "global" | string;
}

export interface DiscordInteractionEvent {
  applicationId: string;
  channelId?: string | null;
  commandName?: string | null;
  guildId?: string | null;
  id: string;
  prompt: string;
  receivedAt: number;
  token: string;
  userId?: string | null;
  username?: string | null;
}

export interface AppUpdateCheckResponse {
  available: boolean;
  body?: string | null;
  currentVersion: string;
  date?: string | null;
  feedStatus?: "ready" | "missing";
  message?: string | null;
  target?: string | null;
  version?: string | null;
}

export type AppUpdateInstallEvent =
  | {
      event: "started";
      data: {
        contentLength?: number | null;
      };
    }
  | {
      event: "progress";
      data: {
        chunkLength: number;
        contentLength?: number | null;
        downloaded: number;
      };
    }
  | {
      event: "finished";
      data?: null;
    };

/** Detects the desktop runtime before invoking Tauri-only commands. */
export function isTauriDesktopRuntime() {
  return typeof window !== "undefined" && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));
}

/** Reads app metadata from Rust and falls back for browser-only previews. */
export async function getAppInfo(): Promise<AppInfo> {
  try {
    return await invoke<AppInfo>("get_app_info");
  } catch {
    return fallbackAppInfo;
  }
}

export async function checkForAppUpdate(): Promise<AppUpdateCheckResponse> {
  if (!isTauriDesktopRuntime()) {
    return {
      available: false,
      currentVersion: fallbackAppInfo.version,
      feedStatus: "ready",
    };
  }

  return invoke<AppUpdateCheckResponse>("app_update_check");
}

export async function installAppUpdate(onEvent: (event: AppUpdateInstallEvent) => void): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("App updates are available in the desktop app.");
  }

  const onEventChannel = new Channel<AppUpdateInstallEvent>(onEvent);
  return invoke<void>("app_update_install", { onEvent: onEventChannel });
}

/** Runs one native browser automation action from the in-app browser preview. */
export async function runBrowserAutomation(request: BrowserAutomationRequest): Promise<BrowserAutomationResponse> {
  return invoke<BrowserAutomationResponse>("browser_automation", { request });
}

export async function getUserConfigInfo(): Promise<UserConfigInfo> {
  if (!isTauriDesktopRuntime()) {
    return {
      exists: false,
      hasDeprecatedHooksFlag: false,
      message: "Open the desktop app to manage config.toml.",
      path: "~/.codex/config.toml",
    };
  }

  return invoke<UserConfigInfo>("settings_get_user_config");
}

export async function openUserConfig(): Promise<UserConfigInfo> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Open config.toml is available in the desktop app.");
  }

  return invoke<UserConfigInfo>("settings_open_user_config");
}

export async function diagnoseWorkspaceDependencies(): Promise<WorkspaceDependencyDiagnostic> {
  if (!isTauriDesktopRuntime()) {
    return createWorkspaceDependencyPreviewDiagnostic("Open the desktop app to diagnose bundled workspace dependencies.");
  }

  return invoke<WorkspaceDependencyDiagnostic>("workspace_dependencies_diagnose");
}

export async function reinstallWorkspaceDependencies(): Promise<WorkspaceDependencyDiagnostic> {
  if (!isTauriDesktopRuntime()) {
    return createWorkspaceDependencyPreviewDiagnostic("Open the desktop app to reset or reinstall bundled workspace dependencies.");
  }

  return invoke<WorkspaceDependencyDiagnostic>("workspace_dependencies_reinstall");
}

export async function getDiscordBridgeStatus(): Promise<DiscordBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return {
      message: "Open the desktop app to run the Discord bridge.",
      running: false,
    };
  }

  return invoke<DiscordBridgeStatus>("discord_bridge_status");
}

export async function startDiscordBridge(request: DiscordBridgeStartRequest): Promise<DiscordBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Open the desktop app to start the Discord bridge.");
  }

  return invoke<DiscordBridgeStatus>("discord_bridge_start", { request });
}

export async function stopDiscordBridge(): Promise<DiscordBridgeStatus> {
  if (!isTauriDesktopRuntime()) {
    return {
      message: "The Discord bridge only runs in the desktop app.",
      running: false,
    };
  }

  return invoke<DiscordBridgeStatus>("discord_bridge_stop");
}

export async function sendDiscordInteractionResponse(request: { applicationId: string; content: string; token: string }): Promise<void> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Discord interaction responses are only available in the desktop app.");
  }

  return invoke<void>("discord_bridge_send_interaction_response", { request });
}

export async function registerDiscordSlashCommand(request: {
  applicationId: string;
  botToken: string;
  commandName?: string;
  guildId?: string;
}): Promise<DiscordSlashCommandRegisterResponse> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Registering Discord slash commands is only available in the desktop app.");
  }

  return invoke<DiscordSlashCommandRegisterResponse>("discord_register_slash_command", { request });
}

export async function listenForDiscordInteractions(onInteraction: (interaction: DiscordInteractionEvent) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<DiscordInteractionEvent>(DISCORD_INTERACTION_EVENT, (event) => {
    onInteraction(event.payload);
  });
}

/** Listens for Discord bridge health updates emitted by the Rust command layer. */
export async function listenForDiscordBridgeStatus(onStatus: (status: DiscordBridgeStatus) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<DiscordBridgeStatus>(DISCORD_BRIDGE_STATUS_EVENT, (event) => {
    onStatus(event.payload);
  });
}

function createWorkspaceDependencyPreviewDiagnostic(message: string): WorkspaceDependencyDiagnostic {
  return {
    details: [message],
    message,
    nodePath: "",
    nodeVersion: null,
    pythonPath: "",
    pythonVersion: null,
    status: "error",
    version: "desktop-only",
  };
}

export async function createTerminalSession(request: TerminalCreateSessionRequest): Promise<TerminalCreateSessionResponse> {
  return invoke<TerminalCreateSessionResponse>("terminal_create_session", { request });
}

export async function getDefaultTerminalWorkingDirectory(): Promise<string> {
  if (!isTauriDesktopRuntime()) {
    return "";
  }

  return invoke<string>("terminal_get_default_working_directory");
}

/** Runs a command through the native terminal session manager. */
export async function runTerminalCommand(request: TerminalRunCommandRequest): Promise<TerminalRunCommandResponse> {
  return invoke<TerminalRunCommandResponse>("terminal_run_command", { request });
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
