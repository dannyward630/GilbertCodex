import type { ChatToolCall, ChatToolResultPolicy } from "../types/chat";
import type { ToolExecutionResult } from "./types";

export type ToolResultKind =
  | "diagnostic"
  | "edit"
  | "file_content"
  | "git"
  | "search"
  | "summary"
  | "terminal"
  | "unknown";

export type VisibleToolResultMode = "allow_raw" | "safe_summary" | "synthesize";

export interface ToolResultFinalizationOptions {
  arguments?: unknown;
  label?: string;
  maxProviderChars?: number | null;
  result: ToolExecutionResult;
  toolId: string;
}

export interface ToolResultFinalization {
  activityContent: string;
  providerContent: string;
  providerRawCharCount: number;
  resultKind: ToolResultKind;
  visibleFallback: string;
  visiblePolicy: ChatToolResultPolicy;
}

interface ToolResultPolicyTemplate {
  kind: ToolResultKind;
  mode: VisibleToolResultMode;
  synthesizeAfterwards: boolean;
}

const DEFAULT_POLICY: ToolResultPolicyTemplate = {
  kind: "unknown",
  mode: "safe_summary",
  synthesizeAfterwards: true,
};

const TOOL_RESULT_POLICIES: Record<string, ToolResultPolicyTemplate> = {
  bridge_echo: { kind: "diagnostic", mode: "allow_raw", synthesizeAfterwards: false },
  bridge_sum: { kind: "diagnostic", mode: "allow_raw", synthesizeAfterwards: false },
  files_append: { kind: "edit", mode: "safe_summary", synthesizeAfterwards: true },
  files_apply_patch: { kind: "edit", mode: "safe_summary", synthesizeAfterwards: true },
  files_count_lines: { kind: "summary", mode: "safe_summary", synthesizeAfterwards: true },
  files_exact_replace: { kind: "edit", mode: "safe_summary", synthesizeAfterwards: true },
  files_insert_at_line: { kind: "edit", mode: "safe_summary", synthesizeAfterwards: true },
  files_list: { kind: "summary", mode: "safe_summary", synthesizeAfterwards: true },
  files_move: { kind: "edit", mode: "safe_summary", synthesizeAfterwards: true },
  files_read: { kind: "file_content", mode: "synthesize", synthesizeAfterwards: true },
  files_read_many: { kind: "file_content", mode: "synthesize", synthesizeAfterwards: true },
  files_read_range: { kind: "file_content", mode: "synthesize", synthesizeAfterwards: true },
  files_replace_range: { kind: "edit", mode: "safe_summary", synthesizeAfterwards: true },
  files_search: { kind: "search", mode: "safe_summary", synthesizeAfterwards: true },
  files_stat: { kind: "summary", mode: "safe_summary", synthesizeAfterwards: true },
  files_tree_summary: { kind: "summary", mode: "safe_summary", synthesizeAfterwards: true },
  files_write: { kind: "edit", mode: "safe_summary", synthesizeAfterwards: true },
  git_branch: { kind: "git", mode: "safe_summary", synthesizeAfterwards: true },
  git_commit: { kind: "git", mode: "safe_summary", synthesizeAfterwards: true },
  git_diff: { kind: "git", mode: "safe_summary", synthesizeAfterwards: true },
  git_init: { kind: "git", mode: "safe_summary", synthesizeAfterwards: true },
  git_pull: { kind: "git", mode: "safe_summary", synthesizeAfterwards: true },
  git_push: { kind: "git", mode: "safe_summary", synthesizeAfterwards: true },
  git_stage: { kind: "git", mode: "safe_summary", synthesizeAfterwards: true },
  git_status: { kind: "git", mode: "safe_summary", synthesizeAfterwards: true },
  terminal_run: { kind: "terminal", mode: "safe_summary", synthesizeAfterwards: true },
  tool_smoke_test: { kind: "diagnostic", mode: "safe_summary", synthesizeAfterwards: false },
};

export function finalizeToolResult(options: ToolResultFinalizationOptions): ToolResultFinalization {
  const rawContent = createToolResultContent(options.result);
  const policyTemplate = resolveToolResultPolicy(options.toolId, options.result);
  const activityContent = rawContent;
  const providerContent = limitToolResultContentForProvider(rawContent, options.maxProviderChars);
  const visibleFallback = createVisibleFallback({
    arguments: options.arguments,
    label: options.label,
    policy: policyTemplate,
    rawContent,
    result: options.result,
    toolId: options.toolId,
  });
  const visiblePolicy: ChatToolResultPolicy = {
    mode: policyTemplate.mode,
    resultKind: policyTemplate.kind,
    synthesizeAfterwards: policyTemplate.synthesizeAfterwards,
  };

  return {
    activityContent,
    providerContent,
    providerRawCharCount: rawContent.length,
    resultKind: policyTemplate.kind,
    visibleFallback,
    visiblePolicy,
  };
}

export function createToolResultContent(result: ToolExecutionResult) {
  if (result.content.trim()) {
    return result.content.trim();
  }

  if (result.error) {
    return result.error;
  }

  if (result.data !== undefined) {
    return safeStringifyResultData(result.data);
  }

  return result.ok ? "Tool completed." : "Tool did not complete.";
}

export function limitToolResultContentForProvider(content: string, maxChars: number | null | undefined) {
  if (maxChars === null || maxChars === undefined || !Number.isFinite(maxChars)) {
    return content;
  }

  const limit = Math.floor(maxChars);

  if (limit <= 0) {
    return [
      "[Tool output omitted from provider context because the model-visible tool-result budget was already used.]",
      "The full result is saved in Activity. Use files_search or a narrower files_read/files_read_many call if exact content is still needed.",
    ].join("\n");
  }

  if (content.length <= limit) {
    return content;
  }

  const marker = [
    "",
    `[Tool output truncated for provider context after ${limit.toLocaleString("en-US")} characters.]`,
    "The full result is saved in Activity. Use files_search or a narrower files_read/files_read_many call if exact omitted content is still needed.",
  ].join("\n");
  const sliceLength = Math.max(0, limit - marker.length);

  return `${content.slice(0, sliceLength).trimEnd()}${marker}`;
}

export function isVisibleToolResultLeak(content: string, toolCalls: ChatToolCall[] = []) {
  const normalizedContent = normalizeVisibleResultText(content);

  if (!normalizedContent || toolCalls.length === 0) {
    return false;
  }

  return toolCalls.some((toolCall) => {
    const policy = toolCall.resultPolicy;

    if (!policy?.synthesizeAfterwards && policy?.mode === "allow_raw") {
      return false;
    }

    const output = normalizeVisibleResultText(toolCall.output ?? "");
    const fallback = normalizeVisibleResultText(createVisibleFallbackFromToolCall(toolCall));

    return Boolean(
      output && isSameOrPrefixToolText(normalizedContent, output) ||
      fallback && isSameOrPrefixToolText(normalizedContent, fallback) ||
      matchesToolResultSignature(content, toolCall.toolId, policy?.resultKind),
    );
  });
}

export function createVisibleFallbackFromToolCall(toolCall: ChatToolCall) {
  const policy = toolCall.resultPolicy;
  const toolId = toolCall.toolId ?? "";
  const output = toolCall.output ?? toolCall.detail ?? "";

  if (policy?.mode === "allow_raw") {
    return output || "The tool completed.";
  }

  return createSafeSummary({
    arguments: toolCall.input,
    label: toolCall.label,
    policy: {
      kind: policy?.resultKind ?? resolveToolResultPolicy(toolId).kind,
      mode: policy?.mode ?? "safe_summary",
      synthesizeAfterwards: policy?.synthesizeAfterwards ?? true,
    },
    rawContent: output,
    result: { content: output, ok: toolCall.status === "complete" },
    toolId,
  });
}

export function shouldToolCallForceSynthesis(toolCall: ChatToolCall) {
  return toolCall.resultPolicy?.synthesizeAfterwards === true;
}

function resolveToolResultPolicy(toolId: string, result?: ToolExecutionResult): ToolResultPolicyTemplate {
  const fromMap = TOOL_RESULT_POLICIES[toolId];

  if (fromMap) {
    return result?.ok === false
      ? { ...fromMap, mode: "safe_summary", synthesizeAfterwards: true }
      : fromMap;
  }

  if (toolId.startsWith("github_")) {
    return { kind: "git", mode: "safe_summary", synthesizeAfterwards: true };
  }

  if (toolId.startsWith("files_")) {
    return { kind: "summary", mode: "safe_summary", synthesizeAfterwards: true };
  }

  if (result?.ok === false) {
    return { ...DEFAULT_POLICY, synthesizeAfterwards: true };
  }

  return DEFAULT_POLICY;
}

function createVisibleFallback({
  arguments: args,
  label,
  policy,
  rawContent,
  result,
  toolId,
}: {
  arguments?: unknown;
  label?: string;
  policy: ToolResultPolicyTemplate;
  rawContent: string;
  result: ToolExecutionResult;
  toolId: string;
}) {
  if (policy.mode === "allow_raw") {
    return rawContent;
  }

  return createSafeSummary({ arguments: args, label, policy, rawContent, result, toolId });
}

function createSafeSummary({
  arguments: args,
  label,
  policy,
  rawContent,
  result,
  toolId,
}: {
  arguments?: unknown;
  label?: string;
  policy: ToolResultPolicyTemplate;
  rawContent: string;
  result: ToolExecutionResult;
  toolId: string;
}) {
  const path = readPathFromArguments(args);
  const title = label || toolId || "Tool";

  if (!result.ok) {
    return [
      `${title} did not complete cleanly.`,
      result.error || result.skippedReason || firstMeaningfulLine(rawContent) || "Review Activity for details.",
    ].filter(Boolean).join("\n");
  }

  if (policy.kind === "file_content") {
    return [
      path ? `Read \`${path}\`.` : "Read the requested file content.",
      summarizeSize(rawContent),
      "Use the saved tool result to answer the request; do not paste the raw file body unless the user explicitly asked for it.",
    ].filter(Boolean).join("\n");
  }

  if (policy.kind === "summary") {
    return [
      `${title} completed.`,
      createSummaryDetail(rawContent),
      "Use the saved result to answer the request instead of pasting the raw tool recap.",
    ].filter(Boolean).join("\n");
  }

  if (policy.kind === "search") {
    return [
      `${title} completed.`,
      createSummaryDetail(rawContent),
      "Use the matching paths and line references from the saved result to answer the request.",
    ].filter(Boolean).join("\n");
  }

  if (policy.kind === "edit") {
    return [
      `${title} completed.`,
      createFileChangeSummary(result) || createSummaryDetail(rawContent),
    ].filter(Boolean).join("\n");
  }

  if (policy.kind === "git") {
    return [
      `${title} completed.`,
      createSummaryDetail(rawContent),
      "Use the saved Git result to answer with a concise status, diff, or next step.",
    ].filter(Boolean).join("\n");
  }

  if (policy.kind === "terminal") {
    return [
      `${title} completed.`,
      createSummaryDetail(rawContent),
    ].filter(Boolean).join("\n");
  }

  return [
    `${title} completed.`,
    createSummaryDetail(rawContent),
  ].filter(Boolean).join("\n");
}

function createSummaryDetail(rawContent: string) {
  const firstLine = firstMeaningfulLine(rawContent);

  if (!firstLine) {
    return "";
  }

  return firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine;
}

function createFileChangeSummary(result: ToolExecutionResult) {
  const data = result.data;

  if (!data || typeof data !== "object" || Array.isArray(data) || !("fileChanges" in data)) {
    return "";
  }

  const fileChanges = (data as { fileChanges?: unknown }).fileChanges;

  if (!Array.isArray(fileChanges) || fileChanges.length === 0) {
    return "";
  }

  const totals = fileChanges.reduce(
    (accumulator, change) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) {
        return accumulator;
      }
      const record = change as Record<string, unknown>;
      accumulator.files += 1;
      accumulator.additions += typeof record.additions === "number" ? record.additions : 0;
      accumulator.deletions += typeof record.deletions === "number" ? record.deletions : 0;
      return accumulator;
    },
    { additions: 0, deletions: 0, files: 0 },
  );

  return `${totals.files} file${totals.files === 1 ? "" : "s"} changed, +${totals.additions} -${totals.deletions}.`;
}

function readPathFromArguments(args: unknown) {
  if (!args) {
    return "";
  }

  if (typeof args === "string") {
    try {
      return readPathFromArguments(JSON.parse(args));
    } catch {
      return "";
    }
  }

  if (typeof args === "object" && !Array.isArray(args)) {
    const record = args as Record<string, unknown>;
    if (typeof record.path === "string") {
      return record.path;
    }
    if (Array.isArray(record.paths)) {
      return record.paths.filter((path): path is string => typeof path === "string").slice(0, 3).join(", ");
    }
  }

  return "";
}

function firstMeaningfulLine(content: string) {
  return content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}

function summarizeSize(content: string) {
  const lineCount = content ? content.split(/\r?\n/).length : 0;
  return `${content.length.toLocaleString("en-US")} characters across ${lineCount.toLocaleString("en-US")} line${lineCount === 1 ? "" : "s"}.`;
}

function matchesToolResultSignature(content: string, toolId?: string, resultKind?: ToolResultKind) {
  const normalized = content.toLowerCase();

  if (toolId === "files_tree_summary" || resultKind === "summary") {
    if (normalized.includes("workspace tree summary for")) {
      return true;
    }
  }

  if (toolId === "files_read" || toolId === "files_read_many" || toolId === "files_read_range" || resultKind === "file_content") {
    if (normalized.includes("full file content is saved") || /\bread .+ successfully\.[\s\S]{0,120}content size:/i.test(content)) {
      return true;
    }
  }

  return false;
}

function isSameOrPrefixToolText(content: string, toolText: string) {
  if (!toolText) {
    return false;
  }

  if (content === toolText) {
    return true;
  }

  const sample = toolText.slice(0, Math.min(toolText.length, 400));
  return sample.length >= 80 && (content.startsWith(sample) || content.includes(sample));
}

function normalizeVisibleResultText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function safeStringifyResultData(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}
