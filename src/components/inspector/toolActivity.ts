import type { ChatToolCall } from "../../types/chat";

export interface ToolActivityChip {
  label: string;
  tone?: "bad" | "good" | "info" | "muted";
}

export interface StructuredToolActivity {
  chips: ToolActivityChip[];
  outputSummary?: string;
  summaryParts: string[];
}

export function getStructuredToolActivity(toolCall: ChatToolCall): StructuredToolActivity {
  const input = parseToolInput(toolCall.input);
  const label = toolCall.label.toLowerCase();
  const summaryParts: string[] = [];
  const chips: ToolActivityChip[] = [];

  if (label.includes("search workspace files")) {
    chips.push({ label: "search", tone: "info" });
    pushQuerySummary(summaryParts, input);
    pushPathSummary(summaryParts, input);

    if (input?.regex === true) {
      chips.push({ label: "regex" });
    }
    if (input?.caseSensitive === true) {
      chips.push({ label: "case-sensitive" });
    }
    if (input?.includeContent === false) {
      chips.push({ label: "paths only" });
    }
    pushGeneratedChip(chips, input);

    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (label.includes("read many workspace files")) {
    const paths = Array.isArray(input?.paths) ? input.paths.filter((path): path is string => typeof path === "string") : [];
    chips.push({ label: "batch read", tone: "info" });
    if (paths.length > 0) {
      chips.push({ label: paths.length === 1 ? "1 path" : `${paths.length} paths` });
      summaryParts.push(formatPathListSummary(paths));
    }
    pushMaxBytesSummary(summaryParts, chips, input);

    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (label.includes("read workspace file range")) {
    chips.push({ label: "range read", tone: "info" });
    pushPathSummary(summaryParts, input);
    if (typeof input?.startLine === "number" && typeof input?.endLine === "number") {
      summaryParts.push(`lines ${input.startLine}-${input.endLine}`);
      chips.push({ label: "line range" });
    }
    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (label.includes("read workspace file")) {
    chips.push({ label: "read", tone: "info" });
    pushPathSummary(summaryParts, input);
    pushMaxBytesSummary(summaryParts, chips, input);
    return { chips, summaryParts };
  }

  if (label.includes("list workspace directory")) {
    chips.push({ label: "list", tone: "info" });
    pushPathSummary(summaryParts, input);
    if (input?.recursive === true) {
      chips.push({ label: "recursive" });
    }
    pushGeneratedChip(chips, input);
    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (label.includes("count source lines")) {
    chips.push({ label: "count", tone: "info" });
    pushPathSummary(summaryParts, input);
    pushGeneratedChip(chips, input);
    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (label.includes("summarize workspace tree")) {
    chips.push({ label: "tree", tone: "info" });
    pushPathSummary(summaryParts, input);
    if (input?.includeGenerated === true) {
      chips.push({ label: "includes generated" });
    }
    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (label.includes("stat workspace path")) {
    chips.push({ label: "stat", tone: "info" });
    pushPathSummary(summaryParts, input);
    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (
    label.includes("edit file by exact replace") ||
    label.includes("insert text at line") ||
    label.includes("replace file line range") ||
    label.includes("append to workspace file") ||
    label.includes("apply workspace patch") ||
    label.includes("write workspace file") ||
    label.includes("move workspace path")
  ) {
    chips.push({ label: "edit", tone: "info" });

    if (label.includes("write workspace file")) {
      chips.push({ label: "write", tone: "info" });
    } else if (label.includes("apply workspace patch")) {
      chips.push({ label: "patch", tone: "info" });
    } else if (label.includes("move workspace path")) {
      chips.push({ label: "move", tone: "info" });
    }

    if (input?.dryRun === true) {
      chips.push({ label: "dry run" });
    }

    pushPathSummary(summaryParts, input);
    pushMovePathSummary(summaryParts, input);
    pushLineEditSummary(summaryParts, input);

    if (typeof input?.oldText === "string" && input.oldText.trim()) {
      summaryParts.push(`replaces "${limitInline(cleanInline(input.oldText), 60)}"`);
    }

    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (label.includes("run tool smoke test")) {
    chips.push({ label: "diagnostic", tone: "info" });
    chips.push({ label: "smoke test" });
    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  if (label.includes("git")) {
    chips.push({ label: label.includes("github") ? "github" : "git", tone: "info" });

    if (label.includes("diff")) {
      chips.push({ label: "diff" });
    } else if (label.includes("status")) {
      chips.push({ label: "status" });
    } else if (label.includes("commit")) {
      chips.push({ label: "commit" });
    } else if (label.includes("branch")) {
      chips.push({ label: "branch" });
    } else if (label.includes("push") || label.includes("release") || label.includes("pull request") || label.includes("workflow")) {
      chips.push({ label: "publish", tone: "bad" });
    }

    if (input?.dryRun === true) {
      chips.push({ label: "dry run" });
    }

    pushPathSummary(summaryParts, input);
    pushGitPathListSummary(summaryParts, input);
    pushGitRepositorySummary(summaryParts, input);

    if (typeof input?.message === "string" && input.message.trim()) {
      summaryParts.push(`message "${limitInline(cleanInline(input.message), 60)}"`);
    }
    if (typeof input?.name === "string" && input.name.trim()) {
      summaryParts.push(`branch ${limitInline(input.name.trim(), 60)}`);
    }
    if (typeof input?.newBranch === "string" && input.newBranch.trim()) {
      summaryParts.push(`branch ${limitInline(input.newBranch.trim(), 60)}`);
    }
    if (typeof input?.workflowId === "string" && input.workflowId.trim()) {
      summaryParts.push(`workflow ${limitInline(input.workflowId.trim(), 60)}`);
    }

    return {
      chips,
      outputSummary: firstOutputLine(toolCall.output),
      summaryParts,
    };
  }

  return {
    chips,
    outputSummary: firstOutputLine(toolCall.output),
    summaryParts,
  };
}

function parseToolInput(input: string | undefined): Record<string, unknown> | null {
  if (!input) {
    return null;
  }

  try {
    const parsed = JSON.parse(input);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function pushQuerySummary(summaryParts: string[], input: Record<string, unknown> | null) {
  if (typeof input?.query === "string" && input.query.trim()) {
    summaryParts.push(`query "${limitInline(input.query.trim(), 80)}"`);
  }
}

function pushPathSummary(summaryParts: string[], input: Record<string, unknown> | null) {
  if (typeof input?.path === "string" && input.path.trim()) {
    summaryParts.push(formatSinglePathSummary(input.path.trim()));
  }
}

function pushMovePathSummary(summaryParts: string[], input: Record<string, unknown> | null) {
  if (typeof input?.fromPath === "string" && typeof input?.toPath === "string" && input.fromPath.trim() && input.toPath.trim()) {
    summaryParts.push(`move ${shortenPath(input.fromPath.trim())} -> ${shortenPath(input.toPath.trim())}`);
  }
}

function pushLineEditSummary(summaryParts: string[], input: Record<string, unknown> | null) {
  if (typeof input?.line === "number" && Number.isFinite(input.line)) {
    summaryParts.push(`line ${Math.floor(input.line)}`);
    return;
  }

  if (typeof input?.startLine === "number" && typeof input?.endLine === "number" && Number.isFinite(input.startLine) && Number.isFinite(input.endLine)) {
    summaryParts.push(`lines ${Math.floor(input.startLine)}-${Math.floor(input.endLine)}`);
  }
}

function pushMaxBytesSummary(summaryParts: string[], chips: ToolActivityChip[], input: Record<string, unknown> | null) {
  if (typeof input?.maxBytes === "number" && Number.isFinite(input.maxBytes) && input.maxBytes > 0) {
    const maxBytes = Math.floor(input.maxBytes);
    chips.push({ label: "bounded" });
    summaryParts.push(`bounded to ${formatNumber(maxBytes)} bytes`);
  }
}

function pushGeneratedChip(chips: ToolActivityChip[], input: Record<string, unknown> | null) {
  if (input?.includeGenerated === true) {
    chips.push({ label: "includes generated" });
  }
}

function pushGitPathListSummary(summaryParts: string[], input: Record<string, unknown> | null) {
  const paths = Array.isArray(input?.paths) ? input.paths.filter((path): path is string => typeof path === "string" && path.trim().length > 0) : [];
  if (paths.length > 0) {
    summaryParts.push(formatPathListSummary(paths));
  }
}

function pushGitRepositorySummary(summaryParts: string[], input: Record<string, unknown> | null) {
  if (typeof input?.owner === "string" && typeof input?.repo === "string" && input.owner.trim() && input.repo.trim()) {
    summaryParts.push(`${input.owner.trim()}/${input.repo.trim()}`);
  }
}

function formatSinglePathSummary(path: string) {
  return `path ${shortenPath(path)}`;
}

function formatPathListSummary(paths: string[]) {
  if (paths.length === 1) {
    return `path ${shortenPath(paths[0]!)}`;
  }

  if (paths.length <= 3) {
    return `${paths.length} paths: ${paths.map(shortenPath).join(", ")}`;
  }

  return `${paths.length} paths: ${paths.slice(0, 2).map(shortenPath).join(", ")} and ${paths.length - 2} more`;
}

function firstOutputLine(output: string | undefined) {
  const line = output
    ?.split(/\r?\n/)
    .map((value) => cleanInline(value))
    .find(Boolean);

  return line ? limitInline(line, 140) : undefined;
}

function shortenPath(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);

  if (segments.length <= 3) {
    return normalized;
  }

  return segments.slice(-3).join("/");
}

function cleanInline(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function limitInline(value: string, maxChars: number) {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}...`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}
