import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauriDesktopRuntime } from "./tauriClient";

async function withWindow(action: (window: ReturnType<typeof getCurrentWindow>) => Promise<void>) {
  try {
    await action(getCurrentWindow());
  } catch {
    return;
  }
}

export async function minimizeWindow() {
  await withWindow((window) => window.minimize());
}

export async function maximizeWindow() {
  await withWindow((window) => window.toggleMaximize());
}

export async function closeWindow() {
  await withWindow((window) => window.close());
}

export async function startWindowDrag() {
  await withWindow((window) => window.startDragging());
}

export async function openChatWindow(chatId: string, title: string) {
  const url = createChatRouteUrl(chatId);

  if (!isTauriDesktopRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  const label = `chat-${sanitizeWindowLabel(chatId)}`;
  const existingWindow = await WebviewWindow.getByLabel(label);

  if (existingWindow) {
    await existingWindow.setFocus();
    return;
  }

  const webview = new WebviewWindow(label, {
    decorations: false,
    height: 820,
    minHeight: 680,
    minWidth: 960,
    title: title.trim() || "Gilbert Codex",
    url,
    width: 1280,
  });

  await new Promise<void>((resolve, reject) => {
    void webview.once("tauri://created", () => resolve());
    void webview.once("tauri://error", (event) => reject(new Error(String(event.payload || "Could not open chat window."))));
  });
}

export function createChatRouteUrl(chatId: string) {
  const currentUrl = new URL(window.location.href);
  currentUrl.hash = `chat=${encodeURIComponent(chatId)}`;
  return currentUrl.pathname + currentUrl.search + currentUrl.hash;
}

function sanitizeWindowLabel(value: string) {
  return value.replace(/[^a-zA-Z0-9-/:_]/g, "-").slice(0, 96) || `${Date.now()}`;
}
