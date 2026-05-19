import { AlertTriangle, CheckCircle2, ChevronDown, FileCode2, GitBranch, GripVertical, LoaderCircle, Maximize2, Minimize2, RefreshCw, Search, ShieldAlert, TestTube2, X } from "lucide-react";
import { useEffect, useMemo, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatGitChangedFileStatus, formatGitChangedFiles, getGitStatusIssue, gitChangedFileStatusTone } from "../../lib/gitStatusUi";
import { commitComputerGitChanges, createComputerGitBranch, diffComputerGitChanges, getComputerGitStatus, initComputerGitRepository, pushComputerGitBranch } from "../../localWorkspace/files";
import type { ComputerGitChangedFile, ComputerGitDiffLine, ComputerGitStatus } from "../../types/localWorkspace";

const GIT_REVIEW_REFRESH_INTERVAL_MS = 10_000;
const MAX_REVIEW_PROMPT_FILES = 240;

type ReviewMode = "auto" | "risk" | "summary" | "tests";
type FileFilter = "all" | "added" | "deleted" | "modified" | "renamed";

interface LoadedGitDiff {
  error?: string;
  lines?: ComputerGitDiffLine[];
  loading: boolean;
  truncated?: boolean;
}

interface GitReviewPanelProps {
  expanded: boolean;
  previewWidth: number;
  resizeMaxWidth: number;
  resizeMinWidth: number;
  root: string;
  onClose: () => void;
  onResizeKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onResizeStart: (event: PointerEvent<HTMLElement>) => void;
  onSubmitReview: (prompt: string) => void | Promise<void>;
  onToggleExpanded: () => void;
}

export function GitReviewPanel({ expanded, previewWidth, resizeMaxWidth, resizeMinWidth, root, onClose, onResizeKeyDown, onResizeStart, onSubmitReview, onToggleExpanded }: GitReviewPanelProps) {
  const [status, setStatus] = useState<ComputerGitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [reviewControlsExpanded, setReviewControlsExpanded] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [gitActionRunning, setGitActionRunning] = useState<"branch" | "commit" | "init" | "push" | null>(null);
  const [gitActionNotice, setGitActionNotice] = useState<{ detail?: string; kind: "error" | "success"; message: string } | null>(null);
  const [selectedFileKey, setSelectedFileKey] = useState("");
  const [fileFilter, setFileFilter] = useState<FileFilter>("all");
  const [fileQuery, setFileQuery] = useState("");
  const [loadedDiffs, setLoadedDiffs] = useState<Record<string, LoadedGitDiff>>({});
  const changedFiles = useMemo(() => sortChangedFiles(status?.files ?? []), [status?.files]);
  const filteredFiles = useMemo(() => filterChangedFiles(changedFiles, fileFilter, fileQuery), [changedFiles, fileFilter, fileQuery]);
  const fileFilters = useMemo(() => createFileFilterOptions(changedFiles), [changedFiles]);
  const visibleFiles = filteredFiles;
  const selectedFile = visibleFiles.find((file) => gitChangedFileKey(file) === selectedFileKey) ?? visibleFiles[0];
  const activeFileKey = selectedFile ? gitChangedFileKey(selectedFile) : "";
  const activeLoadedDiff = activeFileKey ? loadedDiffs[activeFileKey] : undefined;
  const canReview = Boolean(status?.available && status.changedFiles > 0);
  const canRunGitAction = Boolean(status?.available);

  useEffect(() => {
    let disposed = false;

    async function refresh(showLoading: boolean) {
      if (showLoading) {
        setLoading(true);
      }

      try {
        const nextStatus = await getComputerGitStatus(root);

        if (!disposed) {
          setStatus(nextStatus);
          setLastUpdatedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
        }
      } catch (error) {
        if (!disposed) {
          setStatus(createUnavailableGitStatus(error instanceof Error ? error.message : "Git status unavailable."));
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    }

    void refresh(true);

    const timer = window.setInterval(() => {
      void refresh(false);
    }, GIT_REVIEW_REFRESH_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [root]);

  useEffect(() => {
    if (visibleFiles.length === 0) {
      if (selectedFileKey) {
        setSelectedFileKey("");
      }

      return;
    }

    if (!visibleFiles.some((file) => gitChangedFileKey(file) === selectedFileKey)) {
      setSelectedFileKey(gitChangedFileKey(visibleFiles[0]));
    }
  }, [selectedFileKey, visibleFiles]);

  useEffect(() => {
    setLoadedDiffs({});
  }, [root]);

  useEffect(() => {
    if (!status?.available || !root || !selectedFile || !activeFileKey) {
      return;
    }

    const existing = loadedDiffs[activeFileKey];
    if (existing?.loading || existing?.lines || existing?.error) {
      return;
    }

    let disposed = false;

    setLoadedDiffs((current) => ({
      ...current,
      [activeFileKey]: {
        loading: true,
      },
    }));

    void diffComputerGitChanges(root, {
      includeUntracked: true,
      paths: createGitDiffPathspecs(selectedFile),
    })
      .then((result) => {
        if (disposed) {
          return;
        }

        setLoadedDiffs((current) => ({
          ...current,
          [activeFileKey]: {
            lines: parseGitDiffOutput(result.diff),
            loading: false,
            truncated: result.truncated,
          },
        }));
        setStatus(result.status);
        setLastUpdatedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

        setLoadedDiffs((current) => ({
          ...current,
          [activeFileKey]: {
            error: readErrorMessage(error, "Could not load the full diff."),
            loading: false,
          },
        }));
      });

    return () => {
      disposed = true;
    };
  }, [activeFileKey, loadedDiffs, root, selectedFile, status?.available]);

  function submitReview(mode: ReviewMode) {
    if (!status?.available || status.changedFiles === 0) {
      return;
    }

    void onSubmitReview(createReviewPrompt(mode, status, root));
  }

  async function refreshFromButton() {
    setLoading(true);

    try {
      const nextStatus = await getComputerGitStatus(root, { force: true });
      setStatus(nextStatus);
      setLastUpdatedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
    } catch (error) {
      setStatus(createUnavailableGitStatus(error instanceof Error ? error.message : "Git status unavailable."));
    } finally {
      setLoading(false);
    }
  }

  async function runGitAction(kind: "branch" | "commit" | "init" | "push", action: () => Promise<{ message: string; output?: string; status: ComputerGitStatus }>, onSuccess?: () => void) {
    setGitActionRunning(kind);
    setGitActionNotice(null);

    try {
      const result = await action();
      setStatus(result.status);
      setLastUpdatedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
      setGitActionNotice({
        detail: result.output,
        kind: "success",
        message: result.message,
      });
      onSuccess?.();
    } catch (error) {
      setGitActionNotice({
        kind: "error",
        message: readErrorMessage(error, "Git action failed."),
      });
    } finally {
      setGitActionRunning(null);
    }
  }

  function createBranchFromPanel() {
    const nextBranchName = branchName.trim();

    if (!nextBranchName) {
      setGitActionNotice({ kind: "error", message: "Enter a branch name first." });
      return;
    }

    void runGitAction("branch", () => createComputerGitBranch(root, nextBranchName), () => setBranchName(""));
  }

  function initializeGitFromPanel() {
    void runGitAction("init", () => initComputerGitRepository(root));
  }

  function commitFromPanel() {
    const nextCommitMessage = commitMessage.trim();

    if (!nextCommitMessage) {
      setGitActionNotice({ kind: "error", message: "Enter a commit message first." });
      return;
    }

    void runGitAction("commit", () => commitComputerGitChanges(root, nextCommitMessage, true), () => setCommitMessage(""));
  }

  function pushFromPanel() {
    void runGitAction("push", () => pushComputerGitBranch(root));
  }

  const issue = !status?.available ? getGitStatusIssue(status, root) : null;
  const canInitializeGit = issue?.kind === "not-repo" && Boolean(root) && gitActionRunning === null;

  return (
    <aside className="git-review-panel" data-expanded={expanded} aria-label="Review changes">
      <div
        className="git-review-resize-handle"
        aria-label="Resize review changes"
        aria-orientation="vertical"
        aria-valuemax={resizeMaxWidth}
        aria-valuemin={resizeMinWidth}
        aria-valuenow={Math.round(previewWidth)}
        role="separator"
        tabIndex={expanded ? -1 : 0}
        onKeyDown={onResizeKeyDown}
        onPointerDown={onResizeStart}
      >
        <GripVertical size={15} aria-hidden="true" />
      </div>

      <div className="git-review-window">
        <header className="git-review-header">
          <div className="git-review-title">
            <span className="git-review-title-icon" aria-hidden="true">
              <GitBranch size={18} />
            </span>
            <span>
              <small>GitHub review</small>
              <strong>Review changes</strong>
              <em>{status?.available ? formatReviewRepositoryLabel(status, root) : issue?.title ?? "Local Git"}</em>
            </span>
          </div>
          {status?.available ? <BranchPill status={status} /> : null}
          <div className="git-review-header-actions">
            <button type="button" className="git-review-icon-button" aria-label="Refresh Git changes" title="Refresh" onClick={() => void refreshFromButton()}>
              {loading ? <LoaderCircle size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
            </button>
            <button type="button" className="git-review-icon-button" aria-label={expanded ? "Restore review changes" : "Expand review changes"} aria-pressed={expanded} title={expanded ? "Restore" : "Expand"} onClick={onToggleExpanded}>
              {expanded ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
            </button>
            <button type="button" className="git-review-icon-button" aria-label="Close review changes" title="Close" onClick={onClose}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        </header>

        {status?.available ? (
          <>
            <section className="git-review-overview" aria-label="Change summary">
              <div className="git-review-summary">
                <span>{getReviewScaleLabel(status)}</span>
                <strong>{formatGitChangedFiles(status)}</strong>
                <small>{formatBranchSync(status)}</small>
              </div>
              <div className="git-review-stat-cards" aria-label="Code added and removed">
                <span>
                  <small>Added</small>
                  <strong className="git-review-stat-add">+{formatCount(status.additions)}</strong>
                </span>
                <span>
                  <small>Removed</small>
                  <strong className="git-review-stat-remove">-{formatCount(status.deletions)}</strong>
                </span>
                <span>
                  <small>Net</small>
                  <strong data-tone={status.additions >= status.deletions ? "add" : "remove"}>{formatSignedCount(status.additions - status.deletions)}</strong>
                </span>
              </div>
            </section>

            <section className="git-review-control-panel" aria-label="Review controls" data-expanded={reviewControlsExpanded}>
              <div className="git-review-command-bar">
                <button type="button" className="git-review-control-primary" disabled={!canReview} onClick={() => submitReview("auto")}>
                  <CheckCircle2 size={16} aria-hidden="true" />
                  <span>Auto-review</span>
                </button>
                <button type="button" className="git-review-pass-button" disabled={!canReview} onClick={() => submitReview("risk")}>
                  <ShieldAlert size={16} aria-hidden="true" />
                  <span>Risks</span>
                </button>
                <button type="button" className="git-review-pass-button" disabled={!canReview} onClick={() => submitReview("tests")}>
                  <TestTube2 size={16} aria-hidden="true" />
                  <span>Tests</span>
                </button>
                <button type="button" className="git-review-pass-button" disabled={!canReview} onClick={() => submitReview("summary")}>
                  <FileCode2 size={16} aria-hidden="true" />
                  <span>Summary</span>
                </button>
                <button
                  type="button"
                  className="git-review-control-toggle"
                  aria-controls="git-review-control-body"
                  aria-expanded={reviewControlsExpanded}
                  onClick={() => setReviewControlsExpanded((isExpanded) => !isExpanded)}
                >
                  <ChevronDown size={16} aria-hidden="true" />
                  <span>Git actions</span>
                </button>
              </div>

              <div className="git-review-control-body" id="git-review-control-body" aria-hidden={!reviewControlsExpanded}>
                <div className="git-review-control-chips" aria-label="Branch details">
                  <GitReviewControlChip label="Branch" value={status.branch || "unknown"} />
                  <GitReviewControlChip label="Head" value={status.headSha || "none"} />
                  <GitReviewControlChip label="Upstream" value={status.upstream || "not set"} />
                </div>
                <div className="git-review-git-actions" aria-label="Git actions">
                  <label>
                    <span>Commit</span>
                    <input disabled={!canReview || gitActionRunning !== null || !reviewControlsExpanded} placeholder="Message" value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} />
                  </label>
                  <button type="button" disabled={!canReview || !commitMessage.trim() || gitActionRunning !== null || !reviewControlsExpanded} onClick={commitFromPanel}>
                    {gitActionRunning === "commit" ? <LoaderCircle size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                    <span>Commit</span>
                  </button>
                  <label>
                    <span>Branch</span>
                    <input disabled={!canRunGitAction || gitActionRunning !== null || !reviewControlsExpanded} placeholder="codex/review-polish" value={branchName} onChange={(event) => setBranchName(event.target.value)} />
                  </label>
                  <button type="button" disabled={!canRunGitAction || !branchName.trim() || gitActionRunning !== null || !reviewControlsExpanded} onClick={createBranchFromPanel}>
                    {gitActionRunning === "branch" ? <LoaderCircle size={16} aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}
                    <span>Branch</span>
                  </button>
                  <button type="button" disabled={!canRunGitAction || gitActionRunning !== null || !reviewControlsExpanded} onClick={pushFromPanel}>
                    {gitActionRunning === "push" ? <LoaderCircle size={16} aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}
                    <span>Push</span>
                  </button>
                </div>
                {gitActionNotice ? (
                  <div className="git-review-action-notice" data-kind={gitActionNotice.kind}>
                    <strong>{gitActionNotice.message}</strong>
                    {gitActionNotice.detail ? <small>{gitActionNotice.detail}</small> : null}
                  </div>
                ) : null}
              </div>
            </section>

            <section className="git-review-workspace" aria-label="Changed files and diff preview">
              <section className="git-review-files" aria-label="Changed files">
                <div className="git-review-section-heading">
                  <span>
                    <strong>Files</strong>
                    <small>{lastUpdatedAt ? `Updated ${lastUpdatedAt}` : "Live status"}</small>
                  </span>
                  <em>{filteredFiles.length} shown</em>
                </div>
                <label className="git-review-file-search">
                  <Search size={14} aria-hidden="true" />
                  <input aria-label="Search changed files" placeholder="Search files" value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} />
                </label>
                <div className="git-review-file-filters" aria-label="Filter changed files">
                  {fileFilters.map((filter) => (
                    <button key={filter.id} type="button" data-active={fileFilter === filter.id} disabled={filter.count === 0 && filter.id !== "all"} onClick={() => setFileFilter(filter.id)}>
                      <span>{filter.label}</span>
                      <strong>{filter.count}</strong>
                    </button>
                  ))}
                </div>
                {visibleFiles.length > 0 ? (
                  <div className="git-review-file-list">
                    {visibleFiles.map((file) => {
                      const key = gitChangedFileKey(file);

                      return <GitReviewFileRow active={key === activeFileKey} file={file} key={key} onSelect={() => setSelectedFileKey(key)} />;
                    })}
                  </div>
                ) : (
                  <div className="git-review-empty">
                    <CheckCircle2 size={18} aria-hidden="true" />
                    <span>{changedFiles.length > 0 ? "No files match this filter." : "No local changes to review."}</span>
                  </div>
                )}
              </section>

              <GitReviewDiffPane file={selectedFile} loadedDiff={activeLoadedDiff} />
            </section>
          </>
        ) : (
          <section className="git-review-error" data-kind={issue?.kind ?? "unknown"}>
            <div className="git-review-error-heading">
              <AlertTriangle size={18} aria-hidden="true" />
              <span>
                <strong>{issue?.title ?? "Git status unavailable"}</strong>
                <small>{issue?.detail ?? "Gilbert could not read local Git status."}</small>
              </span>
            </div>
            {issue?.hint ? <p>{issue.hint}</p> : null}
            {canInitializeGit || gitActionRunning === "init" ? (
              <div className="git-review-error-actions">
                <button type="button" className="git-review-control-primary" disabled={gitActionRunning !== null} onClick={initializeGitFromPanel}>
                  {gitActionRunning === "init" ? <LoaderCircle size={16} aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}
                  <span>Initialize Git</span>
                </button>
              </div>
            ) : null}
            {gitActionNotice ? (
              <div className="git-review-action-notice" data-kind={gitActionNotice.kind}>
                <strong>{gitActionNotice.message}</strong>
                {gitActionNotice.detail ? <small>{gitActionNotice.detail}</small> : null}
              </div>
            ) : null}
            {status?.error ? <pre>{status.error}</pre> : null}
          </section>
        )}
      </div>
    </aside>
  );
}

function BranchPill({ status }: { status: ComputerGitStatus }) {
  return (
    <div className="git-review-branch-pill" title={status.upstream ? `${status.branch || "unknown"} -> ${status.upstream}` : status.branch || "unknown branch"}>
      <GitBranch size={14} aria-hidden="true" />
      <span>{status.branch || "unknown"}</span>
    </div>
  );
}

function GitReviewControlChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="git-review-control-chip" title={`${label}: ${value}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </span>
  );
}

function GitReviewFileRow({ active, file, onSelect }: { active: boolean; file: ComputerGitChangedFile; onSelect: () => void }) {
  const label = formatGitChangedFileStatus(file);
  const tone = gitChangedFileStatusTone(file);

  return (
    <button type="button" className="git-review-file-row" data-active={active} data-tone={tone} onClick={onSelect}>
      <span className="git-review-file-status">{label}</span>
      <span className="git-review-file-path" title={formatGitFilePath(file)}>
        {formatGitFilePath(file)}
      </span>
      <span className="git-review-file-stats" aria-label={`${file.additions} additions and ${file.deletions} deletions`}>
        {file.additions > 0 ? <span className="git-review-stat-add">+{formatCount(file.additions)}</span> : null}
        {file.deletions > 0 ? <span className="git-review-stat-remove">-{formatCount(file.deletions)}</span> : null}
      </span>
    </button>
  );
}

function GitReviewDiffPane({ file, loadedDiff }: { file?: ComputerGitChangedFile; loadedDiff?: LoadedGitDiff }) {
  if (!file) {
    return (
      <section className="git-review-diff-pane" aria-label="Diff preview">
        <div className="git-review-diff-empty">
          <CheckCircle2 size={18} aria-hidden="true" />
          <span>No patch to preview.</span>
        </div>
      </section>
    );
  }

  const label = formatGitChangedFileStatus(file);
  const diffLines = loadedDiff?.lines ?? file.diffPreview ?? [];
  const loadingFullDiff = Boolean(loadedDiff?.loading && diffLines.length === 0);
  const fullDiffError = loadedDiff?.error;
  const truncated = Boolean(loadedDiff?.truncated);

  return (
    <section className="git-review-diff-pane" aria-label={`Diff preview for ${file.path}`}>
      <div className="git-review-diff-header">
        <span className="git-review-file-status" data-tone={gitChangedFileStatusTone(file)}>
          {label}
        </span>
        <div>
          <strong title={formatGitFilePath(file)}>{formatGitFilePath(file)}</strong>
          <small>
            {formatCount(file.additions)} added, {formatCount(file.deletions)} removed
            {loadedDiff?.loading ? " - loading full diff" : truncated ? " - truncated by request" : ""}
          </small>
        </div>
      </div>

      {loadingFullDiff ? (
        <div className="git-review-diff-empty" data-kind="loading">
          <LoaderCircle size={18} aria-hidden="true" />
          <span>Loading the full diff for this file.</span>
        </div>
      ) : fullDiffError && diffLines.length === 0 ? (
        <div className="git-review-diff-empty" data-kind="error">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>{fullDiffError}</span>
        </div>
      ) : diffLines.length > 0 ? (
        <div className="git-review-code-frame" role="region" aria-label="Code diff preview">
          {diffLines.map((line, index) => (
            <GitReviewCodeLine key={`${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`} line={line} />
          ))}
        </div>
      ) : (
        <div className="git-review-diff-empty">
          <FileCode2 size={18} aria-hidden="true" />
          <span>No text diff was returned for this file. Binary diff metadata will still appear here when Git provides it.</span>
        </div>
      )}
    </section>
  );
}

function GitReviewCodeLine({ line }: { line: ComputerGitDiffLine }) {
  return (
    <div className="git-review-code-line" data-kind={line.kind}>
      <span className="git-review-code-number">{formatCodeLineNumber(line.oldLine)}</span>
      <span className="git-review-code-number">{formatCodeLineNumber(line.newLine)}</span>
      <span className="git-review-code-marker">{formatDiffMarker(line.kind)}</span>
      <code>{line.content || " "}</code>
    </div>
  );
}

function createReviewPrompt(mode: ReviewMode, status: ComputerGitStatus, root: string) {
  const repo = formatReviewRepositoryLabel(status, root);
  const sortedFiles = sortChangedFiles(status.files ?? []);
  const files = sortedFiles
    .slice(0, MAX_REVIEW_PROMPT_FILES)
    .map((file) => `- ${formatGitChangedFileStatus(file)} ${file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}${file.additions || file.deletions ? ` (+${file.additions} -${file.deletions})` : ""}`)
    .join("\n");
  const hiddenFileCount = Math.max(sortedFiles.length - MAX_REVIEW_PROMPT_FILES, 0);
  const base = [
    "Review the current local Git changes in this workspace.",
    `Repository: ${repo}`,
    `Branch: ${status.branch || "unknown"}`,
    status.headSha ? `Head: ${status.headSha}` : "",
    status.upstream ? `Upstream: ${status.upstream} (${formatBranchSync(status)})` : `Upstream: not set (${formatBranchSync(status)})`,
    `Summary: ${formatGitChangedFiles(status)}, +${status.additions}, -${status.deletions}`,
    files ? `Changed files:\n${files}${hiddenFileCount > 0 ? `\n- ${hiddenFileCount} additional files not listed here; use git_status and git_diff for the complete patch.` : ""}` : "",
    "Use the local Git tools first: git_status, then git_diff with the current workspace root. Review the actual patch before giving findings.",
    "Do not edit files unless I explicitly ask for fixes after the review.",
  ].filter(Boolean);

  if (mode === "risk") {
    base.push("Focus the review on correctness, data loss, security, concurrency, and user-visible regressions. Lead with the highest-risk findings.");
  } else if (mode === "tests") {
    base.push("Focus the review on missing or weak tests, broken coverage expectations, and validation gaps. Suggest exact test targets.");
  } else if (mode === "summary") {
    base.push("Summarize what changed in plain engineering terms, call out risky areas, and suggest a short validation checklist.");
  } else {
    base.push("Use code-review style: findings first with file and line references, then open questions, then a short validation summary. If there are no issues, say that clearly.");
  }

  return base.join("\n\n");
}

function createGitDiffPathspecs(file: ComputerGitChangedFile) {
  const paths = [file.path];

  if (file.oldPath && file.oldPath !== file.path) {
    paths.unshift(file.oldPath);
  }

  return paths;
}

function parseGitDiffOutput(diff: string): ComputerGitDiffLine[] {
  const normalizedDiff = diff.replace(/\r\n/g, "\n");
  const rawLines = normalizedDiff.endsWith("\n") ? normalizedDiff.slice(0, -1).split("\n") : normalizedDiff.split("\n");
  const lines: ComputerGitDiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;

  for (const rawLine of rawLines) {
    if (!rawLine && !inHunk) {
      continue;
    }

    if (rawLine.startsWith("@@")) {
      const nextLines = parseDiffHunkHeader(rawLine);
      if (nextLines) {
        oldLine = nextLines.oldLine;
        newLine = nextLines.newLine;
      }
      inHunk = true;
      lines.push(createGitDiffLine("hunk", rawLine));
      continue;
    }

    if (rawLine.startsWith("diff --git ") || rawLine.startsWith("index ") || rawLine.startsWith("new file mode ") || rawLine.startsWith("deleted file mode ") || rawLine.startsWith("similarity index ") || rawLine.startsWith("rename from ") || rawLine.startsWith("rename to ") || rawLine.startsWith("--- ") || rawLine.startsWith("+++ ") || rawLine.startsWith("Binary files ") || rawLine.startsWith("GIT binary patch")) {
      lines.push(createGitDiffLine("meta", rawLine));
      continue;
    }

    if (rawLine.startsWith("\\ ")) {
      lines.push(createGitDiffLine("meta", rawLine));
      continue;
    }

    if (inHunk && rawLine.startsWith("+")) {
      lines.push(createGitDiffLine("add", rawLine.slice(1), undefined, newLine));
      newLine += 1;
      continue;
    }

    if (inHunk && rawLine.startsWith("-")) {
      lines.push(createGitDiffLine("remove", rawLine.slice(1), oldLine, undefined));
      oldLine += 1;
      continue;
    }

    if (inHunk && rawLine.startsWith(" ")) {
      lines.push(createGitDiffLine("context", rawLine.slice(1), oldLine, newLine));
      oldLine += 1;
      newLine += 1;
      continue;
    }

    lines.push(createGitDiffLine("meta", rawLine));
  }

  return lines;
}

function createGitDiffLine(kind: ComputerGitDiffLine["kind"], content: string, oldLine?: number, newLine?: number): ComputerGitDiffLine {
  return {
    content,
    kind,
    newLine,
    oldLine,
  };
}

function parseDiffHunkHeader(line: string) {
  const match = /^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line);

  if (!match) {
    return null;
  }

  return {
    newLine: Number(match[2]),
    oldLine: Number(match[1]),
  };
}

function filterChangedFiles(files: ComputerGitChangedFile[], filter: FileFilter, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  return files.filter((file) => {
    const label = formatGitChangedFileStatus(file);
    const matchesFilter =
      filter === "all" ||
      (filter === "added" && label === "Added") ||
      (filter === "deleted" && label === "Deleted") ||
      (filter === "modified" && label === "Modified") ||
      (filter === "renamed" && (label === "Renamed" || label === "Copied"));

    if (!matchesFilter) {
      return false;
    }

    if (!normalizedQuery) {
      return true;
    }

    return formatGitFilePath(file).toLowerCase().includes(normalizedQuery);
  });
}

function createFileFilterOptions(files: ComputerGitChangedFile[]): Array<{ count: number; id: FileFilter; label: string }> {
  return [
    { count: files.length, id: "all", label: "All" },
    { count: files.filter((file) => formatGitChangedFileStatus(file) === "Modified").length, id: "modified", label: "Modified" },
    { count: files.filter((file) => formatGitChangedFileStatus(file) === "Added").length, id: "added", label: "Added" },
    { count: files.filter((file) => formatGitChangedFileStatus(file) === "Deleted").length, id: "deleted", label: "Deleted" },
    {
      count: files.filter((file) => {
        const label = formatGitChangedFileStatus(file);
        return label === "Renamed" || label === "Copied";
      }).length,
      id: "renamed",
      label: "Moved",
    },
  ];
}

function sortChangedFiles(files: ComputerGitChangedFile[]) {
  return [...files].sort((left, right) => {
    const leftRank = gitChangedFileRank(left);
    const rightRank = gitChangedFileRank(right);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.path.localeCompare(right.path);
  });
}

function gitChangedFileRank(file: ComputerGitChangedFile) {
  const status = formatGitChangedFileStatus(file);

  if (status === "Deleted") {
    return 0;
  }

  if (status === "Modified") {
    return 1;
  }

  if (status === "Renamed") {
    return 2;
  }

  return 3;
}

function gitChangedFileKey(file: ComputerGitChangedFile) {
  return `${file.status}:${file.oldPath ?? ""}->${file.path}`;
}

function formatGitFilePath(file: ComputerGitChangedFile) {
  return file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path;
}

function formatBranchSync(status: ComputerGitStatus) {
  const parts = [];

  if (status.ahead > 0) {
    parts.push(`${status.ahead} ahead`);
  }

  if (status.behind > 0) {
    parts.push(`${status.behind} behind`);
  }

  if (parts.length > 0) {
    return parts.join(", ");
  }

  return status.upstream ? "Up to date with upstream" : "No upstream branch";
}

function getReviewScaleLabel(status: ComputerGitStatus) {
  if (status.changedFiles >= 75 || status.additions + status.deletions >= 5_000) {
    return "Large review";
  }

  if (status.changedFiles >= 20 || status.additions + status.deletions >= 1_000) {
    return "Focused review";
  }

  return "Working tree";
}

function formatCount(value: number) {
  return value.toLocaleString();
}

function formatSignedCount(value: number) {
  if (value > 0) {
    return `+${formatCount(value)}`;
  }

  if (value < 0) {
    return `-${formatCount(Math.abs(value))}`;
  }

  return "0";
}

function formatDiffMarker(kind: ComputerGitDiffLine["kind"]) {
  if (kind === "add") {
    return "+";
  }

  if (kind === "remove") {
    return "-";
  }

  if (kind === "hunk") {
    return "@";
  }

  return "";
}

function formatCodeLineNumber(line?: number) {
  return line ? line.toString() : "";
}

function formatReviewRepositoryLabel(status: ComputerGitStatus, root: string) {
  if (status.githubOwner && status.githubRepo) {
    return `${status.githubOwner}/${status.githubRepo}`;
  }

  return status.remoteUrl || status.repositoryRoot || root || "Local repository";
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : typeof error === "string" && error.trim() ? error : fallback;
}

function createUnavailableGitStatus(error: string): ComputerGitStatus {
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
