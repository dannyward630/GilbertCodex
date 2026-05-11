import { AlertTriangle, CheckCircle2, FileCode2, GitBranch, LoaderCircle, RefreshCw, ShieldAlert, TestTube2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatGitChangedFileStatus, formatGitChangedFiles, getGitStatusIssue, gitChangedFileStatusTone } from "../../lib/gitStatusUi";
import { getComputerGitStatus } from "../../tools/computer/files";
import type { ComputerGitChangedFile, ComputerGitStatus } from "../../types/localWorkspace";

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
  const changedFiles = useMemo(() => sortChangedFiles(status?.files ?? []), [status?.files]);
  const visibleFiles = changedFiles.slice(0, MAX_REVIEW_FILES);
  const hiddenFiles = Math.max(changedFiles.length - visibleFiles.length, 0);
  const canReview = Boolean(status?.available && status.changedFiles > 0);

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
            <small>{status?.available ? status.branch || "Git repository" : issue?.title ?? "Local Git"}</small>
          </span>
        </div>
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
            <div>
              <strong>{formatGitChangedFiles(status)}</strong>
              <small>{formatReviewRepositoryLabel(status, root)}</small>
            </div>
            <div className="git-review-stat-row" aria-label="Code added and removed">
              <span className="git-review-stat-add">+{status.additions}</span>
              <span className="git-review-stat-remove">-{status.deletions}</span>
            </div>
          </section>

          <section className="git-review-actions" aria-label="Review actions">
            <button type="button" className="git-review-action-primary" disabled={!canReview} onClick={() => submitReview("auto")}>
              <CheckCircle2 size={17} aria-hidden="true" />
              <span>
                <strong>Auto-review</strong>
                <small>Find bugs, regressions, and missing tests</small>
              </span>
            </button>
            <div className="git-review-action-grid">
              <button type="button" disabled={!canReview} onClick={() => submitReview("risk")}>
                <ShieldAlert size={16} aria-hidden="true" />
                <span>Risk pass</span>
              </button>
              <button type="button" disabled={!canReview} onClick={() => submitReview("tests")}>
                <TestTube2 size={16} aria-hidden="true" />
                <span>Test pass</span>
              </button>
              <button type="button" disabled={!canReview} onClick={() => submitReview("summary")}>
                <FileCode2 size={16} aria-hidden="true" />
                <span>Summary</span>
              </button>
            </div>
          </section>

          <section className="git-review-files" aria-label="Changed files">
            <div className="git-review-section-heading">
              <strong>Changed files</strong>
              <small>{lastUpdatedAt ? `Updated ${lastUpdatedAt}` : "Live"}</small>
            </div>
            {visibleFiles.length > 0 ? (
              <div className="git-review-file-list">
                {visibleFiles.map((file) => (
                  <GitReviewFileRow file={file} key={`${file.status}-${file.path}-${file.oldPath ?? ""}`} />
                ))}
                {hiddenFiles > 0 ? <div className="git-review-hidden-files">+{hiddenFiles} more files</div> : null}
              </div>
            ) : (
              <div className="git-review-empty">
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>No local changes to review.</span>
              </div>
            )}
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

function GitReviewFileRow({ file }: { file: ComputerGitChangedFile }) {
  const label = formatGitChangedFileStatus(file);
  const tone = gitChangedFileStatusTone(file);

  return (
    <article className="git-review-file-row" data-tone={tone}>
      <span className="git-review-file-status">{label}</span>
      <span className="git-review-file-path" title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}>
        {file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
      </span>
      <span className="git-review-file-stats" aria-label={`${file.additions} additions and ${file.deletions} deletions`}>
        {file.additions > 0 ? <span className="git-review-stat-add">+{file.additions}</span> : null}
        {file.deletions > 0 ? <span className="git-review-stat-remove">-{file.deletions}</span> : null}
      </span>
    </article>
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

function formatReviewRepositoryLabel(status: ComputerGitStatus, root: string) {
  if (status.githubOwner && status.githubRepo) {
    return `${status.githubOwner}/${status.githubRepo}`;
  }

  return status.remoteUrl || status.repositoryRoot || root || "Local repository";
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
