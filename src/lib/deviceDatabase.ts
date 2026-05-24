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
  engine: DeviceDatabaseEngineSummary;
  migration: DeviceDatabaseMigrationSummary;
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

export interface DeviceDatabaseEngineSummary {
  schemaVersion: string;
  journalMode: string;
  synchronous: string;
  walAutocheckpoint: number;
  quickCheck: string;
  pageSizeBytes: number;
  pageCount: number;
  freelistCount: number;
  freeBytes: number;
  walSizeBytes: number;
  shmSizeBytes: number;
}

export interface DeviceDatabaseMigrationSummary {
  targetSchemaVersion: string;
  currentSchemaVersion: string;
  status: string;
  typedChatCount: number;
  typedMessageCount: number;
  typedAgentRunCount: number;
  typedAgentRunEventCount: number;
  typedMemoryChunkCount: number;
  binaryVectorCount: number;
  legacyAgentRunBlobBytes: number;
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

export interface DeviceDatabaseBackup {
  backupPath: string;
  fileSizeBytes: number;
  createdAt: number;
}

export interface DeviceDatabaseMigrationFinalize {
  backup: DeviceDatabaseBackup;
  removedStorageKeys: string[];
  removedLegacyPaths: string[];
  failedLegacyPaths: string[];
}

export interface DeviceDatabaseAutoMigrationFinalize {
  alreadyFinalized: boolean;
  backup: DeviceDatabaseBackup | null;
  removedStorageKeys: string[];
  removedLegacyPaths: string[];
  failedLegacyPaths: string[];
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

export async function loadDeviceDatabaseChat(namespace: string, chatId: string) {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<string | null>("gilbert_database_load_chat", {
    chatId,
    namespace,
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

export async function saveDeviceDatabaseValues(namespace: string, values: DeviceDatabaseSeed[]) {
  if (!isDeviceDatabaseAvailable() || values.length === 0) {
    return;
  }

  await invoke<void>("gilbert_database_set_values", {
    namespace,
    values,
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

export async function backupDeviceDatabase() {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<DeviceDatabaseBackup>("gilbert_database_backup");
}

export async function finalizeDeviceDatabaseMigration() {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<DeviceDatabaseMigrationFinalize>("gilbert_database_finalize_migration");
}

export async function autoFinalizeDeviceDatabaseMigration() {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<DeviceDatabaseAutoMigrationFinalize>("gilbert_database_auto_finalize_migration");
}

export async function resetDeviceDatabase() {
  if (!isDeviceDatabaseAvailable()) {
    return null;
  }

  return invoke<DeviceDatabaseReset>("gilbert_database_reset");
}
