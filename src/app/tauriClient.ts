import { invoke } from "@tauri-apps/api/core";
import type { AppInfo } from "../types/app";

const fallbackAppInfo: AppInfo = {
  name: "Gilbert Codex",
  version: "0.1.0",
  phase: "Phase 1",
  runtime: "Browser preview",
};

export async function getAppInfo(): Promise<AppInfo> {
  try {
    return await invoke<AppInfo>("get_app_info");
  } catch {
    return fallbackAppInfo;
  }
}
