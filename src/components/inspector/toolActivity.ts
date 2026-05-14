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
