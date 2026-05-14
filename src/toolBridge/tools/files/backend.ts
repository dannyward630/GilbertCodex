import {
  listComputerDirectory,
  readComputerTextFile,
} from "../../../localWorkspace/files";
import type {
  ComputerDirectoryListing,
  ComputerReadFileResult,
} from "../../../types/localWorkspace";

/**
 * Filesystem operations the read-only files family depends on. Abstracting
 * these behind a small interface keeps the tool definitions testable in Node
 * (no Tauri) and lets future hardening (sandboxing, audit logging, caching)
 * sit in one place rather than across every tool.
 */
export interface FilesBackend {
  listDirectory: (path: string, limit?: number) => Promise<ComputerDirectoryListing>;
  readTextFile: (path: string, maxBytes?: number) => Promise<ComputerReadFileResult>;
}

/**
 * Backend wired to the real local workspace helpers in
 * {@link ../../../localWorkspace/files}. Used in production; tests inject
 * their own mock.
 */
export const defaultFilesBackend: FilesBackend = {
  listDirectory: (path, limit) => listComputerDirectory(path, limit),
  readTextFile: (path, maxBytes) => readComputerTextFile(path, maxBytes),
};
