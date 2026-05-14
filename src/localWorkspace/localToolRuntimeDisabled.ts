import type { AgentApproval, AgentApprovalDecision } from "../types/agentRun";
import type { ChatArtifact, ChatProgressItem, ChatSource, ChatToolCall } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { WebSearchSettings } from "../types/settings";
import type { ToolRegistrySettings } from "../types/tools";

export interface LocalComputerToolExecutionPolicy {
  allowedTools?: string[];
  maxToolCallOutputChars?: number | null;
  maxToolResultsChars?: number | null;
}

export interface LocalSubagentTask {
  id?: string;
  prompt: string;
  title?: string;
}

export interface LocalSubagentResult {
  content: string;
  error?: string;
  id: string;
  title: string;
}

export interface LocalComputerToolRunResult {
  approvalRequests: AgentApproval[];
  artifacts: ChatArtifact[];
  browserPreviewUrl?: string;
  contextMessage: string;
  directAnswer?: string;
  executedCount: number;
  progress: ChatProgressItem;
  requestedCount: number;
  recoverableFailure?: unknown;
  sources: ChatSource[];
  toolCalls: ChatToolCall[];
  waitingForApproval: boolean;
}

export const STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY: LocalComputerToolExecutionPolicy = {};
export const DEEP_RESEARCH_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY: LocalComputerToolExecutionPolicy = {};

export function createApprovalSessionDecisionKey(approval: AgentApproval) {
  return `${approval.tool}:${approval.risk}:${approval.title}`;
}

export function createLocalComputerProgress(status: ChatProgressItem["status"], detail: string): ChatProgressItem {
  return {
    detail,
    id: "local-computer-tools",
    label: "Tool progress",
    status,
  };
}

export function hasLocalComputerToolCalls(..._args: unknown[]) {
  return false;
}

export function createLocalComputerToolCallPreviews(..._args: unknown[]): ChatToolCall[] {
  return [];
}

export function createLocalComputerToolRequestContent(content: string, ..._args: unknown[]) {
  return content;
}

export function sanitizeLocalToolCallsForDisplay(content: string, ..._args: unknown[]) {
  return stripToolProtocol(content);
}

export function serializeToolCallEnvelope(..._args: unknown[]) {
  return "";
}

export function routePrimitiveEvidenceBatchToWorkflow(content: string, ..._args: unknown[]) {
  return content;
}

export async function runLocalComputerToolCalls(_options: {
  approvalDecisions?: Record<string, AgentApprovalDecision>;
  assistantContent: string;
  executionPolicy?: LocalComputerToolExecutionPolicy;
  onRunSubagents?: (tasks: LocalSubagentTask[]) => Promise<LocalSubagentResult[]>;
  onToolCallUpdate?: (callNumber: number, toolCall: ChatToolCall) => void;
  previousToolCalls?: ChatToolCall[];
  settings: LocalWorkspaceSettings;
  signal?: AbortSignal;
  toolSettings: ToolRegistrySettings;
  userPrompt: string;
  webSearchMaxResults: number;
  webSearchSettings: WebSearchSettings;
}): Promise<LocalComputerToolRunResult> {
  return {
    approvalRequests: [],
    artifacts: [],
    contextMessage: "Legacy text-emitted local tool protocols are disabled. Rebuilt app tools run through the provider tool bridge when attached to the request.",
    executedCount: 0,
    progress: createLocalComputerProgress("complete", "No local tools ran"),
    requestedCount: 0,
    sources: [],
    toolCalls: [],
    waitingForApproval: false,
  };
}

function stripToolProtocol(content: string) {
  if (!content) {
    return "";
  }

  return content
    .replace(/<<<TOOL_CALL>>>[\s\S]*?(?:<<<END_TOOL_CALL>>>|$)/g, "")
    .replace(/<tool_call\b[\s\S]*?(?:<\/tool_call>|$)/gi, "")
    .trim();
}
