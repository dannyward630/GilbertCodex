import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { isTauriDesktopRuntime } from "../../app/tauriClient";
import type {
  ComputerDirectoryListing,
  ComputerDrive,
  ComputerFileIndexProgress,
  ComputerFileIndexSummary,
  ComputerGitStatus,
  ComputerDeleteFileResult,
  ComputerReadFileResult,
  ComputerSearchResult,
  ComputerWriteFileResult,
  LocalPermissionMode,
  LocalWorkspaceScope,
  LocalWorkspaceSettings,
} from "../../types/localWorkspace";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ToolRegistrySettings } from "../../types/tools";
import { describeCodingTools } from "../coding";
import { describeFileCreationTools } from "../fileCreation";

const DEFAULT_FOLDER_INDEX_LIMIT = 12_000;
const DEFAULT_FULL_COMPUTER_INDEX_LIMIT = 25_000;
const DEFAULT_FOLDER_DEPTH = 18;
const DEFAULT_FULL_COMPUTER_DEPTH = 9;
const MAX_CONTEXT_CHARS = 26_000;
const MAX_GILBERT_MEMORY_CHARS = 16_000;
const MAX_GILBERT_MEMORY_IMPORT_DEPTH = 5;
const MAX_SNIPPET_CHARS = 2_600;
const COMPUTER_FILE_INDEX_PROGRESS_EVENT = "computer-file-index-progress";

/** Project-local memory file imported into workspace context when present. */
export const GILBERT_PROJECT_MEMORY_FILE = "GILBERT.md";

/** A loaded project memory note and the absolute/local path it came from. */
export interface GilbertProjectMemory {
  content: string;
  path: string;
}

type BrowserDirectoryHandle = {
  entries?: () => AsyncIterable<[string, BrowserFileSystemHandle]>;
  getDirectoryHandle?: (name: string, options?: { create?: boolean }) => Promise<BrowserDirectoryHandle>;
  getFileHandle?: (name: string, options?: { create?: boolean }) => Promise<BrowserFileHandle>;
  kind: "directory";
  name: string;
  removeEntry?: (name: string, options?: { recursive?: boolean }) => Promise<void>;
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

/** Returns the desktop default workspace, or the first browser folder fallback. */
export async function getDefaultComputerWorkspace() {
  if (!isTauriDesktopRuntime()) {
    return browserWorkspaceRoots.keys().next().value ?? "";
  }

  return (await invoke<string | null>("computer_get_default_workspace")) ?? "";
}

/** Lists readable roots for full-computer and folder-picker UI. */
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

/** Opens the native folder picker in desktop, with browser File System Access fallback. */
export async function pickComputerFolder(startPath?: string) {
  if (!isTauriDesktopRuntime()) {
    return await pickBrowserFolder();
  }

  return await invoke<string | null>("computer_pick_folder", {
    startPath,
  });
}

/** Registers folders dropped onto the browser preview fallback runtime. */
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

/** Subscribes to native folder drag/drop events from the Tauri webview. */
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

/** Lists one directory from the native command layer or browser folder fallback. */
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

/** Builds a capped hybrid file index for the selected workspace scope. */
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

/** Streams indexing progress from Rust while large folders are scanned. */
export async function listenForComputerFileIndexProgress(onProgress: (progress: ComputerFileIndexProgress) => void) {
  if (!isTauriDesktopRuntime()) {
    return () => undefined;
  }

  return await listen<ComputerFileIndexProgress>(COMPUTER_FILE_INDEX_PROGRESS_EVENT, (event) => {
    onProgress(event.payload);
  });
}

/** Returns the most recent local file-index summary for UI status and context. */
export async function getComputerFileIndexSummary() {
  if (!isTauriDesktopRuntime()) {
    return browserIndexSummary;
  }

  return await invoke<ComputerFileIndexSummary>("computer_get_file_index_summary");
}

/** Reads local Git status for a workspace root when native git is available. */
export async function getComputerGitStatus(path: string): Promise<ComputerGitStatus> {
  if (!path || !isTauriDesktopRuntime() || isBrowserWorkspacePath(path)) {
    return createUnavailableGitStatus(path ? "Git status is available in the desktop app for real folders." : "Choose a project folder first.");
  }

  return await invoke<ComputerGitStatus>("computer_get_git_status", {
    request: {
      path,
    },
  });
}

/** Searches the current file index and optionally filters results to selected roots. */
export async function searchComputerFiles(query: string, limit = 24, roots: string[] = []) {
  const filterToRoots = (results: ComputerSearchResult[]) => (roots.length > 0 ? results.filter((result) => roots.some((root) => isPathInsideRoot(result.path, root))) : results);

  if (!isTauriDesktopRuntime()) {
    return filterToRoots(searchBrowserFileIndex(query, limit));
  }

  const results = await invoke<ComputerSearchResult[]>("computer_search_file_index", {
    request: {
      limit,
      query,
    },
  });

  return filterToRoots(results);
}

/** Reads a text file through the active desktop or browser workspace backend. */
export async function readComputerTextFile(path: string, maxBytes = 16 * 1024 * 1024) {
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

/** Writes a text file after the caller has already resolved permission policy. */
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

/** Deletes one file through the active backend; directories are rejected below Rust/browser layers. */
export async function deleteComputerFile(path: string, roots: string[]) {
  if (isBrowserWorkspacePath(path)) {
    return await deleteBrowserFile(path, roots);
  }

  if (!isTauriDesktopRuntime()) {
    throw new Error("Use the desktop app or open a browser folder before deleting files.");
  }

  return await invoke<ComputerDeleteFileResult>("computer_delete_file", {
    request: {
      path,
      roots,
    },
  });
}

/** Resolves saved workspace settings to concrete roots used by context and tools. */
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

  return [];
}

/**
 * Builds the compact model-visible workspace context from roots, Git status,
 * project memories, directory listings, search results, and text snippets.
 */
export async function createLocalWorkspaceContext(settings: LocalWorkspaceSettings, prompt: string, toolSettings?: ToolRegistrySettings) {
  if (!settings.enabled) {
    return "";
  }

  const roots = await resolveLocalWorkspaceRoots(settings);

  if (roots.length === 0) {
    return createWorkspaceHeader(settings, [], undefined, "No readable roots are selected yet.", toolSettings);
  }

  const summary = await ensureComputerFileIndex(settings, roots);
  const gitStatuses = await Promise.all(roots.slice(0, settings.scope === "full-computer" ? 4 : 2).map((root) => getComputerGitStatus(root).catch((error) => createUnavailableGitStatus(readErrorMessage(error, "Git status unavailable.")))));
  const projectMemories = await readGilbertProjectMemories(roots);
  const searchResults = await searchComputerFiles(prompt, 18, roots).catch(() => []);
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
      formatGitStatuses(gitStatuses),
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
  if (mode === "read-only") {
    return "Read only";
  }

  if (mode === "ask-first") {
    return "Ask first";
  }

  if (mode === "full-workspace") {
    return "Auto full";
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
      ...scoreBrowserEntry(entry, query, tokens),
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

async function deleteBrowserFile(path: string, roots: string[]): Promise<ComputerDeleteFileResult> {
  if (!roots.some((root) => isPathInsideRoot(path, root))) {
    throw new Error("Deletes are only allowed inside the selected browser folder.");
  }

  const { parts, root } = resolveBrowserRoot(path);

  if (parts.length === 0) {
    throw new Error("Choose a file path, not the folder root.");
  }

  const fileName = parts[parts.length - 1];
  let directoryHandle = root.handle;

  for (const part of parts.slice(0, -1)) {
    if (!directoryHandle.getDirectoryHandle) {
      throw new Error("This browser cannot open that folder.");
    }

    directoryHandle = await directoryHandle.getDirectoryHandle(part);
  }

  if (!directoryHandle.getFileHandle || !directoryHandle.removeEntry) {
    throw new Error("This browser did not grant delete access to that folder.");
  }

  const handle = await directoryHandle.getFileHandle(fileName);
  const file = await handle.getFile();
  await directoryHandle.removeEntry(fileName, { recursive: false });

  return {
    bytesDeleted: file.size,
    deleted: true,
    path,
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
  const fileCreationTools = tools.fileCreation
    ? [
        "create_text_file",
        "create_markdown_file",
        "create_code_file",
        "create_react_file",
        "create_html_file",
        "create_pdf_file",
        "create_files",
      ]
    : [];
  const codingTools = [
    tools.fileSafety ? "delete_file" : "",
    tools.fileSafety ? "check_duplicate_file" : "",
    tools.fileSafety ? "prevent_duplicate_file_create" : "",
    tools.pdfTools ? "create_chat_pdf" : "",
    tools.codeEdit ? "inline_edit" : "",
    tools.vectorTools ? "vector_embed_text" : "",
    tools.vectorTools ? "vector_search" : "",
    tools.testingTools ? "run_tests" : "",
    tools.testingTools ? "create_unit_test" : "",
    tools.typescriptTools ? "typescript_check" : "",
    tools.sqlTools ? "create_sql_schema" : "",
    tools.sqlTools ? "create_sql_migration" : "",
    tools.reactNativeTools ? "create_react_native_screen" : "",
    tools.reactNativeTools ? "react_native_setup_check" : "",
    tools.codeGeneration ? "codebase_health_scan" : "",
    tools.codeGeneration ? "dependency_audit" : "",
    tools.codeGeneration ? "create_api_route" : "",
  ];
  const runtimeTools = [
    tools.codeView ? "view_code" : "",
    tools.codeView ? "read_file" : "",
    tools.fileBrowser ? "list_directory" : "",
    tools.fileSearch ? "recall_context" : "",
    tools.fileSearch ? "search_files" : "",
    tools.fileBrowser ? "build_index" : "",
    tools.codeEdit ? "edit_file" : "",
    tools.codeEdit ? "write_file" : "",
    ...fileCreationTools,
    ...codingTools,
    tools.sourceControl ? "git_status" : "",
    tools.sourceControl ? "git_diff" : "",
    tools.sourceControl ? "git_log" : "",
    tools.sourceControl ? "git_stage" : "",
    tools.sourceControl ? "git_unstage" : "",
    tools.sourceControl ? "git_commit" : "",
    tools.sourceControl ? "git_push" : "",
    tools.sourceControl ? "git_pull" : "",
    tools.sourceControl ? "git_fetch" : "",
    tools.sourceControl ? "git_branch" : "",
    tools.sourceControl ? "git_checkout" : "",
    tools.terminal ? "run_terminal" : "",
    tools.browserPreview ? "open_browser_preview" : "",
    tools.terminal && tools.codeEdit ? "create_tool" : "",
    tools.terminal ? "run_tool" : "",
  ].filter(Boolean);
  const permissionRules = {
    "ask-first": "Ask before editing, deleting, moving, or running anything. Viewing and indexing are allowed.",
    "gilbert-review": "Review mode reads freely but pauses file changes, terminal commands, custom tools, and mutating Git/GitHub actions for approval.",
    "full-workspace": "Auto full mode runs file changes, terminal commands, custom tools, and mutating Git/GitHub actions without approval prompts inside the enabled workspace roots. In full computer scope, those roots are the readable drive roots.",
    "read-only": "Read, list, index, and search workspace files. File writes, deletes, custom tools, and terminal commands are blocked.",
  } satisfies Record<LocalPermissionMode, string>;

  return [
    "LOCAL COMPUTER FILE TOOL",
    "Tool access: Gilbert can view drives, open folders, read text files, use the local vector file index, and make precise workspace edits when local work is enabled.",
      `Runtime tools enabled from Toolbox: ${runtimeTools.length > 0 ? runtimeTools.join(", ") : "none"}.`,
      `${GILBERT_PROJECT_MEMORY_FILE}: When present in a workspace root, Gilbert loads it like project memory for architecture notes, commands, style rules, and workflow preferences. @path imports are followed up to ${MAX_GILBERT_MEMORY_IMPORT_DEPTH} levels.`,
      "Auto full mode is the no-approval workspace mode: file edits, writes, custom tools, terminal commands, and mutating source-control actions may run inside the enabled roots without stopping for approval. Review and Ask first modes still require confirmation for mutating tools.",
      "Use recall_context when you need project memory plus likely code locations, search_files to locate code by file name, path, content, or semantic meaning, view_code for exact line/character windows, edit_file for focused replacements down to a single letter or punctuation mark, git_status/git_diff/git_stage/git_commit/git_push for local version-control work when Source Control is enabled, run_terminal for local project commands when Terminal is enabled, and open_browser_preview to inspect a local app URL in the in-app browser.",
      "Edit syntax: read with view_code first, then use edit_file with old_text/new_text, start_line/end_line/content, insert_at_line/content, or start_char/end_char/content. Line numbers are 1-based, character indexes are 0-based and end-exclusive, and stale out-of-range coordinates are rejected instead of guessed. For targeted line or character edits, include expected_text when available so Gilbert can refuse the edit if the file changed.",
      tools.fileCreation ? describeFileCreationTools() : "",
      describeCodingTools(),
      "For reusable one-off automation, create_tool writes a platform shell script under .gilbert/tools, run_tool executes it, and edit_file can refine that script after reading command output.",
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

function createUnavailableGitStatus(error?: string): ComputerGitStatus {
  return {
    additions: 0,
    ahead: 0,
    available: false,
    behind: 0,
    changedFiles: 0,
    clean: true,
    deletions: 0,
    error,
    files: [],
  };
}

function formatGitStatuses(statuses: ComputerGitStatus[]) {
  const availableStatuses = statuses.filter((status) => status.available);

  if (availableStatuses.length === 0) {
    return "";
  }

  return [
    "LOCAL GIT STATE",
    ...availableStatuses.map((status) => {
      const repository = status.githubOwner && status.githubRepo ? `${status.githubOwner}/${status.githubRepo}` : status.remoteUrl || "No GitHub remote detected";
      const branch = status.branch || "unknown branch";
      const changes = status.clean ? "working tree clean" : formatGitChangeSummary(status);

      return `- ${status.repositoryRoot || "repository"}: ${repository}, branch ${branch}, ${changes}.`;
    }),
    "Use this Git state when answering branch, GitHub repository, or changed-file questions for the selected project.",
  ].join("\n");
}

function formatGitChangeSummary(status: ComputerGitStatus) {
  const changed = status.changedFiles === 1 ? "1 file changed" : `${status.changedFiles} files changed`;
  const additions = status.additions > 0 ? `+${status.additions}` : "";
  const deletions = status.deletions > 0 ? `-${status.deletions}` : "";

  return [changed, additions, deletions].filter(Boolean).join(" ");
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
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
    return "HYBRID FILE SEARCH RESULTS\nNo local file matches were found for this request yet.";
  }

  return [
    "HYBRID FILE SEARCH RESULTS",
    ...results.slice(0, 18).map((result, index) => {
      const matchKind = result.matchKind ? `, ${result.matchKind}` : "";
      const line = result.line ? `, line ${result.line}` : "";
      const matches = result.matches?.length ? `, matches: ${result.matches.slice(0, 6).join(", ")}` : "";
      const preview = result.preview ? `\n  preview: ${result.preview.replace(/\s+/g, " ").slice(0, 260)}` : "";
      return `${index + 1}. ${result.path} (${result.kind}${matchKind}${line}, score ${result.score.toFixed(3)}${matches})${preview}`;
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

function scoreBrowserEntry(entry: BrowserIndexedEntry, query: string, tokens: string[]) {
  let contentScore = 0;
  let nameScore = 0;
  let pathScore = 0;
  const matches = new Set<string>();
  const nameLower = entry.name.toLowerCase();
  const pathLower = entry.path.toLowerCase();
  const haystackLower = entry.haystack.toLowerCase();
  const queryLower = query.trim().toLowerCase();

  if (queryLower && nameLower === queryLower) {
    nameScore += 8;
    matches.add(queryLower);
  } else if (queryLower && nameLower.includes(queryLower)) {
    nameScore += 5;
    matches.add(queryLower);
  }

  if (queryLower && pathLower.includes(queryLower)) {
    pathScore += 2.5;
    matches.add(queryLower);
  }

  if (queryLower && entry.content?.toLowerCase().includes(queryLower)) {
    contentScore += 1.4;
    matches.add(queryLower);
  }

  for (const token of tokens) {
    if (nameLower.includes(token)) {
      nameScore += 1.6;
      matches.add(token);
    }

    if (pathLower.includes(token)) {
      pathScore += 0.85;
      matches.add(token);
    }

    if (haystackLower.includes(token)) {
      contentScore += 0.35;
    }
  }

  const snippet = findBrowserContentSnippet(entry.preview ?? entry.content ?? "", queryLower, tokens);
  if (snippet) {
    contentScore += 0.8;
    snippet.matches.forEach((match) => matches.add(match));
  }

  const score = nameScore + pathScore + contentScore / Math.max(tokens.length, 1);
  const matchKind =
    nameScore > 0 && nameScore >= pathScore && nameScore >= contentScore
      ? "name"
      : pathScore > 0 && pathScore >= contentScore
        ? "path"
        : contentScore > 0
          ? "content"
          : "semantic";

  return {
    line: snippet?.line,
    matchKind,
    matches: Array.from(matches).slice(0, 10),
    preview: snippet?.preview ?? entry.preview,
    score,
  } satisfies Pick<ComputerSearchResult, "line" | "matchKind" | "matches" | "preview" | "score">;
}

function findBrowserContentSnippet(content: string, queryLower: string, tokens: string[]) {
  if (!content) {
    return undefined;
  }

  const usefulTokens = tokens.filter((token) => token.length > 1);
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const lineLower = line.toLowerCase();
    const matches = new Set<string>();

    if (queryLower && lineLower.includes(queryLower)) {
      matches.add(queryLower);
    }

    for (const token of usefulTokens) {
      if (lineLower.includes(token)) {
        matches.add(token);
      }
    }

    if (matches.size > 0) {
      return {
        line: index + 1,
        matches: Array.from(matches).slice(0, 8),
        preview: line.trim().slice(0, 420),
      };
    }
  }

  return undefined;
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
    "astro",
    "bat",
    "c",
    "cmd",
    "cpp",
    "cs",
    "css",
    "csv",
    "dart",
    "go",
    "graphql",
    "h",
    "html",
    "java",
    "js",
    "json",
    "jsx",
    "kt",
    "kts",
    "log",
    "lua",
    "md",
    "php",
    "ps1",
    "py",
    "rb",
    "rs",
    "scss",
    "sh",
    "sql",
    "svelte",
    "swift",
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
