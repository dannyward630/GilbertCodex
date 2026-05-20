import type { ChatToolCall } from "../types/chat";
import type { CodingRiskLevel, RiskReviewFileSummary, RiskReviewSummary } from "../types/coding";

const SENSITIVE_AREA_PATTERNS: Array<{ area: string; pattern: RegExp; tag: string }> = [
  { area: "auth", pattern: /\bauth|session|login|signup|token\b/i, tag: "auth" },
  { area: "credentials", pattern: /\b(secret|api[-_]?key|credential|password|token|\.env|local\.properties)\b/i, tag: "credentials" },
  { area: "filesystem", pattern: /\b(localWorkspace|files|filesystem|fs_|path|storage)\b|src[\\/]localWorkspace/i, tag: "filesystem" },
  { area: "terminal", pattern: /\bterminal|pty|command|shell\b/i, tag: "terminal" },
  { area: "Git/GitHub", pattern: /\bgit|github|pull request|branch|commit|push\b/i, tag: "git" },
  { area: "provider calls", pattern: /\bprovider|modelProvider|openrouter|responses|anthropic|toolBridge\b/i, tag: "provider" },
  { area: "local database/storage", pattern: /\bdatabase|sqlite|appStorage|memory|storage\b/i, tag: "storage" },
  { area: "Tauri capabilities", pattern: /\bsrc-tauri|tauri|invoke|commands[\\/]|capabilit/i, tag: "tauri" },
  { area: "release/installer", pattern: /\brelease|installer|nsis|updater|tauri\.updater|generate-installer\b/i, tag: "release" },
];

export function createRiskReviewSummary(toolCalls: ChatToolCall[] = [], finalContent?: string): RiskReviewSummary {
  const changedFiles = collectChangedFiles(toolCalls);
  const sensitiveAreas = collectSensitiveAreas(changedFiles.map((file) => file.path).join("\n"));
  const testsRun = collectTestsRun(toolCalls);
  const riskLevel = summarizeRisk(changedFiles, sensitiveAreas);

  return {
    changedFiles,
    generatedAt: new Date().toISOString(),
    riskLevel,
    sensitiveAreas,
    suggestedCommitMessage: createSuggestedCommitMessage(changedFiles, finalContent),
    suggestedPrSummary: createSuggestedPrSummary(changedFiles, sensitiveAreas, testsRun, finalContent),
    testsRun,
    unverifiedAssumptions: testsRun.length > 0 ? [] : ["No verification command was captured for this run yet."],
    version: 1,
  };
}

function collectChangedFiles(toolCalls: ChatToolCall[]): RiskReviewFileSummary[] {
  const files = new Map<string, RiskReviewFileSummary>();

  for (const toolCall of toolCalls) {
    for (const change of toolCall.fileChanges ?? []) {
      upsertChangedFile(files, {
        additions: change.additions,
        deletions: change.deletions,
        path: change.path,
        status: change.kind,
      });
    }

    for (const result of toolCall.batchFileResults ?? []) {
      upsertChangedFile(files, {
        additions: result.additions,
        deletions: result.deletions,
        path: result.path,
        status: result.kind ?? result.status,
      });
    }
  }

  return [...files.values()].sort((left, right) => compareRisk(right.riskLevel, left.riskLevel) || left.path.localeCompare(right.path));
}

function upsertChangedFile(
  files: Map<string, RiskReviewFileSummary>,
  input: { additions?: number; deletions?: number; path: string; status?: string },
) {
  const existing = files.get(input.path);
  const tags = inferRiskTags(input.path);
  const next: RiskReviewFileSummary = {
    additions: (existing?.additions ?? 0) + (input.additions ?? 0),
    deletions: (existing?.deletions ?? 0) + (input.deletions ?? 0),
    path: input.path,
    purpose: inferFilePurpose(input.path),
    riskLevel: maxRisk(existing?.riskLevel, inferRiskLevel(input.path, tags)),
    status: input.status ?? existing?.status,
    tags: Array.from(new Set([...(existing?.tags ?? []), ...tags])),
  };

  files.set(input.path, next);
}

export function inferFilePurpose(path: string) {
  const normalized = path.replace(/\\/g, "/");

  if (/src-tauri\//i.test(normalized)) return "Desktop backend command or storage behavior";
  if (/src\/toolBridge\//i.test(normalized)) return "Model-callable tool bridge behavior";
  if (/src\/app\/workspace\//i.test(normalized)) return "Workspace runtime orchestration";
  if (/src\/components\//i.test(normalized)) return "User-facing React component";
  if (/src\/pages\//i.test(normalized)) return "Application route surface";
  if (/src\/styles\//i.test(normalized)) return "Visual styling";
  if (/src\/services\//i.test(normalized)) return "Provider or service integration";
  if (/src\/memory\//i.test(normalized)) return "Durable memory/project context";
  if (/\.test\.[tj]sx?$/i.test(normalized)) return "Automated test coverage";
  if (/scripts\//i.test(normalized)) return "Automation or release script";
  return "Project file";
}

export function inferRiskTags(path: string) {
  const tags = new Set<string>();

  for (const item of SENSITIVE_AREA_PATTERNS) {
    if (item.pattern.test(path)) {
      tags.add(item.tag);
    }
  }

  if (/\.css$/i.test(path)) tags.add("ui");
  if (/\.test\.[tj]sx?$/i.test(path)) tags.add("tests");

  return [...tags];
}

function inferRiskLevel(path: string, tags: string[]): CodingRiskLevel {
  if (tags.some((tag) => tag === "credentials" || tag === "terminal" || tag === "release")) return "high";
  if (tags.some((tag) => tag === "auth" || tag === "filesystem" || tag === "provider" || tag === "storage" || tag === "tauri")) return "medium";
  if (/src-tauri\//i.test(path)) return "medium";
  return "low";
}

function collectSensitiveAreas(text: string) {
  return SENSITIVE_AREA_PATTERNS
    .filter((item) => item.pattern.test(text))
    .map((item) => item.area);
}

function collectTestsRun(toolCalls: ChatToolCall[]) {
  const tests = new Set<string>();

  for (const toolCall of toolCalls) {
    if (toolCall.toolId !== "terminal_run" && !toolCall.terminal) {
      continue;
    }

    const command = toolCall.terminal?.command ?? extractCommand(toolCall.input);
    if (!command || !/\b(test|typecheck|build|check|cargo|vitest|tsc)\b/i.test(command)) {
      continue;
    }

    const exitCode = toolCall.terminal?.exitCode;
    tests.add(`${command}${exitCode === undefined || exitCode === null ? "" : ` (exit ${exitCode})`}`);
  }

  return [...tests];
}

function extractCommand(input?: string) {
  if (!input) return "";

  try {
    const parsed = JSON.parse(input) as { command?: unknown };
    return typeof parsed.command === "string" ? parsed.command : input;
  } catch {
    return input;
  }
}

function summarizeRisk(files: RiskReviewFileSummary[], sensitiveAreas: string[]): CodingRiskLevel {
  if (files.some((file) => file.riskLevel === "high") || sensitiveAreas.some((area) => area === "credentials" || area === "terminal" || area === "release/installer")) {
    return "high";
  }

  if (files.some((file) => file.riskLevel === "medium") || sensitiveAreas.length > 0) {
    return "medium";
  }

  return "low";
}

function createSuggestedCommitMessage(files: RiskReviewFileSummary[], finalContent?: string) {
  const summary = finalContent?.split(/\r?\n/).find((line) => /\b(add|fix|implement|update|wire|capture|show|build)\b/i.test(line))?.replace(/^[#*\-\s]+/, "").trim();

  if (summary && summary.length <= 72) {
    return summary.charAt(0).toLowerCase() + summary.slice(1);
  }

  if (files.some((file) => file.path.includes("toolBridge") || file.tags.includes("provider"))) {
    return "feat: add bridge-first coding evidence";
  }

  if (files.some((file) => file.tags.includes("ui"))) {
    return "feat: add coding review sidecar";
  }

  return "feat: improve coding run review";
}

function createSuggestedPrSummary(
  files: RiskReviewFileSummary[],
  sensitiveAreas: string[],
  testsRun: string[],
  finalContent?: string,
) {
  const lines = [
    finalContent ? finalContent.split(/\r?\n/).find((line) => line.trim())?.trim() : "",
    files.length > 0 ? `Changed ${files.length} file${files.length === 1 ? "" : "s"} across ${summarizeFilePurposes(files)}.` : "No file mutations were captured yet.",
    sensitiveAreas.length > 0 ? `Risk areas: ${sensitiveAreas.join(", ")}.` : "No sensitive risk area was detected from changed paths.",
    testsRun.length > 0 ? `Verification captured: ${testsRun.join("; ")}.` : "Verification is still recommended.",
  ].filter(Boolean);

  return lines.join("\n");
}

function summarizeFilePurposes(files: RiskReviewFileSummary[]) {
  return Array.from(new Set(files.map((file) => file.purpose.toLowerCase()))).slice(0, 4).join(", ");
}

function maxRisk(left: CodingRiskLevel | undefined, right: CodingRiskLevel): CodingRiskLevel {
  if (!left) return right;
  return compareRisk(left, right) >= 0 ? left : right;
}

function compareRisk(left: CodingRiskLevel, right: CodingRiskLevel) {
  const score: Record<CodingRiskLevel, number> = { high: 3, medium: 2, low: 1 };
  return score[left] - score[right];
}
