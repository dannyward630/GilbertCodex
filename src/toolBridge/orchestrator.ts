import type { ChatToolCall } from "../types/chat";
import { resolveToolPermission } from "./permissions";
import { ToolRegistry, createDefaultToolRegistry } from "./registry";
import { createBridgeChatToolCall } from "./results";
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
  /**
   * Cap concurrent tool executions per batch. Default {@link DEFAULT_BRIDGE_MAX_CONCURRENCY}.
   * Use 1 to force strict sequential execution.
   */
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
  /**
   * Provider format used to filter tools before advertising them on each turn.
   * Must match the adapter the caller will use to send the request, or tools
   * advertised by the orchestrator may be stripped out before they reach the
   * model.
   */
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
  reasoning?: string;
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
    let lastReasoning: string | undefined;

    for (let loopIndex = 0; loopIndex < this.maxLoops; loopIndex += 1) {
      if (this.context.signal?.aborted) {
        emitTelemetry(this.telemetry, { loopIndex, reason: "signal", type: "tool-loop-aborted" });
        return {
          abortedBySignal: true,
          content: lastContent,
          loopCount: loopIndex,
          reasoning: lastReasoning,
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
      if (turn.reasoning !== undefined) {
        lastReasoning = turn.reasoning;
      }

      if (!turn.toolCalls?.length) {
        return {
          abortedBySignal: false,
          content: turn.content,
          loopCount: loopIndex + 1,
          reasoning: turn.reasoning,
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
          reasoning: lastReasoning,
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
      reasoning: lastReasoning,
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
  const calls = options.calls;
  const total = calls.length;

  // Pre-pass: deterministically flag duplicate call ids. First occurrence in
  // the input order is the legitimate one; later occurrences are recorded as
  // skipped so we don't double-execute and don't emit colliding tool_call_ids
  // back to the provider.
  const seen = new Map<string, number>();
  const isDuplicate = calls.map((call) => {
    const count = seen.get(call.id) ?? 0;
    seen.set(call.id, count + 1);
    return count > 0;
  });

  const steps: (ToolBridgeExecutionStep | undefined)[] = new Array(total);

  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(maxConcurrency, total));

  async function worker() {
    while (true) {
      const current = nextIndex;
      if (current >= total) {
        return;
      }
      nextIndex += 1;
      const call = calls[current]!;

      if (isDuplicate[current]) {
        emitTelemetry(options.telemetry, { callId: call.id, toolName: call.name, type: "tool-call-duplicate" });
        const duplicateStep = makeDuplicateStep(call);
        steps[current] = duplicateStep;
        notifyToolUpdate(options.onToolCallUpdate, duplicateStep.chatToolCall);
        continue;
      }

      steps[current] = await executeSingleToolCall(
        call,
        registry,
        options.context,
        options.onToolCallUpdate,
        options.approval,
        options.telemetry,
      );
    }
  }

  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i += 1) {
    workerPromises.push(worker());
  }
  await Promise.all(workerPromises);

  const orderedSteps = steps.filter((step): step is ToolBridgeExecutionStep => step !== undefined);

  return {
    executedCount: orderedSteps.filter((step) => step.result.ok).length,
    requestedCount: total,
    resultMessages: orderedSteps.map((step) => step.resultMessage),
    steps: orderedSteps,
    toolCalls: orderedSteps.map((step) => step.chatToolCall),
  };
}

function makeDuplicateStep(call: ToolCallRequest): ToolBridgeExecutionStep {
  const reason = `Duplicate tool call id "${call.id}" — only the first instance was executed.`;
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

  if (call.argumentsParseError) {
    emitTelemetry(telemetry, { callId: call.id, error: call.argumentsParseError, toolId: tool.id, type: "tool-validation-failed" });
    return {
      content: call.argumentsParseError,
      error: call.argumentsParseError,
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

  if (context.signal?.aborted) {
    const reason = "Tool bridge run was aborted before this call could start.";
    emitTelemetry(telemetry, { callId: call.id, reason, toolId: tool.id, type: "tool-skipped" });
    return createSkippedResult(reason);
  }

  const startedAt = nowMs();
  try {
    const result = await tool.execute(validation.args, context);
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

function notifyToolUpdate(callback: ((toolCall: ChatToolCall) => void) | undefined, toolCall: ChatToolCall) {
  if (!callback) {
    return;
  }
  try {
    callback(toolCall);
  } catch {
    // A throwing UI handler must not break tool execution. Swallow and move on.
  }
}

function emitTelemetry(sink: ToolBridgeTelemetrySink | undefined, event: ToolBridgeTelemetryEvent) {
  if (!sink) {
    return;
  }
  try {
    sink(event);
  } catch {
    // Telemetry must never break execution.
  }
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
