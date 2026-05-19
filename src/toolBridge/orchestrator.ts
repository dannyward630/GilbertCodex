import type { ChatToolCall } from "../types/chat";
import { resolveToolPermission } from "./permissions";
import { ToolRegistry, createDefaultToolRegistry } from "./registry";
import { createBridgeChatToolCall } from "./results";
import { coalesceToolBridgeCalls, createToolExecutionSegments } from "./scheduler";
import type { ProviderReasoningState } from "../types/reasoning";
import type {
  ToolApprovalCallback,
  ToolBridgeExecutionBatch,
  ToolBridgeExecutionStep,
  ToolBridgeProviderFormat,
  ToolBridgeProviderTurn,
  ToolBridgeTelemetryEvent,
  ToolBridgeTelemetrySink,
  ToolCallRequest,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResultMessage,
} from "./types";
import { validateToolArguments } from "./validation";

const DEFAULT_BRIDGE_MAX_CONCURRENCY = 4;
const DEFAULT_BRIDGE_MAX_LOOPS = 4;

export interface ExecuteToolBridgeCallsOptions {
  approval?: ToolApprovalCallback;
  calls: ToolCallRequest[];
  context: ToolExecutionContext;
  // Caps concurrent tool executions per batch; use 1 to force sequential execution.
  maxConcurrency?: number;
  onToolCallUpdate?: (toolCall: ChatToolCall) => void;
  registry?: ToolRegistry;
  telemetry?: ToolBridgeTelemetrySink;
}

export interface ToolBridgeOrchestratorOptions {
  approval?: ToolApprovalCallback;
  context: ToolExecutionContext;
  maxConcurrency?: number;
  maxLoops?: number;
  onToolCallUpdate?: (toolCall: ChatToolCall) => void;
  // Provider format used to filter tools before advertising them on each turn.
  providerFormat?: ToolBridgeProviderFormat;
  registry?: ToolRegistry;
  send: (request: {
    loopIndex: number;
    toolResultMessages: ToolResultMessage[];
    tools: ToolDefinition[];
  }) => Promise<ToolBridgeProviderTurn>;
  telemetry?: ToolBridgeTelemetrySink;
}

export interface ToolBridgeOrchestratorResult {
  abortedBySignal: boolean;
  content: string;
  loopCount: number;
  reasoningState?: ProviderReasoningState;
  resultMessages: ToolResultMessage[];
  steps: ToolBridgeExecutionStep[];
  stoppedAtMaxLoops: boolean;
}

export class ToolBridgeOrchestrator {
  private readonly approval: ToolApprovalCallback | undefined;
  private readonly context: ToolExecutionContext;
  private readonly maxConcurrency: number;
  private readonly maxLoops: number;
  private readonly onToolCallUpdate: ((toolCall: ChatToolCall) => void) | undefined;
  private readonly providerFormat: ToolBridgeProviderFormat | undefined;
  private readonly registry: ToolRegistry;
  private readonly send: ToolBridgeOrchestratorOptions["send"];
  private readonly telemetry: ToolBridgeTelemetrySink | undefined;

  constructor(options: ToolBridgeOrchestratorOptions) {
    this.approval = options.approval;
    this.context = options.context;
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_BRIDGE_MAX_CONCURRENCY);
    this.maxLoops = Math.max(1, options.maxLoops ?? DEFAULT_BRIDGE_MAX_LOOPS);
    this.onToolCallUpdate = options.onToolCallUpdate;
    this.providerFormat = options.providerFormat;
    this.registry = options.registry ?? createDefaultToolRegistry();
    this.send = options.send;
    this.telemetry = options.telemetry;
  }

  async run(): Promise<ToolBridgeOrchestratorResult> {
    const resultMessages: ToolResultMessage[] = [];
    const steps: ToolBridgeExecutionStep[] = [];
    let lastContent = "";
    let lastReasoningState: ProviderReasoningState | undefined;

    for (let loopIndex = 0; loopIndex < this.maxLoops; loopIndex += 1) {
      if (this.context.signal?.aborted) {
        emitTelemetry(this.telemetry, { loopIndex, reason: "signal", type: "tool-loop-aborted" });
        return {
          abortedBySignal: true,
          content: lastContent,
          loopCount: loopIndex,
          reasoningState: lastReasoningState,
          resultMessages,
          steps,
          stoppedAtMaxLoops: false,
        };
      }

      const turn = await this.send({
        loopIndex,
        toolResultMessages: resultMessages,
        tools: this.registry.listForContext(this.context, this.providerFormat, {
          includePendingApproval: Boolean(this.approval),
        }),
      });

      if (turn.content) {
        lastContent = turn.content;
      }
      if (turn.reasoningState !== undefined) {
        lastReasoningState = turn.reasoningState;
      }

      if (!turn.toolCalls?.length) {
        return {
          abortedBySignal: false,
          content: turn.content,
          loopCount: loopIndex + 1,
          reasoningState: turn.reasoningState,
          resultMessages,
          steps,
          stoppedAtMaxLoops: false,
        };
      }

      const batch = await executeToolBridgeCalls({
        approval: this.approval,
        calls: turn.toolCalls,
        context: this.context,
        maxConcurrency: this.maxConcurrency,
        onToolCallUpdate: this.onToolCallUpdate,
        registry: this.registry,
        telemetry: this.telemetry,
      });

      resultMessages.push(...batch.resultMessages);
      steps.push(...batch.steps);

      if (this.context.signal?.aborted) {
        emitTelemetry(this.telemetry, { loopIndex, reason: "signal", type: "tool-loop-aborted" });
        return {
          abortedBySignal: true,
          content: lastContent,
          loopCount: loopIndex + 1,
          reasoningState: lastReasoningState,
          resultMessages,
          steps,
          stoppedAtMaxLoops: false,
        };
      }
    }

    emitTelemetry(this.telemetry, { loopIndex: this.maxLoops, reason: "max-loops", type: "tool-loop-aborted" });
    return {
      abortedBySignal: false,
      content: lastContent,
      loopCount: this.maxLoops,
      reasoningState: lastReasoningState,
      resultMessages,
      steps,
      stoppedAtMaxLoops: true,
    };
  }
}

export async function executeToolBridgeCalls(
  options: ExecuteToolBridgeCallsOptions,
): Promise<ToolBridgeExecutionBatch> {
  const registry = options.registry ?? createDefaultToolRegistry();
  const maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_BRIDGE_MAX_CONCURRENCY);
  const requestedCalls = options.calls;
  const total = requestedCalls.length;

  // Skip duplicate call IDs so one provider call cannot execute twice or collide in result replay.
  const seen = new Map<string, number>();
  const uniqueCalls: ToolCallRequest[] = [];
  const originalPositionByCallId = new Map<string, number>();
  const prefilledSteps: Array<{ position: number; step: ToolBridgeExecutionStep }> = [];

  requestedCalls.forEach((call, position) => {
    const count = seen.get(call.id) ?? 0;
    seen.set(call.id, count + 1);

    if (count > 0) {
      emitTelemetry(options.telemetry, { callId: call.id, toolName: call.name, type: "tool-call-duplicate" });
      const duplicateStep = makeDuplicateStep(call);
      prefilledSteps.push({ position, step: duplicateStep });
      notifyToolUpdate(options.onToolCallUpdate, duplicateStep.chatToolCall);
      return;
    }

    uniqueCalls.push(call);
    originalPositionByCallId.set(call.id, position);
  });

  const coalesced = coalesceToolBridgeCalls(uniqueCalls, registry);

  if (coalesced.coalescedCount > 0) {
    emitTelemetry(options.telemetry, {
      coalescedCount: coalesced.coalescedCount,
      fromToolIds: coalesced.fromToolIds,
      requestedCount: coalesced.requestedCount,
      toToolIds: coalesced.toToolIds,
      type: "tool-batch-coalesced",
    });
  }

  const segments = createToolExecutionSegments(coalesced.calls, registry);
  emitTelemetry(options.telemetry, {
    exclusiveCount: segments.filter((segment) => segment.mode === "exclusive").reduce((count, segment) => count + segment.calls.length, 0),
    parallelCount: segments.filter((segment) => segment.mode === "parallel").reduce((count, segment) => count + segment.calls.length, 0),
    segmentCount: segments.length,
    type: "tool-batch-scheduled",
  });

  const executedSteps: Array<{ position: number; step: ToolBridgeExecutionStep }> = [];

  async function executeCall(call: ToolCallRequest): Promise<{ position: number; step: ToolBridgeExecutionStep }> {
    return {
      position: getOriginalCallPosition(call, originalPositionByCallId, total),
      step: await executeSingleToolCall(
        call,
        registry,
        options.context,
        options.onToolCallUpdate,
        options.approval,
        options.telemetry,
      ),
    };
  }

  for (const segment of segments) {
    if (segment.mode === "exclusive") {
      for (const call of segment.calls) {
        executedSteps.push(await executeCall(call));
      }
      continue;
    }

    const segmentResults = new Array<{ position: number; step: ToolBridgeExecutionStep }>(segment.calls.length);
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(maxConcurrency, segment.calls.length));

    async function worker() {
      while (true) {
        const current = nextIndex;
        if (current >= segment.calls.length) {
          return;
        }
        nextIndex += 1;
        segmentResults[current] = await executeCall(segment.calls[current]!);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    executedSteps.push(...segmentResults.filter((entry): entry is { position: number; step: ToolBridgeExecutionStep } => Boolean(entry)));
  }

  const orderedSteps = [...prefilledSteps, ...executedSteps]
    .sort((left, right) => left.position - right.position)
    .map((entry) => entry.step);

  return {
    coalescedCount: coalesced.coalescedCount,
    executedCount: orderedSteps.filter((step) => step.result.ok).length,
    handledCount: orderedSteps.length,
    hostExecutionCount: coalesced.calls.length,
    requestedCount: total,
    resultMessages: orderedSteps.map((step) => step.resultMessage),
    steps: orderedSteps,
    toolCalls: orderedSteps.map((step) => step.chatToolCall),
  };
}

function getOriginalCallPosition(call: ToolCallRequest, originalPositionByCallId: Map<string, number>, fallbackPosition: number) {
  const directPosition = originalPositionByCallId.get(call.id);
  if (directPosition !== undefined) {
    return directPosition;
  }

  const raw = call.raw;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallbackPosition;
  }

  const coalescedCallIds = (raw as { coalescedCallIds?: unknown }).coalescedCallIds;
  if (!Array.isArray(coalescedCallIds)) {
    return fallbackPosition;
  }

  for (const callId of coalescedCallIds) {
    if (typeof callId !== "string") {
      continue;
    }

    const position = originalPositionByCallId.get(callId);
    if (position !== undefined) {
      return position;
    }
  }

  return fallbackPosition;
}

function makeDuplicateStep(call: ToolCallRequest): ToolBridgeExecutionStep {
  const reason = `Duplicate tool call id "${call.id}"; only the first instance was executed.`;
  const result: ToolExecutionResult = { content: reason, ok: false, skippedReason: reason };
  const chatToolCall = createBridgeChatToolCall(call, undefined, result, "skipped");

  return {
    call,
    chatToolCall,
    result,
    resultMessage: {
      arguments: call.arguments,
      callId: call.id,
      name: call.name,
      rawCall: call.raw,
      result,
    },
  };
}

async function executeSingleToolCall(
  call: ToolCallRequest,
  registry: ToolRegistry,
  context: ToolExecutionContext,
  onToolCallUpdate: ((toolCall: ChatToolCall) => void) | undefined,
  approval: ToolApprovalCallback | undefined,
  telemetry: ToolBridgeTelemetrySink | undefined,
): Promise<ToolBridgeExecutionStep> {
  const tool = registry.get(call.name);
  const activeResult: ToolExecutionResult = {
    content: "Tool bridge call started.",
    ok: true,
  };
  const activeToolCall = createBridgeChatToolCall(call, tool, activeResult, "active");
  notifyToolUpdate(onToolCallUpdate, activeToolCall);

  if (!tool) {
    const reason = `No bridge tool is registered as ${call.name}.`;
    emitTelemetry(telemetry, { callId: call.id, reason, toolId: call.name, type: "tool-skipped" });
    const result = createSkippedResult(reason);
    const chatToolCall = createBridgeChatToolCall(call, undefined, result, "skipped");
    notifyToolUpdate(onToolCallUpdate, chatToolCall);
    return buildStep(call, chatToolCall, result);
  }

  if (context.signal?.aborted) {
    const reason = "Tool bridge run was aborted before this call could start.";
    emitTelemetry(telemetry, { callId: call.id, reason, toolId: tool.id, type: "tool-skipped" });
    const result = createSkippedResult(reason);
    const chatToolCall = createBridgeChatToolCall(call, tool, result, "skipped");
    notifyToolUpdate(onToolCallUpdate, chatToolCall);
    return buildStep(call, chatToolCall, result);
  }

  const result = await executeResolvedToolCall(tool, call, context, approval, onToolCallUpdate, telemetry);
  const status: ChatToolCall["status"] = result.skippedReason ? "skipped" : result.ok ? "complete" : "error";
  const chatToolCall = createBridgeChatToolCall(call, tool, result, status);
  notifyToolUpdate(onToolCallUpdate, chatToolCall);

  return buildStep(call, chatToolCall, result);
}

async function executeResolvedToolCall(
  tool: ToolDefinition,
  call: ToolCallRequest,
  context: ToolExecutionContext,
  approval: ToolApprovalCallback | undefined,
  onToolCallUpdate: ((toolCall: ChatToolCall) => void) | undefined,
  telemetry: ToolBridgeTelemetrySink | undefined,
): Promise<ToolExecutionResult> {
  if (call.argumentsParseError) {
    const errorMessage = createToolArgumentParseRecoveryMessage(tool, call.argumentsParseError);
    emitTelemetry(telemetry, { callId: call.id, error: errorMessage, toolId: tool.id, type: "tool-validation-failed" });
    return {
      content: errorMessage,
      error: errorMessage,
      ok: false,
    };
  }

  const validation = validateToolArguments(tool, call.arguments);

  if (!validation.ok || !validation.args) {
    const errorMessage = validation.error || "Invalid tool arguments.";
    emitTelemetry(telemetry, { callId: call.id, error: errorMessage, toolId: tool.id, type: "tool-validation-failed" });
    return {
      content: errorMessage,
      error: errorMessage,
      ok: false,
    };
  }

  const permission = resolveToolPermission(tool, context);

  if (!permission.allowed) {
    if (!permission.requiresApproval || !approval) {
      emitTelemetry(telemetry, {
        callId: call.id,
        reason: permission.reason ?? `Tool ${tool.id} requires approval.`,
        toolId: tool.id,
        type: "tool-skipped",
      });
      return createSkippedResult(permission.reason || `Tool ${tool.id} requires approval.`);
    }

    emitTelemetry(telemetry, { callId: call.id, reason: permission.reason, toolId: tool.id, type: "tool-approval-requested" });
    notifyToolUpdate(
      onToolCallUpdate,
      createBridgeChatToolCall(
        call,
        tool,
        { content: permission.reason ?? "Awaiting approval.", ok: true },
        "waiting_approval",
      ),
    );

    let decision;
    try {
      decision = await approval({ call, reason: permission.reason, tool });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approval callback failed.";
      emitTelemetry(telemetry, { approved: false, callId: call.id, reason: message, toolId: tool.id, type: "tool-approval-resolved" });
      return createSkippedResult(message);
    }

    emitTelemetry(telemetry, {
      approved: decision.approved,
      callId: call.id,
      reason: decision.reason,
      toolId: tool.id,
      type: "tool-approval-resolved",
    });

    if (!decision.approved) {
      return createSkippedResult(decision.reason || permission.reason || "Approval denied.");
    }
  }

  if (context.signal?.aborted) {
    const reason = "Tool bridge run was aborted before this call could start.";
    emitTelemetry(telemetry, { callId: call.id, reason, toolId: tool.id, type: "tool-skipped" });
    return createSkippedResult(reason);
  }

  const startedAt = nowMs();
  try {
    const progressContext: ToolExecutionContext = {
      ...context,
      reportProgress: (progressResult) => {
        try {
          context.reportProgress?.(progressResult);
        } catch {
          // Progress observers must not break the actual tool run.
        }
        notifyToolUpdate(
          onToolCallUpdate,
          createBridgeChatToolCall(call, tool, progressResult, "active"),
        );
      },
    };
    const result = await tool.execute(validation.args, progressContext);
    emitTelemetry(telemetry, {
      callId: call.id,
      durationMs: nowMs() - startedAt,
      error: result.error,
      family: tool.executorMetadata?.family,
      ok: result.ok,
      toolId: tool.id,
      type: "tool-invoked",
      version: tool.executorMetadata?.version,
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Tool execution failed.";
    emitTelemetry(telemetry, {
      callId: call.id,
      durationMs: nowMs() - startedAt,
      error: message,
      family: tool.executorMetadata?.family,
      ok: false,
      toolId: tool.id,
      type: "tool-invoked",
      version: tool.executorMetadata?.version,
    });
    return {
      content: message,
      error: message,
      ok: false,
    };
  }
}

function buildStep(call: ToolCallRequest, chatToolCall: ChatToolCall, result: ToolExecutionResult): ToolBridgeExecutionStep {
  return {
    call,
    chatToolCall,
    result,
    resultMessage: {
      arguments: call.arguments,
      callId: call.id,
      name: call.name,
      rawCall: call.raw,
      result,
    },
  };
}

function createSkippedResult(reason: string): ToolExecutionResult {
  return {
    content: reason,
    ok: false,
    skippedReason: reason,
  };
}

function createToolArgumentParseRecoveryMessage(tool: ToolDefinition, parseError: string) {
  const editHint = tool.id.startsWith("files_")
    ? "No file was changed. Retry the same operation with a valid JSON object. For large text content, keep it inside one JSON string and escape every newline as \\n, quote as \\\", and backslash as \\\\."
    : "Retry the same tool with a valid JSON object for its arguments.";

  return [
    `Tool ${tool.id} received invalid JSON arguments.`,
    parseError,
    editHint,
  ].join("\n");
}

function notifyToolUpdate(callback: ((toolCall: ChatToolCall) => void) | undefined, toolCall: ChatToolCall) {
  if (!callback) {
    return;
  }
  // A throwing UI handler must not break tool execution.
  try {
    callback(toolCall);
  } catch {
    // Intentionally swallow; tool execution must continue.
  }
}

function emitTelemetry(sink: ToolBridgeTelemetrySink | undefined, event: ToolBridgeTelemetryEvent) {
  if (!sink) {
    return;
  }
  // Telemetry must never break execution.
  try {
    sink(event);
  } catch {
    // Intentionally swallow.
  }
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
