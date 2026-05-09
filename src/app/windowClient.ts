import { getCurrentWindow } from "@tauri-apps/api/window";

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
