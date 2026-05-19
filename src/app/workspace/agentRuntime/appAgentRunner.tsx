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

export function createAppAgentToolCall(deps: WorkspaceRuntimeDeps, messageId: string, status: ChatToolCall["status"], detail: string, output: string, fileChanges: ChatToolCall["fileChanges"]): ChatToolCall {

    return {
      detail,
      fileChanges,
      id: `app-agent-run-${messageId}`,
      label: "Agent run",
      output,
      status,
    };
  }

export function appendAgentRuntimeStep(deps: WorkspaceRuntimeDeps, runId: string | undefined, type: AgentRun["steps"][number]["type"], label: string, detail: string) {
  const { createId, updateAgentRun } = deps;

    updateAgentRun(runId, (run, now) => ({
      ...run,
      steps: [
        ...run.steps.map((step) =>
          step.status === "running"
            ? {
                ...step,
                completedAt: step.completedAt ?? now,
                status: "completed" as const,
              }
            : step,
        ),
        {
          detail,
          id: createId("agent-step"),
          label,
          startedAt: now,
          status: "running",
          type,
        },
      ],
      updatedAt: now,
    }));
  }

export function completeLatestAgentRuntimeStep(deps: WorkspaceRuntimeDeps, runId: string | undefined, status: AgentRun["steps"][number]["status"], detail: string) {
  const { updateAgentRun } = deps;

    updateAgentRun(runId, (run, now) => ({
      ...run,
      steps: run.steps.map((step, index) =>
        index === run.steps.length - 1 && step.status === "running"
          ? {
              ...step,
              completedAt: now,
              detail: detail ?? step.detail,
              status,
            }
          : step,
      ),
      updatedAt: now,
    }));
  }

export function mapAgentDecisionToStepType(deps: WorkspaceRuntimeDeps, decision: AgentRuntimeDecision): AgentRun["steps"][number]["type"] {

    if (decision.action === "read") return "read";
    if (decision.action === "edit") return "edit";
    if (decision.action === "create") return "create";
    if (decision.action === "terminal" || decision.action === "verify") return "terminal";
    if (decision.action === "git") return "git";
    return "synthesis";
  }

export async function runAppOwnedCodingAgent(deps: WorkspaceRuntimeDeps, {
    chatId,
    controller,
    messageId,
    messagesForProvider,
    onExternalUpdate,
    prompt,
    requestId,
    runId,
    webSearchSettingsOverride,
    workspaceSettings,
  }: {
    chatId: string;
    controller: AbortController;
    messageId: string;
    messagesForProvider: ChatMessage[];
    onExternalUpdate?: (update: DiscordStreamUpdate) => void;
    prompt: string;
    requestId: number;
    runId?: string;
    webSearchSettingsOverride?: WebSearchSettings;
    workspaceSettings: LocalWorkspaceSettings;
  }): Promise<AssistantToolResponse> {
  const { activeChat, appendAgentRuntimeStep, attachLiveTerminalSession, compactProviderMessages, completeLatestAgentRuntimeStep, createAgentPrimitiveToolContent, createAgentRunRequest, createAgentRuntimeDecisionInstruction, createAgentRunWorkflowToolContent, createAppAgentToolCall, createContextBoundLocalToolExecutionPolicy, createFinalOnlyProviderSettings, createLocalComputerProgress, createMessage, createRuntimeApprovalDecisions, formatDiscordToolStatus, getRuntimeWebSearchSettings, hasLocalComputerToolCalls, isRequestInactive, limitFallbackToolOutput, looksLikeInternalToolRecoveryAnswer, looksLikeOnlyToolPrelude, looksLikeToolProtocolNarration, looksLikeUnexecutedToolActionPromise, mapAgentDecisionToStepType, mergeChatArtifacts, mergeChatSources, parseAgentRuntimeDecision, pendingChatsRef, providerSettings, recordProviderActualUsage, recordProviderContextUsage, rememberProjectToolMemoryFromChatToolCalls, resolveContextWindowForModel, runLocalComputerToolCalls, runParallelSubagents, sanitizeLocalToolCallsForDisplay, sendProviderMessage, setBrowserPreviewTarget, stampLocalToolCallIds, STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY, summarizeAgentRuntimeDecision, toolSettings, updateGeneratedMessage, upsertToolCall, withLocalComputerProgress } = deps;

    const runtimeChat = pendingChatsRef.current.find((chat) => chat.id === chatId && !chat.archived) ?? activeChat;
    const request = createAgentRunRequest({
      chatId,
      goal: prompt,
      messageId,
      mode: "execute",
      source: "auto",
      workspace: workspaceSettings,
    });
    const baseToolExecutionPolicy = STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY;
    const toolExecutionPolicy = createContextBoundLocalToolExecutionPolicy(baseToolExecutionPolicy);
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(providerSettings, webSearchSettingsOverride);
    const runtimeWebSearchMaxResults = runtimeWebSearchSettings.maxResults;
    const agentToolCall = (status: ChatToolCall["status"], detail: string, output?: string, fileChanges?: ChatToolCall["fileChanges"]) =>
      createAppAgentToolCall(messageId, status, detail, output, fileChanges);
    const allArtifacts: ChatArtifact[] = [];
    const allSources: ChatSource[] = [];
    let visibleToolCall = agentToolCall("active", "Starting app-owned coding agent");
    let runtimeMessages = [...messagesForProvider];
    let localProgress = createLocalComputerProgress("active", "Starting app-owned coding agent");
    let executedCount = 0;
    let allToolCalls: ChatToolCall[] = [];

    const createFinalAppAgentToolCalls = (status: ChatToolCall["status"], detail: string, output?: string, fileChanges?: ChatToolCall["fileChanges"]) => {
      const finalToolCall = agentToolCall(status, detail, output, allToolCalls.length > 0 ? undefined : fileChanges);

      return allToolCalls.length > 0 ? [...allToolCalls, finalToolCall] : [finalToolCall];
    };

    updateGeneratedMessage(chatId, messageId, (message) => ({
      ...message,
      content: "",
      progress: withLocalComputerProgress(localProgress, message.progress),
      toolCalls: [visibleToolCall],
    }));
    onExternalUpdate?.({
      progress: localProgress,
      status: "Starting app-owned coding agent...",
      toolCall: visibleToolCall,
    });

    const executeInternalToolStep = async (toolContent: string, label: string, type: AgentRun["steps"][number]["type"]) => {
      if (!toolContent.trim()) {
        throw new Error(`${label} did not produce an executable internal action.`);
      }

      appendAgentRuntimeStep(runId, type, label);
      const internalPassIndex = executedCount;
      localProgress = createLocalComputerProgress("active", label);
      visibleToolCall = agentToolCall("active", label);
      let liveInternalToolCalls: ChatToolCall[] = [];
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        toolCalls: [...allToolCalls, visibleToolCall],
      }));
      onExternalUpdate?.({
        progress: localProgress,
        status: `${label}...`,
        toolCall: visibleToolCall,
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings),
        assistantContent: toolContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, runtimeMessages, prompt, controller.signal, runtimeChat),
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], internalPassIndex);

          if (!stampedToolCall) {
            return;
          }

          liveInternalToolCalls = upsertToolCall(liveInternalToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(localProgress, message.progress),
            toolCalls: [...allToolCalls, visibleToolCall, ...liveInternalToolCalls],
          }));
          onExternalUpdate?.({
            progress: localProgress,
            status: formatDiscordToolStatus(stampedToolCall),
            toolCall: stampedToolCall,
          });
        },
        settings: workspaceSettings,
        signal: controller.signal,
        toolSettings,
        userPrompt: prompt,
        webSearchSettings: runtimeWebSearchSettings,
        webSearchMaxResults: runtimeWebSearchMaxResults,
      });

      if (toolRun.browserPreviewUrl && toolSettings.browserPreview) {
        setBrowserPreviewTarget((currentTarget) => ({
          id: (currentTarget?.id ?? 0) + 1,
          url: toolRun.browserPreviewUrl!,
        }));
      }

      allArtifacts.push(...(toolRun.artifacts ?? []));
      allSources.push(...toolRun.sources);
      executedCount += toolRun.executedCount;
      const completedInternalToolCalls = stampLocalToolCallIds(toolRun.toolCalls, internalPassIndex);
      rememberProjectToolMemoryFromChatToolCalls(chatId, workspaceSettings, prompt, completedInternalToolCalls);
      attachLiveTerminalSession(completedInternalToolCalls);
      const fileChanges = completedInternalToolCalls.flatMap((toolCall) => toolCall.fileChanges ?? []);
      const stepStatus: AgentRun["steps"][number]["status"] = toolRun.waitingForApproval ? "waiting_for_approval" : toolRun.toolCalls.some((toolCall) => toolCall.status === "error") ? "failed" : "completed";
      completeLatestAgentRuntimeStep(runId, stepStatus, toolRun.progress.detail);
      runtimeMessages = [
        ...runtimeMessages,
        createMessage(
          "user",
          [
            "APP AGENT INTERNAL OBSERVATION",
            "Gilbert executed an app-owned internal action. Use this as real evidence. Do not expose internal tool syntax.",
            toolRun.contextMessage,
          ].join("\n\n"),
        ),
      ];

      visibleToolCall = agentToolCall(
        toolRun.waitingForApproval ? "waiting_approval" : stepStatus === "failed" ? "error" : "complete",
        label,
        limitFallbackToolOutput(toolRun.contextMessage),
        fileChanges.length > 0 ? fileChanges : undefined,
      );
      allToolCalls = [...allToolCalls, ...completedInternalToolCalls];
      const visibleToolCalls = allToolCalls.length > 0 ? [...allToolCalls, visibleToolCall] : [visibleToolCall];
      localProgress = toolRun.waitingForApproval
        ? toolRun.progress
        : createLocalComputerProgress(stepStatus === "failed" ? "complete" : "active", toolRun.waitingForApproval ? "Waiting for approval" : `${executedCount} internal action${executedCount === 1 ? "" : "s"} ran`);
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: visibleToolCalls,
      }));

      if (toolRun.waitingForApproval) {
        return {
          waiting: true as const,
          response: {
            approvalRequests: toolRun.approvalRequests.map((approval) => ({
              ...approval,
              messageId,
              resumeToolCallContent: toolContent,
            })),
            artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
            content: "",
            pendingToolCallContent: toolContent,
            progress: toolRun.progress,
            sources: allSources,
            toolCalls: visibleToolCalls,
            waitingForApproval: true,
          } satisfies AssistantToolResponse,
        };
      }

      return { waiting: false as const };
    };
    const sanitizeAppAgentFinalContent = (content: string) => {
      const sanitized = sanitizeLocalToolCallsForDisplay(content, toolExecutionPolicy).trim();

      if (
        !sanitized ||
        looksLikeOnlyToolPrelude(sanitized) ||
        looksLikeInternalToolRecoveryAnswer(sanitized) ||
        looksLikeToolProtocolNarration(sanitized) ||
        looksLikeUnexecutedToolActionPromise(sanitized)
      ) {
        return "";
      }

      return sanitized;
    };

    const initialWorkflow = await executeInternalToolStep(createAgentRunWorkflowToolContent(request), "Gathering workspace evidence", "search");
    if (initialWorkflow.waiting) {
      return initialWorkflow.response;
    }

    const seenDecisionSignatures = new Set<string>();
    const maxDecisionPasses = 5;

    for (let loopIndex = 0; loopIndex < maxDecisionPasses; loopIndex += 1) {
      if (isRequestInactive(requestId, controller)) {
        return {
          content: "",
          progress: localProgress,
          toolCalls: createFinalAppAgentToolCalls("error", visibleToolCall.detail ?? "Agent run interrupted", visibleToolCall.output, visibleToolCall.fileChanges),
        };
      }

      appendAgentRuntimeStep(runId, "synthesis", "Choose next agent action");
      const decisionInstruction = createMessage("user", createAgentRuntimeDecisionInstruction({ goal: prompt, loopIndex }));
      const finalDecisionBaseSettings = createFinalOnlyProviderSettings(prompt, runtimeChat);
      const decisionSettings = {
        ...finalDecisionBaseSettings,
        maxTokens: Math.max(finalDecisionBaseSettings.maxTokens, 4096),
        temperature: Math.min(providerSettings.temperature, 0.2),
      };
      const decisionMessages = compactProviderMessages([...runtimeMessages, decisionInstruction], decisionSettings).messages;

      recordProviderContextUsage(chatId, decisionMessages, decisionSettings, { stream: false });
      const decisionResponse = await sendProviderMessage(decisionSettings, decisionMessages, {
        contextWindowTokens: resolveContextWindowForModel(decisionSettings.model, decisionSettings).tokens,
        signal: controller.signal,
      });
      recordProviderActualUsage(chatId, decisionMessages, decisionSettings, decisionResponse.usage, { stream: false });
      completeLatestAgentRuntimeStep(runId, "completed");

      const decision = parseAgentRuntimeDecision(decisionResponse.content);

      if (!decision) {
        if (hasLocalComputerToolCalls(decisionResponse.content, toolExecutionPolicy)) {
          const recoveredStep = await executeInternalToolStep(decisionResponse.content, "Running recovered model action", "tool");
          if (recoveredStep.waiting) {
            return recoveredStep.response;
          }
          continue;
        }

        const sanitizedInvalidDecision = sanitizeAppAgentFinalContent(decisionResponse.content);
        runtimeMessages = [
          ...runtimeMessages,
          createMessage(
            "user",
            [
              "The previous action decision was invalid JSON and no executable internal action was found.",
              sanitizedInvalidDecision ? `Non-tool text from that invalid response:\n${sanitizedInvalidDecision.slice(0, 1200)}` : "",
              "Return one valid JSON action now, or use action=answer if enough evidence exists.",
            ].filter(Boolean).join("\n\n"),
          ),
        ];
        continue;
      }

      const decisionSignature = JSON.stringify({
        action: decision.action,
        command: decision.command,
        cwd: decision.cwd,
        edits: decision.edits,
        files: decision.files,
        paths: decision.paths,
        tool: decision.tool,
      });

      if (seenDecisionSignatures.has(decisionSignature)) {
        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: "I stopped the agent run because the same internal action repeated. Try a narrower request or adjust the target file/path.",
          progress: createLocalComputerProgress("complete", "Repeated internal action stopped"),
          sources: allSources,
          toolCalls: createFinalAppAgentToolCalls("error", "Repeated internal action stopped", visibleToolCall.output, visibleToolCall.fileChanges),
        };
      }

      seenDecisionSignatures.add(decisionSignature);

      if (decision.action === "answer") {
        const finalProgress = createLocalComputerProgress("complete", `${executedCount} internal action${executedCount === 1 ? "" : "s"} ran`);
        const finalContent = sanitizeAppAgentFinalContent(decision.answer ?? "");
        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: finalContent || "The app-owned agent run completed.",
          progress: finalProgress,
          sources: allSources,
          toolCalls: createFinalAppAgentToolCalls("complete", "Agent run complete", visibleToolCall.output, visibleToolCall.fileChanges),
        };
      }

      const primitiveContent = createAgentPrimitiveToolContent(decision);
      const stepResult = await executeInternalToolStep(primitiveContent, summarizeAgentRuntimeDecision(decision), mapAgentDecisionToStepType(decision));
      if (stepResult.waiting) {
        return stepResult.response;
      }
    }

    const fallbackSettings = createFinalOnlyProviderSettings(prompt, runtimeChat);
    const fallbackMessages = compactProviderMessages([
      ...runtimeMessages,
      createMessage(
        "user",
        [
          "The app-owned agent runtime reached its decision-pass limit.",
          "Write the best final user-facing answer from the gathered evidence. Do not request more tools or mention internal protocol.",
        ].join("\n"),
      ),
    ], fallbackSettings).messages;
    const fallbackResponse = await sendProviderMessage(fallbackSettings, fallbackMessages, {
      contextWindowTokens: resolveContextWindowForModel(fallbackSettings.model, fallbackSettings).tokens,
      signal: controller.signal,
    });
    let fallbackContent = sanitizeAppAgentFinalContent(fallbackResponse.content);

    if (!fallbackContent && hasLocalComputerToolCalls(fallbackResponse.content, toolExecutionPolicy)) {
      const recoveredStep = await executeInternalToolStep(fallbackResponse.content, "Running recovered final action", "tool");
      if (recoveredStep.waiting) {
        return recoveredStep.response;
      }

      const recoverySynthesisSettings = createFinalOnlyProviderSettings(prompt, runtimeChat);
      const recoverySynthesisMessages = compactProviderMessages([
        ...runtimeMessages,
        createMessage(
          "user",
          [
            "A previous final response emitted an internal tool action. Gilbert executed it internally.",
            "Now write the final user-facing answer from the gathered evidence.",
            "Do not emit tool calls, function-call syntax, provider-native tool JSON, strict envelopes, or protocol discussion.",
          ].join("\n"),
        ),
      ], recoverySynthesisSettings).messages;
      const recoverySynthesisResponse = await sendProviderMessage(recoverySynthesisSettings, recoverySynthesisMessages, {
        contextWindowTokens: resolveContextWindowForModel(recoverySynthesisSettings.model, recoverySynthesisSettings).tokens,
        signal: controller.signal,
      });
      fallbackContent = sanitizeAppAgentFinalContent(recoverySynthesisResponse.content);
    }

    return {
      artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
      content: fallbackContent || "The app-owned agent run reached its step limit before producing a clean final answer.",
      progress: createLocalComputerProgress("complete", `${executedCount} internal action${executedCount === 1 ? "" : "s"} ran`),
      sources: allSources,
      toolCalls: createFinalAppAgentToolCalls("complete", "Agent run complete", visibleToolCall.output, visibleToolCall.fileChanges),
    };
  }
