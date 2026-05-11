import { AlertTriangle, CheckCircle2, ChevronDown, FileCode2, GitBranch, LoaderCircle, RefreshCw, ShieldAlert, TestTube2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatGitChangedFileStatus, formatGitChangedFiles, getGitStatusIssue, gitChangedFileStatusTone } from "../../lib/gitStatusUi";
import { commitComputerGitChanges, createComputerGitBranch, getComputerGitStatus, pushComputerGitBranch } from "../../tools/computer/files";
import type { ComputerGitChangedFile, ComputerGitDiffLine, ComputerGitStatus } from "../../types/localWorkspace";

const GIT_REVIEW_REFRESH_INTERVAL_MS = 2_500;
const MAX_REVIEW_FILES = 80;

type ReviewMode = "auto" | "risk" | "summary" | "tests";

interface GitReviewPanelProps {
  root: string;
  onClose: () => void;
  onSubmitReview: (prompt: string) => void | Promise<void>;
}

export function GitReviewPanel({ root, onClose, onSubmitReview }: GitReviewPanelProps) {
  const [status, setStatus] = useState<ComputerGitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [reviewControlsExpanded, setReviewControlsExpanded] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const [gitActionRunning, setGitActionRunning] = useState<"branch" | "commit" | "push" | null>(null);
  const [gitActionNotice, setGitActionNotice] = useState<{ detail?: string; kind: "error" | "success"; message: string } | null>(null);
  const [selectedFileKey, setSelectedFileKey] = useState("");
  const changedFiles = useMemo(() => sortChangedFiles(status?.files ?? []), [status?.files]);
  const visibleFiles = useMemo(() => changedFiles.slice(0, MAX_REVIEW_FILES), [changedFiles]);
  const hiddenFiles = Math.max(changedFiles.length - visibleFiles.length, 0);
  const selectedFile = visibleFiles.find((file) => gitChangedFileKey(file) === selectedFileKey) ?? visibleFiles[0];
  const activeFileKey = selectedFile ? gitChangedFileKey(selectedFile) : "";
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

  function submitReview(mode: ReviewMode) {
    if (!status?.available || status.changedFiles === 0) {
      return;
    }

    void onSubmitReview(createReviewPrompt(mode, status, root));
  }

  async function refreshFromButton() {
    setLoading(true);

    try {
      const nextStatus = await getComputerGitStatus(root);
      setStatus(nextStatus);
      setLastUpdatedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }));
    } catch (error) {
      setStatus(createUnavailableGitStatus(error instanceof Error ? error.message : "Git status unavailable."));
    } finally {
      setLoading(false);
    }
  }

  async function runGitAction(kind: "branch" | "commit" | "push", action: () => Promise<{ message: string; output?: string; status: ComputerGitStatus }>, onSuccess?: () => void) {
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

  return (
    <aside className="git-review-panel" aria-label="Review changes">
      <header className="git-review-header">
        <div className="git-review-title">
          <span className="git-review-title-icon" aria-hidden="true">
            <GitBranch size={18} />
          </span>
          <span>
            <strong>Review changes</strong>
            <small>{status?.available ? formatReviewRepositoryLabel(status, root) : issue?.title ?? "Local Git"}</small>
          </span>
        </div>
        {status?.available ? <BranchPill status={status} /> : null}
        <div className="git-review-header-actions">
          <button type="button" className="git-review-icon-button" aria-label="Refresh Git changes" title="Refresh" onClick={() => void refreshFromButton()}>
            {loading ? <LoaderCircle size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}
          </button>
          <button type="button" className="git-review-icon-button" aria-label="Close review changes" title="Close" onClick={onClose}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
      </header>

      {status?.available ? (
        <>
          <section className="git-review-summary" aria-label="Change summary">
            <div className="git-review-summary-copy">
              <span>Working tree</span>
              <strong>{formatGitChangedFiles(status)}</strong>
              <small>{formatBranchSync(status)}</small>
            </div>
            <div className="git-review-stat-cards" aria-label="Code added and removed">
              <span>
                <small>Added</small>
                <strong className="git-review-stat-add">+{status.additions}</strong>
              </span>
              <span>
                <small>Removed</small>
                <strong className="git-review-stat-remove">-{status.deletions}</strong>
              </span>
            </div>
          </section>

          <section className="git-review-control-panel" aria-label="Review controls" data-expanded={reviewControlsExpanded}>
            <div className="git-review-control-top">
              <button
                type="button"
                className="git-review-control-toggle"
                aria-controls="git-review-control-body"
                aria-expanded={reviewControlsExpanded}
                onClick={() => setReviewControlsExpanded((expanded) => !expanded)}
              >
                <ChevronDown size={16} aria-hidden="true" />
                <span>
                  <strong>Review</strong>
                  <small>{formatBranchSync(status)}</small>
                </span>
              </button>
              <div className="git-review-control-chips" aria-label="Branch details">
                <GitReviewControlChip label="Branch" value={status.branch || "unknown"} />
                <GitReviewControlChip label="Head" value={status.headSha || "none"} />
                <GitReviewControlChip label="Upstream" value={status.upstream || "not set"} />
              </div>
              <button type="button" className="git-review-control-primary" disabled={!canReview} onClick={() => submitReview("auto")}>
                <CheckCircle2 size={16} aria-hidden="true" />
                <span>Auto-review</span>
              </button>
            </div>
            <div className="git-review-control-body" id="git-review-control-body" aria-hidden={!reviewControlsExpanded}>
              <div className="git-review-control-passes" aria-label="Review passes">
                <button type="button" disabled={!canReview || !reviewControlsExpanded} onClick={() => submitReview("risk")}>
                  <ShieldAlert size={16} aria-hidden="true" />
                  <span>Risks</span>
                </button>
                <button type="button" disabled={!canReview || !reviewControlsExpanded} onClick={() => submitReview("tests")}>
                  <TestTube2 size={16} aria-hidden="true" />
                  <span>Tests</span>
                </button>
                <button type="button" disabled={!canReview || !reviewControlsExpanded} onClick={() => submitReview("summary")}>
                  <FileCode2 size={16} aria-hidden="true" />
                  <span>Summary</span>
                </button>
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
                  <input disabled={!canRunGitAction || gitActionRunning !== null || !reviewControlsExpanded} placeholder="new-branch" value={branchName} onChange={(event) => setBranchName(event.target.value)} />
                </label>
                <button type="button" disabled={!canRunGitAction || !branchName.trim() || gitActionRunning !== null || !reviewControlsExpanded} onClick={createBranchFromPanel}>
                  {gitActionRunning === "branch" ? <LoaderCircle size={16} aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}
                  <span>New branch</span>
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
                <strong>Files</strong>
                <small>{lastUpdatedAt ? `Updated ${lastUpdatedAt}` : "Live"}</small>
              </div>
              {visibleFiles.length > 0 ? (
                <div className="git-review-file-list">
                  {visibleFiles.map((file) => {
                    const key = gitChangedFileKey(file);

                    return <GitReviewFileRow active={key === activeFileKey} file={file} key={key} onSelect={() => setSelectedFileKey(key)} />;
                  })}
                  {hiddenFiles > 0 ? <div className="git-review-hidden-files">+{hiddenFiles} more files</div> : null}
                </div>
              ) : (
                <div className="git-review-empty">
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <span>No local changes to review.</span>
                </div>
              )}
            </section>

            <GitReviewDiffPane file={selectedFile} />
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
          {status?.error ? <pre>{status.error}</pre> : null}
        </section>
      )}
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
        {file.additions > 0 ? <span className="git-review-stat-add">+{file.additions}</span> : null}
        {file.deletions > 0 ? <span className="git-review-stat-remove">-{file.deletions}</span> : null}
      </span>
    </button>
  );
}

function GitReviewDiffPane({ file }: { file?: ComputerGitChangedFile }) {
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
  const diffLines = file.diffPreview ?? [];

  return (
    <section className="git-review-diff-pane" aria-label={`Diff preview for ${file.path}`}>
      <div className="git-review-diff-header">
        <span className="git-review-file-status" data-tone={gitChangedFileStatusTone(file)}>
          {label}
        </span>
        <div>
          <strong title={formatGitFilePath(file)}>{formatGitFilePath(file)}</strong>
          <small>
            {file.additions} added, {file.deletions} removed
          </small>
        </div>
      </div>

      {diffLines.length > 0 ? (
        <div className="git-review-code-frame" role="region" aria-label="Code diff preview">
          {diffLines.map((line, index) => (
            <GitReviewCodeLine key={`${line.kind}-${line.oldLine ?? ""}-${line.newLine ?? ""}-${index}`} line={line} />
          ))}
        </div>
      ) : (
        <div className="git-review-diff-empty">
          <FileCode2 size={18} aria-hidden="true" />
          <span>No text preview for this file. It may be binary, too large, or unchanged in the text diff.</span>
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
  const files = sortChangedFiles(status.files ?? [])
    .slice(0, MAX_REVIEW_FILES)
    .map((file) => `- ${formatGitChangedFileStatus(file)} ${file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}${file.additions || file.deletions ? ` (+${file.additions} -${file.deletions})` : ""}`)
    .join("\n");
  const base = [
    "Review the current local Git changes in this workspace.",
    `Repository: ${repo}`,
    `Branch: ${status.branch || "unknown"}`,
    status.headSha ? `Head: ${status.headSha}` : "",
    status.upstream ? `Upstream: ${status.upstream} (${formatBranchSync(status)})` : `Upstream: not set (${formatBranchSync(status)})`,
    `Summary: ${formatGitChangedFiles(status)}, +${status.additions}, -${status.deletions}`,
    files ? `Changed files:\n${files}` : "",
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
