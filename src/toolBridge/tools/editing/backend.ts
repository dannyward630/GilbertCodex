import {
  moveComputerPath,
  readComputerTextFile,
  writeComputerTextFile,
  type WriteComputerTextFileOptions,
} from "../../../localWorkspace/files";
import type {
  ComputerMovePathResult,
  ComputerReadFileResult,
  ComputerWriteFileResult,
} from "../../../types/localWorkspace";

export interface EditingBackend {
  movePath?: (
    fromPath: string,
    toPath: string,
    roots: string[],
    options?: { createParentDirs?: boolean },
  ) => Promise<ComputerMovePathResult>;
  readTextFile: (path: string, maxBytes?: number) => Promise<ComputerReadFileResult>;
  writeTextFile: (
    path: string,
    content: string,
    roots: string[],
    options?: WriteComputerTextFileOptions,
  ) => Promise<ComputerWriteFileResult>;
}

export const defaultEditingBackend: EditingBackend = {
  movePath: (fromPath, toPath, roots, options) => moveComputerPath(fromPath, toPath, roots, options),
  readTextFile: (path, maxBytes) => readComputerTextFile(path, maxBytes),
  writeTextFile: (path, content, roots, options) => writeComputerTextFile(path, content, roots, options),
};
