import { ChevronRight, FileCode2, FileText, Folder, FolderOpen, LoaderCircle, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useEffect, useState, type CSSProperties } from "react";
import { getComputerGitStatus, listComputerDirectory, readComputerTextFile } from "../../localWorkspace/files";
import type { AgentRun } from "../../types/agentRun";
import type {
  ComputerDirectoryEntry,
  ComputerDirectoryListing,
  ComputerFileKind,
  ComputerGitChangedFile,
  ComputerGitDiffLine,
  ComputerGitStatus,
  ComputerReadFileResult,
  LocalWorkspaceSettings,
} from "../../types/localWorkspace";
import { EmptyCodingState, formatCount } from "./CodingSidecarShared";

interface CodingCodebaseTabProps {
  activeRun?: AgentRun;
  localWorkspace: LocalWorkspaceSettings;
  root: string;
}

interface DirectoryState {
  error?: string;
  listing?: ComputerDirectoryListing;
  loading?: boolean;
}

interface CodebaseChangedFile {
  additions?: number;
  absolutePath: string;
  deletions?: number;
  diffPreview?: ComputerGitDiffLine[];
  diffTruncated?: boolean;
  path: string;
  status?: string;
}

type FileViewMode = "source" | "diff";

const MAX_FILE_BYTES = 128 * 1024;
const MAX_RENDERED_LINES = 2_000;

export function CodingCodebaseTab({ activeRun, localWorkspace, root }: CodingCodebaseTabProps) {
  const workspaceRoot = useMemo(() => resolveCodebaseRoot(root, localWorkspace, activeRun), [activeRun, localWorkspace, root]);
  const [directoryState, setDirectoryState] = useState<Record<string, DirectoryState>>({});
  const directoryStateRef = useRef<Record<string, DirectoryState>>({});
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [fileError, setFileError] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [fileResult, setFileResult] = useState<ComputerReadFileResult | null>(null);
  const [gitStatus, setGitStatus] = useState<ComputerGitStatus | null>(null);
  const [gitStatusLoading, setGitStatusLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedPath, setSelectedPath] = useState("");
  const [viewMode, setViewMode] = useState<FileViewMode>("source");

  const updateDirectoryState = useCallback((updater: (current: Record<string, DirectoryState>) => Record<string, DirectoryState>) => {
    setDirectoryState((current) => {
      const next = updater(current);
      directoryStateRef.current = next;
      return next;
    });
  }, []);

  const loadDirectory = useCallback(async (path: string, force = false) => {
    const existing = directoryStateRef.current[path];
    if (!force && (existing?.loading || existing?.listing)) {
      return;
    }

    updateDirectoryState((current) => ({
      ...current,
      [path]: {
        ...current[path],
        error: undefined,
        loading: true,
      },
    }));

    try {
      const listing = await withTimeout(listComputerDirectory(path, 360), 12_000, `Could not load ${displayWorkspaceName(path)} yet.`);
      updateDirectoryState((current) => ({
        ...current,
        [path]: {
          listing,
          loading: false,
        },
      }));
    } catch (error) {
      updateDirectoryState((current) => ({
        ...current,
        [path]: {
          error: error instanceof Error ? error.message : "Directory unavailable.",
          loading: false,
        },
      }));
    }
  }, [updateDirectoryState]);

  useEffect(() => {
    if (!workspaceRoot) {
      directoryStateRef.current = {};
      setDirectoryState({});
      setExpandedPaths(new Set());
      setFileError("");
      setFileResult(null);
      setGitStatus(null);
      setSelectedPath("");
      return;
    }

    directoryStateRef.current = {};
    setDirectoryState({});
    setExpandedPaths(new Set([workspaceRoot]));
    setFileError("");
    setFileResult(null);
    setSelectedPath("");
    setViewMode("source");
    void loadDirectory(workspaceRoot, true);

    let disposed = false;
    setGitStatusLoading(true);
    void getComputerGitStatus(workspaceRoot, { includeDiffPreview: true })
      .then((status) => {
        if (!disposed) setGitStatus(status);
      })
      .catch((error) => {
        if (!disposed) {
          setGitStatus({
            additions: 0,
            ahead: 0,
            available: false,
            behind: 0,
            changedFiles: 0,
            clean: true,
            deletions: 0,
            error: error instanceof Error ? error.message : "Git status unavailable.",
          });
        }
      })
      .finally(() => {
        if (!disposed) setGitStatusLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [loadDirectory, workspaceRoot]);

  const changedFiles = useMemo(() => createChangedFiles(gitStatus, workspaceRoot), [gitStatus, workspaceRoot]);
  const selectedChangedFile = useMemo(
    () => changedFiles.find((file) => sameComputerPath(file.absolutePath, selectedPath) || sameComputerPath(resolveWorkspacePath(workspaceRoot, file.path), selectedPath)),
    [changedFiles, workspaceRoot, selectedPath],
  );
  const hasDiffPreview = Boolean(selectedChangedFile?.diffPreview?.length);

  useEffect(() => {
    if (selectedPath || !workspaceRoot) return;

    const firstFile = findFirstFile(directoryState[workspaceRoot]?.listing?.entries);
    if (firstFile) {
      setSelectedPath(firstFile.path);
      setViewMode("source");
    }
  }, [directoryState, workspaceRoot, selectedPath]);

  useEffect(() => {
    if (!selectedPath) {
      setFileError("");
      setFileResult(null);
      return;
    }

    let disposed = false;
    setFileError("");
    setFileLoading(true);
    setFileResult(null);
    void readComputerTextFile(selectedPath, MAX_FILE_BYTES)
      .then((result) => {
        if (!disposed) setFileResult(result);
      })
      .catch((error) => {
        if (!disposed) setFileError(error instanceof Error ? error.message : "File unavailable.");
      })
      .finally(() => {
        if (!disposed) setFileLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [selectedPath]);

  function toggleDirectory(path: string) {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        void loadDirectory(path);
      }
      return next;
    });
  }

  function selectTreeFile(path: string) {
    setSelectedPath(path);
    setViewMode("source");
  }

  if (!workspaceRoot) {
    return <EmptyCodingState title="No workspace selected" detail="Choose a local project folder to browse source files and changed code." />;
  }

  const effectiveViewMode: FileViewMode = viewMode === "diff" && hasDiffPreview ? "diff" : "source";
  const selectedDisplayPath = selectedPath ? displayWorkspacePath(selectedPath, workspaceRoot) : "No file selected";

  return (
    <div className="coding-tab coding-codebase-tab">
      <div className="coding-codebase-layout">
        <aside className="coding-codebase-explorer" aria-label="Codebase explorer">
          <section className="coding-codebase-tree" aria-label="Project files">
            <div className="coding-codebase-tree-toolbar">
              <span>
                <strong>Files</strong>
                <small>{displayWorkspaceName(workspaceRoot)}</small>
              </span>
              <label className="coding-codebase-search">
                <Search size={14} aria-hidden="true" />
                <input aria-label="Filter loaded files" placeholder="Filter files" value={query} onChange={(event) => setQuery(event.target.value)} />
              </label>
            </div>
            <div className="coding-codebase-tree-list">
              <DirectoryRows
                depth={0}
                directoryState={directoryState}
                expandedPaths={expandedPaths}
                path={workspaceRoot}
                query={query}
                root={workspaceRoot}
                selectedPath={selectedPath}
                onSelectFile={selectTreeFile}
                onToggleDirectory={toggleDirectory}
              />
            </div>
          </section>
        </aside>

        <section className="coding-codebase-editor" aria-label="Selected source file">
          <header className="coding-codebase-editor-header">
            <span>
              <strong title={selectedDisplayPath}>{selectedDisplayPath}</strong>
              <small>{createFileMeta(fileResult, fileLoading, fileError, gitStatusLoading)}</small>
            </span>
            <div className="coding-codebase-view-toggle" aria-label="File view mode">
              <button type="button" data-active={effectiveViewMode === "source"} onClick={() => setViewMode("source")}>
                Source
              </button>
              <button type="button" data-active={effectiveViewMode === "diff"} disabled={!hasDiffPreview} onClick={() => setViewMode("diff")}>
                Diff
              </button>
            </div>
          </header>

          {effectiveViewMode === "diff" && selectedChangedFile?.diffPreview ? (
            <DiffPreview file={selectedChangedFile} />
          ) : (
            <SourcePreview error={fileError} loading={fileLoading} result={fileResult} />
          )}
        </section>
      </div>
    </div>
  );
}

function DirectoryRows({
  depth,
  directoryState,
  expandedPaths,
  path,
  query,
  root,
  selectedPath,
  onSelectFile,
  onToggleDirectory,
}: {
  depth: number;
  directoryState: Record<string, DirectoryState>;
  expandedPaths: Set<string>;
  path: string;
  query: string;
  root: string;
  selectedPath: string;
  onSelectFile: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}) {
  const state = directoryState[path];

  if (state?.loading && !state.listing) {
    return <div className="coding-codebase-tree-note" style={{ "--tree-depth": depth } as CSSProperties}>Loading...</div>;
  }

  if (state?.error) {
    return <div className="coding-codebase-tree-note" style={{ "--tree-depth": depth } as CSSProperties}>{state.error}</div>;
  }

  if (!state?.listing) {
    return <div className="coding-codebase-tree-note" style={{ "--tree-depth": depth } as CSSProperties}>Open a folder to load files.</div>;
  }

  const entries = sortDirectoryEntries(state.listing.entries).filter((entry) => matchesQuery(displayWorkspacePath(entry.path, root), query) || entry.kind === "directory");

  if (entries.length === 0) {
    return <div className="coding-codebase-tree-note" style={{ "--tree-depth": depth } as CSSProperties}>No loaded files match.</div>;
  }

  return (
    <>
      {entries.map((entry) => {
        const isDirectory = entry.kind === "directory";
        const isExpanded = expandedPaths.has(entry.path);
        const isActive = sameComputerPath(entry.path, selectedPath);
        const Icon = isDirectory ? (isExpanded ? FolderOpen : Folder) : fileIconForEntry(entry);

        return (
          <div className="coding-codebase-tree-group" key={entry.path}>
            <button
              type="button"
              className="coding-codebase-tree-row"
              aria-expanded={isDirectory ? isExpanded : undefined}
              data-active={isActive}
              data-kind={entry.kind}
              style={{ "--tree-depth": depth } as CSSProperties}
              onClick={() => {
                if (isDirectory) {
                  onToggleDirectory(entry.path);
                } else {
                  onSelectFile(entry.path);
                }
              }}
            >
              {isDirectory ? <ChevronRight className="coding-codebase-chevron" size={13} aria-hidden="true" data-expanded={isExpanded} /> : <span className="coding-codebase-chevron" />}
              <Icon size={14} aria-hidden="true" />
              <span title={displayWorkspacePath(entry.path, root)}>{entry.name}</span>
            </button>
            {isDirectory && isExpanded ? (
              <DirectoryRows
                depth={depth + 1}
                directoryState={directoryState}
                expandedPaths={expandedPaths}
                path={entry.path}
                query={query}
                root={root}
                selectedPath={selectedPath}
                onSelectFile={onSelectFile}
                onToggleDirectory={onToggleDirectory}
              />
            ) : null}
          </div>
        );
      })}
      {state.listing.limited ? <div className="coding-codebase-tree-note" style={{ "--tree-depth": depth } as CSSProperties}>Folder limited to the first loaded entries.</div> : null}
    </>
  );
}

function SourcePreview({ error, loading, result }: { error: string; loading: boolean; result: ComputerReadFileResult | null }) {
  if (loading) {
    return (
      <div className="coding-codebase-editor-empty">
        <LoaderCircle size={18} aria-hidden="true" />
        <span>Loading file</span>
      </div>
    );
  }

  if (error) {
    return <EmptyCodingState title="File preview unavailable" detail={error} />;
  }

  if (!result) {
    return <EmptyCodingState title="No file selected" detail="Choose a source file to inspect it here." />;
  }

  const lines = result.content.split(/\r?\n/);
  const visibleLines = lines.slice(0, MAX_RENDERED_LINES);

  return (
    <div className="coding-codebase-code" role="region" aria-label="Source preview">
      {visibleLines.map((line, index) => (
        <div className="coding-codebase-code-line" key={`${index}-${line.slice(0, 12)}`}>
          <span>{index + 1}</span>
          <code>{line || " "}</code>
        </div>
      ))}
      {result.truncated || lines.length > visibleLines.length ? (
        <div className="coding-codebase-code-note">
          Preview truncated at {formatCount(Math.min(result.size, MAX_FILE_BYTES))} bytes.
        </div>
      ) : null}
    </div>
  );
}

function DiffPreview({ file }: { file: CodebaseChangedFile }) {
  const lines = file.diffPreview ?? [];

  if (lines.length === 0) {
    return <EmptyCodingState title="No diff preview" detail="Open Source to inspect the current file contents." />;
  }

  return (
    <div className="coding-codebase-code" role="region" aria-label="Diff preview">
      {lines.map((line, index) => (
        <div className="coding-codebase-code-line" data-kind={line.kind} key={`${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`}>
          <span>{formatDiffLineNumber(line)}</span>
          <code>{line.content || " "}</code>
        </div>
      ))}
      {file.diffTruncated ? <div className="coding-codebase-code-note">Diff preview truncated.</div> : null}
    </div>
  );
}

function createChangedFiles(status: ComputerGitStatus | null, root: string): CodebaseChangedFile[] {
  const files = new Map<string, CodebaseChangedFile>();

  for (const file of status?.files ?? []) {
    const item = createChangedFileFromGit(file, root);
    files.set(normalizeComputerPath(item.path), item);
  }

  return [...files.values()].sort((left, right) => {
    const changedWeight = (value: CodebaseChangedFile) => (value.diffPreview?.length ? 0 : 1);
    return changedWeight(left) - changedWeight(right) || left.path.localeCompare(right.path);
  });
}

function createChangedFileFromGit(file: ComputerGitChangedFile, root: string): CodebaseChangedFile {
  return {
    additions: file.additions,
    absolutePath: resolveWorkspacePath(root, file.path),
    deletions: file.deletions,
    diffPreview: file.diffPreview,
    diffTruncated: file.diffTruncated,
    path: file.path,
    status: file.status,
  };
}

function sortDirectoryEntries(entries: ComputerDirectoryEntry[]) {
  return [...entries].sort((left, right) => {
    const leftRank = fileKindRank(left.kind);
    const rightRank = fileKindRank(right.kind);
    return leftRank - rightRank || left.name.localeCompare(right.name);
  });
}

function fileKindRank(kind: ComputerFileKind) {
  if (kind === "directory") return 0;
  if (kind === "file") return 1;
  if (kind === "symlink") return 2;
  return 3;
}

function fileIconForEntry(entry: ComputerDirectoryEntry) {
  return isCodeLikeExtension(entry.extension) ? FileCode2 : FileText;
}

function isCodeLikeExtension(extension?: string) {
  if (!extension) return false;
  return new Set(["css", "html", "js", "jsx", "json", "md", "rs", "ts", "tsx", "toml", "yml", "yaml"]).has(extension.toLowerCase());
}

function findFirstFile(entries?: ComputerDirectoryEntry[]) {
  return sortDirectoryEntries(entries ?? []).find((entry) => entry.kind === "file");
}

function matchesQuery(value: string, query: string) {
  const trimmed = query.trim().toLowerCase();
  return !trimmed || value.toLowerCase().includes(trimmed);
}

function createFileMeta(result: ComputerReadFileResult | null, loading: boolean, error: string, gitStatusLoading = false) {
  if (loading) return "Loading source";
  if (error) return error;
  const pieces = [
    result ? `${formatCount(result.size)} bytes` : "Source preview",
    result?.truncated ? "truncated" : "",
    gitStatusLoading ? "Refreshing Git" : "",
  ].filter(Boolean);
  return pieces.join(" / ");
}

function formatDiffLineNumber(line: ComputerGitDiffLine) {
  if (line.kind === "add") return `+${line.newLine ?? ""}`;
  if (line.kind === "remove") return `-${line.oldLine ?? ""}`;
  if (line.kind === "hunk") return "@@";
  if (line.kind === "meta") return "";
  return `${line.oldLine ?? ""}`;
}

function displayWorkspaceName(path: string) {
  const normalized = path.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}

function displayWorkspacePath(path: string, root: string) {
  const relative = relativeWorkspacePath(path, root);
  return relative || displayWorkspaceName(root);
}

function resolveWorkspacePath(root: string, path: string) {
  const trimmed = path.trim();
  if (!trimmed) return root;
  if (isAbsoluteComputerPath(trimmed)) return trimmed;

  const cleanRoot = root.replace(/[\\/]+$/, "");
  const separator = cleanRoot.includes("\\") ? "\\" : "/";
  return `${cleanRoot}${separator}${trimmed.replace(/^[\\/]+/, "").replace(/[\\/]/g, separator)}`;
}

function relativeWorkspacePath(path: string, root: string) {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const lowerPath = normalizedPath.toLowerCase();
  const lowerRoot = normalizedRoot.toLowerCase();

  if (lowerPath === lowerRoot) return "";
  if (lowerPath.startsWith(`${lowerRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return normalizedPath;
}

function sameComputerPath(left: string, right: string) {
  return normalizeComputerPath(left) === normalizeComputerPath(right);
}

function normalizeComputerPath(path: string) {
  return path.trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function isAbsoluteComputerPath(path: string) {
  return /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\") || path.startsWith("/") || path.startsWith("browser-folder://");
}

function resolveCodebaseRoot(root: string, localWorkspace: LocalWorkspaceSettings, activeRun: AgentRun | undefined) {
  const candidates = [
    root,
    ...(localWorkspace.roots ?? []),
    ...(activeRun?.localWorkspace?.roots ?? []),
    ...(activeRun?.coding?.request.workspaceRoots ?? []),
    inferWorkspaceRootFromChangedPaths(activeRun?.coding?.review?.changedFiles.map((file) => file.path) ?? []),
  ].map((candidate) => candidate?.trim()).filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find(isAbsoluteComputerPath) ?? candidates[0] ?? "";
}

function inferWorkspaceRootFromChangedPaths(paths: string[]) {
  const absolutePaths = paths.filter(isAbsoluteComputerPath).map((path) => path.replace(/\\/g, "/"));
  const firstSourcePath = absolutePaths.find((path) => /\/(?:src|src-tauri|docs|scripts|tests?)\//i.test(path));

  if (firstSourcePath) {
    return firstSourcePath.replace(/\/(?:src|src-tauri|docs|scripts|tests?)\/.*$/i, "");
  }

  const first = absolutePaths[0];
  if (!first) return "";

  const lastSlash = first.lastIndexOf("/");
  return lastSlash > 0 ? first.slice(0, lastSlash) : first;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        globalThis.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
