import type { LocalPermissionMode } from "./localWorkspace";
import type { ModelProviderId } from "./settings";

export type CodingJsonPrimitive = string | number | boolean | null;
export type CodingJsonValue = CodingJsonPrimitive | CodingJsonValue[] | { [key: string]: CodingJsonValue };

export type CodingRiskLevel = "low" | "medium" | "high";

export interface CodingEvidenceToolRef {
  family?: string;
  id: string;
  permission?: string;
  reason?: string;
  risk?: string;
  title: string;
}

export interface ToolHealthSnapshot {
  advertisedTools: CodingEvidenceToolRef[];
  availableToolCount: number;
  capabilityPlan?: {
    blockedReasons: string[];
    canCallProvider: boolean;
    intent: string[];
    mustUseTools: boolean;
    providerFormat?: string;
    providerVisibleToolIds: string[];
    requiredFamilies: string[];
    selectedToolIds: string[];
  };
  createdAt: string;
  hiddenTools: CodingEvidenceToolRef[];
  id: string;
  model: string;
  parallelToolCalls?: boolean;
  passIndex: number;
  permissionMode: LocalPermissionMode;
  prompt: string;
  provider: ModelProviderId;
  registryToolCount: number;
  runtimeBudget?: {
    maxExecutions?: number;
    maxPasses?: number;
    remainingExecutions?: number;
    remainingPasses?: number;
  };
  selectedTools: CodingEvidenceToolRef[];
  toolChoice?: "auto" | "none" | "required";
  workspaceRoots: string[];
}

export interface CodingEvidenceEvent {
  at: string;
  data?: CodingJsonValue;
  detail?: string;
  id: string;
  kind:
    | "artifact"
    | "browser-console"
    | "file-change"
    | "git-status"
    | "source"
    | "summary"
    | "terminal"
    | "tool-call"
    | "tool-telemetry"
    | "verification";
  label: string;
  status?: "active" | "complete" | "error" | "skipped" | "unknown";
  toolCallId?: string;
  toolId?: string;
}

export interface VerificationPlanItem {
  command?: string;
  id: string;
  kind: "browser" | "manual" | "test";
  label: string;
  reason: string;
  status: "failed" | "not-run" | "passed" | "recommended" | "unknown";
  toolCallId?: string;
}

export interface VerificationPlan {
  assumptions: string[];
  generatedAt: string;
  items: VerificationPlanItem[];
  version: 1;
}

export interface RiskReviewFileSummary {
  additions?: number;
  deletions?: number;
  path: string;
  purpose: string;
  riskLevel: CodingRiskLevel;
  status?: string;
  tags: string[];
}

export interface RiskReviewSummary {
  changedFiles: RiskReviewFileSummary[];
  generatedAt: string;
  riskLevel: CodingRiskLevel;
  sensitiveAreas: string[];
  suggestedCommitMessage: string;
  suggestedPrSummary: string;
  testsRun: string[];
  unverifiedAssumptions: string[];
  version: 1;
}

export interface ProjectMapNode {
  changed?: boolean;
  detail: string;
  evidenceCount?: number;
  id: string;
  lane: string;
  label: string;
  path?: string;
  riskLevel?: CodingRiskLevel;
  tags: string[];
  type: "command" | "component" | "file" | "service" | "test" | "tool" | "type";
}

export interface ProjectMapRelation {
  from: string;
  label: string;
  to: string;
}

export interface ProjectMapLane {
  detail: string;
  id: string;
  label: string;
  nodeIds: string[];
}

export interface ProjectMapSnapshot {
  generatedAt: string;
  lanes: ProjectMapLane[];
  nodes: ProjectMapNode[];
  relations: ProjectMapRelation[];
  roots: string[];
  version: 1;
}

export interface AgentRunCodingEvidenceV1 {
  completedAt?: string;
  events: CodingEvidenceEvent[];
  finalSummary?: string;
  model?: string;
  permissionMode?: LocalPermissionMode;
  projectMap?: ProjectMapSnapshot;
  provider?: ModelProviderId;
  request: {
    chatId: string;
    messageId?: string;
    prompt: string;
    workspaceRoots: string[];
  };
  review?: RiskReviewSummary;
  startedAt: string;
  toolHealth: ToolHealthSnapshot[];
  verification?: VerificationPlan;
  version: 1;
}
