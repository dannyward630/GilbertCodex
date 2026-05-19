// @ts-nocheck
import type { SetStateAction } from "react";

import type { AgentRuntimeDecision } from "../../../agentRuntime/codingAgent";
import type { LocalComputerToolExecutionPolicy, LocalSubagentResult, LocalSubagentTask } from "../../../localWorkspace/localToolRuntimeDisabled";
import type { ContextCompactionNotice, ContextWindowUsage, ModelContextWindowMap, compactMessagesForContext } from "../../../lib/contextWindow";
import type { PlanningProviderRequest } from "../../../services/planningClient";
import type { ProviderToolBridgeOptions, ToolBridgeExecutionBatch, ToolCallRequest, ToolDefinition, ToolExecutionContext, ToolMemorySearchRequest, ToolResultMessage } from "../../../toolBridge";
import type { AppInfo } from "../../../types/app";
import type { AgentApproval, AgentApprovalDecision, AgentRun } from "../../../types/agentRun";
import type { AuthSession } from "../../../types/auth";
import type { ChatArtifact, ChatAttachment, ChatContextCompaction, ChatComposerDraft, ChatMessage, ChatPlanningInputAnswer, ChatProgressItem, ChatResearchReference, ChatSendInput, ChatSource, ChatSummary, ChatToolCall, ChatWebSearch, ChatWorkTraceItem } from "../../../types/chat";
import type { DiscordBridgeSettings } from "../../../types/discord";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import type { PrimaryRoute } from "../../../types/navigation";
import type { CreateProjectOptions, ProjectSummary } from "../../../types/project";
import type { ProviderReasoningState } from "../../../types/reasoning";
import type { AppPersonalizationSettings, AppearanceMode, ProviderSettings, WebSearchSettings } from "../../../types/settings";
import type { ToolRegistrySettings } from "../../../types/tools";
import type { SettingsSectionId } from "../../../pages/settings/types";
import type { DiscordInteractionEvent } from "../../tauriClient";
import type { ActiveGeneration, ApprovedPlanExecutionContext, AssistantToolResponse, ComposerDraftRestoreRequest, DiscordReplyTarget, DiscordStreamUpdate, QueuedChatSend, SessionApprovalDecisionMap, SessionApprovalDecisionsByWorkspace, StartSendMessageOptions } from "../WorkspaceApp";
import type { WorkspaceRuntimeDeps } from "../runtimeTypes";

export function persistAgentRun(deps: WorkspaceRuntimeDeps, nextRun: AgentRun) {
  const { agentRunsRef, saveAgentRun, setAgentRuns } = deps;

    const normalizedRun: AgentRun = {
      ...nextRun,
      approvals: nextRun.approvals ?? [],
      artifacts: nextRun.artifacts ?? [],
      events: nextRun.events ?? [],
      sources: nextRun.sources ?? [],
      steps: nextRun.steps ?? [],
      toolCalls: nextRun.toolCalls ?? [],
      updatedAt: nextRun.updatedAt || new Date().toISOString(),
    };

    const nextRuns = [normalizedRun, ...agentRunsRef.current.filter((run) => run.id !== normalizedRun.id)].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );

    agentRunsRef.current = nextRuns;
    setAgentRuns(nextRuns);
    void saveAgentRun(normalizedRun);

    return normalizedRun;
  }

export function createAgentRunForMessage(deps: WorkspaceRuntimeDeps, params: {
    chatId: string;
    localWorkspace?: LocalWorkspaceSettings;
    messageId: string;
    mode: "chat" | "plan";
    prompt: string;
    title?: string;
  }) {
  const { createId, persistAgentRun, titleFromMessage } = deps;

    const now = new Date().toISOString();
    const run: AgentRun = {
      approvals: [],
      artifacts: [],
      chatId: params.chatId,
      createdAt: now,
      events: [
        {
          at: now,
          id: createId("agent-event"),
          label: params.mode === "plan" ? "Planning run started" : "Agent run started",
          type: "status",
        },
      ],
      id: createId("agent-run"),
      localWorkspace: params.localWorkspace,
      messageId: params.messageId,
      mode: params.mode,
      prompt: params.prompt,
      sources: [],
      status: "running",
      steps: [
        {
          id: createId("agent-step"),
          label: params.mode === "plan" ? "Plan the work" : "Start the run",
          startedAt: now,
          status: "running",
          type: params.mode === "plan" ? "planning" : "model",
        },
      ],
      title: params.title ?? titleFromMessage(params.prompt, []),
      toolCalls: [],
      updatedAt: now,
    };

    return persistAgentRun(run);
  }

export function updateAgentRun(deps: WorkspaceRuntimeDeps, runId: string | undefined, updater: (run: AgentRun, now: string) => AgentRun) {
  const { agentRunsRef, persistAgentRun } = deps;

    if (!runId) {
      return undefined;
    }

    const existingRun = agentRunsRef.current.find((run) => run.id === runId);

    if (!existingRun) {
      return undefined;
    }

    return persistAgentRun(updater(existingRun, new Date().toISOString()));
  }

export function setAgentRunWaiting(deps: WorkspaceRuntimeDeps, runId: string | undefined, label: string, detail: string, approvals: AgentApproval[], pendingToolCallContent: string) {
  const { createId, mergeAgentApprovals, updateAgentRun } = deps;

    updateAgentRun(runId, (run, now) => ({
      ...run,
      approvals: mergeAgentApprovals(run.approvals, approvals),
      events: [
        ...run.events,
        {
          at: now,
          detail,
          id: createId("agent-event"),
          label,
          type: "approval",
        },
      ],
      pendingToolCallContent: pendingToolCallContent ?? run.pendingToolCallContent,
      status: "waiting_for_approval",
      steps: run.steps.map((step, index) =>
        index === run.steps.length - 1 && step.status === "running"
          ? {
              ...step,
              completedAt: now,
              detail,
              status: "waiting_for_approval",
            }
          : step,
      ),
      updatedAt: now,
    }));
  }

export function setAgentRunCompleted(deps: WorkspaceRuntimeDeps, runId: string | undefined, message: ChatMessage) {
  const { createId, updateAgentRun } = deps;

    updateAgentRun(runId, (run, now) => ({
      ...run,
      artifacts: message.artifacts ?? run.artifacts,
      completedAt: now,
      events: [
        ...run.events,
        {
          at: now,
          id: createId("agent-event"),
          label: "Agent run completed",
          type: "status",
        },
      ],
      pendingToolCallContent: undefined,
      sources: message.sources ?? run.sources,
      status: "completed",
      steps: run.steps.map((step) =>
        step.status === "running" || step.status === "waiting_for_approval"
          ? {
              ...step,
              completedAt: step.completedAt ?? now,
              status: "completed",
            }
          : step,
      ),
      toolCalls: message.toolCalls ?? run.toolCalls,
      updatedAt: now,
    }));
  }

export function setAgentRunFailed(deps: WorkspaceRuntimeDeps, runId: string | undefined, errorMessage: string) {
  const { createId, updateAgentRun } = deps;

    updateAgentRun(runId, (run, now) => ({
      ...run,
      events: [
        ...run.events,
        {
          at: now,
          detail: errorMessage,
          id: createId("agent-event"),
          label: "Agent run failed",
          type: "error",
        },
      ],
      lastError: errorMessage,
      status: "failed",
      steps: run.steps.map((step) =>
        step.status === "running" || step.status === "waiting_for_approval"
          ? {
              ...step,
              completedAt: step.completedAt ?? now,
              detail: errorMessage,
              status: "failed",
            }
          : step,
      ),
      updatedAt: now,
    }));
  }

export function setAgentRunCancelled(deps: WorkspaceRuntimeDeps, runId: string | undefined, detail: string) {
  const { createId, updateAgentRun } = deps;

    updateAgentRun(runId, (run, now) => ({
      ...run,
      completedAt: now,
      events: [
        ...run.events,
        {
          at: now,
          detail,
          id: createId("agent-event"),
          label: "Agent run stopped",
          type: "status",
        },
      ],
      status: "cancelled",
      steps: run.steps.map((step) =>
        step.status === "running" || step.status === "queued" || step.status === "waiting_for_approval"
          ? {
              ...step,
              completedAt: step.completedAt ?? now,
              detail: detail ?? step.detail,
              status: "skipped",
            }
          : step,
      ),
      updatedAt: now,
    }));
  }

export function setAgentRunContinuing(deps: WorkspaceRuntimeDeps, runId: string | undefined, label: string, detail: string) {
  const { createId, updateAgentRun } = deps;

    updateAgentRun(runId, (run, now) => ({
      ...run,
      completedAt: undefined,
      events: [
        ...run.events,
        {
          at: now,
          detail,
          id: createId("agent-event"),
          label,
          type: "resume",
        },
      ],
      lastError: undefined,
      status: "running",
      steps: [
        ...run.steps,
        {
          detail,
          id: createId("agent-step"),
          label,
          startedAt: now,
          status: "running",
          type: "model",
        },
      ],
      updatedAt: now,
    }));
  }

export function createPlanningExecutionApproval(deps: WorkspaceRuntimeDeps, runId: string, messageId: string, planContent: string, prompt: string): AgentApproval {
  const { createId } = deps;

    return {
      args: {
        plan: planContent,
        prompt,
      },
      createdAt: new Date().toISOString(),
      detail: "Review the plan, edit the task JSON if needed, then approve execution.",
      id: createId("approval-plan"),
      kind: "other",
      messageId,
      preview: planContent,
      risk: "medium",
      runId,
      status: "pending",
      title: "Approve plan execution",
      tool: "planning_handoff",
    };
  }
