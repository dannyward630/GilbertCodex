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

export function resolveWorkspaceForChatProject(deps: WorkspaceRuntimeDeps, projectName: string, fallback: LocalWorkspaceSettings) {
  const { createNoProjectWorkspace, isNoProjectName, normalizeProjectName, projectsRef } = deps;

    const normalizedProjectName = normalizeProjectName(projectName);

    if (isNoProjectName(normalizedProjectName)) {
      return createNoProjectWorkspace(fallback);
    }

    const projectWorkspace = projectsRef.current.find((project) => project.name.toLowerCase() === normalizedProjectName.toLowerCase())?.localWorkspace;

    if (fallback.enabled && fallback.scope === "full-computer") {
      return fallback;
    }

    if (projectWorkspace) {
      return projectWorkspace;
    }

    return createNoProjectWorkspace(fallback);
  }

export function isActiveChatProject(deps: WorkspaceRuntimeDeps, projectName: string) {
  const { activeChat, activeChatIdRef, normalizeProjectName, pendingChatsRef } = deps;

    const activeChatId = activeChatIdRef.current;
    const activeProjectName = normalizeProjectName(pendingChatsRef.current.find((chat) => chat.id === activeChatId)?.project ?? activeChat.project);

    return activeProjectName.toLowerCase() === normalizeProjectName(projectName).toLowerCase();
  }
