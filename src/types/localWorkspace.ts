export type LocalPermissionMode = "ask-first" | "gilbert-review" | "full-workspace" | "read-only";

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

export interface ComputerGitStatus {
  additions: number;
  ahead: number;
  available: boolean;
  behind: number;
  branch?: string;
  changedFiles: number;
  clean: boolean;
  deletions: number;
  error?: string;
  files?: ComputerGitChangedFile[];
  githubOwner?: string;
  githubRepo?: string;
  headSha?: string;
  remoteUrl?: string;
  repositoryRoot?: string;
  upstream?: string;
}

export interface ComputerGitActionResult {
  message: string;
  output?: string;
  status: ComputerGitStatus;
}

export interface ComputerGitChangedFile {
  additions: number;
  deletions: number;
  diffPreview?: ComputerGitDiffLine[];
  diffTruncated?: boolean;
  oldPath?: string;
  path: string;
  status: string;
}

export interface ComputerGitDiffLine {
  content: string;
  kind: "add" | "context" | "hunk" | "meta" | "remove";
  newLine?: number;
  oldLine?: number;
}

export interface ComputerSearchResult {
  extension?: string;
  kind: ComputerFileKind;
  line?: number;
  matchKind?: "content" | "memory" | "name" | "path" | "semantic";
  matches?: string[];
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

export interface ComputerDeleteFileResult {
  bytesDeleted: number;
  deleted: boolean;
  path: string;
}
