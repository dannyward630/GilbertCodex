import type { AgentRun } from "../types/agentRun";
import type { ChatArtifact, ChatSource, ChatToolCall } from "../types/chat";
import type {
  AgentRunCodingEvidenceV1,
  CodingEvidenceEvent,
  CodingJsonValue,
  RiskReviewSummary,
  ToolHealthSnapshot,
  VerificationPlan,
} from "../types/coding";
import type { LocalPermissionMode } from "../types/localWorkspace";
import type { ModelProviderId } from "../types/settings";
import type { ToolBridgeTelemetryEvent } from "../toolBridge";
import { createRiskReviewSummary } from "./riskReview";
import { createVerificationPlan } from "./verificationPlanner";

const MAX_CODING_EVENTS = 220;
const MAX_EVENT_DETAIL_CHARS = 1_800;
const MAX_EVENT_DATA_CHARS = 3_000;

export interface CreateInitialCodingEvidenceOptions {
  chatId: string;
  messageId?: string;
  model?: string;
  permissionMode?: LocalPermissionMode;
  prompt: string;
  provider?: ModelProviderId;
  startedAt?: string;
  workspaceRoots?: string[];
}

export function createInitialCodingEvidence(options: CreateInitialCodingEvidenceOptions): AgentRunCodingEvidenceV1 {
  const startedAt = options.startedAt ?? new Date().toISOString();

  return {
    events: [],
    model: options.model,
    permissionMode: options.permissionMode,
    provider: options.provider,
    request: {
      chatId: options.chatId,
      messageId: options.messageId,
      prompt: options.prompt,
      workspaceRoots: options.workspaceRoots ?? [],
    },
    startedAt,
    toolHealth: [],
    version: 1,
  };
}

export function ensureCodingEvidence(run: AgentRun, now = new Date().toISOString()): AgentRunCodingEvidenceV1 {
  if (run.coding?.version === 1) {
    return {
      ...run.coding,
      events: Array.isArray(run.coding.events) ? run.coding.events.slice(-MAX_CODING_EVENTS) : [],
      toolHealth: Array.isArray(run.coding.toolHealth) ? run.coding.toolHealth : [],
      version: 1,
    };
  }

  return createInitialCodingEvidence({
    chatId: run.chatId,
    messageId: run.messageId,
    permissionMode: run.localWorkspace?.permissionMode,
    prompt: run.prompt,
    startedAt: run.createdAt || now,
    workspaceRoots: run.localWorkspace?.roots ?? [],
  });
}

export function withCodingToolHealth(run: AgentRun, snapshot: ToolHealthSnapshot): AgentRun {
  const coding = ensureCodingEvidence(run);
  const existingIndex = coding.toolHealth.findIndex((item) => item.id === snapshot.id);
  const toolHealth = existingIndex >= 0
    ? coding.toolHealth.map((item, index) => (index === existingIndex ? snapshot : item))
    : [...coding.toolHealth, snapshot];

  return {
    ...run,
    coding: {
      ...coding,
      model: snapshot.model || coding.model,
      permissionMode: snapshot.permissionMode || coding.permissionMode,
      provider: snapshot.provider || coding.provider,
      request: {
        ...coding.request,
        workspaceRoots: snapshot.workspaceRoots.length > 0 ? snapshot.workspaceRoots : coding.request.workspaceRoots,
      },
      toolHealth,
    },
  };
}

export function withCodingEvent(run: AgentRun, event: Omit<CodingEvidenceEvent, "id"> & { id?: string }): AgentRun {
  const coding = ensureCodingEvidence(run);
  const nextEvent = normalizeCodingEvent(event);

  return {
    ...run,
    coding: {
      ...coding,
      events: [...coding.events, nextEvent].slice(-MAX_CODING_EVENTS),
    },
  };
}

export function withCodingTelemetryEvent(run: AgentRun, event: ToolBridgeTelemetryEvent, at = new Date().toISOString()): AgentRun {
  return withCodingEvent(run, {
    at,
    data: trimJsonForEvent(event as unknown as CodingJsonValue),
    detail: formatTelemetryDetail(event),
    kind: "tool-telemetry",
    label: formatTelemetryLabel(event),
    status: telemetryStatus(event),
    toolCallId: "callId" in event ? event.callId : undefined,
    toolId: "toolId" in event ? event.toolId : "toolName" in event ? event.toolName : undefined,
  });
}

export function withCodingBridgeBatch(run: AgentRun, toolCalls: ChatToolCall[], at = new Date().toISOString()): AgentRun {
  let nextRun = run;

  for (const toolCall of toolCalls) {
    const event = createToolCallEvent(toolCall, at);
    const coding = ensureCodingEvidence(nextRun);
    if (coding.events.some((existing) => existing.toolCallId === event.toolCallId && existing.kind === event.kind)) {
      continue;
    }
    nextRun = withCodingEvent(nextRun, event);
  }

  return nextRun;
}

export function finalizeCodingEvidenceForMessage(
  run: AgentRun,
  options: {
    artifacts?: ChatArtifact[];
    completedAt?: string;
    content?: string;
    sources?: ChatSource[];
    toolCalls?: ChatToolCall[];
  },
): AgentRun {
  const completedAt = options.completedAt ?? new Date().toISOString();
  let nextRun = run;

  if (options.toolCalls?.length) {
    nextRun = withCodingBridgeBatch(nextRun, options.toolCalls, completedAt);
  }

  for (const source of options.sources ?? []) {
    nextRun = withCodingEvent(nextRun, {
      at: completedAt,
      detail: source.url,
      kind: "source",
      label: source.title,
      status: "complete",
    });
  }

  for (const artifact of options.artifacts ?? []) {
    nextRun = withCodingEvent(nextRun, {
      at: completedAt,
      detail: artifact.detail ?? artifact.url ?? artifact.kind,
      kind: "artifact",
      label: artifact.title,
      status: "complete",
    });
  }

  const coding = ensureCodingEvidence(nextRun);
  const verification = createVerificationPlan({
    review: createRiskReviewSummary(options.toolCalls ?? nextRun.toolCalls ?? [], options.content),
    toolCalls: options.toolCalls ?? nextRun.toolCalls ?? [],
  });
  const review = createRiskReviewSummary(options.toolCalls ?? nextRun.toolCalls ?? [], options.content);

  return {
    ...nextRun,
    coding: {
      ...coding,
      completedAt,
      finalSummary: createFinalSummary(options.content),
      review,
      verification,
    },
  };
}

export function updateCodingReviewAndVerification(
  run: AgentRun,
  toolCalls: ChatToolCall[] = run.toolCalls,
  finalContent?: string,
): AgentRun {
  const review: RiskReviewSummary = createRiskReviewSummary(toolCalls, finalContent);
  const verification: VerificationPlan = createVerificationPlan({ review, toolCalls });
  const coding = ensureCodingEvidence(run);

  return {
    ...run,
    coding: {
      ...coding,
      review,
      verification,
    },
  };
}

function createToolCallEvent(toolCall: ChatToolCall, at: string): Omit<CodingEvidenceEvent, "id"> {
  const terminal = toolCall.terminal;
  const browserConsole = toolCall.toolId === "browser_console_read";
  const kind = terminal ? "terminal" : browserConsole ? "browser-console" : toolCall.fileChanges?.length ? "file-change" : "tool-call";
  const status = toolCall.status === "error" ? "error" : toolCall.status === "skipped" ? "skipped" : toolCall.status === "complete" ? "complete" : "active";

  return {
    at,
    data: trimJsonForEvent({
      fileChanges: toolCall.fileChanges,
      terminal: toolCall.terminal,
    }),
    detail: limitText(toolCall.detail ?? toolCall.output ?? toolCall.input, MAX_EVENT_DETAIL_CHARS),
    kind,
    label: toolCall.label,
    status,
    toolCallId: toolCall.id,
    toolId: toolCall.toolId,
  };
}

function normalizeCodingEvent(event: Omit<CodingEvidenceEvent, "id"> & { id?: string }): CodingEvidenceEvent {
  return {
    ...event,
    data: trimJsonForEvent(event.data),
    detail: limitText(event.detail, MAX_EVENT_DETAIL_CHARS),
    id: event.id ?? `coding-event-${Date.now()}-${Math.round(Math.random() * 100000)}`,
  };
}

function trimJsonForEvent(value: unknown): CodingJsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }

  const raw = JSON.stringify(value);
  if (!raw) {
    return undefined;
  }

  const serialized = redactSecrets(raw);
  if (serialized.length <= MAX_EVENT_DATA_CHARS) {
    try {
      return JSON.parse(serialized) as CodingJsonValue;
    } catch {
      return serialized;
    }
  }

  return {
    truncated: true,
    preview: serialized.slice(0, MAX_EVENT_DATA_CHARS),
  };
}

function limitText(value: string | undefined, maxChars: number) {
  if (!value) {
    return undefined;
  }

  const cleaned = redactSecrets(value);
  return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars).trimEnd()}\n...` : cleaned;
}

function redactSecrets(value: string) {
  return value
    .replace(/(api[_-]?key|authorization|bearer|token|secret|password)(["'\s:=]+)[^\s"',;}]+/gi, "$1$2[redacted]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "sk-[redacted]");
}

function formatTelemetryLabel(event: ToolBridgeTelemetryEvent) {
  switch (event.type) {
    case "tool-invoked":
      return `Ran ${event.toolId}`;
    case "tool-skipped":
      return `Skipped ${event.toolId}`;
    case "tool-validation-failed":
      return `Validation failed for ${event.toolId}`;
    case "tool-approval-requested":
      return `Approval requested for ${event.toolId}`;
    case "tool-approval-resolved":
      return `Approval ${event.approved ? "approved" : "denied"}`;
    case "tool-batch-coalesced":
      return "Tool calls coalesced";
    case "tool-batch-scheduled":
      return "Tool batch scheduled";
    case "tool-loop-aborted":
      return "Tool loop stopped";
    case "tool-call-duplicate":
      return `Duplicate tool call ${event.toolName}`;
  }
}

function formatTelemetryDetail(event: ToolBridgeTelemetryEvent) {
  if ("error" in event && event.error) return event.error;
  if ("reason" in event && event.reason) return event.reason;
  if (event.type === "tool-invoked") return `${event.ok ? "ok" : "failed"} in ${event.durationMs}ms`;
  if (event.type === "tool-batch-scheduled") return `${event.parallelCount} parallel, ${event.exclusiveCount} exclusive`;
  if (event.type === "tool-batch-coalesced") return `${event.requestedCount} requested, ${event.coalescedCount} coalesced`;
  return undefined;
}

function telemetryStatus(event: ToolBridgeTelemetryEvent): CodingEvidenceEvent["status"] {
  if (event.type === "tool-invoked") return event.ok ? "complete" : "error";
  if (event.type === "tool-skipped" || event.type === "tool-call-duplicate") return "skipped";
  if (event.type === "tool-validation-failed") return "error";
  if (event.type === "tool-approval-resolved") return event.approved ? "complete" : "skipped";
  return "complete";
}

function createFinalSummary(content: string | undefined) {
  const trimmed = content?.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return undefined;
  }

  return limitText(trimmed, 900);
}
