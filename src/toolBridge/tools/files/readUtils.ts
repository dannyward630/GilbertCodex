import type { ComputerDirectoryEntry, ComputerReadFileResult } from "../../../types/localWorkspace";
import type { FilesBackend } from "./backend";

const MODULE_ENTRY_NAMES = [
  "index.ts",
  "index.tsx",
  "index.js",
  "index.jsx",
  "index.mjs",
  "index.cjs",
  "mod.rs",
  "main.ts",
  "main.tsx",
  "main.js",
];

export interface RecoveredReadResult {
  file: ComputerReadFileResult;
  recoveredFrom?: string;
  recoveryNote?: string;
}

export async function readTextFileWithModuleRecovery(
  backend: FilesBackend,
  path: string,
  maxBytes?: number,
  offset?: number,
): Promise<RecoveredReadResult> {
  try {
    return {
      file: await backend.readTextFile(path, maxBytes, offset),
    };
  } catch (error) {
    const readError = readErrorMessage(error, "Could not read file.");
    const recovery = await tryRecoverModuleEntryRead(backend, path, maxBytes, offset, readError);

    if (recovery) {
      return recovery;
    }

    throw new Error(await createHelpfulReadError(backend, path, readError));
  }
}

export function formatRecoveredContent(read: RecoveredReadResult) {
  if (!read.recoveredFrom || !read.recoveryNote) {
    return read.file.content;
  }

  return [
    read.recoveryNote,
    "",
    read.file.content,
  ].join("\n");
}

export function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : fallback;
  } catch {
    return fallback;
  }
}

async function tryRecoverModuleEntryRead(
  backend: FilesBackend,
  requestedPath: string,
  maxBytes: number | undefined,
  offset: number | undefined,
  readError: string,
): Promise<RecoveredReadResult | null> {
  const candidates = createModuleDirectoryCandidates(requestedPath);

  for (const candidateDirectory of candidates) {
    const listing = await tryListDirectory(backend, candidateDirectory);

    if (!listing) {
      continue;
    }

    const entry = pickModuleEntry(listing.entries, requestedPath);

    if (!entry) {
      continue;
    }

    try {
      const file = await backend.readTextFile(entry.path, maxBytes, offset);
      return {
        file,
        recoveredFrom: requestedPath,
        recoveryNote: `Requested \`${requestedPath}\` could not be read (${readError}). Recovered module entry \`${file.path}\`.`,
      };
    } catch {
      continue;
    }
  }

  return null;
}

async function createHelpfulReadError(backend: FilesBackend, requestedPath: string, readError: string) {
  const suggestions = await createReadSuggestions(backend, requestedPath);
  return [
    `Could not read \`${requestedPath}\`: ${readError}`,
    suggestions,
  ].filter(Boolean).join("\n");
}

async function createReadSuggestions(backend: FilesBackend, requestedPath: string) {
  const directListing = await tryListDirectory(backend, requestedPath);

  if (directListing) {
    const entries = directListing.entries.slice(0, 8).map((entry) => `\`${entry.path}\``);
    return entries.length > 0
      ? `That path is a directory. Try files_read on one of: ${entries.join(", ")}`
      : "That path is an empty directory.";
  }

  const { extension, name, parent, stem } = splitPath(requestedPath);

  if (!parent) {
    return "";
  }

  const parentListing = await tryListDirectory(backend, parent);

  if (!parentListing) {
    return "";
  }

  const siblingDirectory = extension
    ? parentListing.entries.find((entry) => entry.kind === "directory" && entry.name.toLowerCase() === stem.toLowerCase())
    : undefined;

  if (siblingDirectory) {
    const childListing = await tryListDirectory(backend, siblingDirectory.path);
    const childEntries = childListing?.entries.slice(0, 8).map((entry) => `\`${entry.path}\``) ?? [];

    return childEntries.length > 0
      ? `A directory named \`${siblingDirectory.name}\` exists. Try files_read on one of: ${childEntries.join(", ")}`
      : `A directory named \`${siblingDirectory.name}\` exists, but no module entry file was found.`;
  }

  const nearMatches = parentListing.entries
    .filter((entry) => entry.name.toLowerCase().includes(stem.toLowerCase()) || stem.toLowerCase().includes(entry.name.toLowerCase()))
    .slice(0, 8)
    .map((entry) => `\`${entry.path}\``);

  if (nearMatches.length > 0) {
    return `Nearby paths: ${nearMatches.join(", ")}`;
  }

  const searchQuery = stem || name;
  return searchQuery
    ? `No nearby path matched \`${name}\`. Try files_search with query \`${searchQuery}\`, includePath=true, includeContent=false, and maxMatches=20 before answering.`
    : "";
}

function createModuleDirectoryCandidates(requestedPath: string) {
  const { extension, parent, stem } = splitPath(requestedPath);
  const candidates = [requestedPath];

  if (extension && parent) {
    candidates.push(joinPath(parent, stem));
  }

  return candidates;
}

function pickModuleEntry(entries: ComputerDirectoryEntry[], requestedPath: string) {
  const requestedExtension = splitPath(requestedPath).extension.toLowerCase();
  const preferredNames = requestedExtension
    ? [
        `index.${requestedExtension}`,
        `mod.${requestedExtension}`,
        `main.${requestedExtension}`,
        ...MODULE_ENTRY_NAMES,
      ]
    : MODULE_ENTRY_NAMES;
  const fileEntries = entries.filter((entry) => entry.kind === "file");

  for (const name of preferredNames) {
    const entry = fileEntries.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase());

    if (entry) {
      return entry;
    }
  }

  return undefined;
}

async function tryListDirectory(backend: FilesBackend, path: string) {
  try {
    return await backend.listDirectory(path);
  } catch {
    return null;
  }
}

function splitPath(path: string) {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const parent = separatorIndex >= 0 ? path.slice(0, separatorIndex) : "";
  const name = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
  const dotIndex = name.lastIndexOf(".");
  const hasExtension = dotIndex > 0 && dotIndex < name.length - 1;

  return {
    extension: hasExtension ? name.slice(dotIndex + 1) : "",
    name,
    parent,
    stem: hasExtension ? name.slice(0, dotIndex) : name,
  };
}

function joinPath(parent: string, child: string) {
  const separator = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return `${parent.replace(/[\\/]+$/, "")}${separator}${child.replace(/^[\\/]+/, "")}`;
}
