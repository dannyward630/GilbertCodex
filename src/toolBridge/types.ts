import type { ChatToolCall } from "../types/chat";
import type { LocalPermissionMode } from "../types/localWorkspace";
import type { ModelProviderId } from "../types/settings";

export type ToolBridgeProviderFormat = "openai-compatible" | "anthropic-messages" | "openai-responses";
export type ToolBridgeRisk = "diagnostic" | "read" | "mutating" | "terminal" | "network" | "destructive" | "credential" | "publish";
export type ToolBridgePermissionRequirement =
  | "diagnostic"
  | "read-only"
  | "mutating"
  | "terminal"
  | "network"
  | "destructive"
  | "external-path"
  | "credential"
  | "publish";
export type ToolBridgeToolChoice = "auto" | "none" | "required";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export interface ToolExecutionContext {
  model: string;
  permissionMode: LocalPermissionMode;
  provider: ModelProviderId;
  signal?: AbortSignal;
  workspaceRoots?: string[];
}

export interface ToolExecutionResult {
  data?: JsonValue;
  error?: string;
  content: string;
  ok: boolean;
  skippedReason?: string;
}

export interface ToolDefinition {
  compatibleProviders?: ToolBridgeProviderFormat[];
  description: string;
  executorMetadata?: {
    family: "diagnostic" | "files" | "editing" | "terminal" | "git" | "web" | "mcp" | "browser" | "workflow";
    version: number;
  };
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult> | ToolExecutionResult;
  id: string;
  inputSchema: JsonSchema;
  permission: ToolBridgePermissionRequirement;
  risk: ToolBridgeRisk;
  title: string;
}

export interface ToolCallRequest {
  arguments: unknown;
  /**
   * If the raw arguments string could not be parsed as JSON, this field carries
   * the parse error. The orchestrator surfaces it as the call's failure reason
   * instead of running schema validation against a string.
   */
  argumentsParseError?: string;
  id: string;
  name: string;
  provider: ModelProviderId;
  raw?: unknown;
}

export interface ToolResultMessage {
  arguments: unknown;
  callId: string;
  name: string;
  rawCall?: unknown;
  result: ToolExecutionResult;
}

export interface ProviderToolBridgeOptions {
  /**
   * If true, the adapter will NOT synthesize a fake assistant message
   * carrying the original tool_call(s). Set this when the caller's message
   * history already contains the assistant turn that emitted the tool calls.
   * Defaults to false to preserve the legacy contract: the adapter prepends
   * a synthetic assistant message for each result so providers see a
   * well-formed (assistant→tool) pair.
   */
  resultsHistoryAlreadyContainsAssistantTurns?: boolean;
  /**
   * Maximum aggregate characters of completed tool output to place back into
   * the next provider request. Activity keeps the full raw output separately.
   */
  maxToolResultContentChars?: number | null;
  toolChoice?: ToolBridgeToolChoice;
  toolResultMessages?: ToolResultMessage[];
  tools?: ToolDefinition[];
}

export interface ToolPermissionDecision {
  allowed: boolean;
  reason?: string;
  requiresApproval: boolean;
}

export interface ToolValidationResult {
  args?: Record<string, unknown>;
  error?: string;
  ok: boolean;
}

export interface ToolBridgeExecutionStep {
  call: ToolCallRequest;
  chatToolCall: ChatToolCall;
  result: ToolExecutionResult;
  resultMessage: ToolResultMessage;
}

export interface ToolBridgeExecutionBatch {
  executedCount: number;
  requestedCount: number;
  resultMessages: ToolResultMessage[];
  steps: ToolBridgeExecutionStep[];
  toolCalls: ChatToolCall[];
}

export interface ToolBridgeProviderTurn {
  content: string;
  reasoning?: string;
  toolCalls?: ToolCallRequest[];
}

export interface ToolApprovalRequest {
  call: ToolCallRequest;
  reason?: string;
  tool: ToolDefinition;
}

export interface ToolApprovalDecision {
  approved: boolean;
  reason?: string;
}

export type ToolApprovalCallback = (request: ToolApprovalRequest) => Promise<ToolApprovalDecision> | ToolApprovalDecision;

export type ToolBridgeTelemetryEvent =
  | {
      callId: string;
      durationMs: number;
      error?: string;
      family?: string;
      ok: boolean;
      toolId: string;
      type: "tool-invoked";
      version?: number;
    }
  | { callId: string; reason: string; toolId: string; type: "tool-skipped" }
  | { callId: string; error: string; toolId: string; type: "tool-validation-failed" }
  | { callId: string; reason?: string; toolId: string; type: "tool-approval-requested" }
  | { approved: boolean; callId: string; reason?: string; toolId: string; type: "tool-approval-resolved" }
  | { loopIndex: number; reason: "max-loops" | "signal"; type: "tool-loop-aborted" }
  | { callId: string; toolName: string; type: "tool-call-duplicate" };

export type ToolBridgeTelemetrySink = (event: ToolBridgeTelemetryEvent) => void;
