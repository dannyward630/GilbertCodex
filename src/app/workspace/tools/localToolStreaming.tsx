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

export async function streamAssistantWithLocalTools(deps: WorkspaceRuntimeDeps, {
    approvalDecisions,
    approvedPlanExecution,
    chatId,
    controller,
    messageId,
    messagesForProvider,
    memoryToolsEnabled = true,
    onExternalUpdate,
    previousToolCalls,
    prompt,
    requestId,
    resumeToolCallContent,
    runtimeToolOverrides,
    toolSelectionPrompt,
    webSearchSettingsOverride,
    workspaceSettings,
  }: {
    approvalDecisions?: Record<string, AgentApprovalDecision>;
    approvedPlanExecution?: ApprovedPlanExecutionContext;
    chatId: string;
    controller: AbortController;
    messageId: string;
    memoryToolsEnabled?: boolean;
    messagesForProvider: ChatMessage[];
    onExternalUpdate?: (update: DiscordStreamUpdate) => void;
    previousToolCalls?: ChatToolCall[];
    prompt: string;
    requestId: number;
    resumeToolCallContent?: string;
    /**
     * Tools that should be force-enabled or force-disabled for this run only,
     * overriding the user's chat-mode toggles. Plan-mode research uses this to
     * guarantee `fileSearch` / `fileBrowser` / `codeView` are on even if the
     * user has turned them off for normal chat.
     */
    runtimeToolOverrides?: Partial<ProviderSettings["tools"]>;
    toolSelectionPrompt?: string;
    webSearchSettingsOverride?: WebSearchSettings;
    workspaceSettings: LocalWorkspaceSettings;
  }): Promise<AssistantToolResponse> {
  const { activeChat, appendAutoCompactionContinuation, attachLiveTerminalSession, BRIDGE_TOOL_APPROVAL_RESUME_KIND, coalesceToolBridgeCalls, compactProviderMessages, completeStreamingWorkThinking, contextWindowRef, createActiveLocalToolCalls, createApprovalSessionDecisionKey, createApprovedPlanExecutionFailedAnswer, createApprovedPlanExecutionRetryInstruction, createAssistantToolRequestContent, createBridgeChatToolCall, createContextBoundLocalToolExecutionPolicy, createContextCompactionProgress, createDefaultToolRegistry, createFabricatedToolProgressRecoveryInstruction, createFinalAnswerRecoveryInstruction, createFinalOnlyProviderSettings, createFreshLocalToolEvidenceInstruction, createId, createLocalComputerProgress, createLocalToolBudgetFinalInstruction, createLocalToolFinalInstruction, createMalformedToolCallRecoveryInstruction, createMemorySearchForRequest, createMessage, createNeutralToolSynthesisFailureMessage, createNoExecutedToolFinalAnswer, createNoExecutedToolFinalInstruction, createPromptAwareProviderSettings, createRecoverableBridgeToolRetryInstruction, createRecoverableLocalEditRetryInstruction, createRuntimeApprovalDecisions, createSimpleLocalTaskCompletionAnswer, createToolActionPromiseRecoveryInstruction, createToolFinalAnswerUnavailableMessage, createToolProtocolNarrationRecoveryInstruction, createUnappliedFileEditRecoveryInstruction, createUnnecessaryLocalActionConfirmationRecoveryInstruction, detectSimpleLocalTaskCompletion, executeToolBridgeCalls, formatDiscordToolStatus, formatLocalToolPreviewProgress, getEnabledWorkspaceRoots, getModelVisibleToolResultCharBudget, getRuntimeWebSearchSettings, getToolMemoryProjectName, hasLocalComputerToolCalls, hasRequestScopedWorkspaceToolsEnabled, hasSuccessfulApprovedPlanMutation, hasSuccessfulApprovedPlanWorkspaceTool, isAbortError, isEmptySelectedScaffoldProbe, isMissingFileReadError, isRecoverableLocalEditFailure, isRequestInactive, isSimpleLocalScaffoldRequest, isVisibleToolResultLeak, LOCAL_TOOL_FINAL_MIN_TOKENS, looksLikeContradictedSuccessfulFileMutationAnswer, looksLikeFabricatedToolProgress, looksLikeInFlightToolPlanning, looksLikeInternalToolRecoveryAnswer, looksLikeOnlyToolPrelude, looksLikePrivateThinkingNarration, looksLikeSubstantiveVisibleAnswer, looksLikeToolProtocolNarration, looksLikeUnappliedFileEditAnswer, looksLikeUnexecutedToolActionPromise, looksLikeUnnecessaryLocalActionConfirmation, MAX_LOCAL_TOOL_EXECUTIONS, MAX_LOCAL_TOOL_PASSES, MAX_MALFORMED_TOOL_RECOVERY_RETRIES, MAX_RECOVERABLE_LOCAL_EDIT_RETRIES, MAX_TOOL_FINALIZATION_RETRIES, mergeAgentApprovals, mergeChatArtifacts, mergeChatSources, needsFreshLocalToolEvidence, parseVisibleTextToolCalls, pendingChatsRef, providerSettings, recordProviderActualUsage, recordProviderContextUsage, rememberProjectToolMemoryFromBridgeRun, rememberProjectToolMemoryFromChatToolCalls, requiresWorkspaceToolCallForPrompt, resolveContextWindowForModel, resolveToolPermission, routePrimitiveEvidenceBatchToWorkflow, runLocalComputerToolCalls, runParallelSubagents, sanitizeLocalToolCallsForDisplay, selectAdvertisedBridgeTools, sendProviderMessage, setBrowserPreviewTarget, shouldAttachWebSearch, shouldHoldStreamingContentForToolCalls, shouldSynthesizeEmptyFinalFromToolResults, stampLocalToolCallIds, STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY, streamProviderMessageWithRetry, stripLeadingToolPreludeForDisplay, supportsProviderParallelToolCalls, toolSettings, updateGeneratedMessage, upsertToolCall, validateToolArguments, withContextCompactionMarker, withContextCompactionProgress, withLocalComputerProgress, withStreamingWorkThinking } = deps;

    function applyToolOverrides(settings: ProviderSettings): ProviderSettings {
      if (!runtimeToolOverrides) return settings;
      return { ...settings, tools: { ...settings.tools, ...runtimeToolOverrides } };
    }
    const runtimeChat = pendingChatsRef.current.find((chat) => chat.id === chatId && !chat.archived) ?? activeChat;
    let messages = messagesForProvider;
    let localProgress: ChatProgressItem | undefined;
    let finalResponse: AssistantToolResponse = {
      content: "",
      toolCalls: undefined,
    };

    let totalExecutedToolCalls = 0;
    let allArtifacts: ChatArtifact[] = [];
    let allSources: ChatSource[] = [];
    let allToolCalls: ChatToolCall[] = [];
    let finalizationRetries = 0;
    let freshLocalToolEvidenceRetries = 0;
    let malformedToolRecoveryRetries = 0;
    let recoverableBridgeToolRetries = 0;
    let recoverableEditRetries = 0;
    let emptyScaffoldRecoveryUsed = false;

    let passIndex = 0;
    const baseRuntimeSettings = applyToolOverrides(createPromptAwareProviderSettings(prompt, {}, runtimeChat));
    const toolExecutionPolicy = createContextBoundLocalToolExecutionPolicy(STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY);
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(providerSettings, webSearchSettingsOverride);
    const runtimeWebSearchMaxResults = runtimeWebSearchSettings.maxResults;
    const simpleLocalScaffoldRequest = isSimpleLocalScaffoldRequest(prompt);
    const maxToolPasses = simpleLocalScaffoldRequest ? 5 : MAX_LOCAL_TOOL_PASSES;
    const maxToolExecutions = simpleLocalScaffoldRequest ? 16 : MAX_LOCAL_TOOL_EXECUTIONS;
    const bridgeRegistry = createDefaultToolRegistry();
    const bridgeToolResultMessages: ToolResultMessage[] = [];
    let bridgeReasoningState: ProviderReasoningState | undefined;
    const memorySearch = createMemorySearchForRequest(chatId, getToolMemoryProjectName(chatId), workspaceSettings);

    function maybeFinishSimpleLocalScaffold(): typeof finalResponse | null {
      if (!simpleLocalScaffoldRequest) {
        return null;
      }

      const completion = detectSimpleLocalTaskCompletion(prompt, allToolCalls);

      if (!completion) {
        return null;
      }

      const content = createSimpleLocalTaskCompletionAnswer(completion);
      const completedProgress = createLocalComputerProgress("complete", "Starter app verified");
      localProgress = completedProgress;
      finalResponse = {
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
        content,
        progress: completedProgress,
        sources: allSources.length > 0 ? allSources : undefined,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: "completed",
        artifacts: allArtifacts.length > 0 ? mergeChatArtifacts(message.artifacts, allArtifacts) : message.artifacts,
        content,
        progress: withLocalComputerProgress(completedProgress, message.progress),
        sources: allSources.length > 0 ? mergeChatSources(message.sources, allSources) : message.sources,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        content,
        progress: completedProgress,
        status: "Starter app verified.",
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      return finalResponse;
    }

    function createSimpleScaffoldToolPlanContent() {
      return "";
    }

    async function recoverEmptySimpleScaffold(): Promise<typeof finalResponse | null> {
      emptyScaffoldRecoveryUsed = true;
      const recoveryPassIndex = passIndex + 1;
      const recoveryToolContent = createSimpleScaffoldToolPlanContent();
      const activeProgress = createLocalComputerProgress("active", "Scaffolding empty starter app");
      const activeToolCalls = createActiveLocalToolCalls(recoveryToolContent, recoveryPassIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: "running",
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? [...allToolCalls, ...activeToolCalls] : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: "Scaffolding empty starter app...",
        toolCall: activeToolCalls[0],
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions),
        assistantContent: recoveryToolContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal, runtimeChat),
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], recoveryPassIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: [...allToolCalls, ...liveToolCalls],
          }));
          onExternalUpdate?.({
            progress: activeProgress,
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

      totalExecutedToolCalls += toolRun.executedCount;
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, recoveryPassIndex);
      rememberProjectToolMemoryFromChatToolCalls(chatId, workspaceSettings, prompt, completedToolCalls);
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allSources = mergeChatSources(allSources, toolRun.sources);
      allToolCalls = [...allToolCalls, ...completedToolCalls];
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.sources = allSources.length > 0 ? allSources : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent: recoveryToolContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? recoveryToolContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: toolRun.waitingForApproval ? "waiting_for_approval" : "running",
        approvals: toolRun.waitingForApproval ? mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []) : message.approvals,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: toolRun.waitingForApproval ? "Tool approval is needed in Gilbert Codex." : `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (toolRun.waitingForApproval) {
        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      const completedResponse = maybeFinishSimpleLocalScaffold();
      if (completedResponse) {
        return completedResponse;
      }

      messages = [
        ...messages,
        createMessage("assistant", recoveryToolContent),
        createMessage("user", toolRun.contextMessage),
        createMessage("user", createLocalToolFinalInstruction(prompt)),
      ];
      passIndex = recoveryPassIndex + 1;
      return null;
    }

    async function synthesizeAnswerFromSavedToolResults(
      synthesisMessages: ChatMessage[],
      detail: string,
      synthesisToolBridge?: ProviderToolBridgeOptions,
    ): Promise<typeof finalResponse | null> {
      if (isRequestInactive(requestId, controller)) {
        return null;
      }

      const activeProgress: ChatProgressItem = allToolCalls.length > 0
        ? createLocalComputerProgress("active", "Writing final answer from gathered tool results")
        : {
            detail: "Continuing from the work log",
            id: "final-answer-recovery",
            label: "Thinking",
            status: "active",
          };
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: allToolCalls.length > 0 ? "Writing final answer from gathered tool results..." : "Continuing from the work log...",
      });

      const baseSynthesisSettings = createFinalOnlyProviderSettings(prompt, runtimeChat);
      const synthesisSettings: ProviderSettings = {
        ...baseSynthesisSettings,
        maxTokens: Math.max(baseSynthesisSettings.maxTokens, LOCAL_TOOL_FINAL_MIN_TOKENS),
        thinking: {
          ...baseSynthesisSettings.thinking,
          enabled: false,
          effort: "low",
        },
        temperature: Math.min(baseSynthesisSettings.temperature, 0.25),
      };
      const synthesisRetries = [
        "",
        [
          "The previous final-answer attempt exposed internal runtime state instead of answering the user.",
          "Rewrite only the user-facing answer. Do not mention the app, provider, tool loop, tool calls, saved evidence, continuation, fallback, or recovery.",
        ].join("\n"),
      ];

      for (const retryInstruction of synthesisRetries) {
        const synthesisDetail = [
          allToolCalls.length > 0
            ? `The prior tool pass supplied ${totalExecutedToolCalls} observation${totalExecutedToolCalls === 1 ? "" : "s"} for this request.`
            : "Use the conversation, web-search, and local workspace context already provided above as evidence.",
          detail,
          "Use those observations silently and write only the visible answer the user asked for.",
          retryInstruction,
        ].filter(Boolean).join("\n");
        const synthesisInstruction = allToolCalls.length > 0
          ? createLocalToolBudgetFinalInstruction(prompt, synthesisDetail)
          : createFinalAnswerRecoveryInstruction(prompt, synthesisDetail);
        const synthesisCompaction = compactProviderMessages([...synthesisMessages, createMessage("user", synthesisInstruction)], synthesisSettings, {
          toolBridge: synthesisToolBridge,
        });

        if (synthesisCompaction.contextCompaction) {
          const compactionProgress = createContextCompactionProgress(synthesisCompaction);

          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...withContextCompactionMarker(message, synthesisCompaction.contextCompaction),
            progress: withContextCompactionProgress(compactionProgress, message.progress),
          }));
        }

        try {
          recordProviderContextUsage(chatId, synthesisCompaction.messages, synthesisSettings, { stream: false, toolBridge: synthesisToolBridge });
          const response = await sendProviderMessage(synthesisSettings, synthesisCompaction.messages, {
            contextWindowTokens: resolveContextWindowForModel(synthesisSettings.model, synthesisSettings).tokens,
            signal: controller.signal,
            toolBridge: synthesisToolBridge,
          });
          recordProviderActualUsage(chatId, synthesisCompaction.messages, synthesisSettings, response.usage, { stream: false, toolBridge: synthesisToolBridge });

          if (isRequestInactive(requestId, controller)) {
            return null;
          }

          const content = sanitizeLocalToolCallsForDisplay(response.content, toolExecutionPolicy).trim();

          if (
            !content ||
            looksLikeOnlyToolPrelude(content) ||
            looksLikeInternalToolRecoveryAnswer(content) ||
            looksLikeFabricatedToolProgress(content, allToolCalls) ||
            isVisibleToolResultLeak(content, allToolCalls)
          ) {
            continue;
          }

          return {
            content,
            artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
            progress: localProgress,
            sources: allSources.length > 0 ? allSources : undefined,
            toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
          };
        } catch (error) {
          if (isAbortError(error) || isRequestInactive(requestId, controller)) {
            throw error;
          }

          return null;
        }
      }

      return null;
    }

    function createBridgeSynthesisToolBridgeOptions(): ProviderToolBridgeOptions | undefined {
      const synthesisToolResultMessages = getSynthesisToolResultMessages();
      return synthesisToolResultMessages.length > 0
        ? {
            maxToolResultContentChars: getModelVisibleToolResultCharBudget(contextWindowRef.current.tokens),
            toolChoice: "none",
            toolResultDelivery: "inline-user-message",
            toolResultMessages: synthesisToolResultMessages,
            tools: [],
          }
        : undefined;
    }

    function getSynthesisToolResultMessages() {
      const successfulMessages = bridgeToolResultMessages.filter((message) => message.result.ok);

      return successfulMessages.length > 0 ? successfulMessages : bridgeToolResultMessages;
    }

    function createBridgeToolContinuationInstruction(run: ToolBridgeExecutionBatch) {
      const handledCount = getBridgeHandledCount(run);
      const failedCount = Math.max(0, handledCount - run.executedCount);
      const recoverableFailureGuidance = createBridgeRunRecoverableFailureGuidance(run);
      const mutationEvidence = createBridgeRunMutationEvidence(run);
      return [
        "BRIDGE TOOL RESULTS AVAILABLE",
        `Original user request: ${prompt}`,
        `The app just handled ${handledCount} bridge tool call${handledCount === 1 ? "" : "s"}: ${run.executedCount} succeeded, ${failedCount} failed or was skipped.`,
        "Use the attached tool result messages as current evidence.",
        mutationEvidence,
        failedCount > 0 ? "If a tool failed because the arguments were invalid JSON or failed validation, retry the operation with corrected valid JSON instead of stopping on the raw error." : "",
        recoverableFailureGuidance,
        "If more work is needed, emit the next needed tool call now.",
        "If the request is done, write the normal final answer now.",
        "Do not answer with a raw tool result, tool recap, Latest completed result, recovery note, or continuation note.",
      ].filter(Boolean).join("\n\n");
    }

    function createBridgeRunMutationEvidence(run: ToolBridgeExecutionBatch) {
      const changedPaths = collectBridgeRunChangedPaths(run);

      if (changedPaths.length === 0) {
        return "";
      }

      const preview = changedPaths.slice(0, 8).join(", ");
      const remaining = changedPaths.length > 8 ? `, and ${changedPaths.length - 8} more` : "";

      return [
        `Successful workspace file changes are already applied to ${changedPaths.length} file${changedPaths.length === 1 ? "" : "s"}: ${preview}${remaining}.`,
        "Do not say you only have read-only evidence, no edit result, or no write result for those files. Continue from the successful mutation result.",
      ].join("\n");
    }

    function collectBridgeRunChangedPaths(run: ToolBridgeExecutionBatch) {
      const paths = new Set<string>();

      for (const toolCall of run.toolCalls) {
        if (toolCall.status !== "complete") {
          continue;
        }

        const toolId = toolCall.toolId ?? "";
        const isMutatingFileTool =
          /^files_(?:append|apply_patch|create_directory|edit_many|exact_replace|insert_at_line|move|replace_range|write|write_many)\b/i.test(toolId) ||
          toolCall.batchSummary?.operation === "edit" ||
          toolCall.batchSummary?.operation === "write" ||
          (toolCall.fileChanges?.length ?? 0) > 0;

        if (!isMutatingFileTool) {
          continue;
        }

        for (const result of toolCall.batchFileResults ?? []) {
          if (result.status === "ok") {
            paths.add(result.path);
          }
        }

        for (const change of toolCall.fileChanges ?? []) {
          paths.add(change.path);
        }
      }

      return [...paths];
    }

    function createBridgeRunRecoverableFailureGuidance(run: ToolBridgeExecutionBatch) {
      const failedOutputs = run.steps
        .filter((step) => !step.result.ok)
        .map((step) => step.result.content || step.result.error || step.result.skippedReason || "")
        .filter(Boolean);

      if (failedOutputs.some((output) => /try\s+files_read\s+on\s+one\s+of:/i.test(output) || /a directory named .+ exists/i.test(output))) {
        return [
          "A failed file read included candidate paths.",
          "Do not stop on that error. Pick the closest suggested file path and retry files_read/files_read_range now.",
        ].join("\n");
      }

      if (failedOutputs.some((output) => /try\s+files_search\s+with\s+query/i.test(output) || isMissingFileReadError(output))) {
        return [
          "A failed file read did not have a direct path match.",
          "Do not stop on that error. Use files_search to locate the file by name before answering that it is missing.",
        ].join("\n");
      }

      if (failedOutputs.some((output) => /cannot replace lines \d+-\d+[\s\S]{0,160}\bfile has \d+ line/i.test(output) || /line range is stale/i.test(output))) {
        return [
          "A range edit used stale or out-of-bounds line numbers.",
          "Do not retry the same range. Re-read the current file or nearby section, then retry with files_edit_many using exact_replace or files_apply_patch anchored to current text.",
          "Use replace_range again only when the fresh read gives the exact current line numbers.",
        ].join("\n");
      }

      if (failedOutputs.some((output) => /\b(arguments?|maxBytes|offset|replaceAll)\b[\s\S]{0,120}\b(?:must be|is not allowed|invalid|required)\b/i.test(output))) {
        return "A tool argument shape failed validation. Retry the same intent with corrected argument types and only schema-supported keys.";
      }

      return "";
    }

    function getBridgeHandledCount(run: ToolBridgeExecutionBatch) {
      return run.handledCount || run.resultMessages.length || run.requestedCount;
    }

    function applyBridgeRunSideEffects(run: ToolBridgeExecutionBatch, toolCalls: ChatToolCall[]) {
      attachLiveTerminalSession(toolCalls);

      const sources = findBridgeRunSources(run);
      if (sources.length > 0) {
        allSources = mergeChatSources(allSources, sources);
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          sources: mergeChatSources(message.sources, sources),
        }));
      }

      const artifacts = findBridgeRunArtifacts(run);
      if (artifacts.length > 0) {
        allArtifacts = mergeChatArtifacts(allArtifacts, artifacts) ?? [];
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          artifacts: mergeChatArtifacts(message.artifacts, artifacts),
        }));
      }

      const previewUrl = findBridgeRunBrowserPreviewUrl(run);
      if (!previewUrl || !toolSettings.browserPreview) {
        return;
      }

      setBrowserPreviewTarget((currentTarget) => ({
        id: (currentTarget?.id ?? 0) + 1,
        url: previewUrl,
      }));
    }

    function findBridgeRunBrowserPreviewUrl(run: ToolBridgeExecutionBatch) {
      for (const step of [...run.steps].reverse()) {
        const data = step.result.data;

        if (!data || typeof data !== "object" || Array.isArray(data)) {
          continue;
        }

        const record = data as Record<string, unknown>;
        const candidate = typeof record.browserPreviewUrl === "string"
          ? record.browserPreviewUrl
          : typeof record.url === "string"
            ? record.url
            : undefined;

        if (candidate) {
          return candidate;
        }
      }

      return undefined;
    }

    function findBridgeRunSources(run: ToolBridgeExecutionBatch) {
      const sources = run.steps.flatMap((step) => {
        const data = step.result.data;

        if (!data || typeof data !== "object" || Array.isArray(data) || !("sources" in data)) {
          return [];
        }

        const rawSources = (data as { sources?: unknown }).sources;
        if (!Array.isArray(rawSources)) {
          return [];
        }

        return rawSources.flatMap((source, index) => normalizeBridgeSource(source, index));
      });

      return mergeChatSources(undefined, sources);
    }

    function findBridgeRunArtifacts(run: ToolBridgeExecutionBatch) {
      const artifacts = run.steps.flatMap((step) => {
        const data = step.result.data;

        if (!data || typeof data !== "object" || Array.isArray(data) || !("artifacts" in data)) {
          return [];
        }

        const rawArtifacts = (data as { artifacts?: unknown }).artifacts;
        if (!Array.isArray(rawArtifacts)) {
          return [];
        }

        return rawArtifacts.flatMap((artifact, index) => normalizeBridgeArtifact(artifact, index));
      });

      return mergeChatArtifacts(undefined, artifacts) ?? [];
    }

    function normalizeBridgeArtifact(artifact: unknown, index: number): ChatArtifact[] {
      if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
        return [];
      }

      const record = artifact as Record<string, unknown>;
      const title = typeof record.title === "string" && record.title.trim()
        ? record.title.trim()
        : `generated-artifact-${index + 1}`;
      const url = typeof record.url === "string" && record.url.trim() ? record.url.trim() : undefined;
      const sourceText = typeof record.sourceText === "string" && record.sourceText.trim() ? record.sourceText : undefined;
      const sizeBytes = typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes) ? Math.max(0, Math.round(record.sizeBytes)) : undefined;
      const sourceFormat = record.sourceFormat === "markdown" || record.sourceFormat === "text" ? record.sourceFormat : undefined;
      const width = typeof record.width === "number" && Number.isFinite(record.width) ? Math.max(1, Math.round(record.width)) : undefined;
      const height = typeof record.height === "number" && Number.isFinite(record.height) ? Math.max(1, Math.round(record.height)) : undefined;

      if (!url && !sourceText) {
        return [];
      }

      return [{
        detail: typeof record.detail === "string" && record.detail.trim() ? record.detail.trim() : undefined,
        height,
        id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `bridge-artifact-${index + 1}`,
        kind: normalizeBridgeArtifactKind(record.kind),
        mimeType: typeof record.mimeType === "string" && record.mimeType.trim() ? record.mimeType.trim() : undefined,
        sizeBytes,
        sourceFormat,
        sourceText,
        title,
        url,
        width,
      }];
    }

    function normalizeBridgeArtifactKind(value: unknown): ChatArtifact["kind"] {
      return value === "code" || value === "document" || value === "file" || value === "image" || value === "other" || value === "preview"
        ? value
        : undefined;
    }

    function normalizeBridgeSource(source: unknown, index: number): ChatSource[] {
      if (!source || typeof source !== "object" || Array.isArray(source)) {
        return [];
      }

      const record = source as Record<string, unknown>;
      const title = typeof record.title === "string" ? record.title.trim() : "";
      const url = typeof record.url === "string" ? record.url.trim() : "";

      if (!title || !url) {
        return [];
      }

      return [{
        detail: typeof record.detail === "string" ? record.detail : undefined,
        id: typeof record.id === "string" ? record.id : `bridge-web-source-${index + 1}`,
        imageUrl: typeof record.imageUrl === "string" ? record.imageUrl : undefined,
        sourceType: normalizeBridgeSourceType(record.sourceType),
        thumbnailUrl: typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : undefined,
        title,
        url,
      }];
    }

    function normalizeBridgeSourceType(value: unknown): ChatSource["sourceType"] {
      return value === "answer" || value === "image" || value === "news" || value === "place" || value === "video" || value === "web" ? value : undefined;
    }

    function formatBridgeToolRunProgress(run: ToolBridgeExecutionBatch, noun: string) {
      const handledCount = getBridgeHandledCount(run);
      const pluralNoun = `${noun}${handledCount === 1 ? "" : "s"}`;

      if (handledCount === 0) {
        return `No ${noun}s ran`;
      }

      if (run.executedCount === handledCount) {
        return `${handledCount} ${pluralNoun} ran`;
      }

      if (run.executedCount === 0) {
        return `${handledCount} ${pluralNoun} handled with errors`;
      }

      return `${run.executedCount} of ${handledCount} ${pluralNoun} ran`;
    }

    function serializeBridgeToolApprovalResume(calls: ToolCallRequest[]) {
      return JSON.stringify({
        calls,
        kind: BRIDGE_TOOL_APPROVAL_RESUME_KIND,
        version: 1,
      });
    }

    function parseBridgeToolApprovalResume(content: string | undefined): { calls: ToolCallRequest[] } | null {
      if (!content) {
        return null;
      }

      try {
        const parsed = JSON.parse(content) as { calls?: unknown; kind?: unknown };

        if (parsed.kind !== BRIDGE_TOOL_APPROVAL_RESUME_KIND || !Array.isArray(parsed.calls)) {
          return null;
        }

        const calls = parsed.calls.filter((call): call is ToolCallRequest =>
          Boolean(
            call &&
              typeof call === "object" &&
              typeof (call as ToolCallRequest).id === "string" &&
              typeof (call as ToolCallRequest).name === "string" &&
              typeof (call as ToolCallRequest).provider === "string",
          ),
        );

        return calls.length > 0 ? { calls } : null;
      } catch {
        return null;
      }
    }

    function createBridgeApprovalShell(call: ToolCallRequest, tool: ToolDefinition, preview?: string): AgentApproval {
      const args = typeof call.arguments === "object" && call.arguments !== null && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : undefined;
      const command = formatBridgeApprovalCommand(args);
      const path = formatBridgeApprovalPath(args);
      const kind = bridgeApprovalKind(tool);

      return {
        args,
        command,
        createdAt: new Date().toISOString(),
        detail: formatBridgeApprovalDetail(tool, command, path),
        id: createId("approval"),
        kind,
        path,
        preview,
        resumeToolCallContent: serializeBridgeToolApprovalResume([call]),
        risk: bridgeApprovalRisk(tool),
        status: "pending",
        title: tool.title,
        tool: tool.id,
        toolCallId: call.id,
      };
    }

    function formatBridgeApprovalCommand(args: Record<string, unknown> | undefined) {
      return typeof args?.command === "string" && args.command.trim() ? args.command.trim() : undefined;
    }

    function formatBridgeApprovalPath(args: Record<string, unknown> | undefined) {
      if (!args) {
        return undefined;
      }

      if (typeof args.fromPath === "string" && typeof args.toPath === "string") {
        return `${args.fromPath} -> ${args.toPath}`;
      }

      if (Array.isArray(args.files)) {
        const paths = args.files.flatMap((item) =>
          item && typeof item === "object" && !Array.isArray(item) && typeof (item as { path?: unknown }).path === "string"
            ? [(item as { path: string }).path]
            : [],
        );
        return formatBatchApprovalPath(paths, "file");
      }

      if (Array.isArray(args.edits)) {
        const paths = args.edits.flatMap((item) =>
          item && typeof item === "object" && !Array.isArray(item) && typeof (item as { path?: unknown }).path === "string"
            ? [(item as { path: string }).path]
            : [],
        );
        return formatBatchApprovalPath(paths, "file");
      }

      if (Array.isArray(args.paths)) {
        return formatBatchApprovalPath(args.paths.filter((path): path is string => typeof path === "string"), "path");
      }

      if (typeof args.path === "string" && args.path.trim()) {
        return args.path.trim();
      }

      if (typeof args.cwd === "string" && args.cwd.trim()) {
        return args.cwd.trim();
      }

      if (typeof args.workingDirectory === "string" && args.workingDirectory.trim()) {
        return args.workingDirectory.trim();
      }

      if (typeof args.url === "string" && args.url.trim()) {
        return args.url.trim();
      }

      return undefined;
    }

    function formatBatchApprovalPath(paths: string[], noun: "file" | "path") {
      const uniquePaths = [...new Set(paths.filter((path) => path.trim()).map((path) => path.trim()))];

      if (uniquePaths.length === 0) {
        return undefined;
      }

      if (uniquePaths.length === 1) {
        return uniquePaths[0];
      }

      return `${uniquePaths.length} ${noun}${uniquePaths.length === 1 ? "" : "s"}: ${uniquePaths.slice(0, 3).join(", ")}${uniquePaths.length > 3 ? ` and ${uniquePaths.length - 3} more` : ""}`;
    }

    function formatBridgeApprovalDetail(tool: ToolDefinition, command: string | undefined, path: string | undefined) {
      if (tool.executorMetadata?.family === "terminal" || tool.id === "terminal_run") {
        return [
          `${tool.title} wants to run a local command.`,
          command ? `Command: ${command}` : "",
          path ? `cwd: ${path}` : "",
        ].filter(Boolean).join("\n");
      }

      if (tool.executorMetadata?.family === "browser") {
        return path ? `${tool.title} wants to open ${path}.` : `${tool.title} wants to open the in-app browser preview.`;
      }

      return path ? `${tool.title} wants to change ${path}.` : `${tool.title} needs approval before it runs.`;
    }

    function bridgeApprovalKind(tool: ToolDefinition): AgentApproval["kind"] {
      const toolId = tool.id;

      if (tool.executorMetadata?.family === "terminal" || toolId === "terminal_run") {
        return "terminal";
      }

      if (tool.executorMetadata?.family === "browser") {
        return "browser";
      }

      if (toolId === "files_write" || toolId === "files_write_many") {
        return "write";
      }

      if (
        toolId === "files_exact_replace" ||
        toolId === "files_insert_at_line" ||
        toolId === "files_replace_range" ||
        toolId === "files_append" ||
        toolId === "files_edit_many" ||
        toolId === "files_apply_patch" ||
        toolId === "files_move"
      ) {
        return "edit";
      }

      return "custom_tool";
    }

    function bridgeApprovalRisk(tool: ToolDefinition): AgentApproval["risk"] {
      if (tool.risk === "terminal" || tool.risk === "destructive" || tool.risk === "credential" || tool.risk === "publish") {
        return "high";
      }

      if (tool.risk === "read" || tool.permission === "read-only") {
        return "low";
      }

      return "medium";
    }

    async function createBridgeApprovalPreview(tool: ToolDefinition, call: ToolCallRequest, bridgeContext: ToolExecutionContext) {
      const validation = validateToolArguments(tool, call.arguments);

      if (!validation.ok || !validation.args) {
        return validation.error || "Invalid tool arguments.";
      }

      try {
        const preview = await tool.execute({ ...validation.args, dryRun: true }, bridgeContext);
        return preview.content;
      } catch (error) {
        return error instanceof Error ? error.message : "Could not preview this tool call.";
      }
    }

    async function collectPendingBridgeApprovals(calls: ToolCallRequest[], bridgeContext: ToolExecutionContext) {
      const runtimeDecisions = createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions) ?? {};
      const approvals: AgentApproval[] = [];
      const waitingToolCalls: ChatToolCall[] = [];

      for (const call of calls) {
        const tool = bridgeRegistry.get(call.name);

        if (!tool) {
          continue;
        }

        const permission = resolveToolPermission(tool, bridgeContext);

        if (permission.allowed || !permission.requiresApproval) {
          continue;
        }

        if (call.argumentsParseError) {
          continue;
        }

        const validation = validateToolArguments(tool, call.arguments);
        if (!validation.ok) {
          continue;
        }

        const shell = createBridgeApprovalShell(call, tool);
        const reusableDecision = runtimeDecisions[createApprovalSessionDecisionKey(shell)];

        if (reusableDecision?.status === "approved") {
          continue;
        }

        const preview = await createBridgeApprovalPreview(tool, call, bridgeContext);
        const approval = createBridgeApprovalShell(call, tool, preview);
        approvals.push(approval);
        waitingToolCalls.push(createBridgeChatToolCall(
          call,
          tool,
          { content: preview || permission.reason || "Approval required before this tool action can run.", ok: true },
          "waiting_approval",
        ));
      }

      return {
        approvals,
        waitingToolCalls,
      };
    }

    const approvedBridgeResume = parseBridgeToolApprovalResume(resumeToolCallContent);

    if (approvedBridgeResume) {
      const submittedDecision = Object.values(approvalDecisions ?? {})[0];

      if (submittedDecision?.status === "denied") {
        const deniedProgress = createLocalComputerProgress("complete", "Approved tool action was denied");
        const deniedToolCalls = stampLocalToolCallIds(
          approvedBridgeResume.calls.map((call) =>
            createBridgeChatToolCall(call, bridgeRegistry.get(call.name), { content: "Approval denied. No tool action ran.", ok: false, skippedReason: "Approval denied." }, "skipped"),
          ),
          passIndex,
        );

        return {
          content: "Approval denied. No tool action ran.",
          progress: deniedProgress,
          toolCalls: deniedToolCalls,
        };
      }

      const activeProgress = createLocalComputerProgress("active", "Running approved tool action");
      const resumeBridgeContext: ToolExecutionContext = {
        memorySearch,
        model: baseRuntimeSettings.model,
        permissionMode: workspaceSettings.permissionMode,
        provider: baseRuntimeSettings.provider,
        providerApiKey: baseRuntimeSettings.apiKeys[baseRuntimeSettings.provider]?.trim() || "",
        signal: controller.signal,
        webSearchMaxResults: runtimeWebSearchMaxResults,
        webSearchSettings: runtimeWebSearchSettings,
        workspaceRoots: getEnabledWorkspaceRoots(workspaceSettings),
      };
      let liveToolCalls: ChatToolCall[] = [];

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: "running",
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
      }));

      const bridgeRun = await executeToolBridgeCalls({
        approval: () => ({ approved: true }),
        calls: approvedBridgeResume.calls,
        context: resumeBridgeContext,
        onToolCallUpdate: (toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: liveToolCalls,
          }));
        },
        registry: bridgeRegistry,
      });
      const completedBridgeToolCalls = stampLocalToolCallIds(bridgeRun.toolCalls, passIndex);
      totalExecutedToolCalls += getBridgeHandledCount(bridgeRun);
      bridgeToolResultMessages.push(...bridgeRun.resultMessages);
      rememberProjectToolMemoryFromBridgeRun(chatId, workspaceSettings, prompt, bridgeRun);
      allToolCalls = [...allToolCalls, ...completedBridgeToolCalls];
      applyBridgeRunSideEffects(bridgeRun, completedBridgeToolCalls);
      localProgress = createLocalComputerProgress("complete", formatBridgeToolRunProgress(bridgeRun, "approved tool"));

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        toolCalls: allToolCalls,
      }));

      messages = [
        ...messages,
        createMessage("user", [
          "APPROVED TOOL RESULT",
          "Use the attached tool result messages as the source of truth.",
          "If the approved action failed because the tool arguments were invalid JSON or failed validation, retry with corrected valid JSON instead of stopping on the raw error.",
          "If no more work is needed, finish the user's request normally.",
        ].join("\n")),
      ];
      passIndex += 1;
      resumeToolCallContent = undefined;
    }

    if (resumeToolCallContent) {
      const activeProgress = createLocalComputerProgress("active", "Resuming approved tool action");
      const activeToolCalls = createActiveLocalToolCalls(resumeToolCallContent, passIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: "running",
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? activeToolCalls : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: activeProgress.label,
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions),
        assistantContent: resumeToolCallContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal, runtimeChat),
        previousToolCalls,
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: liveToolCalls,
          }));
          onExternalUpdate?.({
            progress: activeProgress,
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

      totalExecutedToolCalls += toolRun.executedCount;
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allSources = mergeChatSources(allSources, toolRun.sources);
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, passIndex);
      rememberProjectToolMemoryFromChatToolCalls(chatId, workspaceSettings, prompt, completedToolCalls);
      allToolCalls = completedToolCalls;
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.sources = allSources.length > 0 ? allSources : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? resumeToolCallContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        agentRunStatus: toolRun.waitingForApproval ? "waiting_for_approval" : "running",
        approvals: toolRun.waitingForApproval ? mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []) : message.approvals,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: toolRun.waitingForApproval ? "Tool approval is needed in Gilbert Codex." : `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (toolRun.waitingForApproval) {
        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      const simpleScaffoldResponse = maybeFinishSimpleLocalScaffold();
      if (simpleScaffoldResponse) {
        return simpleScaffoldResponse;
      }

      messages = [
        ...messages,
        createMessage("assistant", resumeToolCallContent),
        createMessage("user", toolRun.contextMessage),
      ];
      passIndex += 1;
    }

    while (!isRequestInactive(requestId, controller)) {
      const toolBudgetReached = passIndex >= maxToolPasses || totalExecutedToolCalls >= maxToolExecutions;
      const approvedPlanNeedsWorkspaceTool = Boolean(approvedPlanExecution && !hasSuccessfulApprovedPlanWorkspaceTool(allToolCalls));
      const approvedPlanNeedsMutation = Boolean(approvedPlanExecution?.requiresMutation && !hasSuccessfulApprovedPlanMutation(allToolCalls));
      const approvedPlanNeedsToolExecution = approvedPlanNeedsWorkspaceTool || approvedPlanNeedsMutation;
      const bridgeSelectionPrompt = toolSelectionPrompt ?? prompt;
      const latestUserPromptNeedsWebSearch = shouldAttachWebSearch(prompt);
      const freshLocalEvidenceNeeded = needsFreshLocalToolEvidence(bridgeSelectionPrompt, workspaceSettings.enabled);
      const freshLocalEvidenceRequiredForPass = freshLocalEvidenceNeeded && allToolCalls.length === 0 && !toolBudgetReached;
      const runtimeSettings = applyToolOverrides(toolBudgetReached ? createFinalOnlyProviderSettings(prompt, runtimeChat) : createPromptAwareProviderSettings(prompt, {}, runtimeChat));
      const minPassTokens = localProgress ? LOCAL_TOOL_FINAL_MIN_TOKENS : 0;
      const passSettings: ProviderSettings = minPassTokens > 0
        ? {
            ...runtimeSettings,
            maxTokens: Math.max(runtimeSettings.maxTokens, minPassTokens),
          }
        : runtimeSettings;
      const workspaceToolCallRequiredForPass =
        allToolCalls.length === 0 &&
        !toolBudgetReached &&
        hasRequestScopedWorkspaceToolsEnabled(passSettings) &&
        requiresWorkspaceToolCallForPrompt(bridgeSelectionPrompt, workspaceSettings.enabled);
      const webSearchEnabledForPass =
        passSettings.tools.webSearch &&
        runtimeWebSearchSettings.enabled &&
        !approvedPlanNeedsToolExecution &&
        (!freshLocalEvidenceRequiredForPass || latestUserPromptNeedsWebSearch) &&
        (!workspaceToolCallRequiredForPass || latestUserPromptNeedsWebSearch);
      const bridgeContext: ToolExecutionContext = {
        memorySearch,
        model: passSettings.model,
        permissionMode: workspaceSettings.permissionMode,
        provider: passSettings.provider,
        providerApiKey: passSettings.apiKeys[passSettings.provider]?.trim() || "",
        signal: controller.signal,
        webSearchMaxResults: runtimeWebSearchMaxResults,
        webSearchSettings: runtimeWebSearchSettings,
        workspaceRoots: getEnabledWorkspaceRoots(workspaceSettings),
      };
      const availableBridgeTools = bridgeRegistry.listForContext(bridgeContext, undefined, {
        includePendingApproval: true,
      });
      const selectedBridgeTools = toolBudgetReached
        ? []
        : selectAdvertisedBridgeTools(
          availableBridgeTools,
          {
            browserPreviewEnabled: passSettings.tools.browserPreview,
            imageGenerationEnabled: passSettings.tools.imageGeneration,
            memoryEnabled: memoryToolsEnabled && !approvedPlanNeedsToolExecution && !freshLocalEvidenceRequiredForPass && !workspaceToolCallRequiredForPass,
            prompt: bridgeSelectionPrompt,
            terminalEnabled: passSettings.tools.terminal,
            webSearchEnabled: webSearchEnabledForPass,
          },
        );
      const bridgeTools = selectedBridgeTools.length > 0 || !workspaceToolCallRequiredForPass
        ? selectedBridgeTools
        : selectAdvertisedBridgeTools(
          availableBridgeTools,
          {
            browserPreviewEnabled: passSettings.tools.browserPreview,
            imageGenerationEnabled: false,
            memoryEnabled: false,
            prompt: "fix the selected workspace app. read relevant files and edit code with the attached file tools.",
            terminalEnabled: passSettings.tools.terminal,
            webSearchEnabled: false,
          },
        );
      const webSearchRequiredForPass =
        latestUserPromptNeedsWebSearch &&
        bridgeTools.some((tool) => tool.id === "web_search") &&
        !allToolCalls.some((toolCall) => toolCall.toolId === "web_search");
      const bridgeToolResultCharBudget = getModelVisibleToolResultCharBudget(resolveContextWindowForModel(passSettings.model).tokens);
      const bridgeOptions = bridgeTools.length > 0 || bridgeToolResultMessages.length > 0
        ? {
            maxToolResultContentChars: bridgeToolResultCharBudget,
            parallelToolCalls: toolBudgetReached ? undefined : supportsProviderParallelToolCalls(passSettings.provider) ? true : undefined,
            reasoningState: bridgeReasoningState,
            runtimeBudget: {
              maxExecutions: maxToolExecutions,
              maxPasses: maxToolPasses,
              maxToolResultContentChars: bridgeToolResultCharBudget,
              remainingExecutions: Math.max(maxToolExecutions - totalExecutedToolCalls, 0),
              remainingPasses: Math.max(maxToolPasses - passIndex, 0),
            },
            toolChoice: toolBudgetReached
              ? "none" as const
              : (approvedPlanNeedsToolExecution || freshLocalEvidenceRequiredForPass || workspaceToolCallRequiredForPass || webSearchRequiredForPass) && bridgeTools.length > 0
                ? "required" as const
                : "auto" as const,
            toolResultDelivery: bridgeToolResultMessages.length > 0 ? "native" as const : undefined,
            toolResultMessages: bridgeToolResultMessages,
            tools: bridgeTools,
          }
        : undefined;
      const passCompaction = compactProviderMessages(messages, passSettings, { toolBridge: bridgeOptions });
      if (passCompaction.compacted) {
        const compactionProgress = createContextCompactionProgress(passCompaction);

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withContextCompactionMarker(message, passCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
        onExternalUpdate?.({
          progress: compactionProgress,
          status: "Compacting local chat context...",
        });
      }
      messages = passCompaction.compacted ? appendAutoCompactionContinuation(passCompaction.messages, prompt, totalExecutedToolCalls) : passCompaction.messages;
      let assistantResponse: Awaited<ReturnType<typeof streamProviderMessageWithRetry>>;

      try {
        assistantResponse = await streamProviderMessageWithRetry(
          chatId,
          passSettings,
          messages,
          (snapshot) => {
            if (isRequestInactive(requestId, controller)) {
              return;
            }

            const streamingToolRequestContent = routePrimitiveEvidenceBatchToWorkflow(
              createAssistantToolRequestContent(snapshot.content, undefined, toolExecutionPolicy),
              prompt,
              toolSettings,
              toolExecutionPolicy,
            );
            const hasStreamingLocalToolCalls = hasLocalComputerToolCalls(streamingToolRequestContent, toolExecutionPolicy);
            const streamingToolCalls = hasStreamingLocalToolCalls ? createActiveLocalToolCalls(streamingToolRequestContent, passIndex, toolExecutionPolicy) : [];
            const streamingBridgeToolCalls = !hasStreamingLocalToolCalls && snapshot.toolCalls?.length
              ? stampLocalToolCallIds(
                  snapshot.toolCalls.map((call) =>
                    createBridgeChatToolCall(
                      call,
                      bridgeRegistry.get(call.name),
                      { content: "Preparing tool call.", ok: true },
                      "active",
                    ),
                  ),
                  passIndex,
                )
              : [];
            const hasStreamingBridgeToolCalls = streamingBridgeToolCalls.length > 0;
            const waitingForRequiredLocalEvidence =
              freshLocalEvidenceRequiredForPass &&
              !hasStreamingLocalToolCalls &&
              !hasStreamingBridgeToolCalls &&
              allToolCalls.length === 0;
            const rawSanitizedContent = sanitizeLocalToolCallsForDisplay(snapshot.content, toolExecutionPolicy);
            const displaySanitizedContent = stripLeadingToolPreludeForDisplay(rawSanitizedContent);
            const hasSubstantiveVisibleAnswer = looksLikeSubstantiveVisibleAnswer(displaySanitizedContent);
            const heldToolCallContent = shouldHoldStreamingContentForToolCalls(rawSanitizedContent, hasStreamingLocalToolCalls || hasStreamingBridgeToolCalls);
            const inFlightToolPlanning = !heldToolCallContent && !hasSubstantiveVisibleAnswer && looksLikeInFlightToolPlanning(rawSanitizedContent);
            const privateThinkingNarration = !heldToolCallContent && looksLikePrivateThinkingNarration(rawSanitizedContent);
            const promisedToolAction = !hasStreamingLocalToolCalls && !hasSubstantiveVisibleAnswer && looksLikeUnexecutedToolActionPromise(snapshot.content);
            const unappliedFileEditAnswer = !hasStreamingLocalToolCalls && !hasSubstantiveVisibleAnswer && looksLikeUnappliedFileEditAnswer(rawSanitizedContent, allToolCalls);
            const unnecessaryConfirmation = !hasStreamingLocalToolCalls && !hasSubstantiveVisibleAnswer && looksLikeUnnecessaryLocalActionConfirmation(rawSanitizedContent, allToolCalls);
            const streamingLocalProgress = hasStreamingLocalToolCalls
              ? createLocalComputerProgress("active", formatLocalToolPreviewProgress(streamingToolCalls))
              : hasStreamingBridgeToolCalls
                ? createLocalComputerProgress("active", formatLocalToolPreviewProgress(streamingBridgeToolCalls))
                : unappliedFileEditAnswer || unnecessaryConfirmation
                  ? createLocalComputerProgress("active", "Preparing file changes")
                : waitingForRequiredLocalEvidence && rawSanitizedContent.trim()
                  ? createLocalComputerProgress("active", "Getting current workspace evidence")
                : inFlightToolPlanning || promisedToolAction || privateThinkingNarration
                  ? createLocalComputerProgress("active", "Preparing tool action")
                  : localProgress;
            const sanitizedContent = hasStreamingLocalToolCalls ? "" : displaySanitizedContent;
            const shouldHideVisibleContent =
              heldToolCallContent ||
              waitingForRequiredLocalEvidence ||
              unappliedFileEditAnswer ||
              unnecessaryConfirmation ||
              inFlightToolPlanning ||
              privateThinkingNarration ||
              promisedToolAction ||
              looksLikeFabricatedToolProgress(sanitizedContent, allToolCalls) ||
              looksLikeToolProtocolNarration(sanitizedContent);
            const visibleContent = shouldHideVisibleContent ? "" : sanitizedContent;
            const workThinkingContent = shouldHideVisibleContent && rawSanitizedContent.trim() ? rawSanitizedContent : "";

            updateGeneratedMessage(chatId, messageId, (message) => ({
              ...(workThinkingContent ? withStreamingWorkThinking(message, workThinkingContent, "active") : completeStreamingWorkThinking(message)),
              content: visibleContent,
              progress: streamingLocalProgress ? withLocalComputerProgress(streamingLocalProgress, message.progress) : message.progress,
              thinking: message.thinking,
              toolCalls: streamingToolCalls.length > 0
                ? [...allToolCalls, ...streamingToolCalls]
                : streamingBridgeToolCalls.length > 0
                  ? [...allToolCalls, ...streamingBridgeToolCalls]
                  : message.toolCalls,
            }));
            onExternalUpdate?.({
              content: visibleContent,
              progress: streamingLocalProgress,
              status: hasStreamingLocalToolCalls
                ? "Preparing tool request..."
                : hasStreamingBridgeToolCalls
                ? "Preparing tool call..."
                : unappliedFileEditAnswer || unnecessaryConfirmation
                  ? "Preparing file changes..."
                : waitingForRequiredLocalEvidence
                  ? "Requesting fresh workspace evidence..."
                : inFlightToolPlanning || promisedToolAction || privateThinkingNarration
                  ? "Preparing tool action..."
                    : visibleContent
                      ? "Streaming answer..."
                      : "Thinking...",
            });
          },
          {
            signal: controller.signal,
            toolBridge: bridgeOptions,
          },
          messageId,
        );
      } catch (error) {
        if (isAbortError(error) || isRequestInactive(requestId, controller) || allToolCalls.length === 0) {
          throw error;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          messages,
          "The streaming final response failed after the app gathered tool results.",
          createBridgeSynthesisToolBridgeOptions(),
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      bridgeReasoningState = assistantResponse.reasoningState ?? bridgeReasoningState;
      const visibleToolCallRecoveryText = assistantResponse.content;
      const rawBridgeToolCalls = assistantResponse.toolCalls?.length
        ? assistantResponse.toolCalls
        : parseVisibleTextToolCalls(visibleToolCallRecoveryText, passSettings.provider);
      const allowedRawBridgeToolCalls = memoryToolsEnabled
        ? rawBridgeToolCalls
        : rawBridgeToolCalls.filter((call) => bridgeRegistry.get(call.name)?.executorMetadata?.family !== "memory");
      const bridgeToolCalls = allowedRawBridgeToolCalls.length
        ? coalesceToolBridgeCalls(allowedRawBridgeToolCalls, bridgeRegistry).calls
        : allowedRawBridgeToolCalls;

      if (bridgeToolCalls.length) {
        const activeProgress = createLocalComputerProgress("active", "Running bridge tools");
        let liveBridgeToolCalls: ChatToolCall[] = [];
        const pendingBridgeApprovals = await collectPendingBridgeApprovals(bridgeToolCalls, bridgeContext);

        if (pendingBridgeApprovals.approvals.length > 0) {
          const approvalProgress = createLocalComputerProgress("pending", "Tool approval required");
          const waitingToolCalls = stampLocalToolCallIds(pendingBridgeApprovals.waitingToolCalls, passIndex);

          finalResponse = {
            approvalRequests: pendingBridgeApprovals.approvals.map((approval) => ({
              ...approval,
              messageId,
            })),
            content: "",
            pendingToolCallContent: pendingBridgeApprovals.approvals[0]?.resumeToolCallContent,
            progress: approvalProgress,
            toolCalls: [...allToolCalls, ...waitingToolCalls],
            waitingForApproval: true,
          };

          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            agentRunStatus: "waiting_for_approval",
            approvals: mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []),
            content: "",
            progress: withLocalComputerProgress(approvalProgress, message.progress),
            toolCalls: finalResponse.toolCalls,
          }));
          onExternalUpdate?.({
            progress: approvalProgress,
            status: "Tool approval is needed in Gilbert Codex.",
            toolCall: waitingToolCalls[0],
          });

          return finalResponse;
        }

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          content: "",
          progress: withLocalComputerProgress(activeProgress, message.progress),
          toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
        }));
        onExternalUpdate?.({
          progress: activeProgress,
          status: activeProgress.label,
        });

        const bridgeRun = await executeToolBridgeCalls({
          approval: () => ({ approved: true }),
          calls: bridgeToolCalls,
          context: bridgeContext,
          onToolCallUpdate: (toolCall) => {
            const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

            if (!stampedToolCall) {
              return;
            }

            liveBridgeToolCalls = upsertToolCall(liveBridgeToolCalls, stampedToolCall);
            attachLiveTerminalSession([stampedToolCall]);
            updateGeneratedMessage(chatId, messageId, (message) => ({
              ...message,
              content: "",
              progress: withLocalComputerProgress(activeProgress, message.progress),
              toolCalls: [...allToolCalls, ...liveBridgeToolCalls],
            }));
            onExternalUpdate?.({
              progress: activeProgress,
              status: formatDiscordToolStatus(stampedToolCall),
              toolCall: stampedToolCall,
            });
          },
          registry: bridgeRegistry,
        });
        const completedBridgeToolCalls = stampLocalToolCallIds(bridgeRun.toolCalls, passIndex);
        totalExecutedToolCalls += getBridgeHandledCount(bridgeRun);
        bridgeToolResultMessages.push(...bridgeRun.resultMessages);
        rememberProjectToolMemoryFromBridgeRun(chatId, workspaceSettings, prompt, bridgeRun);
        allToolCalls = [...allToolCalls, ...completedBridgeToolCalls];
        applyBridgeRunSideEffects(bridgeRun, completedBridgeToolCalls);
        localProgress = createLocalComputerProgress("complete", formatBridgeToolRunProgress(bridgeRun, "bridge tool"));

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          content: "",
          progress: withLocalComputerProgress(localProgress, message.progress),
          toolCalls: allToolCalls,
        }));
      onExternalUpdate?.({
        progress: localProgress,
        status: `${formatBridgeToolRunProgress(bridgeRun, "bridge tool")}.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      messages = [
        ...messages,
        createMessage("user", createBridgeToolContinuationInstruction(bridgeRun)),
      ];
      passIndex += 1;
      continue;
    }

      const assistantToolRequestContent = routePrimitiveEvidenceBatchToWorkflow(
        createAssistantToolRequestContent(assistantResponse.content, undefined, toolExecutionPolicy),
        prompt,
        toolSettings,
        toolExecutionPolicy,
      );
      const assistantHasLocalToolCalls = hasLocalComputerToolCalls(assistantToolRequestContent, toolExecutionPolicy);

      finalResponse = {
        artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
        content: assistantHasLocalToolCalls ? "" : stripLeadingToolPreludeForDisplay(sanitizeLocalToolCallsForDisplay(assistantResponse.content, toolExecutionPolicy)),
        sources: allSources.length > 0 ? allSources : undefined,
        toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
      };

      if (isRequestInactive(requestId, controller)) {
        return guardRecoveryFinalResponse(finalResponse);
      }

      if (!assistantHasLocalToolCalls && shouldSynthesizeEmptyFinalFromToolResults(finalResponse.content, allToolCalls)) {
        const recoverableBridgeRetryInstruction = createRecoverableBridgeToolRetryInstruction(allToolCalls, prompt);

        if (recoverableBridgeRetryInstruction && recoverableBridgeToolRetries < MAX_MALFORMED_TOOL_RECOVERY_RETRIES) {
          recoverableBridgeToolRetries += 1;
          const retryProgress = createLocalComputerProgress("active", "Retrying corrected tool call");

          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(retryProgress, message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          onExternalUpdate?.({
            progress: retryProgress,
            status: "Retrying corrected tool call...",
          });

          messages = [
            ...messages,
            createMessage("user", recoverableBridgeRetryInstruction),
          ];
          passIndex += 1;
          continue;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          messages,
          "The provider returned no visible final answer after completed tool results. Use the attached tool result messages and write the requested answer now.",
          createBridgeSynthesisToolBridgeOptions(),
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (toolBudgetReached && assistantHasLocalToolCalls) {
        finalizationRetries += 1;

        if (finalizationRetries <= MAX_TOOL_FINALIZATION_RETRIES) {
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(createLocalComputerProgress("active", "Synthesizing gathered tool results"), message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          onExternalUpdate?.({
            progress: createLocalComputerProgress("active", "Synthesizing gathered tool results"),
            status: "Synthesizing gathered tool results...",
          });
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage(
              "user",
              createLocalToolBudgetFinalInstruction(
                prompt,
                [
                  `The app already gathered ${totalExecutedToolCalls} local tool result${totalExecutedToolCalls === 1 ? "" : "s"} across ${passIndex} pass${passIndex === 1 ? "" : "es"}.`,
                  "The previous assistant response requested more tools, but the next step is to synthesize from the saved results unless user input is truly required.",
                ].join("\n"),
              ),
            ),
          ];
          passIndex += 1;
          continue;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent)],
          "The model requested more tools after the configured tool budget. Synthesize from the saved results instead of asking for more tools.",
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (!assistantHasLocalToolCalls) {
        const fabricatedToolProgress = looksLikeFabricatedToolProgress(finalResponse.content, allToolCalls);
        const hasSubstantiveFinalAnswer = looksLikeSubstantiveVisibleAnswer(finalResponse.content);
        const inFlightToolPlanning = !hasSubstantiveFinalAnswer && looksLikeInFlightToolPlanning(finalResponse.content);
        const privateThinkingNarration = looksLikePrivateThinkingNarration(finalResponse.content);
        const toolProtocolNarration = looksLikeToolProtocolNarration(finalResponse.content);
        const unexecutedToolActionPromise = !hasSubstantiveFinalAnswer && looksLikeUnexecutedToolActionPromise(finalResponse.content);
        const unappliedFileEditAnswer = !hasSubstantiveFinalAnswer && looksLikeUnappliedFileEditAnswer(finalResponse.content, allToolCalls);
        const unnecessaryConfirmation = !hasSubstantiveFinalAnswer && looksLikeUnnecessaryLocalActionConfirmation(finalResponse.content, allToolCalls);
        const contradictedSuccessfulFileMutation = looksLikeContradictedSuccessfulFileMutationAnswer(finalResponse.content, allToolCalls);
        const visibleToolResultLeak = isVisibleToolResultLeak(finalResponse.content, allToolCalls);
        const localToolEvidenceRequired =
          allToolCalls.length === 0 &&
          freshLocalToolEvidenceRetries < 2 &&
          !toolBudgetReached &&
          freshLocalEvidenceNeeded;
        const approvedPlanExecutionIncomplete = Boolean(approvedPlanExecution && !toolBudgetReached && approvedPlanNeedsToolExecution);

        if (approvedPlanExecutionIncomplete || localToolEvidenceRequired || looksLikeOnlyToolPrelude(finalResponse.content) || looksLikeInternalToolRecoveryAnswer(finalResponse.content) || fabricatedToolProgress || inFlightToolPlanning || privateThinkingNarration || toolProtocolNarration || unexecutedToolActionPromise || unappliedFileEditAnswer || unnecessaryConfirmation || contradictedSuccessfulFileMutation || visibleToolResultLeak) {
          if (localToolEvidenceRequired) {
            freshLocalToolEvidenceRetries += 1;
          }
          finalizationRetries += 1;

          if (finalizationRetries > MAX_TOOL_FINALIZATION_RETRIES) {
            if (approvedPlanExecutionIncomplete && approvedPlanExecution) {
              return {
                artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
                content: createApprovedPlanExecutionFailedAnswer(approvedPlanExecution, allToolCalls),
                progress: localProgress,
                sources: allSources.length > 0 ? allSources : undefined,
                toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
              };
            }

            const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
              [...messages, createMessage("assistant", assistantResponse.content)],
              fabricatedToolProgress
                ? "The previous finalization attempt claimed tool progress that was not backed by app tool-call records. Do not repeat that claim."
                : approvedPlanExecutionIncomplete
                  ? "The previous finalization attempt answered before executing the approved plan. Do not repeat that answer."
                : inFlightToolPlanning
                  ? "The previous finalization attempt exposed in-flight tool planning instead of using real app tool calls or writing a final answer. Do not repeat that planning text."
                : privateThinkingNarration
                  ? "The previous finalization attempt exposed private reasoning instead of a user-facing answer. Do not repeat that reasoning text."
                : toolProtocolNarration
                  ? "The previous finalization attempt exposed tool-call protocol narration. Do not repeat it."
                : unnecessaryConfirmation
                  ? "The previous finalization attempt asked for confirmation instead of executing an ordinary requested local action. Use real tools instead."
                : unexecutedToolActionPromise
                  ? "The previous finalization attempt promised a tool action without executing it. Do not repeat the promise."
                : unappliedFileEditAnswer
                  ? "The previous finalization attempt pasted proposed updated files, but no mutating edit/write tool call succeeded. Apply the edit with real tools instead."
                : contradictedSuccessfulFileMutation
                  ? "The previous finalization attempt contradicted successful file edit/write tool evidence. Treat the saved file mutation results as already applied and write a normal answer."
                : visibleToolResultLeak
                  ? "The previous finalization attempt repeated raw tool result text. Use the saved tool evidence to write a normal answer instead."
                : "The previous finalization attempt exposed tool progress instead of a user-facing answer. Write the actual answer from the completed tool evidence.",
            );

            if (synthesizedResponse) {
              return synthesizedResponse;
            }

            return {
              artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
              content: createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
              progress: localProgress,
              sources: allSources.length > 0 ? allSources : undefined,
              toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
            };
          }

          const recoveryProgress: ChatProgressItem = localProgress ?? (approvedPlanExecutionIncomplete
            ? createLocalComputerProgress("active", "Executing approved plan")
            : {
                detail: "Continuing from the work log",
                id: "final-answer-recovery",
                label: "Thinking",
                status: "active",
              });
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(recoveryProgress, message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          onExternalUpdate?.({
            progress: recoveryProgress,
            status: approvedPlanExecutionIncomplete
              ? "Executing approved plan..."
              : localToolEvidenceRequired
                ? "Requesting fresh tool evidence..."
                : localProgress
                  ? "Synthesizing gathered tool results..."
                  : "Continuing from the work log...",
          });
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage(
              "user",
              approvedPlanExecutionIncomplete && approvedPlanExecution
                ? createApprovedPlanExecutionRetryInstruction(approvedPlanExecution, finalResponse.content, allToolCalls)
                : localToolEvidenceRequired
                ? createFreshLocalToolEvidenceInstruction(prompt, finalResponse.content)
                : fabricatedToolProgress
                ? createFabricatedToolProgressRecoveryInstruction(prompt, finalResponse.content, allToolCalls)
                : inFlightToolPlanning
                ? createToolActionPromiseRecoveryInstruction(prompt, finalResponse.content)
                : privateThinkingNarration
                  ? createFinalAnswerRecoveryInstruction(
                      prompt,
                      "The previous response exposed private reasoning instead of answering the user. Rewrite it as the actual final answer now.",
                    )
                : toolProtocolNarration
                  ? createToolProtocolNarrationRecoveryInstruction(prompt, finalResponse.content)
                : unnecessaryConfirmation
                  ? createUnnecessaryLocalActionConfirmationRecoveryInstruction(prompt, finalResponse.content)
                : unexecutedToolActionPromise
                  ? createToolActionPromiseRecoveryInstruction(prompt, finalResponse.content)
                : unappliedFileEditAnswer
                  ? createUnappliedFileEditRecoveryInstruction(prompt, finalResponse.content)
                : contradictedSuccessfulFileMutation
                  ? createFinalAnswerRecoveryInstruction(
                      prompt,
                      "The previous response said there was no edit/write result even though a successful file mutation tool result exists. Treat the file changes as already applied and summarize the completed work.",
                    )
                : localProgress
                ? createLocalToolFinalInstruction(prompt)
                : createFinalAnswerRecoveryInstruction(
                    prompt,
                    "The previous response exposed internal continuation text instead of answering the user. Rewrite it as the actual final answer now.",
                  ),
            ),
          ];
          passIndex += 1;
          continue;
        }

        return guardRecoveryFinalResponse(finalResponse);
      }

      const activeProgress = createLocalComputerProgress("active", "Running requested agent tools");
      const activeToolCalls = createActiveLocalToolCalls(assistantToolRequestContent, passIndex, toolExecutionPolicy);
      let liveToolCalls = activeToolCalls;

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        content: "",
        progress: withLocalComputerProgress(activeProgress, message.progress),
        toolCalls: activeToolCalls.length > 0 ? [...allToolCalls, ...activeToolCalls] : message.toolCalls,
      }));
      onExternalUpdate?.({
        progress: activeProgress,
        status: activeProgress.label,
        toolCall: activeToolCalls[0],
      });

      const toolRun = await runLocalComputerToolCalls({
        approvalDecisions: createRuntimeApprovalDecisions(workspaceSettings, approvalDecisions),
        assistantContent: assistantToolRequestContent,
        executionPolicy: toolExecutionPolicy,
        onRunSubagents: (tasks) => runParallelSubagents(tasks, messages, prompt, controller.signal, runtimeChat),
        onToolCallUpdate: (_callNumber, toolCall) => {
          const [stampedToolCall] = stampLocalToolCallIds([toolCall], passIndex);

          if (!stampedToolCall) {
            return;
          }

          liveToolCalls = upsertToolCall(liveToolCalls, stampedToolCall);
          attachLiveTerminalSession([stampedToolCall]);
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(activeProgress, message.progress),
            toolCalls: [...allToolCalls, ...liveToolCalls],
          }));
          onExternalUpdate?.({
            progress: activeProgress,
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

      totalExecutedToolCalls += toolRun.executedCount;
      const completedToolCalls = stampLocalToolCallIds(toolRun.toolCalls, passIndex);
      rememberProjectToolMemoryFromChatToolCalls(chatId, workspaceSettings, prompt, completedToolCalls);
      allArtifacts = mergeChatArtifacts(allArtifacts, toolRun.artifacts) ?? [];
      allSources = mergeChatSources(allSources, toolRun.sources);
      allToolCalls = [...allToolCalls, ...completedToolCalls];
      attachLiveTerminalSession(allToolCalls);
      localProgress = toolRun.waitingForApproval ? toolRun.progress : createLocalComputerProgress("complete", `${totalExecutedToolCalls} ran`);
      finalResponse.artifacts = allArtifacts.length > 0 ? allArtifacts : undefined;
      finalResponse.sources = allSources.length > 0 ? allSources : undefined;
      finalResponse.toolCalls = allToolCalls;
      finalResponse.approvalRequests = toolRun.approvalRequests.map((approval) => ({
        ...approval,
        messageId,
        resumeToolCallContent: assistantToolRequestContent,
      }));
      finalResponse.pendingToolCallContent = toolRun.waitingForApproval ? assistantToolRequestContent : undefined;
      finalResponse.waitingForApproval = toolRun.waitingForApproval;

      if (toolRun.waitingForApproval) {
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          agentRunStatus: "waiting_for_approval",
          approvals: mergeAgentApprovals(message.approvals ?? [], finalResponse.approvalRequests ?? []),
          artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
          content: "",
          progress: withLocalComputerProgress(toolRun.progress, message.progress),
          sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
          toolCalls: allToolCalls,
        }));
        onExternalUpdate?.({
          progress: toolRun.progress,
          sources: toolRun.sources,
          status: "Tool approval is needed in Gilbert Codex.",
          toolCall: allToolCalls[allToolCalls.length - 1],
        });

        return {
          ...finalResponse,
          progress: toolRun.progress,
        };
      }

      if (toolRun.requestedCount === 0) {
        malformedToolRecoveryRetries += 1;

        if (malformedToolRecoveryRetries <= MAX_MALFORMED_TOOL_RECOVERY_RETRIES) {
          updateGeneratedMessage(chatId, messageId, (message) => ({
            ...message,
            content: "",
            progress: withLocalComputerProgress(createLocalComputerProgress("active", "Recovering tool request"), message.progress),
            toolCalls: allToolCalls.length > 0 ? allToolCalls : message.toolCalls,
          }));
          messages = [
            ...messages,
            createMessage("assistant", assistantToolRequestContent),
            createMessage("user", createMalformedToolCallRecoveryInstruction(prompt)),
          ];
          passIndex += 1;
          continue;
        }

        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent)],
          "The previous assistant output looked like an unreadable tool request. Write the final answer from the completed tool evidence.",
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return guardRecoveryFinalResponse({
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: sanitizeLocalToolCallsForDisplay(assistantResponse.content, toolExecutionPolicy) || createToolFinalAnswerUnavailableMessage(allToolCalls, prompt),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        });
      }

      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        artifacts: mergeChatArtifacts(message.artifacts, toolRun.artifacts),
        content: "",
        progress: withLocalComputerProgress(localProgress, message.progress),
        sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
        toolCalls: allToolCalls,
      }));
      onExternalUpdate?.({
        progress: localProgress,
        sources: toolRun.sources,
        status: `${totalExecutedToolCalls} tool call${totalExecutedToolCalls === 1 ? "" : "s"} completed.`,
        toolCall: allToolCalls[allToolCalls.length - 1],
      });

      if (!emptyScaffoldRecoveryUsed && isEmptySelectedScaffoldProbe(prompt, toolRun.contextMessage, completedToolCalls)) {
        const recoveredResponse = await recoverEmptySimpleScaffold();
        if (recoveredResponse) {
          return recoveredResponse;
        }
        continue;
      }

      const hasRecoverableToolFailure =
        toolRun.requestedCount > 0 &&
        isRecoverableLocalEditFailure(toolRun.contextMessage, completedToolCalls, toolRun.recoverableFailure);

      if (hasRecoverableToolFailure && recoverableEditRetries < MAX_RECOVERABLE_LOCAL_EDIT_RETRIES) {
        recoverableEditRetries += 1;
        const retryProgress = createLocalComputerProgress("active", "Recovering file change");

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          content: "",
          progress: withLocalComputerProgress(retryProgress, message.progress),
          sources: toolRun.sources.length > 0 ? mergeChatSources(message.sources, toolRun.sources) : message.sources,
          toolCalls: allToolCalls,
        }));
        onExternalUpdate?.({
          progress: retryProgress,
          sources: toolRun.sources,
          status: "Recovering file change...",
          toolCall: allToolCalls[allToolCalls.length - 1],
        });

        messages = [
          ...messages,
          createMessage("assistant", assistantToolRequestContent),
          createMessage("user", toolRun.contextMessage),
          createMessage("user", createRecoverableLocalEditRetryInstruction(prompt, toolRun.contextMessage, toolRun.recoverableFailure)),
        ];
        passIndex += 1;
        continue;
      }

      if (toolRun.directAnswer) {
        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: toolRun.directAnswer,
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      if (toolRun.requestedCount > 0 && toolRun.executedCount === 0) {
        const synthesizedResponse = await synthesizeAnswerFromSavedToolResults(
          [...messages, createMessage("assistant", assistantToolRequestContent), createMessage("user", toolRun.contextMessage)],
          createNoExecutedToolFinalInstruction(toolRun.contextMessage, hasRecoverableToolFailure),
        );

        if (synthesizedResponse) {
          return synthesizedResponse;
        }

        return {
          artifacts: allArtifacts.length > 0 ? allArtifacts : undefined,
          content: createNoExecutedToolFinalAnswer(toolRun.contextMessage),
          progress: localProgress,
          sources: allSources.length > 0 ? allSources : undefined,
          toolCalls: allToolCalls.length > 0 ? allToolCalls : undefined,
        };
      }

      const simpleScaffoldResponse = maybeFinishSimpleLocalScaffold();
      if (simpleScaffoldResponse) {
        return simpleScaffoldResponse;
      }

      const nextPassWillReachBudget = passIndex + 1 >= maxToolPasses || totalExecutedToolCalls >= maxToolExecutions;
      messages = [
        ...messages,
        createMessage("assistant", assistantToolRequestContent),
        createMessage("user", toolRun.contextMessage),
        ...(nextPassWillReachBudget
          ? [
              createMessage(
                "user",
                createLocalToolBudgetFinalInstruction(
                  prompt,
                  `The app has gathered ${totalExecutedToolCalls} local tool result${totalExecutedToolCalls === 1 ? "" : "s"} across ${passIndex + 1} pass${passIndex + 1 === 1 ? "" : "es"}. Synthesize the answer from those results now unless user input is required.`,
                ),
              ),
            ]
          : []),
      ];

      passIndex += 1;
    }

    return guardRecoveryFinalResponse(finalResponse);

    function guardRecoveryFinalResponse(response: typeof finalResponse) {
      const content = response.content.trim();

      if (!content) {
        return {
          ...response,
          progress: localProgress,
        };
      }

      if (looksLikeInternalToolRecoveryAnswer(content) || isVisibleToolResultLeak(content, allToolCalls)) {
        return {
          ...response,
          content: createNeutralToolSynthesisFailureMessage(),
          progress: localProgress,
        };
      }

      return {
        ...response,
        progress: localProgress,
      };
    }
  }
