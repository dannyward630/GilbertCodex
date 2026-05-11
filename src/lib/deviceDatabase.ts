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

export interface LegacyDeviceStorageCleanup {
  removedPaths: string[];
}

export interface DeviceDatabaseOverview {
  databasePath: string;
  exists: boolean;
  fileSizeBytes: number;
  lastModified: number | null;
  recordCount: number;
  namespaceCount: number;
  categories: DeviceDatabaseStorageCategory[];
  records: DeviceDatabaseStorageRecord[];
  context: DeviceDatabaseContextSummary;
  legacyStorage: DeviceDatabaseLegacyStorageSummary;
}

export interface DeviceDatabaseStorageCategory {
  id: string;
  label: string;
  description: string;
  recordCount: number;
  storageBytes: number;
}

export interface DeviceDatabaseStorageRecord {
  namespace: string;
  key: string;
  label: string;
  category: string;
  sizeBytes: number;
  updatedAt: number;
  summary: string;
  sensitive: boolean;
}

export interface DeviceDatabaseContextSummary {
  chatCount: number;
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  sourceCount: number;
  imageCount: number;
  fileAttachmentCount: number;
  toolCallCount: number;
  approvalCount: number;
  artifactCount: number;
  thinkingBytes: number;
  reasoningBytes: number;
  contentBytes: number;
  estimatedTokens: number;
  contextCompactionCount: number;
  agentRunCount: number;
  agentRunStepCount: number;
  agentRunEventCount: number;
  largestChatTitle: string | null;
  largestChatBytes: number;
}

export interface DeviceDatabaseLegacyStorageSummary {
  totalBytes: number;
  files: DeviceDatabaseLegacyStorageEntry[];
}

export interface DeviceDatabaseLegacyStorageEntry {
  path: string;
  exists: boolean;
  sizeBytes: number;
}

export interface DeviceDatabaseReset {
  removedPaths: string[];
  failedPaths: string[];
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

export async function cleanupLegacyDeviceStorage() {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<LegacyDeviceStorageCleanup>("gilbert_database_cleanup_legacy_storage");
}

export async function getDeviceDatabaseOverview() {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<DeviceDatabaseOverview>("gilbert_database_get_overview");
}

export async function resetDeviceDatabase() {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<DeviceDatabaseReset>("gilbert_database_reset");
}
