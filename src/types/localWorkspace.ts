export type LocalPermissionMode = "ask-first" | "gilbert-review" | "full-workspace";

export type LocalWorkspaceScope = "current-folder" | "selected-folder" | "full-computer";
export type LocalWorkspaceIndexStatus = "idle" | "indexing" | "error";

export interface LocalWorkspaceSettings {
  enabled: boolean;
  indexReason?: string;
  indexSummary?: ComputerFileIndexSummary;
  indexStatus?: LocalWorkspaceIndexStatus;
  indexUpdatedAt?: string;
  lastError?: string;
  permissionMode: LocalPermissionMode;
  roots: string[];
  scope: LocalWorkspaceScope;
}

export interface ComputerDrive {
  available: boolean;
  kind: string;
  label: string;
  name: string;
  path: string;
}

export type ComputerFileKind = "directory" | "file" | "symlink" | "other";

export interface ComputerDirectoryEntry {
  extension?: string;
  kind: ComputerFileKind;
  modifiedAt?: number;
  name: string;
  path: string;
  size?: number;
}

export interface ComputerDirectoryListing {
  entries: ComputerDirectoryEntry[];
  inaccessibleEntries: number;
  limited: boolean;
  parentPath?: string;
  path: string;
}

export interface ComputerFileIndexSummary {
  builtAt?: number;
  entryCount: number;
  roots: string[];
  scannedDirectories: number;
  skippedEntries: number;
  truncated: boolean;
}

export interface ComputerFileIndexProgress {
  currentPath?: string;
  done: boolean;
  entryCount: number;
  requestId: number;
  roots: string[];
  scannedDirectories: number;
  skippedEntries: number;
  truncated: boolean;
}

export interface ComputerSearchResult {
  extension?: string;
  kind: ComputerFileKind;
  modifiedAt?: number;
  name: string;
  path: string;
  preview?: string;
  score: number;
  size?: number;
}

export interface ComputerReadFileResult {
  content: string;
  extension?: string;
  modifiedAt?: number;
  name: string;
  path: string;
  size: number;
  truncated: boolean;
}

export interface ComputerWriteFileResult {
  bytesWritten: number;
  created: boolean;
  modifiedAt?: number;
  path: string;
}
