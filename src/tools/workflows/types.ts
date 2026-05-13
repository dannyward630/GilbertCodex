import type { ToolRegistryId } from "../../types/tools";
import type {
  LocalComputerToolCallResult,
  LocalComputerToolName,
  ParsedLocalComputerToolCall,
  ToolHandlerContext,
} from "../computer/executor/types";

export type WorkflowMode = "auto" | "execute" | "monitor" | "plan";

export type WorkflowStepKind =
  | "approval_wait"
  | "branch"
  | "model_synthesis"
  | "note"
  | "parallel"
  | "primitive"
  | "verification";

export type WorkflowPrimitiveFamily =
  | "approval"
  | "artifact"
  | "mcp"
  | "source_control"
  | "subagent"
  | "terminal"
  | "web"
  | "workspace_mutate"
  | "workspace_read";

export interface WorkflowPrimitiveDefinition {
  description: string;
  family: WorkflowPrimitiveFamily;
  mutates: boolean;
  requiredTools: ToolRegistryId[];
  tool: LocalComputerToolName;
}

export interface WorkflowRetryPolicy {
  maxAttempts: number;
}

export interface WorkflowPrimitiveStepDefinition {
  args?: Record<string, string>;
  family?: WorkflowPrimitiveFamily;
  id: string;
  kind: "primitive" | "verification";
  label: string;
  optional?: boolean;
  retry?: WorkflowRetryPolicy;
  tool: LocalComputerToolName;
}

export interface WorkflowParallelStepDefinition {
  id: string;
  kind: "parallel";
  label: string;
  steps: WorkflowPrimitiveStepDefinition[];
}

export interface WorkflowBranchStepDefinition {
  elseSteps?: WorkflowStepDefinition[];
  id: string;
  ifSteps: WorkflowStepDefinition[];
  kind: "branch";
  label: string;
  when: {
    input?: string;
    matches?: string;
    toolEnabled?: ToolRegistryId;
  };
}

export interface WorkflowNoteStepDefinition {
  detail: string;
  id: string;
  kind: "approval_wait" | "model_synthesis" | "note";
  label: string;
}

export type WorkflowStepDefinition =
  | WorkflowBranchStepDefinition
  | WorkflowNoteStepDefinition
  | WorkflowParallelStepDefinition
  | WorkflowPrimitiveStepDefinition;

export interface WorkflowInputDefinition {
  description: string;
  id: string;
  required?: boolean;
}

export interface WorkflowDefinition {
  description: string;
  id: string;
  inputs?: WorkflowInputDefinition[];
  mutates: boolean;
  requiredTools: ToolRegistryId[];
  steps: WorkflowStepDefinition[];
  successCriteria: string[];
  title: string;
  triggerHints: string[];
  version: number;
}

export interface WorkflowRunState {
  completedStepIds: string[];
  currentStepId?: string;
  pendingApprovalId?: string;
  retryCounts: Record<string, number>;
  stepResults: WorkflowStepResult[];
  variables: Record<string, unknown>;
  workflowId: string;
  workflowVersion: number;
}

export interface WorkflowRunRequest {
  approvalPolicy: "inherit";
  goal: string;
  inputs: Record<string, unknown>;
  mode: WorkflowMode;
  workflowId?: string;
}

export interface WorkflowStepResult {
  attempts: number;
  detail?: string;
  id: string;
  label: string;
  output?: string;
  status: "complete" | "error" | "skipped" | "waiting_approval";
  tool?: LocalComputerToolName;
}

export interface WorkflowExecutionResult {
  artifacts?: LocalComputerToolCallResult["artifacts"];
  browserPreviewUrl?: string;
  content: string;
  executed: boolean;
  fileChanges?: LocalComputerToolCallResult["fileChanges"];
  is_error?: boolean;
  sources?: LocalComputerToolCallResult["sources"];
}

export type WorkflowPrimitiveRunner = (
  call: ParsedLocalComputerToolCall,
  context: ToolHandlerContext,
) => Promise<LocalComputerToolCallResult>;
