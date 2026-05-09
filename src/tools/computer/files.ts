import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauriDesktopRuntime } from "../../app/tauriClient";
import type {
  ComputerDirectoryListing,
  ComputerDrive,
  ComputerFileIndexProgress,
  ComputerFileIndexSummary,
  ComputerReadFileResult,
  ComputerSearchResult,
  ComputerWriteFileResult,
  LocalPermissionMode,
  LocalWorkspaceScope,
  LocalWorkspaceSettings,
} from "../../types/localWorkspace";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ToolRegistrySettings } from "../../types/tools";

const DEFAULT_FOLDER_INDEX_LIMIT = 12_000;
const DEFAULT_FULL_COMPUTER_INDEX_LIMIT = 25_000;
const DEFAULT_FOLDER_DEPTH = 18;
const DEFAULT_FULL_COMPUTER_DEPTH = 9;
const MAX_CONTEXT_CHARS = 26_000;
const MAX_GILBERT_MEMORY_CHARS = 16_000;
const MAX_GILBERT_MEMORY_IMPORT_DEPTH = 5;
const MAX_SNIPPET_CHARS = 2_600;
const COMPUTER_FILE_INDEX_PROGRESS_EVENT = "computer-file-index-progress";
export const GILBERT_PROJECT_MEMORY_FILE = "GILBERT.md";

interface GilbertProjectMemory {
  content: string;
  path: string;
}

type BrowserDirectoryHandle = {
  entries?: () => AsyncIterable<[string, BrowserFileSystemHandle]>;
  getDirectoryHandle?: (name: string, options?: { create?: boolean }) => Promise<BrowserDirectoryHandle>;
  getFileHandle?: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>;
  kind: "directory";
  name: string;
  values?: () => AsyncIterable<BrowserFileSystemHandle>;
};

type BrowserFileHandle = {
  createWritable?: () => Promise<{
    close: () => Promise<void>;
    write: (data: string) => Promise<void>;
  }>;
  getFile: () => Promise<File>;
  kind: "file";
  name: string;
};

type BrowserFileSystemHandle = BrowserDirectoryHandle | BrowserFileHandle;

interface BrowserWorkspaceRoot {
  handle: BrowserDirectoryHandle;
  name: string;
  path: string;
}

interface BrowserIndexedEntry extends ComputerSearchResult {
  content?: string;
  haystack: string;
}

const BROWSER_WORKSPACE_PREFIX = "browser-folder://";
const browserWorkspaceRoots = new Map<string, BrowserWorkspaceRoot>();
let browserIndexEntries: BrowserIndexedEntry[] = [];
let browserIndexSummary: ComputerFileIndexSummary = {
  builtAt: undefined,
  entryCount: 0,
  roots: [],
  scannedDirectories: 0,
  skippedEntries: 0,
  truncated: false,
};

export async function getDefaultComputerWorkspace() {
  if (!isTauriDesktopRuntime()) {
    return browserWorkspaceRoots.keys().next().value ?? "";
  }

  return (await invoke<string | null>("computer_get_default_workspace")) ?? "";
}

export async function listComputerDrives() {
  if (!isTauriDesktopRuntime()) {
    return Array.from(browserWorkspaceRoots.values()).map((root) => ({
      available: true,
      kind: "browser-folder",
      label: root.name,
      name: root.name,
      path: root.path,
    })) satisfies ComputerDrive[];
  }

  return await invoke<ComputerDrive[]>("computer_list_drives");
}

export async function pickComputerFolder(startPath?: string) {
  if (!isTauriDesktopRuntime()) {
    return await pickBrowserFolder();
  }

  return await invoke<string | null>("computer_pick_folder", {
    startPath,
  });
}

export async function registerBrowserDroppedFolders(dataTransfer: DataTransfer) {
  if (isTauriDesktopRuntime()) {
    return [];
  }

  const roots: string[] = [];

  for (const item of Array.from(dataTransfer.items)) {
    const getHandle = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<BrowserFileSystemHandle | null> }).getAsFileSystemHandle;

    if (!getHandle || item.kind !== "file") {
      continue;
    }

    const handle = await getHandle.call(item);

    if (handle?.kind === "directory") {
      roots.push(registerBrowserWorkspaceRoot(handle));
    }
  }

  return roots;
}

export async function listenForComputerFolderDrops(onDrop: (paths: string[]) => void, onHover?: (hovering: boolean) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await getCurrentWebview().onDragDropEvent((event) => {
    const payload = event.payload;

    if (payload.type === "enter" || payload.type === "over") {
      onHover?.(true);
      return;
    }

    if (payload.type === "leave") {
      onHover?.(false);
      return;
    }

    onHover?.(false);
    onDrop(payload.paths);
  });
}

export async function listComputerDirectory(path: string, limit = 600) {
  if (isBrowserWorkspacePath(path)) {
    return await listBrowserDirectory(path, limit);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Open or drop a folder first so Gilbert can browse it.");
  }

  return await invoke<ComputerDirectoryListing>("computer_list_directory", {
    request: {
      limit,
      path,
    },
  });
}

export async function buildComputerFileIndex(roots: string[], scope: LocalWorkspaceScope, requestId = Date.now()) {
  const fullComputer = scope === "full-computer";

  if (!isTauriDesktopRuntime() || roots.some(isBrowserWorkspacePath)) {
    return await buildBrowserFileIndex(roots, fullComputer ? DEFAULT_FULL_COMPUTER_DEPTH : DEFAULT_FOLDER_DEPTH, fullComputer ? DEFAULT_FULL_COMPUTER_INDEX_LIMIT : DEFAULT_FOLDER_INDEX_LIMIT);
  }

  return await invoke<ComputerFileIndexSummary>("computer_build_file_index", {
    request: {
      maxDepth: fullComputer ? DEFAULT_FULL_COMPUTER_DEPTH : DEFAULT_FOLDER_DEPTH,
      maxFiles: fullComputer ? DEFAULT_FULL_COMPUTER_INDEX_LIMIT : DEFAULT_FOLDER_INDEX_LIMIT,
      requestId,
      roots,
    },
  });
}

export async function listenForComputerFileIndexProgress(onProgress: (progress: ComputerFileIndexProgress) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<ComputerFileIndexProgress>(COMPUTER_FILE_INDEX_PROGRESS_EVENT, (event) => {
    onProgress(event.payload);
  });
}

export async function getComputerFileIndexSummary() {
  if (!isTauriDesktopRuntime()) {
    return browserIndexSummary;
  }

  return await invoke<ComputerFileIndexSummary>("computer_get_file_index_summary");
}

export async function searchComputerFiles(query: string, limit = 24) {
  if (!isTauriDesktopRuntime()) {
    return searchBrowserFileIndex(query, limit);
  }

  return await invoke<ComputerSearchResult[]>("computer_search_file_index", {
    request: {
      limit,
      query,
    },
  });
}

export async function readComputerTextFile(path: string, maxBytes = 32 * 1024) {
  if (isBrowserWorkspacePath(path)) {
    return await readBrowserTextFile(path, maxBytes);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Open or drop a folder first so Gilbert can read files.");
  }

  return await invoke<ComputerReadFileResult>("computer_read_text_file", {
    request: {
      maxBytes,
      path,
    },
  });
}

export async function writeComputerTextFile(path: string, content: string, roots: string[], options: { createParentDirs?: boolean; overwrite?: boolean } = {}) {
  if (isBrowserWorkspacePath(path)) {
    return await writeBrowserTextFile(path, content, roots, options);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Use the desktop app or open a browser folder before writing files.");
  }

  return await invoke<ComputerWriteFileResult>("computer_write_text_file", {
    request: {
      content,
      createParentDirs: options.createParentDirs ?? false,
      overwrite: options.overwrite ?? true,
      path,
      roots,
    },
  });
}

export async function resolveLocalWorkspaceRoots(settings: LocalWorkspaceSettings) {
  if (!settings.enabled) {
    return [];
  }

  if (settings.scope === "full-computer") {
    if (!isTauriDesktopRuntime() && settings.roots.length > 0) {
      return settings.roots;
    }

    const drives = await listComputerDrives();
    return drives.map((drive) => drive.path);
  }

  if (settings.roots.length > 0) {
    return settings.roots;
  }

  const defaultWorkspace = await getDefaultComputerWorkspace();
  return defaultWorkspace ? [defaultWorkspace] : [];
}

export async function createLocalWorkspaceContext(settings: LocalWorkspaceSettings, prompt: string, toolSettings?: ToolRegistrySettings) {
  if (!settings.enabled) {
    return "";
  }

  const roots = await resolveLocalWorkspaceRoots(settings);

  if (roots.length === 0) {
    return createWorkspaceHeader(settings, [], undefined, "No readable roots are selected yet.", toolSettings);
  }

  const summary = await ensureComputerFileIndex(settings, roots);
  const projectMemories = await readGilbertProjectMemories(roots);
  const searchResults = await searchComputerFiles(prompt, 18).catch(() => []);
  const hintedFolders = await resolvePromptFolders(prompt, roots);
  const listings = await Promise.all(
    uniquePaths([...hintedFolders, ...roots.slice(0, settings.scope === "full-computer" ? 6 : 3)]).map(async (root) => {
      try {
        return await listComputerDirectory(root, 80);
      } catch {
        return null;
      }
    }),
  );
  const snippets = await collectTextSnippets(searchResults);

  return limitContext(
    [
      createWorkspaceHeader(settings, roots, summary, undefined, toolSettings),
      formatGilbertProjectMemories(projectMemories),
      formatRootListings(listings.flatMap((listing) => (listing ? [listing] : []))),
      formatSearchResults(searchResults),
      formatTextSnippets(snippets),
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

export function localPermissionModeLabel(mode: LocalPermissionMode) {
  if (mode === "ask-first") {
    return "Ask first";
  }

  if (mode === "full-workspace") {
    return "Full workspace";
  }

  return "Gilbert review";
}

export function localWorkspaceScopeLabel(scope: LocalWorkspaceScope) {
  if (scope === "full-computer") {
    return "Full computer";
  }

  if (scope === "selected-folder") {
    return "Selected folder";
  }

  return "Current folder";
}

export function formatIndexSummary(summary?: ComputerFileIndexSummary) {
  if (!summary || summary.entryCount === 0) {
    return "Not indexed";
  }

  const entryCount = new Intl.NumberFormat().format(summary.entryCount);
  const suffix = summary.truncated ? " indexed, capped for speed" : " indexed";
  return `${entryCount}${suffix}`;
}

export function formatLocalWorkspaceIndexStatus(settings: LocalWorkspaceSettings) {
  if (settings.indexStatus === "indexing") {
    return settings.indexReason || "Indexing...";
  }

  if (settings.indexStatus === "error") {
    return "Index failed";
  }

  return formatIndexSummary(settings.indexSummary);
}

async function pickBrowserFolder() {
  const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: "read" | "readwrite" }) => Promise<BrowserDirectoryHandle> }).showDirectoryPicker;

  if (!picker) {
    throw new Error("This browser cannot open folders directly. Use the desktop app or type a folder path there.");
  }

  const handle = await picker.call(window, { mode: "readwrite" });
  return registerBrowserWorkspaceRoot(handle);
}

function registerBrowserWorkspaceRoot(handle: BrowserDirectoryHandle) {
  const path = createBrowserWorkspacePath(handle.name);

  browserWorkspaceRoots.set(path, {
    handle,
    name: handle.name,
    path,
  });

  return path;
}

async function listBrowserDirectory(path: string, limit: number): Promise<ComputerDirectoryListing> {
  const resolved = await resolveBrowserDirectory(path);
  const entries: ComputerDirectoryListing["entries"] = [];
  let inaccessibleEntries = 0;
  let limited = false;

  for await (const handle of iterateDirectoryHandles(resolved.handle)) {
    if (entries.length >= limit) {
      limited = true;
      break;
    }

    try {
      const entryPath = joinBrowserPath(resolved.path, handle.name);

      if (handle.kind === "directory") {
        entries.push({
          kind: "directory",
          name: handle.name,
          path: entryPath,
        });
      } else {
        const file = await handle.getFile();

        entries.push({
          extension: fileExtensionFromName(handle.name),
          kind: "file",
          modifiedAt: file.lastModified,
          name: handle.name,
          path: entryPath,
          size: file.size,
        });
      }
    } catch {
      inaccessibleEntries += 1;
    }
  }

  entries.sort((left, right) => {
    const leftRank = left.kind === "directory" ? 0 : 1;
    const rightRank = right.kind === "directory" ? 0 : 1;
    return leftRank - rightRank || left.name.toLowerCase().localeCompare(right.name.toLowerCase());
  });

  return {
    entries,
    inaccessibleEntries,
    limited,
    parentPath: browserParentPath(resolved.path),
    path: resolved.path,
  };
}

async function buildBrowserFileIndex(roots: string[], maxDepth: number, maxFiles: number): Promise<ComputerFileIndexSummary> {
  const rootPaths = uniquePaths(roots.filter(isBrowserWorkspacePath));
  const nextEntries: BrowserIndexedEntry[] = [];
  let scannedDirectories = 0;
  let skippedEntries = 0;
  let truncated = false;

  for (const rootPath of rootPaths) {
    try {
      const root = await resolveBrowserDirectory(rootPath);
      const queue: Array<{ depth: number; handle: BrowserDirectoryHandle; path: string }> = [{ depth: 0, handle: root.handle, path: root.path }];

      while (queue.length > 0) {
        const item = queue.shift()!;
        scannedDirectories += 1;

        for await (const handle of iterateDirectoryHandles(item.handle)) {
          if (nextEntries.length >= maxFiles) {
            truncated = true;
            break;
          }

          const entryPath = joinBrowserPath(item.path, handle.name);

          if (handle.kind === "directory") {
            nextEntries.push({
              haystack: `${handle.name} ${entryPath}`.toLowerCase(),
              kind: "directory",
              name: handle.name,
              path: entryPath,
              score: 0,
            });

            if (item.depth < maxDepth) {
              queue.push({ depth: item.depth + 1, handle, path: entryPath });
            }
          } else {
            try {
              const file = await handle.getFile();
              const extension = fileExtensionFromName(handle.name);
              const content = shouldReadBrowserFile(file) ? await readFilePreview(file, 16 * 1024) : "";
              const preview = content ? content.split(/\r?\n/).slice(0, 18).join("\n") : undefined;

              nextEntries.push({
                content,
                extension,
                haystack: `${handle.name} ${entryPath} ${extension ?? ""} ${preview ?? ""}`.toLowerCase(),
                kind: "file",
                modifiedAt: file.lastModified,
                name: handle.name,
                path: entryPath,
                preview,
                score: 0,
                size: file.size,
              });
            } catch {
              skippedEntries += 1;
            }
          }
        }

        if (truncated) {
          break;
        }
      }
    } catch {
      skippedEntries += 1;
    }

    if (truncated) {
      break;
    }
  }

  browserIndexEntries = nextEntries;
  browserIndexSummary = {
    builtAt: Date.now(),
    entryCount: nextEntries.length,
    roots: rootPaths,
    scannedDirectories,
    skippedEntries,
    truncated,
  };

  return browserIndexSummary;
}

function searchBrowserFileIndex(query: string, limit: number) {
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    return [];
  }

  return browserIndexEntries
    .map((entry) => ({
      ...entry,
      score: scoreBrowserEntry(entry, tokens),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map(({ content, haystack, ...entry }) => entry);
}

async function readBrowserTextFile(path: string, maxBytes: number): Promise<ComputerReadFileResult> {
  const { file, handle } = await resolveBrowserFile(path);
  const content = await readFilePreview(file, maxBytes);

  return {
    content,
    extension: fileExtensionFromName(handle.name),
    modifiedAt: file.lastModified,
    name: handle.name,
    path,
    size: file.size,
    truncated: file.size > maxBytes,
  };
}

async function writeBrowserTextFile(
  path: string,
  content: string,
  roots: string[],
  options: { createParentDirs?: boolean; overwrite?: boolean },
): Promise<ComputerWriteFileResult> {
  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    throw new Error("Writes are only allowed inside the selected browser folder.");
  }

  const { parts, root } = resolveBrowserRoot(path);

  if (parts.length === 0) {
    throw new Error("Choose a file path, not the folder root.");
  }

  const fileName = parts[parts.length - 1];
  let directoryHandle = root.handle;
  let resolvedPath = root.path;

  for (const part of parts.slice(0, -1)) {
    if (!directoryHandle.getDirectoryHandle) {
      throw new Error("This browser cannot create folders in that workspace.");
    }

    directoryHandle = await directoryHandle.getDirectoryHandle(part, { create: options.createParentDirs ?? false });
    resolvedPath = joinBrowserPath(resolvedPath, part);
  }

  if (!directoryHandle.getFileHandle) {
    throw new Error("This browser cannot write that file.");
  }

  let created = false;

  try {
    await directoryHandle.getFileHandle(fileName);

    if (options.overwrite === false) {
      throw new Error("That file already exists and overwrite is disabled.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("overwrite is disabled")) {
      throw error;
    }

    created = true;
  }

  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });

  if (!fileHandle.createWritable) {
    throw new Error("This browser did not grant write access to that folder.");
  }

  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();

  return {
    bytesWritten: new TextEncoder().encode(content).byteLength,
    created,
    modifiedAt: Date.now(),
    path: joinBrowserPath(resolvedPath, fileName),
  };
}

async function ensureComputerFileIndex(settings: LocalWorkspaceSettings, roots: string[]) {
  const currentSummary = await getComputerFileIndexSummary().catch(() => undefined);

  if (currentSummary && currentSummary.entryCount > 0 && sameRootSet(currentSummary.roots, roots)) {
    return currentSummary;
  }

  return await buildComputerFileIndex(roots, settings.scope);
}

async function collectTextSnippets(searchResults: ComputerSearchResult[]) {
  const snippets: ComputerReadFileResult[] = [];
  const textResults = searchResults.filter((result) => result.kind === "file" && isProbablyTextExtension(result.extension)).slice(0, 4);

  for (const result of textResults) {
    try {
      snippets.push(await readComputerTextFile(result.path, 16 * 1024));
    } catch {
      continue;
    }
  }

  return snippets;
}

function createWorkspaceHeader(settings: LocalWorkspaceSettings, roots: string[], summary?: ComputerFileIndexSummary, issue?: string, toolSettings?: ToolRegistrySettings) {
  const tools = normalizeToolRegistrySettings(toolSettings);
  const runtimeTools = [
    tools.codeView ? "view_code" : "",
    tools.codeView ? "read_file" : "",
    tools.fileBrowser ? "list_directory" : "",
    tools.fileSearch ? "search_files" : "",
    tools.fileBrowser ? "build_index" : "",
    tools.codeEdit ? "edit_file" : "",
    tools.codeEdit ? "write_file" : "",
  ].filter(Boolean);
  const permissionRules = {
    "ask-first": "Ask before editing, deleting, moving, or running anything. Viewing and indexing are allowed.",
    "gilbert-review": "Read and review freely inside the selected workspace roots. File changes must stay inside those roots and should call out risk.",
    "full-workspace": "Read/write is allowed inside the current or selected folder workspace. Full computer scope stays read-only.",
  } satisfies Record<LocalPermissionMode, string>;

  return [
    "LOCAL COMPUTER FILE TOOL",
    "Tool access: Gilbert can view drives, open folders, read text files, use the local vector file index, and make precise workspace edits when local work is enabled.",
      `Runtime tools enabled from Toolbox: ${runtimeTools.length > 0 ? runtimeTools.join(", ") : "none"}.`,
      `${GILBERT_PROJECT_MEMORY_FILE}: When present in a workspace root, Gilbert loads it like project memory for architecture notes, commands, style rules, and workflow preferences. @path imports are followed up to ${MAX_GILBERT_MEMORY_IMPORT_DEPTH} levels.`,
      "Full computer scope is read-only. File edits and writes are only allowed inside the current or selected folder workspace, and Ask first mode requires user confirmation before writes.",
      "Use search_files to locate code through the vector index, view_code for exact line/character windows, and edit_file for focused replacements down to a single letter or punctuation mark.",
    "If more file evidence is needed, request a compact <tool_call> for the app to execute. The app shows tool calls in Activity; final answers should explain the result clearly.",
    "Use the local context below as real computer file evidence. Do not claim you cannot access files when this tool context is present.",
    `Mode: ${localPermissionModeLabel(settings.permissionMode)}`,
    `Scope: ${localWorkspaceScopeLabel(settings.scope)}`,
    `Roots: ${roots.length > 0 ? roots.join(" | ") : "none"}`,
    `Index: ${summary ? `${summary.entryCount} entries, ${summary.scannedDirectories} folders scanned, ${summary.skippedEntries} skipped${summary.truncated ? ", capped for speed" : ""}` : "not built"}`,
    `Permission rule: ${permissionRules[settings.permissionMode]}`,
    issue ? `Tool note: ${issue}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function createGilbertProjectMemoryTemplate() {
  return [
    "# Gilbert Project Instructions",
    "",
    "Use this file for project memory that Gilbert should load whenever this folder is selected.",
    "",
    "## Project Overview",
    "- Describe what this project does.",
    "",
    "## Commands",
    "- Build:",
    "- Test:",
    "- Lint:",
    "",
    "## Coding Standards",
    "- Keep changes scoped and consistent with the existing codebase.",
    "",
    "## Notes",
    "- Add architecture details, important folders, environment setup, or gotchas here.",
  ].join("\n");
}

export async function readGilbertProjectMemories(roots: string[]) {
  const visited = new Set<string>();
  const memories: GilbertProjectMemory[] = [];
  let remainingChars = MAX_GILBERT_MEMORY_CHARS;

  for (const root of roots.slice(0, 8)) {
    const candidates = [
      joinPathParts(root, [GILBERT_PROJECT_MEMORY_FILE]),
      joinPathParts(root, ["Gilbert.md"]),
      joinPathParts(root, [".gilbert", GILBERT_PROJECT_MEMORY_FILE]),
      joinPathParts(root, [".gilbert", "Gilbert.md"]),
    ];

    for (const candidate of candidates) {
      if (remainingChars <= 0) {
        return memories;
      }

      const loaded = await readGilbertMemoryFile(candidate, visited, 0, remainingChars);

      for (const memory of loaded) {
        if (remainingChars <= 0) {
          return memories;
        }

        const content = memory.content.slice(0, remainingChars);
        memories.push({
          ...memory,
          content,
        });
        remainingChars -= content.length;
      }
    }
  }

  return memories;
}

async function readGilbertMemoryFile(path: string, visited: Set<string>, depth: number, remainingChars: number): Promise<GilbertProjectMemory[]> {
  const key = normalizePathKey(path);

  if (!key || visited.has(key) || depth > MAX_GILBERT_MEMORY_IMPORT_DEPTH || remainingChars <= 0) {
    return [];
  }

  visited.add(key);

  try {
    const file = await readComputerTextFile(path, Math.min(64 * 1024, Math.max(4 * 1024, remainingChars)));
    const content = file.content.slice(0, remainingChars);
    const memories: GilbertProjectMemory[] = [{ content, path: file.path }];
    let importBudget = remainingChars - content.length;

    for (const importPath of extractGilbertMemoryImports(content)) {
      if (importBudget <= 0) {
        break;
      }

      const resolvedImportPath = resolveGilbertMemoryImportPath(file.path, importPath);
      const imported = await readGilbertMemoryFile(resolvedImportPath, visited, depth + 1, importBudget);

      for (const memory of imported) {
        memories.push(memory);
        importBudget -= memory.content.length;
      }
    }

    return memories;
  } catch {
    return [];
  }
}

function extractGilbertMemoryImports(content: string) {
  const imports: string[] = [];
  let inFence = false;

  for (const line of content.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const importRegex = /(?:^|\s)@([^\s`]+)/g;
    let match: RegExpExecArray | null;

    while ((match = importRegex.exec(line))) {
      const value = match[1].replace(/[),.;:]+$/, "");

      if (value && !value.includes("://")) {
        imports.push(value);
      }
    }
  }

  return imports;
}

function resolveGilbertMemoryImportPath(memoryPath: string, importPath: string) {
  if (isAbsoluteLocalPath(importPath) || isBrowserWorkspacePath(importPath)) {
    return importPath;
  }

  return joinPathParts(directoryName(memoryPath), importPath.split(/[\\/]+/).filter(Boolean));
}

function isAbsoluteLocalPath(path: string) {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

function directoryName(path: string) {
  const lastBackslash = path.lastIndexOf("\\");
  const lastSlash = path.lastIndexOf("/");
  const index = Math.max(lastBackslash, lastSlash);

  return index > 0 ? path.slice(0, index) : path;
}

function formatGilbertProjectMemories(memories: GilbertProjectMemory[]) {
  if (memories.length === 0) {
    return "";
  }

  return [
    "GILBERT PROJECT MEMORY",
    "The following Markdown files are loaded like project instructions. Follow them unless they conflict with explicit user instructions or safety rules.",
    ...memories.map((memory) => `--- ${memory.path}\n${memory.content}`),
  ].join("\n\n");
}

function formatRootListings(listings: ComputerDirectoryListing[]) {
  if (listings.length === 0) {
    return "";
  }

  return [
    "ROOT DIRECTORY SNAPSHOT",
    ...listings.map((listing) => {
      const rows = listing.entries.slice(0, 26).map((entry) => {
        const marker = entry.kind === "directory" ? "[dir]" : "[file]";
        return `${marker} ${entry.path}`;
      });
      return [`${listing.path}${listing.limited ? " (limited)" : ""}`, ...rows].join("\n");
    }),
  ].join("\n\n");
}

async function resolvePromptFolders(prompt: string, roots: string[]) {
  const normalizedPrompt = prompt.toLowerCase();
  const folders: string[] = [];

  if (!isTauriDesktopRuntime()) {
    const matchingRoots = roots.filter((root) => {
      const key = decodeURIComponent(root).toLowerCase();
      return (
        (normalizedPrompt.includes("document") && key.includes("document")) ||
        (normalizedPrompt.includes("desktop") && key.includes("desktop")) ||
        (normalizedPrompt.includes("download") && key.includes("download"))
      );
    });
    folders.push(...(matchingRoots.length > 0 ? matchingRoots : roots.slice(0, 3)));
  }

  const defaultWorkspace = await getDefaultComputerWorkspace().catch(() => "");
  const documentsFolder = defaultWorkspace ? inferKnownFolder(defaultWorkspace, "Documents") : "";
  const userFolder = documentsFolder ? parentPath(documentsFolder) : defaultWorkspace ? parentPath(parentPath(defaultWorkspace)) : "";
  const cDrive = roots.find((root) => normalizePathKey(root) === "c:") || roots.find((root) => normalizePathKey(root).startsWith("c:"));

  if (normalizedPrompt.includes("document")) {
    pushIfPresent(folders, documentsFolder);
  }

  if (normalizedPrompt.includes("desktop")) {
    pushIfPresent(folders, joinPath(userFolder, "Desktop"));
  }

  if (normalizedPrompt.includes("download")) {
    pushIfPresent(folders, joinPath(userFolder, "Downloads"));
  }

  if (normalizedPrompt.includes("drive") || normalizedPrompt.includes("c drive") || normalizedPrompt.includes("c:")) {
    pushIfPresent(folders, cDrive);
  }

  const readable = await Promise.all(
    folders.map(async (folder) => {
      try {
        await listComputerDirectory(folder, 1);
        return folder;
      } catch {
        return "";
      }
    }),
  );

  return uniquePaths(readable.filter(Boolean));
}

function inferKnownFolder(defaultWorkspace: string, folderName: string) {
  const parts = splitPath(defaultWorkspace);
  const index = parts.findIndex((part) => part.toLowerCase() === folderName.toLowerCase());

  if (index < 0) {
    return "";
  }

  return pathFromParts(parts.slice(0, index + 1), defaultWorkspace);
}

function parentPath(path: string) {
  const parts = splitPath(path);

  if (parts.length <= 1) {
    return path;
  }

  return pathFromParts(parts.slice(0, -1), path);
}

function joinPath(root: string, child: string) {
  if (!root) {
    return "";
  }

  const separator = root.includes("\\") ? "\\" : "/";
  return `${root.replace(/[\\/]+$/, "")}${separator}${child}`;
}

function joinPathParts(root: string, parts: string[]) {
  return parts.reduce((path, part) => joinPath(path, part), root);
}

function splitPath(path: string) {
  return path.split(/[\\/]+/).filter(Boolean);
}

function pathFromParts(parts: string[], originalPath: string) {
  if (originalPath.includes("\\")) {
    const first = parts[0]?.endsWith(":") ? parts[0] : "";
    const rest = first ? parts.slice(1) : parts;
    return first ? `${first}\\${rest.join("\\")}` : rest.join("\\");
  }

  return originalPath.startsWith("/") ? `/${parts.join("/")}` : parts.join("/");
}

function pushIfPresent(values: string[], value?: string) {
  if (value) {
    values.push(value);
  }
}

function formatSearchResults(results: ComputerSearchResult[]) {
  if (results.length === 0) {
    return "VECTOR SEARCH RESULTS\nNo local file matches were found for this request yet.";
  }

  return [
    "VECTOR SEARCH RESULTS",
    ...results.slice(0, 18).map((result, index) => {
      const preview = result.preview ? `\n  preview: ${result.preview.replace(/\s+/g, " ").slice(0, 260)}` : "";
      return `${index + 1}. ${result.path} (${result.kind}, score ${result.score.toFixed(3)})${preview}`;
    }),
  ].join("\n");
}

function formatTextSnippets(snippets: ComputerReadFileResult[]) {
  if (snippets.length === 0) {
    return "";
  }

  return [
    "READABLE FILE SNIPPETS",
    ...snippets.map((snippet) => {
      const content = snippet.content.slice(0, MAX_SNIPPET_CHARS);
      return `--- ${snippet.path}${snippet.truncated ? " (truncated)" : ""}\n${content}`;
    }),
  ].join("\n\n");
}

function createBrowserWorkspacePath(name: string) {
  const safeName = encodeURIComponent(name || "Folder");
  let path = `${BROWSER_WORKSPACE_PREFIX}${safeName}`;
  let suffix = 2;

  while (browserWorkspaceRoots.has(path)) {
    path = `${BROWSER_WORKSPACE_PREFIX}${safeName}-${suffix}`;
    suffix += 1;
  }

  return path;
}

function isBrowserWorkspacePath(path: string) {
  return path.startsWith(BROWSER_WORKSPACE_PREFIX);
}

async function resolveBrowserDirectory(path: string): Promise<{ handle: BrowserDirectoryHandle; path: string; root: BrowserWorkspaceRoot }> {
  const { parts, root } = resolveBrowserRoot(path);
  let handle = root.handle;
  let resolvedPath = root.path;

  for (const part of parts) {
    if (!handle.getDirectoryHandle) {
      throw new Error("This browser cannot open that folder.");
    }

    handle = await handle.getDirectoryHandle(part);
    resolvedPath = joinBrowserPath(resolvedPath, part);
  }

  return { handle, path: resolvedPath, root };
}

async function resolveBrowserFile(path: string): Promise<{ file: File; handle: BrowserFileHandle; root: BrowserWorkspaceRoot }> {
  const { parts, root } = resolveBrowserRoot(path);

  if (parts.length === 0) {
    throw new Error("Choose a file, not the folder root.");
  }

  const fileName = parts[parts.length - 1];
  let directoryHandle = root.handle;

  for (const part of parts.slice(0, -1)) {
    if (!directoryHandle.getDirectoryHandle) {
      throw new Error("This browser cannot open that folder.");
    }

    directoryHandle = await directoryHandle.getDirectoryHandle(part);
  }

  if (!directoryHandle.getFileHandle) {
    throw new Error("This browser cannot read that file.");
  }

  const handle = await directoryHandle.getFileHandle(fileName);
  return { file: await handle.getFile(), handle, root };
}

function resolveBrowserRoot(path: string) {
  const normalizedPath = path.replace(/[\\/]+/g, "/");
  const root = Array.from(browserWorkspaceRoots.values())
    .sort((left, right) => right.path.length - left.path.length)
    .find((candidate) => normalizedPath === candidate.path || normalizedPath.startsWith(`${candidate.path}/`));

  if (!root) {
    throw new Error("Open or drop that folder again so Gilbert can access it.");
  }

  const relativePath = normalizedPath.slice(root.path.length).replace(/^\/+/, "");
  const parts = relativePath ? relativePath.split("/").map(decodeURIComponent) : [];
  return { parts, root };
}

async function* iterateDirectoryHandles(handle: BrowserDirectoryHandle): AsyncIterable<BrowserFileSystemHandle> {
  if (handle.values) {
    for await (const child of handle.values()) {
      yield child;
    }
    return;
  }

  if (handle.entries) {
    for await (const [, child] of handle.entries()) {
      yield child;
    }
  }
}

function joinBrowserPath(root: string, child: string) {
  return `${root.replace(/\/+$/, "")}/${encodeURIComponent(child)}`;
}

function browserParentPath(path: string) {
  const normalizedPath = path.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  const root = Array.from(browserWorkspaceRoots.values()).find((candidate) => normalizedPath === candidate.path || normalizedPath.startsWith(`${candidate.path}/`));

  if (!root || normalizedPath === root.path) {
    return undefined;
  }

  return normalizedPath.slice(0, normalizedPath.lastIndexOf("/"));
}

function fileExtensionFromName(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 && index < name.length - 1 ? name.slice(index + 1).toLowerCase() : undefined;
}

function shouldReadBrowserFile(file: File) {
  return file.size <= 1_500_000 && isProbablyTextExtension(fileExtensionFromName(file.name));
}

async function readFilePreview(file: File, maxBytes: number) {
  const text = await file.slice(0, maxBytes).text();

  if (text.includes("\u0000")) {
    throw new Error("This file looks binary, so Gilbert did not load it as text.");
  }

  return text;
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_:-]+/i)
    .map((token) => token.trim())
    .filter((token) => token.length > 1);
}

function scoreBrowserEntry(entry: BrowserIndexedEntry, tokens: string[]) {
  let score = 0;

  for (const token of tokens) {
    if (entry.name.toLowerCase().includes(token)) {
      score += 1.4;
    }

    if (entry.path.toLowerCase().includes(token)) {
      score += 0.9;
    }

    if (entry.haystack.includes(token)) {
      score += 0.45;
    }
  }

  return score / Math.max(tokens.length, 1);
}

function sameRootSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const normalizedLeft = left.map(normalizePathKey).sort();
  const normalizedRight = right.map(normalizePathKey).sort();
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function uniquePaths(paths: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const path of paths) {
    const key = normalizePathKey(path);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(path);
  }

  return result;
}

function normalizePathKey(value: string) {
  return value.trim().replace(/[\\/]+$/, "").toLowerCase();
}

function isPathInsideRoot(path: string, root: string) {
  const normalizedPath = normalizeComparablePath(path);
  const normalizedRoot = normalizeComparablePath(root);

  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function normalizeComparablePath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isProbablyTextExtension(extension?: string) {
  if (!extension) {
    return false;
  }

  return new Set([
    "bat",
    "cmd",
    "css",
    "csv",
    "html",
    "java",
    "js",
    "json",
    "jsx",
    "kt",
    "kts",
    "log",
    "md",
    "ps1",
    "py",
    "rs",
    "sh",
    "toml",
    "ts",
    "tsx",
    "txt",
    "xml",
    "yaml",
    "yml",
  ]).has(extension.toLowerCase());
}

function limitContext(content: string) {
  if (content.length <= MAX_CONTEXT_CHARS) {
    return content;
  }

  return `${content.slice(0, MAX_CONTEXT_CHARS)}\n\n[Local workspace context truncated for speed.]`;
}
