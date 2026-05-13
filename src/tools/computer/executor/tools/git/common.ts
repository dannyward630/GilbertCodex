import type { TerminalShellId } from "../../../../../types/terminal";
import { booleanArg, firstArg, normalizeComparablePath, optionalNumberArg } from "../../argHelpers";
import { isRecord } from "../../parser";
import { quoteShellArg } from "../../shell";
import type { ParsedLocalComputerToolCall } from "../../types";

const GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT = 64 * 1024;
export function createGitCommand(call: ParsedLocalComputerToolCall, shell: TerminalShellId, workingDirectory: string) {
  const paths = parseGitPaths(call.args, workingDirectory);
  const all = booleanArg(call.args, ["all", "all_files", "allFiles"], false);
  const remote = firstArg(call.args, ["remote"]);
  const branch = firstArg(call.args, ["branch", "ref"]);

  switch (call.tool) {
    case "git_init": {
      const initialBranch = firstArg(call.args, ["initial_branch", "initialBranch", "branch", "default_branch", "defaultBranch"]) || "main";
      const headRef = `refs/heads/${initialBranch}`;
      if (shell === "powershell") {
        return `git init; if ($LASTEXITCODE -eq 0) { git symbolic-ref HEAD ${quoteShellArg(headRef, shell)} }`;
      }
      return `git init && git symbolic-ref HEAD ${quoteShellArg(headRef, shell)}`;
    }
    case "git_status":
      return "git --no-pager status --short --branch --untracked-files=all";
    case "git_diff": {
      return createGitDiffCommand(call, shell, paths);
    }
    case "git_log": {
      const limit = optionalNumberArg(call.args, ["limit", "count", "n"]);
      return ["git", "log", "--oneline", "--decorate", limit !== undefined ? `-n ${Math.max(1, Math.trunc(limit))}` : ""].filter(Boolean).join(" ");
    }
    case "git_stage":
      if (all) {
        return "git add -A";
      }
      return paths.length > 0 ? ["git", "add", "--", ...paths.map((path) => quoteShellArg(path, shell))].join(" ") : "";
    case "git_unstage":
      if (all) {
        return "git restore --staged .";
      }
      return paths.length > 0 ? ["git", "restore", "--staged", "--", ...paths.map((path) => quoteShellArg(path, shell))].join(" ") : "";
    case "git_commit": {
      const message = firstArg(call.args, ["message", "commit_message", "commitMessage"]);
      return message ? `git commit -m ${quoteShellArg(message, shell)}` : "";
    }
    case "git_push": {
      const setUpstream = booleanArg(call.args, ["set_upstream", "setUpstream", "upstream"], false);
      const forceWithLease = booleanArg(call.args, ["force_with_lease", "forceWithLease"], false);
      const targetRemote = remote || (branch ? "origin" : "");
      return ["git", "push", forceWithLease ? "--force-with-lease" : "", setUpstream ? "--set-upstream" : "", targetRemote ? quoteShellArg(targetRemote, shell) : "", branch ? quoteShellArg(branch, shell) : ""].filter(Boolean).join(" ");
    }
    case "git_pull": {
      const rebase = booleanArg(call.args, ["rebase"], false);
      const targetRemote = remote || (branch ? "origin" : "");
      return ["git", "pull", rebase ? "--rebase" : "", targetRemote ? quoteShellArg(targetRemote, shell) : "", branch ? quoteShellArg(branch, shell) : ""].filter(Boolean).join(" ");
    }
    case "git_fetch": {
      const prune = booleanArg(call.args, ["prune"], true);
      return ["git", "fetch", prune ? "--prune" : "", remote ? quoteShellArg(remote, shell) : ""].filter(Boolean).join(" ");
    }
    case "git_branch": {
      const namedBranch = firstArg(call.args, ["name", "branch", "ref"]);
      const createRequested = booleanArg(call.args, ["create", "new"], false);
      const deleteRequested = booleanArg(call.args, ["delete"], false);
      const newBranch = firstArg(call.args, ["new_branch", "newBranch"]) || (createRequested ? namedBranch : "");
      const deleteBranch = firstArg(call.args, ["delete_branch", "deleteBranch"]) || (deleteRequested ? namedBranch : "");
      const force = booleanArg(call.args, ["force"], false);

      if (deleteBranch) {
        return ["git", "branch", force ? "-D" : "-d", quoteShellArg(deleteBranch, shell)].join(" ");
      }

      if (newBranch) {
        const base = firstArg(call.args, ["base", "base_branch", "baseBranch", "from"]);
        return ["git", "branch", quoteShellArg(newBranch, shell), base ? quoteShellArg(base, shell) : ""].filter(Boolean).join(" ");
      }

      return ["git", "branch", "--all", "--verbose", namedBranch && !createRequested && !deleteRequested ? "--list" : "", namedBranch && !createRequested && !deleteRequested ? quoteShellArg(namedBranch, shell) : ""].filter(Boolean).join(" ");
    }
    case "git_checkout": {
      const target = firstArg(call.args, ["branch", "ref", "name"]);
      const create = booleanArg(call.args, ["create", "new", "new_branch", "newBranch"], false);
      const base = firstArg(call.args, ["base", "base_branch", "baseBranch", "from"]);

      if (!target) {
        return "";
      }

      return create
        ? ["git", "switch", "-c", quoteShellArg(target, shell), base ? quoteShellArg(base, shell) : ""].filter(Boolean).join(" ")
        : ["git", "switch", quoteShellArg(target, shell)].join(" ");
    }
    default:
      return "";
  }
}

function createGitDiffCommand(call: ParsedLocalComputerToolCall, shell: TerminalShellId, paths: string[]) {
  const staged = booleanArg(call.args, ["staged", "cached"], false);
  const statOnly = booleanArg(call.args, ["stat", "summary"], false);
  const includeUntracked = booleanArg(call.args, ["include_untracked", "includeUntracked", "untracked"], !staged);
  const target = staged ? "--cached" : "HEAD";
  const trackedCommand = [
    "git",
    "--no-pager",
    "diff",
    "--no-ext-diff",
    "--no-color",
    target,
    "--stat",
    statOnly ? "" : "--patch",
    ...gitPathspecArgs(paths, shell),
  ].filter(Boolean).join(" ");

  if (staged || !includeUntracked) {
    return trackedCommand;
  }

  return appendUntrackedGitDiffDump(trackedCommand, paths, shell, statOnly);
}

function appendUntrackedGitDiffDump(trackedCommand: string, paths: string[], shell: TerminalShellId, statOnly: boolean) {
  const untrackedCommand = [
    "git",
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...paths.map((path) => quoteShellArg(path, shell)),
  ].filter(Boolean).join(" ");

  if (shell === "powershell") {
    const body = statOnly
      ? [
          "$__gilbert_untracked = @(" + untrackedCommand + ")",
          "if ($__gilbert_untracked.Count -gt 0) { Write-Output ''; Write-Output 'UNTRACKED FILES'; $__gilbert_untracked }",
        ].join("; ")
      : [
          `$__gilbert_max_untracked_bytes = ${GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT}`,
          "$__gilbert_untracked = @(" + untrackedCommand + ")",
          "if ($__gilbert_untracked.Count -gt 0) {",
          "Write-Output ''; Write-Output 'UNTRACKED FILES (full text for text files)'",
          "foreach ($__p in $__gilbert_untracked) {",
          "Write-Output ''; Write-Output ('===== UNTRACKED FILE: ' + $__p + ' =====')",
          "if (Test-Path -LiteralPath $__p -PathType Leaf) {",
          "$__full = (Resolve-Path -LiteralPath $__p).Path",
          "$__bytes = [System.IO.File]::ReadAllBytes($__full)",
          "$__take = [Math]::Min($__bytes.Length, $__gilbert_max_untracked_bytes)",
          "if ([Array]::IndexOf($__bytes, [byte]0) -ge 0) { Write-Output '[binary file omitted from text diff]' } else { Write-Output ([System.Text.Encoding]::UTF8.GetString($__bytes, 0, $__take)); if ($__bytes.Length -gt $__take) { Write-Output ('[untracked file text truncated after ' + $__take + ' bytes of ' + $__bytes.Length + ' bytes]') } }",
          "} else { Write-Output '[not a regular file]' }",
          "}",
          "}",
        ].join("; ");
    return `${trackedCommand}; ${body}`;
  }

  if (shell === "bash" || shell === "zsh" || shell === "sh") {
    const listCommand = untrackedCommand;
    const body = statOnly
      ? `printf '\\nUNTRACKED FILES\\n'; ${listCommand}`
      : [
          `${listCommand} | while IFS= read -r __p; do`,
          `printf '\\n===== UNTRACKED FILE: %s =====\\n' "$__p";`,
          `if [ -f "$__p" ]; then if LC_ALL=C grep -Iq . "$__p"; then __size=$(wc -c < "$__p" 2>/dev/null || printf 0); head -c ${GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT} "$__p"; if [ "$__size" -gt ${GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT} ] 2>/dev/null; then printf '\\n[untracked file text truncated after ${GIT_UNTRACKED_FILE_TEXT_BYTE_LIMIT} bytes of %s bytes]\\n' "$__size"; fi; else printf '[binary file omitted from text diff]\\n'; fi; else printf '[not a regular file]\\n'; fi;`,
          "done",
        ].join(" ");
    return `${trackedCommand}; if [ -n "$(${listCommand})" ]; then ${body}; fi`;
  }

  return `${trackedCommand} & echo. & echo UNTRACKED FILES & ${untrackedCommand}`;
}

function gitPathspecArgs(paths: string[], shell: TerminalShellId) {
  return paths.length > 0 ? ["--", ...paths.map((path) => quoteShellArg(path, shell))] : [];
}

function parseGitPaths(args: Record<string, string>, workingDirectory?: string) {
  const rawJson = firstArg(args, ["paths_json", "pathsJson"]);

  if (rawJson) {
    return filterGitPathspecs(parseGitPathList(rawJson), workingDirectory);
  }

  const raw = firstArg(args, ["paths", "path", "file_path", "file", "files"]);

  if (!raw) {
    return [];
  }

  return filterGitPathspecs(parseGitPathList(raw), workingDirectory);
}

function parseGitPathList(raw: string) {
  const trimmed = raw.trim();

  if (!trimmed) {
    return [];
  }

  const parsedJsonPaths = parseJsonGitPathList(trimmed);

  if (parsedJsonPaths) {
    return parsedJsonPaths;
  }

  return trimmed.split(/[\n,]/).map(normalizeGitPath).filter(Boolean);
}

function parseJsonGitPathList(raw: string): string[] | undefined {
  if (!raw.startsWith("[") && !raw.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed)
        ? parsed.paths ?? parsed.files ?? parsed.pathspecs
        : undefined;

    if (!Array.isArray(items)) {
      return undefined;
    }

    return items.map(normalizeGitPathItem).filter(Boolean);
  } catch {
    return undefined;
  }
}

function normalizeGitPathItem(item: unknown) {
  if (typeof item === "string" || typeof item === "number") {
    return normalizeGitPath(String(item));
  }

  if (isRecord(item)) {
    const path = item.path ?? item.file ?? item.file_path;
    return typeof path === "string" || typeof path === "number" ? normalizeGitPath(String(path)) : "";
  }

  return "";
}

function normalizeGitPath(path: string) {
  const normalized = path.trim();

  if (!normalized || normalized.includes("\0") || normalized.includes("\n") || normalized.includes("\r")) {
    return "";
  }

  return normalized;
}

function filterGitPathspecs(paths: string[], workingDirectory?: string) {
  if (!workingDirectory) {
    return paths;
  }

  const normalizedWorkingDirectory = normalizeComparablePath(workingDirectory);

  return paths.filter((path) => {
    const normalizedPath = normalizeComparablePath(path);
    return normalizedPath !== normalizedWorkingDirectory;
  });
}
