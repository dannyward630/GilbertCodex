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
import type { ModelProviderId, WebSearchSettings } from "../types/settings";

export type ToolBridgeProviderFormat = "openai-compatible" | "anthropic-messages" | "openai-responses";
export type ToolBridgeRisk = "diagnostic" | "read" | "mutating" | "terminal" | "network" | "destructive" | "credential" | "publish";
export type ToolBridgePermissionRequirement = "diagnostic" | "read-only" | "mutating" | "terminal" | "network" | "destructive" | "external-path" | "credential" | "publish";
export type ToolBridgeToolChoice = "auto" | "none" | "required";
export type ToolBridgeSchedulerMode = "parallel" | "exclusive";

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
  memorySearch?: (request: ToolMemorySearchRequest) => Promise<ToolMemorySearchResponse> | ToolMemorySearchResponse;
  model: string;
  permissionMode: LocalPermissionMode;
  provider: ModelProviderId;
  providerApiKey?: string;
  reportProgress?: ToolExecutionProgressReporter;
  signal?: AbortSignal;
  webSearchMaxResults?: number;
  webSearchSettings?: WebSearchSettings;
  workspaceRoots?: string[];
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
    family: "diagnostic" | "files" | "editing" | "terminal" | "git" | "web" | "media" | "mcp" | "browser" | "workflow" | "memory";
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
export type ToolBridgeTelemetryEvent = { [key: string]: unknown; type: string };
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
import type { ProviderToolBridgeOptions, ToolBridgeProviderFormat } from "../types";

export function applyToolBridgeToProviderRequest<T>(body: T, _format: ToolBridgeProviderFormat, _toolBridge?: ProviderToolBridgeOptions): T {
  return body;
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

export function resolveToolPermission(_tool: ToolDefinition | undefined, _context?: ToolExecutionContext): ToolPermissionDecision {
  return {
    allowed: false,
    reason: "Provider tool bridge is not bundled in this public build.",
    requiresApproval: false,
  };
}

export function filterToolsForPermission(tools: ToolDefinition[] = [], _options: FilterToolsForPermissionOptions = {}) {
  return tools;
}

export function toolBridgePermissionLabel(value: unknown) {
  return String(value ?? "default");
}
'@

Write-ShimFile "parsers.ts" @'
import type { ModelProviderId } from "../types/settings";
import type { ToolCallRequest } from "./types";

export function createToolCallRequest(provider: ModelProviderId, id: string, name: string, args: unknown, raw?: unknown): ToolCallRequest {
  return {
    arguments: args,
    id,
    name,
    provider,
    raw,
  };
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

export function parseOpenAiCompatibleStreamToolCallDeltas(..._args: unknown[]): Array<{ argumentsDelta?: string; argumentsParseError?: string; argumentsSnapshot?: unknown; id?: string; index: number; name?: string; raw?: unknown }> {
  return [];
}

export function parseOpenAiCompatibleToolCalls(..._args: unknown[]): ToolCallRequest[] {
  return [];
}

export function parseResponsesStreamToolCallDeltas(..._args: unknown[]): Array<{ argumentsDelta?: string; argumentsParseError?: string; argumentsSnapshot?: unknown; id?: string; index: number; name?: string; raw?: unknown }> {
  return [];
}

export function parseResponsesStreamToolCalls(..._args: unknown[]): ToolCallRequest[] {
  return [];
}

export function parseResponsesToolCalls(..._args: unknown[]): ToolCallRequest[] {
  return [];
}
'@

Write-ShimFile "index.ts" @'
import type { ChatToolCall } from "../types/chat";
import type {
  ToolBridgeExecutionBatch,
  ToolCallRequest,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  ToolResultMessage,
  ToolValidationResult,
} from "./types";

export * from "./types";
export * from "./permissions";
export * from "./resultFinalizer";
export { applyToolBridgeToProviderRequest } from "./adapters";
export { parseVisibleTextToolCalls } from "./parsers";
export { createProviderVisibleToolSchema, decrementRemainingChars, normalizeRemainingChars } from "./adapters/sharedUtils";

export const BRIDGE_TOOL_CALL_ID_PREFIX = "bridge-tool-";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: ToolDefinition[] = []) {
    for (const tool of tools) {
      this.tools.set(tool.id, tool);
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

  listForContext(_context?: ToolExecutionContext, _provider?: unknown, _settings?: unknown) {
    return this.list();
  }

  register(tool: ToolDefinition) {
    this.tools.set(tool.id, tool);
    return this;
  }
}

export function createDefaultToolRegistry() {
  return new ToolRegistry();
}

export function isToolCompatibleWithProvider() {
  return false;
}

export interface ToolRegistryListOptions {
  [key: string]: unknown;
}

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
