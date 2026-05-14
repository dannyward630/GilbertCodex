import type { ToolRegistrySettings } from "../types/tools";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";

export interface AgentRuntimeDecision {
  action: "answer" | "create" | "edit" | "git" | "read" | "terminal" | "verify";
  answer?: string;
  command?: string;
  cwd?: string;
  edits?: unknown;
  files?: unknown;
  paths?: unknown;
  reason: string;
  tool?: string;
}

export interface AgentRunRequest {
  chatId: string;
  goal: string;
  messageId: string;
  mode: "execute" | "plan";
  source: "auto" | "manual";
  workspace: LocalWorkspaceSettings;
}

export function shouldStartAppAgentRun(_params: {
  mode: "chat" | "plan";
  prompt: string;
  toolSettings: ToolRegistrySettings;
  workspace: LocalWorkspaceSettings;
}) {
  return false;
}

export function createAgentRunRequest(params: AgentRunRequest): AgentRunRequest {
  return params;
}

export function createAgentRunWorkflowToolContent(_request: AgentRunRequest) {
  return "";
}

export function createAgentRuntimeDecisionInstruction(_params: { goal: string; loopIndex: number }) {
  return "Local coding-agent tools have been removed. Answer from the conversation and any host-attached web context only.";
}

export function parseAgentRuntimeDecision(_content: string): AgentRuntimeDecision | null {
  return {
    action: "answer",
    reason: "Local coding-agent tools are disabled.",
  };
}

export function createAgentPrimitiveToolContent(_decision: AgentRuntimeDecision) {
  return "";
}

export function summarizeAgentRuntimeDecision(decision: AgentRuntimeDecision) {
  return decision.reason || "Answer directly";
}
