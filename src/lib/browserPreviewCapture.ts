import { captureBrowserPreview, isTauriDesktopRuntime, type BrowserPreviewCaptureClip } from "../app/tauriClient";
import type { ChatArtifact } from "../types/chat";

export interface BrowserPreviewCaptureState {
  activeTabId?: string;
  clip?: BrowserPreviewCaptureClip;
  mode: "iframe" | "native";
  nativeLabel?: string;
  status?: string;
  title?: string;
  updatedAt: string;
  url: string;
}

export interface BrowserPreviewScreenshotOptions {
  reason?: string;
}

export interface BrowserPreviewScreenshotResult {
  artifact: ChatArtifact;
  clip?: BrowserPreviewCaptureClip;
  dataUrl: string;
  detail: string;
  label: string;
  mimeType: string;
  mode: BrowserPreviewCaptureState["mode"];
  sizeBytes: number;
  title: string;
  url: string;
}

let currentCaptureState: BrowserPreviewCaptureState | null = null;

export function updateBrowserPreviewCaptureState(state: BrowserPreviewCaptureState) {
  currentCaptureState = {
    ...state,
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
}

export function clearBrowserPreviewCaptureState(activeTabId?: string) {
  if (!activeTabId || currentCaptureState?.activeTabId === activeTabId) {
    currentCaptureState = null;
  }
}

export function getBrowserPreviewCaptureState() {
  return currentCaptureState;
}

export async function captureBrowserPreviewScreenshot(options: BrowserPreviewScreenshotOptions = {}): Promise<BrowserPreviewScreenshotResult> {
  if (!isTauriDesktopRuntime()) {
    throw new Error("Browser screenshot capture is available in the desktop app.");
  }

  const state = getBrowserPreviewCaptureState();
  if (!state?.url) {
    throw new Error("Open the in-app browser preview before capturing a screenshot.");
  }

  if (state.mode === "native" && !state.nativeLabel) {
    throw new Error("The native browser view is still starting. Try the screenshot again after the page is ready.");
  }

  const label = state.mode === "native" ? state.nativeLabel! : "main";
  const response = await captureBrowserPreview({
    clip: state.mode === "iframe" ? state.clip : undefined,
    format: "png",
    label,
  });

  const title = state.title || formatBrowserScreenshotTitle(state.url);
  const sizeBytes = response.sizeBytes || estimateDataUrlBytes(response.dataUrl);
  const detail = [
    `URL: ${state.url}`,
    `Mode: ${state.mode}`,
    state.status ? `Preview status: ${state.status}` : "",
    options.reason ? `Reason: ${options.reason}` : "",
    response.clip ? `Clip: ${Math.round(response.clip.width)}x${Math.round(response.clip.height)} at ${Math.round(response.clip.x)},${Math.round(response.clip.y)}` : "",
  ].filter(Boolean).join("\n");
  const artifact: ChatArtifact = {
    detail,
    id: createBrowserScreenshotId(),
    kind: "image",
    mimeType: response.mimeType,
    sizeBytes,
    title,
    url: response.dataUrl,
  };

  return {
    artifact,
    clip: response.clip ?? undefined,
    dataUrl: response.dataUrl,
    detail,
    label: response.label,
    mimeType: response.mimeType,
    mode: state.mode,
    sizeBytes,
    title,
    url: state.url,
  };
}

function formatBrowserScreenshotTitle(url: string) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `Browser screenshot - ${parsed.host}${path}`;
  } catch {
    return "Browser screenshot";
  }
}

function createBrowserScreenshotId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `browser-screenshot-${crypto.randomUUID()}`;
  }

  return `browser-screenshot-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

function estimateDataUrlBytes(dataUrl: string) {
  const base64 = dataUrl.includes(",") ? dataUrl.split(",").pop() ?? "" : dataUrl;
  return Math.max(0, Math.floor((base64.length * 3) / 4));
}
