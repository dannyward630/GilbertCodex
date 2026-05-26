param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$toolBridgeRoot = Join-Path $repoRoot "src\toolBridge"
$indexPath = Join-Path $toolBridgeRoot "index.ts"

if ((Test-Path $indexPath) -and -not $Force) {
  Write-Host "Existing local tool bridge found; public shim not needed."
  exit 0
}

New-Item -ItemType Directory -Force -Path $toolBridgeRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $toolBridgeRoot "adapters") | Out-Null

function Write-ShimFile {
  param(
    [Parameter(Mandatory = $true)][string]$RelativePath,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $target = Join-Path $toolBridgeRoot $RelativePath
  $targetDir = Split-Path -Parent $target
  New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
  Set-Content -LiteralPath $target -Value $Content -Encoding utf8
}

Write-ShimFile "types.ts" @'
import type { ChatToolCall } from "../types/chat";
import type { LocalPermissionMode } from "../types/localWorkspace";
import type { ProviderReasoningState } from "../types/reasoning";
import type { AppAgentEnvironment, ModelProviderId, WebSearchSettings } from "../types/settings";
import type { TerminalShellId } from "../types/terminal";

export type ToolBridgeProviderFormat = "openai-compatible" | "anthropic-messages" | "openai-responses";
export type ToolBridgeRisk = "diagnostic" | "read" | "mutating" | "terminal" | "network" | "destructive" | "credential" | "publish";
export type ToolBridgeToolFamily = "diagnostic" | "files" | "editing" | "terminal" | "git" | "github" | "web" | "media" | "mcp" | "browser" | "workflow" | "memory" | "gmail" | "calendar";
export type ToolBridgePermissionRequirement = "diagnostic" | "read-only" | "mutating" | "terminal" | "network" | "destructive" | "external-path" | "credential" | "publish";
export type ToolBridgeToolChoice = "auto" | "none" | "required";
export type ToolBridgeSchedulerMode = "parallel" | "exclusive";
export type ToolIntent =
  | "none"
  | "workspace_evidence"
  | "workspace_mutation"
  | "git_review"
  | "web_search"
  | "terminal"
  | "browser"
  | "media_generation"
  | "memory"
  | "gmail"
  | "calendar"
  | "diagnostic";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonSchema = Record<string, unknown>;

export interface ToolMemorySearchRequest {
  includeProjectMap?: boolean;
  includeRecentEvents?: boolean;
  includeToolLessons?: boolean;
  maxChars?: number;
  maxRecords?: number;
  query: string;
}

export interface ToolMemorySearchResponse {
  chatTitle?: string;
  content: string;
  projectName?: string;
  projectRecordCount?: number;
  storedRecordCount?: number;
  toolLessonCount?: number;
}

export interface ToolExecutionContext {
  agentEnvironment?: AppAgentEnvironment;
  automationScope?: ToolAutomationScope;
  memorySearch?: (request: ToolMemorySearchRequest) => Promise<ToolMemorySearchResponse> | ToolMemorySearchResponse;
  model: string;
  permissionMode: LocalPermissionMode;
  provider: ModelProviderId;
  providerApiKey?: string;
  reportProgress?: ToolExecutionProgressReporter;
  signal?: AbortSignal;
  terminalDefaultShell?: TerminalShellId;
  webSearchMaxResults?: number;
  webSearchSettings?: WebSearchSettings;
  workspaceRoots?: string[];
}

export interface ToolAutomationScope {
  allowedFamilies?: ToolBridgeToolFamily[];
  allowedToolIds?: string[];
  autonomous: boolean;
  maxModelLoops?: number;
  maxRuntimeSeconds?: number;
  maxToolCalls?: number;
  taskId: string;
  taskTitle?: string;
}

export interface ToolExecutionResult {
  content: string;
  data?: JsonValue;
  error?: string;
  ok: boolean;
  skippedReason?: string;
}

export type ToolExecutionProgressReporter = (result: ToolExecutionResult) => void;

export interface ToolDefinition {
  compatibleProviders?: ToolBridgeProviderFormat[];
  description: string;
  executorMetadata?: {
    family: ToolBridgeToolFamily;
    version: number;
  };
  execute: (args: Record<string, unknown>, context: ToolExecutionContext) => Promise<ToolExecutionResult> | ToolExecutionResult;
  id: string;
  inputSchema: JsonSchema;
  permission: ToolBridgePermissionRequirement;
  risk: ToolBridgeRisk;
  scheduler?: { mode?: ToolBridgeSchedulerMode };
  title: string;
}

export interface ToolCapabilityBlockedReason {
  code: string;
  detail: string;
  family?: ToolBridgeToolFamily;
  toolId?: string;
}

export interface ToolCapabilityPlan {
  blockedReasons: ToolCapabilityBlockedReason[];
  canCallProvider: boolean;
  intent: ToolIntent[];
  mustUseTools: boolean;
  prompt: string;
  providerFormat?: ToolBridgeProviderFormat;
  providerVisibleToolIds: string[];
  requiredFamilies: ToolBridgeToolFamily[];
  selectedToolIds: string[];
  selectedTools: ToolDefinition[];
  toolChoice: ToolBridgeToolChoice;
}

export interface ToolCallRequest {
  arguments: unknown;
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
  maxToolResultContentChars?: number | null;
  parallelToolCalls?: boolean;
  reasoningState?: ProviderReasoningState;
  capabilityPlan?: ToolCapabilityPlan;
  providerVisibleToolIds?: string[];
  resultsHistoryAlreadyContainsAssistantTurns?: boolean;
  runtimeBudget?: {
    maxExecutions?: number;
    maxPasses?: number;
    maxToolResultContentChars?: number | null;
    remainingExecutions?: number;
    remainingPasses?: number;
  };
  toolChoice?: ToolBridgeToolChoice;
  toolResultDelivery?: "native" | "inline-user-message";
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
  coalescedCount?: number;
  executedCount: number;
  handledCount: number;
  hostExecutionCount?: number;
  requestedCount: number;
  resultMessages: ToolResultMessage[];
  steps: ToolBridgeExecutionStep[];
  toolCalls: ChatToolCall[];
}

export interface ToolBridgeProviderTurn {
  content: string;
  reasoningState?: ProviderReasoningState;
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
  | { coalescedCount: number; fromToolIds: string[]; requestedCount: number; toToolIds: string[]; type: "tool-batch-coalesced" }
  | { exclusiveCount: number; parallelCount: number; segmentCount: number; type: "tool-batch-scheduled" }
  | { loopIndex: number; reason: "max-loops" | "signal"; type: "tool-loop-aborted" }
  | { callId: string; toolName: string; type: "tool-call-duplicate" };
export type ToolBridgeTelemetrySink = (event: ToolBridgeTelemetryEvent) => void;
'@

Write-ShimFile "resultFinalizer.ts" @'
import type { ChatToolCall, ChatToolResultPolicy } from "../types/chat";
import type { ToolExecutionResult } from "./types";

export type ToolResultKind = "diagnostic" | "edit" | "file_content" | "git" | "search" | "summary" | "terminal" | "unknown";
export type VisibleToolResultMode = "allow_raw" | "safe_summary" | "synthesize";

export interface ToolResultFinalizationOptions {
  arguments?: unknown;
  label?: string;
  maxProviderChars?: number | null;
  result: ToolExecutionResult;
  toolId: string;
}

export interface ToolResultFinalization {
  providerContent: string;
  providerRawCharCount: number;
  resultKind: ToolResultKind;
  toolRecordContent: string;
  visibleFallback: string;
  visiblePolicy: ChatToolResultPolicy;
}

export function finalizeToolResult(options: ToolResultFinalizationOptions): ToolResultFinalization {
  const rawContent = createToolResultContent(options.result);
  const providerContent = limitToolResultContentForProvider(rawContent, options.maxProviderChars);
  return {
    providerContent,
    providerRawCharCount: rawContent.length,
    resultKind: "unknown",
    toolRecordContent: rawContent,
    visibleFallback: providerContent,
    visiblePolicy: {
      mode: "safe_summary",
      resultKind: "unknown",
      synthesizeAfterwards: true,
    },
  };
}

export function createToolResultContent(result: ToolExecutionResult) {
  return result.content.trim() || result.error || (result.data === undefined ? "" : safeJson(result.data));
}

export function createVisibleFallbackFromToolCall(toolCall: ChatToolCall) {
  return toolCall.output || toolCall.detail || "";
}

export function shouldToolCallForceSynthesis(toolCall: ChatToolCall) {
  return Boolean(toolCall.resultPolicy?.synthesizeAfterwards);
}

export function isVisibleToolResultLeak(content: string) {
  return /\bTOOL RESULT EVIDENCE\b/i.test(content);
}

function limitToolResultContentForProvider(content: string, maxChars: number | null | undefined) {
  if (typeof maxChars !== "number" || maxChars < 0 || content.length <= maxChars) {
    return content;
  }
  return `${content.slice(0, Math.max(0, maxChars))}\n\n[Tool output truncated for provider context.]`;
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
'@

Write-ShimFile "adapters\sharedUtils.ts" @'
import type { JsonSchema, ToolDefinition, ToolResultMessage } from "../types";
import { finalizeToolResult } from "../resultFinalizer";

export function normalizeRemainingChars(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(Math.floor(value), 0);
}

export function decrementRemainingChars(remaining: number | null, rawLength: number): number | null {
  return remaining === null ? null : Math.max(remaining - rawLength, 0);
}

export function createInlineToolResultMessage(result: ToolResultMessage, remainingChars: number | null) {
  const finalization = finalizeToolResult({
    arguments: result.arguments,
    maxProviderChars: remainingChars,
    result: result.result,
    toolId: result.name,
  });
  return {
    content: finalization.providerContent,
    providerRawCharCount: finalization.providerRawCharCount,
  };
}

export function appendInlineUserToolResultMessages(currentMessages: unknown, results: ToolResultMessage[], options: { maxToolResultContentChars?: number | null }) {
  const messages = Array.isArray(currentMessages) ? [...currentMessages] : [];
  let remaining = normalizeRemainingChars(options.maxToolResultContentChars);
  for (const result of results) {
    const inlineResult = createInlineToolResultMessage(result, remaining);
    remaining = decrementRemainingChars(remaining, inlineResult.providerRawCharCount);
    messages.push({ content: inlineResult.content, role: "user" });
  }
  return messages;
}

export function createProviderVisibleToolSchema(tool: ToolDefinition) {
  return {
    description: tool.description,
    inputSchema: tool.inputSchema as JsonSchema,
    name: tool.id,
  };
}
'@

Write-ShimFile "adapters\index.ts" @'
import type { ProviderToolBridgeOptions, ToolBridgeProviderFormat, ToolDefinition } from "../types";

export function applyToolBridgeToProviderRequest<T>(body: T, format: ToolBridgeProviderFormat, toolBridge?: ProviderToolBridgeOptions): T {
  if (!toolBridge?.tools?.length || toolBridge.toolChoice === "none") {
    return body;
  }

  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const providerVisibleToolIds = new Set(toolBridge.providerVisibleToolIds ?? []);
  const tools = toolBridge.tools.filter((tool) => providerVisibleToolIds.size === 0 || providerVisibleToolIds.has(tool.id));

  if (tools.length === 0) {
    return body;
  }

  if (format === "anthropic-messages") {
    record.tools = tools.map(toAnthropicTool);
  } else if (format === "openai-responses") {
    record.tools = tools.map(toResponsesTool);
  } else {
    record.tools = tools.map(toOpenAiCompatibleTool);
  }

  if (toolBridge.toolChoice && toolBridge.toolChoice !== "auto") {
    record.tool_choice = toolBridge.toolChoice;
  }

  return body;
}

function toOpenAiCompatibleTool(tool: ToolDefinition) {
  return {
    function: {
      description: tool.description,
      name: tool.id,
      parameters: tool.inputSchema,
    },
    type: "function",
  };
}

function toResponsesTool(tool: ToolDefinition) {
  return {
    description: tool.description,
    name: tool.id,
    parameters: tool.inputSchema,
    type: "function",
  };
}

function toAnthropicTool(tool: ToolDefinition) {
  return {
    description: tool.description,
    input_schema: tool.inputSchema,
    name: tool.id,
  };
}
'@

Write-ShimFile "permissions.ts" @'
import type { LocalPermissionMode } from "../types/localWorkspace";
import type { ToolDefinition, ToolExecutionContext, ToolPermissionDecision } from "./types";

export interface FilterToolsForPermissionOptions {
  context?: ToolExecutionContext;
}

export function normalizeToolBridgePermissionMode(value: unknown): LocalPermissionMode {
  return value === "auto-review" || value === "full-access" || value === "default" ? value : "default";
}

export function resolveToolPermission(tool: ToolDefinition, context: Pick<ToolExecutionContext, "automationScope" | "permissionMode">): ToolPermissionDecision {
  if (context.permissionMode === "full-access") {
    return {
      allowed: true,
      requiresApproval: false,
    };
  }

  if (tool.permission === "diagnostic" || tool.permission === "read-only") {
    return {
      allowed: true,
      requiresApproval: false,
    };
  }

  return {
    allowed: false,
    reason: "Tool requires approval before execution.",
    requiresApproval: true,
  };
}

export function filterToolsForPermission(
  tools: ToolDefinition[] = [],
  _context?: Pick<ToolExecutionContext, "automationScope" | "permissionMode">,
  _options: FilterToolsForPermissionOptions = {},
) {
  return tools;
}

export function toolBridgePermissionLabel(value: unknown) {
  return String(value ?? "default");
}
'@

Write-ShimFile "registry.ts" @'
import type { ToolBridgeProviderFormat, ToolDefinition, ToolExecutionContext } from "./types";
import { filterToolsForPermission, type FilterToolsForPermissionOptions } from "./permissions";

export type ToolRegistryListOptions = FilterToolsForPermissionOptions;

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(id: string) {
    return this.tools.get(id);
  }

  has(id: string) {
    return this.tools.has(id);
  }

  list() {
    return [...this.tools.values()];
  }

  listForContext(
    context: Pick<ToolExecutionContext, "automationScope" | "permissionMode">,
    providerFormat?: ToolBridgeProviderFormat,
    options?: ToolRegistryListOptions,
  ) {
    return filterToolsForPermission(this.list(), context, options).filter((tool) =>
      isToolCompatibleWithProvider(tool, providerFormat),
    );
  }

  register(tool: ToolDefinition) {
    this.tools.set(tool.id, tool);
    return this;
  }
}

export function createDefaultToolRegistry() {
  return new ToolRegistry();
}

export function isToolCompatibleWithProvider(tool: ToolDefinition, providerFormat: ToolBridgeProviderFormat | undefined) {
  return !providerFormat || !tool.compatibleProviders || tool.compatibleProviders.includes(providerFormat);
}
'@

Write-ShimFile "parsers.ts" @'
import type { ModelProviderId } from "../types/settings";
import type { ToolCallRequest } from "./types";

export function createToolCallRequest(provider: ModelProviderId, id: string, name: string, args: unknown, raw?: unknown): ToolCallRequest {
  const request: ToolCallRequest = {
    arguments: args,
    id,
    name,
    provider,
    raw,
  };

  if (typeof args === "string") {
    const parsed = parseJsonArguments(args);
    request.arguments = parsed.ok ? parsed.value : {};
    request.argumentsParseError = parsed.ok ? undefined : parsed.error;
  }

  return request;
}

export function parseVisibleTextToolCalls(): ToolCallRequest[] {
  return [];
}

export function parseAnthropicStreamToolCallDelta(..._args: unknown[]): { argumentsDelta?: string; argumentsParseError?: string; argumentsSnapshot?: unknown; id?: string; index: number; name?: string; raw?: unknown } | undefined {
  return undefined;
}

export function parseAnthropicToolCalls(..._args: unknown[]): ToolCallRequest[] {
  return [];
}

export function parseOpenAiCompatibleStreamToolCallDeltas(payload: unknown): Array<{ argumentsDelta?: string; argumentsParseError?: string; argumentsSnapshot?: unknown; id?: string; index: number; name?: string; raw?: unknown }> {
  const choice = readArray(readRecord(payload).choices)[0];
  const delta = readRecord(readRecord(choice).delta ?? readRecord(choice).message);
  return readArray(delta.tool_calls).map((rawCall, fallbackIndex) => {
    const call = readRecord(rawCall);
    const fn = readRecord(call.function);
    return {
      argumentsDelta: typeof fn.arguments === "string" ? fn.arguments : undefined,
      id: typeof call.id === "string" ? call.id : undefined,
      index: typeof call.index === "number" ? call.index : fallbackIndex,
      name: typeof fn.name === "string" ? fn.name : undefined,
      raw: rawCall,
    };
  });
}

export function parseOpenAiCompatibleToolCalls(message: unknown, provider: ModelProviderId): ToolCallRequest[] {
  return readArray(readRecord(message).tool_calls).flatMap((rawCall, index) => {
    const call = readRecord(rawCall);
    const fn = readRecord(call.function);
    const name = typeof fn.name === "string" ? fn.name : "";
    if (!name) {
      return [];
    }

    return [createToolCallRequest(
      provider,
      typeof call.id === "string" ? call.id : `${name}-${index + 1}`,
      name,
      typeof fn.arguments === "string" ? fn.arguments : {},
      rawCall,
    )];
  });
}

export function parseResponsesStreamToolCallDeltas(payload: unknown): Array<{ argumentsDelta?: string; argumentsParseError?: string; argumentsSnapshot?: unknown; id?: string; index: number; name?: string; raw?: unknown }> {
  const record = readRecord(payload);
  const type = typeof record.type === "string" ? record.type : "";
  const index = typeof record.output_index === "number" ? record.output_index : 0;

  if (type === "response.output_item.added") {
    const item = readRecord(record.item);
    if (item.type !== "function_call") {
      return [];
    }

    return [{
      argumentsDelta: typeof item.arguments === "string" ? item.arguments : undefined,
      id: typeof item.call_id === "string" ? item.call_id : typeof item.id === "string" ? item.id : undefined,
      index,
      name: typeof item.name === "string" ? item.name : undefined,
      raw: payload,
    }];
  }

  if (type === "response.function_call_arguments.delta") {
    return [{
      argumentsDelta: typeof record.delta === "string" ? record.delta : "",
      index,
      raw: payload,
    }];
  }

  if (type === "response.function_call_arguments.done") {
    const parsed = typeof record.arguments === "string" ? parseJsonArguments(record.arguments) : undefined;
    return [{
      argumentsParseError: parsed && !parsed.ok ? parsed.error : undefined,
      argumentsSnapshot: parsed?.ok ? parsed.value : undefined,
      index,
      name: typeof record.name === "string" ? record.name : undefined,
      raw: payload,
    }];
  }

  return [];
}

export function parseResponsesStreamToolCalls(..._args: unknown[]): ToolCallRequest[] {
  return [];
}

export function parseResponsesToolCalls(..._args: unknown[]): ToolCallRequest[] {
  return [];
}

function parseJsonArguments(value: string): { ok: true; value: unknown } | { error: string; ok: false } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: {} };
  }

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (error) {
    return {
      error: `Could not parse tool arguments as JSON: ${error instanceof Error ? error.message : String(error)}`,
      ok: false,
    };
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
'@

Write-ShimFile "index.ts" @'
import type { ChatToolCall } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import type { ToolRegistry } from "./registry";
import type {
  ToolBridgeExecutionBatch,
  ToolBridgeProviderFormat,
  ToolBridgeToolChoice,
  ToolBridgeToolFamily,
  ToolCallRequest,
  ToolCapabilityBlockedReason,
  ToolCapabilityPlan,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolIntent,
  ToolResultMessage,
  ToolValidationResult,
} from "./types";

export * from "./types";
export * from "./permissions";
export { ToolRegistry, createDefaultToolRegistry, isToolCompatibleWithProvider, type ToolRegistryListOptions } from "./registry";
export * from "./resultFinalizer";
export { applyToolBridgeToProviderRequest } from "./adapters";
export { parseVisibleTextToolCalls } from "./parsers";
export { createProviderVisibleToolSchema, decrementRemainingChars, normalizeRemainingChars } from "./adapters/sharedUtils";

export const BRIDGE_TOOL_CALL_ID_PREFIX = "bridge-tool-";

export function createBridgeChatToolCall(call: ToolCallRequest, tool: ToolDefinition | undefined, result: ToolExecutionResult, status: ChatToolCall["status"] = result.ok ? "complete" : "error"): ChatToolCall {
  return {
    detail: result.skippedReason || result.error,
    id: `${BRIDGE_TOOL_CALL_ID_PREFIX}${call.id}`,
    input: safeStringify(call.arguments ?? {}),
    label: tool?.title || call.name,
    output: result.content || result.error,
    status,
    toolId: call.name,
  };
}

export function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatToolResultContent(result: ToolExecutionResult) {
  return result.content || result.error || "";
}

export function coalesceToolBridgeCalls(calls: ToolCallRequest[]) {
  return { calls, coalescedCount: 0 };
}

export function createToolExecutionSegments(calls: ToolCallRequest[]) {
  return [calls];
}

export function getToolSchedulerMode() {
  return "parallel" as const;
}

export async function executeToolBridgeCalls(options: { calls?: ToolCallRequest[]; registry?: ToolRegistry }): Promise<ToolBridgeExecutionBatch> {
  const calls = options.calls ?? [];
  const toolCalls = calls.map((call) =>
    createBridgeChatToolCall(
      call,
      options.registry?.get(call.name),
      { content: "Provider tool bridge is not bundled in this public build.", ok: false, skippedReason: "Tool bridge unavailable." },
      "skipped",
    ),
  );
  const resultMessages: ToolResultMessage[] = calls.map((call) => ({
    arguments: call.arguments,
    callId: call.id,
    name: call.name,
    rawCall: call.raw,
    result: { content: "Provider tool bridge is not bundled in this public build.", ok: false, skippedReason: "Tool bridge unavailable." },
  }));
  return {
    executedCount: 0,
    handledCount: calls.length,
    requestedCount: calls.length,
    resultMessages,
    steps: [],
    toolCalls,
  };
}

export function validateToolArguments(_tool: ToolDefinition | undefined, args: unknown): ToolValidationResult {
  return typeof args === "object" && args !== null
    ? { args: args as Record<string, unknown>, ok: true }
    : { args: {}, ok: true };
}

export function selectAdvertisedBridgeTools() {
  return [] as ToolDefinition[];
}

export interface SelectToolCapabilityPlanOptions {
  availableTools: ToolDefinition[];
  blockedReasons?: ToolCapabilityBlockedReason[];
  mustUseTools?: boolean;
  prompt: string;
  providerFormat?: ToolBridgeProviderFormat;
  requiredFamilies?: ToolBridgeToolFamily[];
  requestedToolChoice?: ToolBridgeToolChoice;
  toolBudgetReached?: boolean;
  toolIntent?: ToolIntent[];
}

export function inferProviderToolBridgeFormat(settings: ProviderSettings): ToolBridgeProviderFormat {
  if (settings.provider === "anthropic") {
    return "anthropic-messages";
  }

  if (settings.provider === "openai" && settings.thinking.enabled) {
    return "openai-responses";
  }

  return "openai-compatible";
}

export function createToolCapabilityPlan(options: {
  blockedReasons?: ToolCapabilityBlockedReason[];
  mustUseTools?: boolean;
  prompt: string;
  providerFormat?: ToolBridgeProviderFormat;
  requestedToolChoice?: ToolBridgeToolChoice;
  requiredFamilies?: ToolBridgeToolFamily[];
  selectedTools: ToolDefinition[];
  toolBudgetReached?: boolean;
  toolIntent?: ToolIntent[];
}): ToolCapabilityPlan {
  const selectedTools = options.toolBudgetReached ? [] : options.selectedTools;
  const providerVisibleToolIds = selectedTools.map((tool) => tool.id);
  const canCallProvider = !options.mustUseTools || (providerVisibleToolIds.length > 0 && !options.toolBudgetReached);

  return {
    blockedReasons: options.blockedReasons ?? [],
    canCallProvider,
    intent: options.toolIntent?.length ? [...new Set(options.toolIntent)] : ["none"],
    mustUseTools: Boolean(options.mustUseTools),
    prompt: options.prompt,
    providerFormat: options.providerFormat,
    providerVisibleToolIds,
    requiredFamilies: [...new Set(options.requiredFamilies ?? [])],
    selectedToolIds: selectedTools.map((tool) => tool.id),
    selectedTools,
    toolChoice: options.toolBudgetReached || !canCallProvider ? "none" : options.requestedToolChoice ?? (options.mustUseTools ? "required" : "auto"),
  };
}

export function selectToolCapabilityPlan(options: SelectToolCapabilityPlanOptions): ToolCapabilityPlan {
  return createToolCapabilityPlan({
    blockedReasons: options.blockedReasons,
    mustUseTools: options.mustUseTools,
    prompt: options.prompt,
    providerFormat: options.providerFormat,
    requestedToolChoice: options.requestedToolChoice,
    requiredFamilies: options.requiredFamilies,
    selectedTools: options.availableTools,
    toolBudgetReached: options.toolBudgetReached,
    toolIntent: options.toolIntent,
  });
}

export function shouldAttachWebSearch(prompt = "") {
  return /\b(?:search|web|latest|current|source|verify|cite)\b/i.test(prompt);
}

export interface SelectAdvertisedBridgeToolsOptions {
  [key: string]: unknown;
}

export function createProjectToolMemoryContext() {
  return "";
}

export function createProjectToolMemoryScope(input: unknown) {
  return input;
}

export function learnProjectToolMemoryFromBridgeRun<T>(state: T) {
  return state;
}

export function learnProjectToolMemoryFromChatToolCalls<T>(state: T) {
  return state;
}

export function loadProjectToolMemoryState(_scope?: unknown, options?: { load?: (key: string) => string | null }) {
  const raw = options?.load?.("project-tool-memory");
  if (!raw) {
    return { entries: [], version: 1 };
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { entries: [], version: 1 };
  }
}

export function saveProjectToolMemoryState(state: unknown, options?: { save?: (key: string, value: string) => void }) {
  options?.save?.("project-tool-memory", safeStringify(state));
}

export function projectToolMemoryStorageKey() {
  return "project-tool-memory";
}

export interface ProjectToolMemoryEntry {
  [key: string]: unknown;
}

export interface ProjectToolMemoryScope {
  [key: string]: unknown;
}

export interface ProjectToolMemoryState {
  entries?: ProjectToolMemoryEntry[];
  version?: number;
}

export interface ProjectToolMemoryStorage {
  load?: (key: string) => string | null;
  save?: (key: string, value: string) => void;
}
'@

Write-Host "Generated public-safe tool bridge shim for CI/release builds."
