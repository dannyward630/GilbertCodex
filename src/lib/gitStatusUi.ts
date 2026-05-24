import type { ComputerGitChangedFile, ComputerGitStatus } from "../types/localWorkspace";

export interface GitStatusIssue {
  detail: string;
  hint: string;
  kind: "busy" | "missing-git" | "missing-path" | "no-root" | "not-repo" | "permission" | "trust" | "unknown";
  title: string;
}

export function formatGitChangedFiles(status: ComputerGitStatus | null) {
  if (!status?.available || status.changedFiles === 0) {
    return "No files changed";
  }

  return status.changedFiles === 1 ? "1 file changed" : `${status.changedFiles} files changed`;
}

export function formatGitChangeStripLabel(status: ComputerGitStatus | null) {
  if (!status?.available || status.changedFiles === 0) {
    return "No local Git changes";
  }

  return `${formatGitChangedFiles(status)}, ${status.additions} lines added, ${status.deletions} lines removed`;
}

export function getGitStatusIssue(status: ComputerGitStatus | null, root: string): GitStatusIssue {
  const error = status?.error?.trim() ?? "";
  const normalizedError = error.toLowerCase();

  if (!root) {
    return {
      detail: "Git status needs a local workspace folder.",
      hint: "Choose a project folder from the project menu.",
      kind: "no-root",
      title: "Choose a workspace",
    };
  }

  if (!status) {
    return {
      detail: "Gilbert is checking local Git status for this workspace.",
      hint: "This should finish automatically; refresh Git if it takes more than a few seconds.",
      kind: "unknown",
      title: "Checking Git status",
    };
  }

  if (!error || normalizedError.includes("not a git repository")) {
    return {
      detail: "This folder is not inside a Git repository.",
      hint: "Pick a repository folder, or initialize Git in this workspace.",
      kind: "not-repo",
      title: "No Git repository detected",
    };
  }

  if (normalizedError.includes("does not exist") || normalizedError.includes("cannot find the path") || normalizedError.includes("no such file or directory")) {
    return {
      detail: "The selected workspace path no longer exists.",
      hint: "Choose an existing project folder before reviewing changes.",
      kind: "missing-path",
      title: "Workspace folder not found",
    };
  }

  if (normalizedError.includes("could not run git") || normalizedError.includes("not recognized") || normalizedError.includes("program not found") || normalizedError.includes("os error 2")) {
    return {
      detail: "The Git executable is not available to the desktop app.",
      hint: "Install Git, add it to PATH, then restart Gilbert Codex.",
      kind: "missing-git",
      title: "Git is not installed",
    };
  }

  if (normalizedError.includes("access is denied") || normalizedError.includes("permission denied") || normalizedError.includes("operation not permitted")) {
    return {
      detail: "Git cannot read this workspace with the current permissions.",
      hint: "Check folder permissions or choose a different project folder.",
      kind: "permission",
      title: "Git cannot read this folder",
    };
  }

  if (normalizedError.includes("dubious ownership") || normalizedError.includes("safe.directory")) {
    return {
      detail: "Git blocked this repository because it is not marked as trusted.",
      hint: "Mark the folder as safe in Git, then refresh the workspace.",
      kind: "trust",
      title: "Repository trust check failed",
    };
  }

  if (normalizedError.includes("index.lock") || normalizedError.includes("another git process")) {
    return {
      detail: "Another Git operation appears to be using this repository.",
      hint: "Wait for the current Git operation to finish, then review changes again.",
      kind: "busy",
      title: "Git repository is busy",
    };
  }

  return {
    detail: "The local Git command returned an error.",
    hint: "The raw Git message is shown below for troubleshooting.",
    kind: "unknown",
    title: "Git status failed",
  };
}

export function formatGitChangedFileStatus(file: ComputerGitChangedFile) {
  const status = file.status.trim();

  if (status === "??") {
    return "Added";
  }

  if (status.includes("D")) {
    return "Deleted";
  }

  if (status.includes("R")) {
    return "Renamed";
  }

  if (status.includes("C")) {
    return "Copied";
  }

  if (status.includes("A")) {
    return "Added";
  }

  if (status.includes("M")) {
    return "Modified";
  }

  return "Changed";
}

export function gitChangedFileStatusTone(file: ComputerGitChangedFile) {
  const label = formatGitChangedFileStatus(file);

  if (label === "Added") {
    return "add";
  }

  if (label === "Deleted") {
    return "delete";
  }

  if (label === "Renamed" || label === "Copied") {
    return "move";
  }

  return "change";
}
