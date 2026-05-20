import type { ChatToolCall } from "../types/chat";
import type { RiskReviewSummary, VerificationPlan, VerificationPlanItem } from "../types/coding";

export function createVerificationPlan(options: {
  changedPaths?: string[];
  review?: RiskReviewSummary;
  toolCalls?: ChatToolCall[];
}): VerificationPlan {
  const changedPaths = Array.from(new Set([
    ...(options.changedPaths ?? []),
    ...(options.review?.changedFiles.map((file) => file.path) ?? []),
    ...extractChangedPathsFromToolCalls(options.toolCalls ?? []),
  ]));
  const executedCommands = extractExecutedCommands(options.toolCalls ?? []);
  const items = new Map<string, VerificationPlanItem>();

  for (const item of recommendChecks(changedPaths)) {
    items.set(item.id, item);
  }

  for (const executed of executedCommands) {
    const existing = findMatchingRecommendedItem(items, executed.command);
    const item: VerificationPlanItem = {
      command: executed.command,
      id: existing?.id ?? `executed-${stableId(executed.command)}`,
      kind: "test",
      label: existing?.label ?? executed.command,
      reason: existing?.reason ?? "Captured from a terminal tool call during this run.",
      status: executed.exitCode === 0 ? "passed" : executed.exitCode === null || executed.exitCode === undefined ? "unknown" : "failed",
      toolCallId: executed.toolCallId,
    };

    items.set(item.id, item);
  }

  if (items.size === 0) {
    items.set("manual-review", {
      id: "manual-review",
      kind: "manual",
      label: "Review gathered evidence",
      reason: "No changed files or verification commands were captured yet.",
      status: "recommended",
    });
  }

  return {
    assumptions: createAssumptions(changedPaths, executedCommands.length),
    generatedAt: new Date().toISOString(),
    items: [...items.values()],
    version: 1,
  };
}

export function recommendChecks(changedPaths: string[]): VerificationPlanItem[] {
  const normalized = changedPaths.map((path) => path.replace(/\\/g, "/"));
  const items: VerificationPlanItem[] = [];
  const hasTs = normalized.some((path) => /^src\/.*\.(ts|tsx)$/i.test(path));
  const hasUi = normalized.some((path) => /^src\/(components|pages|styles)\//i.test(path) || /\.(css|tsx)$/i.test(path));
  const hasToolBridge = normalized.some((path) => /^src\/toolBridge\//i.test(path));
  const hasRust = normalized.some((path) => /^src-tauri\//i.test(path));
  const hasReleaseScript = normalized.some((path) => /^(scripts\/|src-tauri\/tauri\.updater|.*installer|.*release)/i.test(path));
  const hasSharedRuntime = normalized.some((path) => /^src\/(app|services|lib|prompts)\//i.test(path));

  if (hasToolBridge) {
    items.push({
      command: "npm run test:tool-bridge",
      id: "tool-bridge-tests",
      kind: "test",
      label: "Tool bridge tests",
      reason: "Tool bridge changes affect model-callable execution and result handling.",
      status: "recommended",
    });
  }

  if (hasTs || hasUi || hasSharedRuntime || hasToolBridge) {
    items.push({
      command: "npm run typecheck",
      id: "typecheck",
      kind: "test",
      label: "TypeScript typecheck",
      reason: "TypeScript/runtime/UI changes should compile before handoff.",
      status: "recommended",
    });
  }

  if (hasSharedRuntime || hasUi || normalized.length > 8) {
    items.push({
      command: "npm run build",
      id: "frontend-build",
      kind: "test",
      label: "Frontend build",
      reason: "Shared runtime or UI changes can fail only after bundling.",
      status: "recommended",
    });
  }

  if (hasRust) {
    items.push({
      command: "npm run rust:fmt:check",
      id: "rust-fmt",
      kind: "test",
      label: "Rust format check",
      reason: "Rust/Tauri changes should satisfy repository formatting.",
      status: "recommended",
    });
    items.push({
      command: "npm run rust:check",
      id: "rust-check",
      kind: "test",
      label: "Rust compile check",
      reason: "Tauri command and storage changes must compile on the desktop backend.",
      status: "recommended",
    });
  }

  if (hasReleaseScript) {
    items.push({
      command: "npm run app:installer",
      id: "installer-build",
      kind: "test",
      label: "Installer build",
      reason: "Installer/release files need packaging validation before publish.",
      status: "recommended",
    });
  }

  if (hasUi) {
    items.push({
      id: "browser-preview",
      kind: "browser",
      label: "Browser preview smoke check",
      reason: "UI changes should be previewed with console logs and a visual smoke check.",
      status: "recommended",
    });
  }

  return dedupeItems(items);
}

function extractChangedPathsFromToolCalls(toolCalls: ChatToolCall[]) {
  const paths = new Set<string>();

  for (const toolCall of toolCalls) {
    for (const change of toolCall.fileChanges ?? []) {
      paths.add(change.path);
    }

    for (const result of toolCall.batchFileResults ?? []) {
      paths.add(result.path);
    }
  }

  return [...paths];
}

function extractExecutedCommands(toolCalls: ChatToolCall[]) {
  return toolCalls
    .filter((toolCall) => toolCall.terminal?.command || toolCall.toolId === "terminal_run")
    .map((toolCall) => ({
      command: toolCall.terminal?.command ?? extractCommand(toolCall.input),
      exitCode: toolCall.terminal?.exitCode,
      toolCallId: toolCall.id,
    }))
    .filter((item) => Boolean(item.command));
}

function extractCommand(input?: string) {
  if (!input) return "";

  try {
    const parsed = JSON.parse(input) as { command?: unknown };
    return typeof parsed.command === "string" ? parsed.command : "";
  } catch {
    return "";
  }
}

function findMatchingRecommendedItem(items: Map<string, VerificationPlanItem>, command: string) {
  const normalized = normalizeCommand(command);

  return [...items.values()].find((item) => item.command && normalizeCommand(item.command) === normalized);
}

function normalizeCommand(command: string) {
  return command.replace(/\s+/g, " ").trim().toLowerCase();
}

function createAssumptions(changedPaths: string[], executedCommandCount: number) {
  const assumptions: string[] = [];

  if (changedPaths.length === 0) {
    assumptions.push("Changed-file impact is based on captured tool evidence only; no file mutations were recorded.");
  }

  if (executedCommandCount === 0) {
    assumptions.push("No terminal verification command was captured yet.");
  }

  return assumptions;
}

function dedupeItems(items: VerificationPlanItem[]) {
  const seen = new Set<string>();
  const deduped: VerificationPlanItem[] = [];

  for (const item of items) {
    const key = item.command ? normalizeCommand(item.command) : item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function stableId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}
