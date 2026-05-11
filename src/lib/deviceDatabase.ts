import { invoke } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  }
}

export interface DeviceDatabaseSeed {
  key: string;
  value: string;
}

export interface DeviceDatabaseSnapshot {
  databasePath: string;
  namespace: string;
  values: Record<string, string>;
}

export function isDeviceDatabaseAvailable() {
  return typeof window !== "undefined" && (Boolean(window.__TAURI_INTERNALS__) || Boolean(window.__TAURI__));
}

export async function loadDeviceDatabaseNamespace(namespace: string, seeds: DeviceDatabaseSeed[]) {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<DeviceDatabaseSnapshot>("gilbert_database_load", {
    namespace,
    seeds,
  });
}

export async function saveDeviceDatabaseValue(namespace: string, key: string, value: string) {
  if (!isDeviceDatabaseAvailable()) {
    return;
  }

  await invoke<void>("gilbert_database_set_value", {
    key,
    namespace,
    value,
  });
}
