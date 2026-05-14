import {
  listComputerDirectory,
  readComputerTextFile,
} from "../../../localWorkspace/files";
import type {
  ComputerDirectoryListing,
  ComputerReadFileResult,
} from "../../../types/localWorkspace";

// Filesystem operations used by read-only file tools, abstracted for tests and future hardening.
export interface FilesBackend {
  listDirectory: (path: string, limit?: number) => Promise<ComputerDirectoryListing>;
  readTextFile: (path: string, maxBytes?: number, offset?: number) => Promise<ComputerReadFileResult>;
}

// Production backend wired to local workspace helpers; tests inject their own mock.
export const defaultFilesBackend: FilesBackend = {
  listDirectory: (path, limit) => listComputerDirectory(path, limit),
  readTextFile: (path, maxBytes, offset) => readComputerTextFile(path, maxBytes, offset),
};
