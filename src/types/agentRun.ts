import type { ChatArtifact, ChatSource, ChatToolCall } from "./chat";
import type { LocalWorkspaceSettings } from "./localWorkspace";

export type AgentRunStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "cancelled";

export type AgentRunStepStatus = "queued" | "running" | "waiting_for_approval" | "completed" | "failed" | "skipped";

export type AgentApprovalStatus = "pending" | "approved" | "denied" | "edited" | "expired";

export type AgentApprovalKind = "browser" | "custom_tool" | "delete" | "edit" | "file_create" | "terminal" | "write" | "other";

export type AgentApprovalRisk = "low" | "medium" | "high";

export type AgentApprovalDecisionScope = "once" | "session";

export interface AgentApprovalDecision {
  editedArgs?: Record<string, unknown>;
  note?: string;
  scope?: AgentApprovalDecisionScope;
  status: Extract<AgentApprovalStatus, "approved" | "denied" | "edited">;
}

export interface AgentApproval {
  args?: Record<string, unknown>;
  command?: string;
  createdAt: string;
  detail?: string;
  editedArgs?: Record<string, unknown>;
  id: string;
  kind: AgentApprovalKind;
  messageId?: string;
  path?: string;
  preview?: string;
  resolvedAt?: string;
  resolutionNote?: string;
  resumeToolCallContent?: string;
  risk: AgentApprovalRisk;
  runId?: string;
  status: AgentApprovalStatus;
  title: string;
  tool: string;
  toolCallId?: string;
}

export interface AgentRunStep {
  approvalId?: string;
  completedAt?: string;
  detail?: string;
  id: string;
  input?: string;
  label: string;
  output?: string;
  startedAt: string;
  status: AgentRunStepStatus;
  toolCallId?: string;
  type: "approval" | "browser" | "model" | "planning" | "subagent" | "tool" | "verification";
}

export interface AgentRunEvent {
  at: string;
  detail?: string;
  id: string;
  label: string;
  type: "approval" | "error" | "info" | "recovery" | "resume" | "status";
}

export interface AgentRun {
  approvals: AgentApproval[];
  artifacts: ChatArtifact[];
  chatId: string;
  completedAt?: string;
  createdAt: string;
  events: AgentRunEvent[];
  id: string;
  lastError?: string;
  localWorkspace?: LocalWorkspaceSettings;
  messageId?: string;
  mode: "chat" | "plan";
  pendingToolCallContent?: string;
  prompt: string;
  sources: ChatSource[];
  status: AgentRunStatus;
  steps: AgentRunStep[];
  title: string;
  toolCalls: ChatToolCall[];
  updatedAt: string;
}
