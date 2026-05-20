import { GitBranch, LoaderCircle, RefreshCw, ShieldAlert, TestTube2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { formatGitChangedFileStatus, formatGitChangedFiles, getGitStatusIssue } from "../../lib/gitStatusUi";
import { getComputerGitStatus } from "../../localWorkspace/files";
import type { AgentRun } from "../../types/agentRun";
import type { RiskReviewFileSummary, RiskReviewSummary, VerificationPlan } from "../../types/coding";
import type { ComputerGitStatus } from "../../types/localWorkspace";
import { createRiskReviewSummary, inferFilePurpose, inferRiskTags } from "../../coding/riskReview";
import { createVerificationPlan } from "../../coding/verificationPlanner";
import { EmptyCodingState, RiskPill, StatusPill, formatCount, verificationStatusTone } from "./CodingSidecarShared";

interface CodingReviewTabProps {
  activeRun?: AgentRun;
  root: string;
  onSubmitPrompt: (prompt: string) => void | Promise<void>;
}

export function CodingReviewTab({ activeRun, root, onSubmitPrompt }: CodingReviewTabProps) {
  const [status, setStatus] = useState<ComputerGitStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const review = useMemo(() => createReview(activeRun, status), [activeRun, status]);
  const verification = useMemo(() => createVerification(activeRun, review), [activeRun, review]);
  const issue = !status?.available ? getGitStatusIssue(status, root) : null;

  useEffect(() => {
    let disposed = false;
    if (!root) {
      setStatus(null);
      return;
    }

    setLoading(true);
    void getComputerGitStatus(root, { includeDiffPreview: true })
      .then((nextStatus) => {
        if (!disposed) setStatus(nextStatus);
      })
      .catch((error) => {
        if (!disposed) {
          setStatus({
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
        if (!disposed) setLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [root]);

  function askForVerification() {
    const checks = verification.items
      .filter((item) => item.status === "recommended" && item.command)
      .map((item) => `- ${item.command}: ${item.reason}`)
      .join("\n");
    void onSubmitPrompt([
      "Run the recommended verification for the current local changes using the real bridge tools.",
      checks ? `Recommended checks:\n${checks}` : "No command checks were generated; inspect the latest run details and choose the smallest useful verification.",
      "After running checks, summarize pass/fail status and remaining risk.",
    ].join("\n\n"));
  }

  function askForRiskReview() {
    void onSubmitPrompt("Review the current local changes with the local Git tools. Lead with correctness, security, data loss, terminal/filesystem/provider risk, and missing verification.");
  }

  if (!root) {
    return <EmptyCodingState title="No workspace selected" detail="Choose a local project folder to review Git changes and verification impact." />;
  }

  return (
    <div className="coding-tab coding-review-tab">
      <section className="coding-review-hero" data-risk={review.riskLevel}>
        <div>
          <span className="coding-kicker">Review</span>
          <h3>{status?.available ? formatGitChangedFiles(status) : issue?.title ?? "Coding run review"}</h3>
          <p>{status?.available ? `${formatCount(status.additions)} added, ${formatCount(status.deletions)} removed on ${status.branch || "current branch"}.` : issue?.detail ?? "Git status has not loaded yet."}</p>
        </div>
        <RiskPill level={review.riskLevel} />
      </section>

      <div className="coding-command-row">
        <button type="button" onClick={askForRiskReview}>
          <ShieldAlert size={16} aria-hidden="true" />
          <span>Ask for risk review</span>
        </button>
        <button type="button" onClick={askForVerification}>
          <TestTube2 size={16} aria-hidden="true" />
          <span>Ask Gilbert to verify</span>
        </button>
      </div>

      <section className="coding-review-section" data-section="changed-files">
        <div className="coding-section-heading">
          <span>
            <strong>Changed files</strong>
            <small>{loading ? "Refreshing Git status" : `${review.changedFiles.length} captured`}</small>
          </span>
          {loading ? <LoaderCircle size={16} aria-hidden="true" /> : <GitBranch size={16} aria-hidden="true" />}
        </div>
        {review.changedFiles.length > 0 ? (
          <div className="coding-file-list">
            {review.changedFiles.map((file) => (
              <article className="coding-file-row" key={file.path} data-risk={file.riskLevel}>
                <div>
                  <strong title={file.path}>{file.path}</strong>
                  <small>{file.purpose}</small>
                </div>
                <span className="coding-file-stats">
                  {file.additions ? <b data-kind="add">+{formatCount(file.additions)}</b> : null}
                  {file.deletions ? <b data-kind="remove">-{formatCount(file.deletions)}</b> : null}
                </span>
                <RiskPill level={file.riskLevel} />
              </article>
            ))}
          </div>
        ) : (
          <EmptyCodingState title="No file changes captured" detail={status?.available && status.clean ? "The workspace is clean." : "Run or refresh a coding action to attach file changes."} />
        )}
      </section>

      <section className="coding-review-section">
        <div className="coding-section-heading">
          <span>
            <strong>Verification</strong>
            <small>{verification.items.length} checks</small>
          </span>
          <RefreshCw size={16} aria-hidden="true" />
        </div>
        <div className="coding-verification-list">
          {verification.items.map((item) => (
            <article className="coding-verification-row" key={item.id} data-tone={verificationStatusTone(item.status)}>
              <StatusPill status={item.status} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.command ?? item.reason}</small>
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="coding-review-section">
        <div className="coding-section-heading">
          <span>
            <strong>Handoff</strong>
            <small>Commit and PR draft material</small>
          </span>
          <Wand2 size={16} aria-hidden="true" />
        </div>
        <div className="coding-handoff">
          <label>
            <span>Commit</span>
            <code>{review.suggestedCommitMessage}</code>
          </label>
          <label>
            <span>PR summary</span>
            <p>{review.suggestedPrSummary}</p>
          </label>
          {review.sensitiveAreas.length > 0 ? (
            <label>
              <span>Risk areas</span>
              <p>{review.sensitiveAreas.join(", ")}</p>
            </label>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function createReview(activeRun: AgentRun | undefined, status: ComputerGitStatus | null): RiskReviewSummary {
  if (isUsableReview(activeRun?.coding?.review)) {
    return mergeGitStatusIntoReview(activeRun.coding.review, status);
  }

  if (activeRun?.toolCalls?.length) {
    return mergeGitStatusIntoReview(createRiskReviewSummary(activeRun.toolCalls), status);
  }

  return mergeGitStatusIntoReview(createRiskReviewSummary([]), status);
}

function createVerification(activeRun: AgentRun | undefined, review: RiskReviewSummary): VerificationPlan {
  return isUsableVerification(activeRun?.coding?.verification) ? activeRun.coding.verification : createVerificationPlan({ review, toolCalls: activeRun?.toolCalls ?? [] });
}

function mergeGitStatusIntoReview(review: RiskReviewSummary, status: ComputerGitStatus | null): RiskReviewSummary {
  if (!status?.available || !status.files?.length) {
    return review;
  }

  const existing = new Set(review.changedFiles.map((file) => file.path));
  const gitFiles: RiskReviewFileSummary[] = status.files
    .filter((file) => !existing.has(file.path))
    .map((file) => {
      const tags = inferRiskTags(file.path);
      return {
        additions: file.additions,
        deletions: file.deletions,
        path: file.path,
        purpose: inferFilePurpose(file.path),
        riskLevel: tags.length > 0 ? "medium" : "low",
        status: formatGitChangedFileStatus(file),
        tags,
      };
    });

  return {
    ...review,
    changedFiles: [...review.changedFiles, ...gitFiles],
  };
}

function isUsableReview(value: unknown): value is RiskReviewSummary {
  const review = value as Partial<RiskReviewSummary> | undefined;
  return Boolean(
    review &&
    Array.isArray(review.changedFiles) &&
    Array.isArray(review.sensitiveAreas) &&
    Array.isArray(review.testsRun) &&
    Array.isArray(review.unverifiedAssumptions) &&
    typeof review.suggestedCommitMessage === "string" &&
    typeof review.suggestedPrSummary === "string",
  );
}

function isUsableVerification(value: unknown): value is VerificationPlan {
  const plan = value as Partial<VerificationPlan> | undefined;
  return Boolean(plan && Array.isArray(plan.items) && Array.isArray(plan.assumptions));
}
