import { lazy, Suspense, useEffect, useRef, useState, type SetStateAction } from "react";
import { Info, Trash2 } from "lucide-react";
import { ConfirmDialog, NoticeDialog, TextInputDialog } from "../../components/dialogs/AppDialog";
import { BulkDeleteChatsDialog } from "../../components/dialogs/BulkDeleteChatsDialog";
import { AppShell } from "../../components/layout/AppShell";
import { OnboardingDialog } from "../../components/onboarding/OnboardingDialog";
import { ProviderConnectionDialog } from "../../components/onboarding/ProviderConnectionDialog";
import { ChatPage } from "../../pages/ChatPage";
import type { SettingsSectionId } from "../../pages/settings/types";
import { resolveSettingsNavSection } from "../../pages/settings/settingsNavigation";
import {
  loadActiveChatId,
  loadAppPersonalizationSettings,
  loadAppearanceMode,
  loadChats,
  loadDiscordBridgeSettings,
  loadLocalWorkspaceSettings,
  loadPersistentString,
  loadProjects,
  loadProviderSettings,
  saveActiveChatId,
  saveAppPersonalizationSettings,
  saveAppearanceMode,
  saveChats,
  saveDiscordBridgeSettings,
  saveLocalWorkspaceSettings,
  savePersistentString,
  saveProjects,
  saveProviderSettings,
} from "../../lib/appStorage";
import {
  createEmptyChat,
  createId,
  createMessage,
  DEFAULT_PROJECT,
  formatChatAge,
  hasComposerDraftContent,
  isDiscardableEmptyChat,
  isEmptyChat,
  isNoProjectName,
  isPlainResearchChat,
  normalizeProjectName,
  sortChatsByUpdatedAt,
  titleFromMessage,
} from "../../lib/chatUtils";
import { contentReferencesChatTitle, createChatResearchContextContent } from "../../lib/chatResearchContext";
import {
  AUTO_COMPACT_CONTEXT_TARGET,
  AUTO_COMPACT_CONTEXT_THRESHOLD,
  compactMessagesForContext,
  CONTEXT_COMPACTION_STRATEGY,
  CONTEXT_COMPACTION_SUMMARY_VERSION,
  formatTokenCount,
  getFallbackContextWindowTokens,
  getFallbackModelContextWindow,
  getFallbackModelContextWindows,
  type ContextCompactionNotice,
  type ContextWindowUsage,
  type ModelContextWindowMap,
} from "../../lib/contextWindow";
import { getEffectiveMaxOutputTokens, isLocalModelProvider } from "../../lib/generationSettings";
import { copyTextToClipboard } from "../../lib/clipboard";
import { CHAT_MODEL_OPTIONS, getDefaultBaseUrlForProvider, getDefaultModelForProvider, getModelProvider, getProviderApiKey, isModelProviderId, isNineRouterCodexModelId, isNineRouterGithubCopilotModelId, supportsProviderThinking } from "../../lib/models";
import { scheduleIdleTask } from "../../lib/idleTask";
import { createPdfLibraryContextMessages, syncPdfLibraryFromChats } from "../../lib/pdfLibrary";
import {
  createChatMemoryFingerprint,
  createDurableMemoryContext,
  createDurableMemoryScopeFromChat,
  createDurableProjectMemoryScope,
  loadDurableChatMemoryState,
  loadDurableProjectMemoryState,
  persistDurableMemoryFromChat,
  saveDurableProjectMemoryState,
  updateDurableProjectMemoryMap,
} from "../../memory";
import {
  createPlanningInputRequest,
  createPlanningProgress,
  runPlanningMode,
  type PlanningProviderRequest,
} from "../../services/planningClient";
import {
  createPlanResearchFollowupInstruction,
  createPlanResearchInstruction,
  formatResearchPayload,
  isResearchDeepEnough,
  PLAN_RESEARCH_BUDGET,
  summarizeResearchEvidence,
} from "../../services/planResearchClient";
import { createFallbackChatTitle, generateChatTitle } from "../../services/chatTitleClient";
import { fetchProviderModelContextLengths, isProviderEmptyResponseError, sendProviderMessage, streamProviderMessage } from "../../services/modelProviderClient";
import { annotateProviderPayloadSpike, applyProviderUsageToContextEstimate, countAutoCompactedProviderMessages, estimateModelProviderPayloadUsage, preserveContextUsageHighWaterMark } from "../../services/modelProviderUsage";
import {
  createBridgeChatToolCall,
  createDefaultToolRegistry,
  coalesceToolBridgeCalls,
  createProjectToolMemoryContext,
  createProjectToolMemoryScope,
  executeToolBridgeCalls,
  isVisibleToolResultLeak,
  learnProjectToolMemoryFromBridgeRun,
  learnProjectToolMemoryFromChatToolCalls,
  loadProjectToolMemoryState,
  parseVisibleTextToolCalls,
  resolveToolPermission,
  saveProjectToolMemoryState,
  selectAdvertisedBridgeTools,
  shouldAttachWebSearch,
  validateToolArguments,
} from "../../toolBridge";
import type { ProviderToolBridgeOptions, ToolBridgeExecutionBatch, ToolCallRequest, ToolDefinition, ToolExecutionContext, ToolMemorySearchRequest, ToolResultMessage } from "../../toolBridge";
import { buildComputerFileIndex, createComputerGitWorktree, createLocalWorkspaceContext, getComputerFileIndexSummary, pickComputerFolder, resolveLocalWorkspaceRoots } from "../../localWorkspace/files";
import {
  createLocalComputerProgress,
  createApprovalSessionDecisionKey,
  hasLocalComputerToolCalls,
  runLocalComputerToolCalls,
  sanitizeLocalToolCallsForDisplay,
  STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
  type LocalComputerToolExecutionPolicy,
  type LocalSubagentResult,
  type LocalSubagentTask,
  routePrimitiveEvidenceBatchToWorkflow,
} from "../../localWorkspace/localToolRuntimeDisabled";
import {
  createActiveLocalToolCalls,
  createAssistantToolRequestContent,
  createCompletedToolFallbackSummary,
  createFabricatedToolProgressRecoveryInstruction,
  createFinalAnswerRecoveryInstruction,
  createInterruptedResponseContinuationInstruction,
  createLocalToolBudgetFinalInstruction,
  createLocalToolFinalInstruction,
  createMalformedToolCallRecoveryInstruction,
  createNeutralToolSynthesisFailureMessage,
  createFreshLocalToolEvidenceInstruction,
  createRecoverableLocalEditRetryInstruction,
  createToolActionPromiseRecoveryInstruction,
  createToolProtocolNarrationRecoveryInstruction,
  createUnnecessaryLocalActionConfirmationRecoveryInstruction,
  createUnappliedFileEditRecoveryInstruction,
  createPlanningAnswerMessages,
  createSimpleLocalTaskCompletionAnswer,
  getLatestUserPrompt,
  getPendingPlanningInputRequest,
  getPlanningInputRequests,
  detectSimpleLocalTaskCompletion,
  isSimpleLocalScaffoldRequest,
  isEmptySelectedScaffoldProbe,
  isFileReadSynthesisToolCall,
  isRecoverableLocalEditFailure,
  isAbortError,
  isInterruptedAssistantMessage,
  isToolResultFallbackAnswer,
  looksLikeInFlightToolPlanning,
  looksLikeFabricatedToolProgress,
  looksLikeInternalToolRecoveryAnswer,
  looksLikeOnlyToolPrelude,
  looksLikePrivateThinkingNarration,
  looksLikeSubstantiveVisibleAnswer,
  looksLikeToolProtocolNarration,
  looksLikeUnnecessaryLocalActionConfirmation,
  looksLikeUnappliedFileEditAnswer,
  looksLikeUnexecutedToolActionPromise,
  needsFreshLocalToolEvidence,
  requiresWorkspaceToolCallForPrompt,
  shouldSynthesizeEmptyFinalFromToolResults,
  shouldHoldStreamingContentForToolCalls,
  stripLeadingToolPreludeForDisplay,
  markPlanningInputAnswered,
  mergeChatSources,
  stampLocalToolCallIds,
  withLocalComputerProgress,
  withWebSearchProgress,
} from "../chatRuntime";
import { mergeProjectsWithChats, sameLocalWorkspaceSettings, samePathSet, sortProjectsByUpdatedAt } from "../projectState";
import { refreshWorkspaceContext } from "../../localWorkspace/workspaceContext";
import { formatWebSearchProviderLabel, MAX_WEB_SEARCH_RESULTS } from "../../services/webSearchClient";
import { NINE_ROUTER_PROVIDER_ID } from "../../services/nineRouterClient";
import {
  createAgentPrimitiveToolContent,
  createAgentRunRequest,
  createAgentRunWorkflowToolContent,
  createAgentRuntimeDecisionInstruction,
  parseAgentRuntimeDecision,
  shouldStartAppAgentRun,
  summarizeAgentRuntimeDecision,
  type AgentRuntimeDecision,
} from "../../agentRuntime/codingAgent";
import {
  getAppInfo,
  getDefaultTerminalWorkingDirectory,
  isTauriDesktopRuntime,
  listenForDiscordInteractions,
  sendDiscordInteractionResponse,
  startDiscordBridge,
  stopDiscordBridge,
  type DiscordInteractionEvent,
} from "../tauriClient";
import { listAgentRuns, saveAgentRun } from "../agentRunClient";
import { openChatWindow } from "../windowClient";
import {
  createNeedsAttentionNotification,
  createNeedsInputNotification,
  notifyAgentRunStatus,
  prepareDesktopNotifications,
} from "../desktopNotifications";
import type { AppInfo } from "../../types/app";
import type { AgentApproval, AgentApprovalDecision, AgentRun } from "../../types/agentRun";
import type { AuthSession } from "../../types/auth";
import type {
  ChatArtifact,
  ChatAttachment,
  ChatContextCompaction,
  ChatComposerDraft,
  ChatMessage,
  ChatPlanningInputAnswer,
  ChatPlanningInputRequest,
  ChatProgressItem,
  ChatResearchReference,
  ChatSendInput,
  ChatSource,
  ChatSummary,
  ChatToolCall,
  ChatWebSearch,
  ChatWorkTraceItem,
} from "../../types/chat";
import type { LocalWorkspaceSettings } from "../../types/localWorkspace";
import type { PrimaryRoute } from "../../types/navigation";
import type { ProviderReasoningState } from "../../types/reasoning";
import type { CreateProjectOptions, ProjectSummary } from "../../types/project";
import type { DiscordBridgeSettings } from "../../types/discord";
import type { TerminalAttachedSession } from "../../types/terminal";
import type { AppPersonalizationSettings, AppearanceMode, ProviderSettings, WebSearchSettings } from "../../types/settings";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ToolRegistrySettings } from "../../types/tools";

import type { WorkspaceRuntimeDeps } from "./runtimeTypes";
import { RouteLoading, formatDiscordStreamMessage, waitForDiscordFlushSlot, formatDiscordProgress, formatLocalToolPreviewProgress, formatDiscordToolStatus, formatDiscordSources, limitDiscordStreamMessage, formatMarkdownForDiscord, splitMarkdownFenceSegments, formatDiscordTextMarkdown, isMarkdownHorizontalRule, isMarkdownTableStart, renderMarkdownTableForDiscord, parseMarkdownTableRow, renderMarkdownTableRowForDiscord, closeUnclosedDiscordCodeFence, getChatIdFromLocationHash, createChatDeeplink, formatChatAsMarkdown, createForkedChat, cloneMessageForFork, cloneToolCallForFork, cloneJson, createUniqueProjectName, createProjectBaseName, projectNameFromPath, normalizeSelectedProjectPath, looksLikeContradictedSuccessfulFileMutationAnswer, hasSuccessfulFileMutationToolCall, readErrorMessage, upsertToolCall, withStreamingWorkThinking, completeStreamingWorkThinking, mergeMessageWorkTrace, toolCallsMatchForWorkTrace, getToolCallInputIdentity, cleanWorkThinkingContent, mergeAgentApprovals, mergeChatArtifacts, recoverInterruptedAgentRun } from "./workspaceHelpers";
import { persistChatState as persistChatStateImpl, setChats as setChatsImpl, handleComposerDraftChange as handleComposerDraftChangeImpl, queueDurableMemoryForChangedChats as queueDurableMemoryForChangedChatsImpl, queueDurableMemoryForChatIds as queueDurableMemoryForChatIdsImpl, scheduleDurableMemoryFlush as scheduleDurableMemoryFlushImpl, flushDurableMemoryQueue as flushDurableMemoryQueueImpl, takeNextDurableMemoryChatId as takeNextDurableMemoryChatIdImpl, persistDurableMemoryForChatId as persistDurableMemoryForChatIdImpl } from "./state/chatPersistence";
import { resolveWorkspaceForChatProject as resolveWorkspaceForChatProjectImpl, isActiveChatProject as isActiveChatProjectImpl } from "./state/workspaceLookup";
import { persistAgentRun as persistAgentRunImpl, createAgentRunForMessage as createAgentRunForMessageImpl, updateAgentRun as updateAgentRunImpl, setAgentRunWaiting as setAgentRunWaitingImpl, setAgentRunCompleted as setAgentRunCompletedImpl, setAgentRunFailed as setAgentRunFailedImpl, setAgentRunCancelled as setAgentRunCancelledImpl, setAgentRunContinuing as setAgentRunContinuingImpl, createPlanningExecutionApproval as createPlanningExecutionApprovalImpl } from "./state/agentRuns";
import { handleNewChat as handleNewChatImpl, handleSelectChat as handleSelectChatImpl, handleActiveChatModelChange as handleActiveChatModelChangeImpl, handleProviderConnectionChoice as handleProviderConnectionChoiceImpl, handleSelectProject as handleSelectProjectImpl, openCreateProjectDialog as openCreateProjectDialogImpl, createProjectFromFolder as createProjectFromFolderImpl, handleLocalWorkspaceChange as handleLocalWorkspaceChangeImpl, bindActiveChatToProject as bindActiveChatToProjectImpl, handleToggleTerminal as handleToggleTerminalImpl, attachLiveTerminalSession as attachLiveTerminalSessionImpl, handleTogglePin as handleTogglePinImpl, handleOpenRenameChat as handleOpenRenameChatImpl, confirmRenameChat as confirmRenameChatImpl, handleArchiveActiveChat as handleArchiveActiveChatImpl, handleCopyWorkingDirectory as handleCopyWorkingDirectoryImpl, handleCopySessionId as handleCopySessionIdImpl, handleCopyChatDeeplink as handleCopyChatDeeplinkImpl, handleCopyChatMarkdown as handleCopyChatMarkdownImpl, handleForkActiveChatLocal as handleForkActiveChatLocalImpl, handleForkActiveChatWorktree as handleForkActiveChatWorktreeImpl, handleAddAutomation as handleAddAutomationImpl, handleOpenActiveChatInNewWindow as handleOpenActiveChatInNewWindowImpl, getActiveWorkingDirectory as getActiveWorkingDirectoryImpl, copyLabeledTextToClipboard as copyLabeledTextToClipboardImpl, activateForkedChat as activateForkedChatImpl, notifyPlanningInputNeeded as notifyPlanningInputNeededImpl, notifyRunNeedsAttention as notifyRunNeedsAttentionImpl, notifyRunComplete as notifyRunCompleteImpl, touchProject as touchProjectImpl, restoreProjectLocalWorkspace as restoreProjectLocalWorkspaceImpl, saveWorkspaceForProject as saveWorkspaceForProjectImpl, handleDeleteChat as handleDeleteChatImpl, handleDeleteProject as handleDeleteProjectImpl, handleOpenBulkDeleteChats as handleOpenBulkDeleteChatsImpl, handleToggleBulkDeleteChat as handleToggleBulkDeleteChatImpl, handleSelectAllBulkDeleteChats as handleSelectAllBulkDeleteChatsImpl, handleClearBulkDeleteChats as handleClearBulkDeleteChatsImpl, confirmDeleteChat as confirmDeleteChatImpl, confirmDeleteProject as confirmDeleteProjectImpl, confirmBulkDeleteChats as confirmBulkDeleteChatsImpl } from "./state/projectActions";
import { isChatSending as isChatSendingImpl, isAnyChatSending as isAnyChatSendingImpl, getSendingChatIds as getSendingChatIdsImpl, setChatSending as setChatSendingImpl, getActiveGenerationByRequest as getActiveGenerationByRequestImpl, getActiveGenerationByMessage as getActiveGenerationByMessageImpl, createActiveGeneration as createActiveGenerationImpl, setActiveGenerationTarget as setActiveGenerationTargetImpl, isRequestInactive as isRequestInactiveImpl, finishActiveGeneration as finishActiveGenerationImpl, handleStopGeneration as handleStopGenerationImpl, stopActiveGeneration as stopActiveGenerationImpl, stopStreamingMessage as stopStreamingMessageImpl, stopStaleStreamingMessages as stopStaleStreamingMessagesImpl, stopStreamingAssistantMessage as stopStreamingAssistantMessageImpl, completeActiveProgress as completeActiveProgressImpl, preserveQueuedMessagesForSnapshot as preserveQueuedMessagesForSnapshotImpl, restoreChatSnapshot as restoreChatSnapshotImpl, updateQueuedChatSends as updateQueuedChatSendsImpl, scheduleGeneratedChatTitle as scheduleGeneratedChatTitleImpl, applyGeneratedChatTitle as applyGeneratedChatTitleImpl, shouldPreserveExistingTitleAfterUserEdit as shouldPreserveExistingTitleAfterUserEditImpl, enqueueChatSend as enqueueChatSendImpl, handleDeleteQueuedMessage as handleDeleteQueuedMessageImpl, handleHoldQueuedMessage as handleHoldQueuedMessageImpl, handleUpdateQueuedMessage as handleUpdateQueuedMessageImpl, handleEditUserMessageAndRegenerate as handleEditUserMessageAndRegenerateImpl, handleSteerQueuedMessage as handleSteerQueuedMessageImpl } from "./chat/generationQueue";
import { steerActiveResponse as steerActiveResponseImpl, createMessagesForProvider as createMessagesForProviderImpl, createChatToolSelectionPrompt as createChatToolSelectionPromptImpl, referencesSelectedWorkspaceForToolSelection as referencesSelectedWorkspaceForToolSelectionImpl, resolveChatResearchReferences as resolveChatResearchReferencesImpl, getChatResearchCandidates as getChatResearchCandidatesImpl, createChatResearchContextMessages as createChatResearchContextMessagesImpl, createActiveProjectBoundaryMessage as createActiveProjectBoundaryMessageImpl, createMemorySearchForRequest as createMemorySearchForRequestImpl, clampMemoryToolInteger as clampMemoryToolIntegerImpl, limitMemoryToolContent as limitMemoryToolContentImpl, rememberProjectMapSnapshot as rememberProjectMapSnapshotImpl, loadToolMemoryForProject as loadToolMemoryForProjectImpl, saveToolMemoryForProject as saveToolMemoryForProjectImpl, createToolMemoryScope as createToolMemoryScopeImpl, getEnabledWorkspaceRoots as getEnabledWorkspaceRootsImpl, rememberProjectToolMemoryFromBridgeRun as rememberProjectToolMemoryFromBridgeRunImpl, rememberProjectToolMemoryFromChatToolCalls as rememberProjectToolMemoryFromChatToolCallsImpl, getToolMemoryProjectName as getToolMemoryProjectNameImpl, createSourceControlContextMessages as createSourceControlContextMessagesImpl, shouldSkipLocalContextForGithub as shouldSkipLocalContextForGithubImpl, createLocalWorkspaceContextMessages as createLocalWorkspaceContextMessagesImpl, hasAnyLocalWorkspaceToolEnabled as hasAnyLocalWorkspaceToolEnabledImpl, getAutomaticWorkspaceContextCharBudget as getAutomaticWorkspaceContextCharBudgetImpl, syncLocalWorkspaceIndexSummary as syncLocalWorkspaceIndexSummaryImpl } from "./context/messageContext";
import { compactProviderMessages as compactProviderMessagesImpl, resolveContextWindowForModel as resolveContextWindowForModelImpl, getManualModelBudgetOverride as getManualModelBudgetOverrideImpl, getConfiguredContextWindow as getConfiguredContextWindowImpl, createContextBoundLocalToolExecutionPolicy as createContextBoundLocalToolExecutionPolicyImpl, getModelVisibleToolResultCharBudget as getModelVisibleToolResultCharBudgetImpl, minNullableCharCap as minNullableCharCapImpl, getProviderCompactionBaseline as getProviderCompactionBaselineImpl, recordContextCompaction as recordContextCompactionImpl, createContextCompactionProgress as createContextCompactionProgressImpl, withContextCompactionProgress as withContextCompactionProgressImpl, withContextCompactionMarker as withContextCompactionMarkerImpl, createChatContextCompaction as createChatContextCompactionImpl, getContextCompactionMarkerKey as getContextCompactionMarkerKeyImpl, recordProviderContextUsage as recordProviderContextUsageImpl, recordProviderActualUsage as recordProviderActualUsageImpl, estimateProviderContextUsageForDisplay as estimateProviderContextUsageForDisplayImpl, createProviderPayloadGuardrailProgress as createProviderPayloadGuardrailProgressImpl, withProviderPayloadGuardrailProgress as withProviderPayloadGuardrailProgressImpl, recordPlanningProviderRequest as recordPlanningProviderRequestImpl, recordPlanningProviderUsage as recordPlanningProviderUsageImpl, createChatProviderSettings as createChatProviderSettingsImpl, createToolAwareProviderSettings as createToolAwareProviderSettingsImpl, createPromptAwareProviderSettings as createPromptAwareProviderSettingsImpl, hasRequestScopedWorkspaceToolsEnabled as hasRequestScopedWorkspaceToolsEnabledImpl, createPromptAwareThinkingSettings as createPromptAwareThinkingSettingsImpl, shouldUseLighterThinkingForPrompt as shouldUseLighterThinkingForPromptImpl, createFinalOnlyProviderSettings as createFinalOnlyProviderSettingsImpl, rememberSessionApprovalDecision as rememberSessionApprovalDecisionImpl, createRuntimeApprovalDecisions as createRuntimeApprovalDecisionsImpl, getRuntimeWebSearchMaxResults as getRuntimeWebSearchMaxResultsImpl, getRuntimeWebSearchSettings as getRuntimeWebSearchSettingsImpl, supportsProviderParallelToolCalls as supportsProviderParallelToolCallsImpl, createLocationAwareWebSearchSettings as createLocationAwareWebSearchSettingsImpl } from "./context/contextWindow";
import { createAppAgentToolCall as createAppAgentToolCallImpl, appendAgentRuntimeStep as appendAgentRuntimeStepImpl, completeLatestAgentRuntimeStep as completeLatestAgentRuntimeStepImpl, mapAgentDecisionToStepType as mapAgentDecisionToStepTypeImpl, runAppOwnedCodingAgent as runAppOwnedCodingAgentImpl } from "./agentRuntime/appAgentRunner";
import { streamAssistantWithLocalTools as streamAssistantWithLocalToolsImpl } from "./tools/localToolStreaming";
import { createToolFinalAnswerUnavailableMessage as createToolFinalAnswerUnavailableMessageImpl, createSynthesisRecoveryFallback as createSynthesisRecoveryFallbackImpl, summarizeUserFacingFailure as summarizeUserFacingFailureImpl, createRecoverableBridgeToolRetryInstruction as createRecoverableBridgeToolRetryInstructionImpl, getToolCallRawOutput as getToolCallRawOutputImpl, extractSuggestedFileReadCandidates as extractSuggestedFileReadCandidatesImpl, extractNearbyPathCandidates as extractNearbyPathCandidatesImpl, extractSuggestedFileSearchQuery as extractSuggestedFileSearchQueryImpl, isMissingFileReadToolCall as isMissingFileReadToolCallImpl, isMissingFileReadError as isMissingFileReadErrorImpl, extractMissingReadPath as extractMissingReadPathImpl, extractToolInputPath as extractToolInputPathImpl, createMissingReadSearchQuery as createMissingReadSearchQueryImpl, getLastPathSegment as getLastPathSegmentImpl, isRecoverableBridgeArgumentError as isRecoverableBridgeArgumentErrorImpl, summarizeCompletedToolFallback as summarizeCompletedToolFallbackImpl, shouldKeepToolOutputOutOfChat as shouldKeepToolOutputOutOfChatImpl, countTextLines as countTextLinesImpl, limitFallbackToolOutput as limitFallbackToolOutputImpl, createGitToolFallbackAnswer as createGitToolFallbackAnswerImpl, parseGitStatusFallbackFiles as parseGitStatusFallbackFilesImpl, parseGitDiffStatFallbackFiles as parseGitDiffStatFallbackFilesImpl, extractToolStdout as extractToolStdoutImpl, cleanGitFallbackPath as cleanGitFallbackPathImpl, dedupeGitFallbackFiles as dedupeGitFallbackFilesImpl, groupGitStatusFallbackFiles as groupGitStatusFallbackFilesImpl, formatGitStatusFallbackGroup as formatGitStatusFallbackGroupImpl, formatGitStatSuffix as formatGitStatSuffixImpl, createNoExecutedToolFinalInstruction as createNoExecutedToolFinalInstructionImpl, createNoExecutedToolFinalAnswer as createNoExecutedToolFinalAnswerImpl, extractFirstUnsuccessfulToolSection as extractFirstUnsuccessfulToolSectionImpl, summarizeUnsuccessfulToolSection as summarizeUnsuccessfulToolSectionImpl, stripToolSectionHeader as stripToolSectionHeaderImpl, stripToolAdaptationRecommendation as stripToolAdaptationRecommendationImpl, appendAutoCompactionContinuation as appendAutoCompactionContinuationImpl, isAutoCompactionContinuationMessage as isAutoCompactionContinuationMessageImpl } from "./tools/toolFallbacks";
import { runParallelSubagents as runParallelSubagentsImpl, streamProviderMessageWithRetry as streamProviderMessageWithRetryImpl, runProviderRetryWithTimeout as runProviderRetryWithTimeoutImpl, createProviderRetryInstruction as createProviderRetryInstructionImpl, isRetryableProviderMessageError as isRetryableProviderMessageErrorImpl, hasLocalToolEvidence as hasLocalToolEvidenceImpl, createEmptyResponseRetrySettings as createEmptyResponseRetrySettingsImpl, updateGeneratedMessage as updateGeneratedMessageImpl, preserveVisibleResponseThinking as preserveVisibleResponseThinkingImpl, createInterruptedResponseContextMessages as createInterruptedResponseContextMessagesImpl, createSteeringInstruction as createSteeringInstructionImpl, withSteeringProgress as withSteeringProgressImpl, removeSteeringProgress as removeSteeringProgressImpl } from "./providers/providerStreaming";
import { handleDiscordInteraction as handleDiscordInteractionImpl, resolveDiscordSourceChat as resolveDiscordSourceChatImpl, findLatestDiscordConversationChat as findLatestDiscordConversationChatImpl, discordSourceMatchesInteraction as discordSourceMatchesInteractionImpl, createDiscordMessageSource as createDiscordMessageSourceImpl, isDiscordNewChatCommand as isDiscordNewChatCommandImpl, normalizeDiscordCommandName as normalizeDiscordCommandNameImpl, resolveDiscordChatProject as resolveDiscordChatProjectImpl, sendDiscordReply as sendDiscordReplyImpl, createDiscordResponseStreamer as createDiscordResponseStreamerImpl } from "./discord/discordActions";
import { handleSendMessage as handleSendMessageImpl, startSendMessage as startSendMessageImpl } from "./chat/sendActions";
import { handleResolveToolApproval as handleResolveToolApprovalImpl } from "./tools/approvalActions";
import { handleSubmitPlanningInput as handleSubmitPlanningInputImpl, handleRequestPlanRevision as handleRequestPlanRevisionImpl } from "./chat/planningActions";
import { handleRegenerateResponse as handleRegenerateResponseImpl } from "./chat/regenerateActions";
import { renderUtilityPage as renderUtilityPageImpl, renderChatPage as renderChatPageImpl, handleSkipOnboarding as handleSkipOnboardingImpl, handleNeverShowOnboarding as handleNeverShowOnboardingImpl, handleOpenOnboardingSettings as handleOpenOnboardingSettingsImpl, handleOpenProviderConnectionNineRouterSettings as handleOpenProviderConnectionNineRouterSettingsImpl, handleOpenProviderConnectionKeySettings as handleOpenProviderConnectionKeySettingsImpl, handleRouteChange as handleRouteChangeImpl, handleSettingsSectionChange as handleSettingsSectionChangeImpl } from "./routes/renderRoutes";

const AppsPage = lazy(() => import("../../pages/apps/AppsPage").then((module) => ({ default: module.AppsPage })));
const SettingsPage = lazy(() => import("../../pages/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const SupportPage = lazy(() => import("../../pages/SupportPage").then((module) => ({ default: module.SupportPage })));
const WeatherRadarPage = lazy(() => import("../../pages/WeatherRadarPage").then((module) => ({ default: module.WeatherRadarPage })));

export interface ActiveGeneration {
  chatId: string;
  controller: AbortController;
  messageId?: string;
  previousChat: ChatSummary;
  previousChatExisted: boolean;
  requestId: number;
  restoreDraft?: ChatComposerDraft;
}

export interface QueuedChatSend {
  chatId: string;
  held?: boolean;
  id: string;
  input: ChatSendInput;
  userMessageId: string;
}

export interface ComposerDraftRestoreRequest {
  draft: ChatComposerDraft;
  id: string;
}

export interface DiscordReplyTarget {
  applicationId: string;
  channelId?: string | null;
  interactionId: string;
  token: string;
  username?: string | null;
}

export interface StartSendMessageOptions {
  discordReply?: DiscordReplyTarget;
  preserveExistingTitle?: boolean;
  sourceChat?: ChatSummary;
  userMessageSource?: ChatMessage["source"];
}

export interface DiscordStreamUpdate {
  content?: string;
  progress?: ChatProgressItem;
  sources?: ChatSource[];
  status?: string;
  toolCall?: ChatToolCall;
}

export interface AssistantToolResponse {
  approvalRequests?: AgentApproval[];
  artifacts?: ChatArtifact[];
  content: string;
  pendingToolCallContent?: string;
  progress?: ChatProgressItem;
  sources?: ChatSource[];
  toolCalls?: ChatToolCall[];
  waitingForApproval?: boolean;
}

export interface ApprovedPlanExecutionContext {
  originalPrompt: string;
  planContent: string;
  requiresMutation: boolean;
}

export type SessionApprovalDecisionMap = Record<string, AgentApprovalDecision>;
export type SessionApprovalDecisionsByWorkspace = Record<string, SessionApprovalDecisionMap>;

const MAX_PLANNING_INPUT_ROUNDS = 3;
const PINNED_MODEL_IDS = CHAT_MODEL_OPTIONS.map((option) => option.value);
const LOCAL_TOOL_FINAL_MIN_TOKENS = 4096;
const MAX_LOCAL_TOOL_PASSES = 12;
const MAX_LOCAL_TOOL_EXECUTIONS = 48;
const MAX_TOOL_FINALIZATION_RETRIES = 3;
const MAX_MALFORMED_TOOL_RECOVERY_RETRIES = 2;
const MAX_RECOVERABLE_LOCAL_EDIT_RETRIES = 4;
const MESSAGE_RETRY_TIMEOUT_MS = 10_000;
const CONTEXT_COMPACTION_PROGRESS_ID = "context-compaction";
const PROVIDER_PAYLOAD_GUARDRAIL_PROGRESS_ID = "provider-payload-guardrail";
const BRIDGE_TOOL_APPROVAL_RESUME_KIND = "bridge_tool_calls";
const DISCORD_NEW_CHAT_COMMAND = "gilbertnewchat";
const DISCORD_STREAM_UPDATE_INTERVAL_MS = 2_400;
const DISCORD_STREAM_MESSAGE_LIMIT = 1_850;
const STEERING_PROGRESS_ID = "response-steering";
const ONBOARDING_NEVER_SHOW_KEY = "gilbert-codex.onboarding.never-show.v1";
const LAST_ACTIVE_PROJECT_KEY = "gilbert-codex.last-active-project.v1";
const SIMPLE_THINKING_PROMPT_MAX_WORDS = 18;
const SIMPLE_THINKING_PROMPT_PATTERN = /\b(?:answer|change|clean up|explain|fix typo|format|quick|rename|remove|rewrite|show|summarize|tell|translate|update)\b/i;
const COMPLEX_THINKING_PROMPT_PATTERN = /\b(?:all|architecture|audit|build|debug|deep|end[-\s]?to[-\s]?end|entire|every|investigate|migrate|plan|publish|refactor|release|research|review|security|test|verify)\b/i;
const PENDING_CHAT_TITLE = "Naming chat...";
const DURABLE_MEMORY_PERSIST_DELAY_MS = 350;
const DURABLE_MEMORY_BACKFILL_DELAY_MS = 5_000;
const DURABLE_MEMORY_BATCH_DELAY_MS = 700;
const DURABLE_MEMORY_BATCH_SIZE = 1;

function createApprovedPlanExecutionPrompt(originalPrompt: string, planContent: string) {
  return [
    "Execute the approved plan now.",
    `Original request: ${originalPrompt}`,
    "Approved plan:",
    planContent,
  ].join("\n\n");
}

function createApprovedPlanExecutionInstruction(originalPrompt: string, planContent: string) {
  return [
    "APPROVED PLAN EXECUTION CONTRACT",
    `Original request: ${originalPrompt}`,
    "The user approved the plan. This is no longer plan/research mode.",
    "Execute the approved plan now using the app-exposed workspace tools.",
    "Do not answer with a memory-only recap, implementation plan, status summary, or statement that you are missing file access.",
    "Memory search is optional context only; it never satisfies execution. Verify current files with file tools, apply the planned edits, run the relevant checks, and then summarize the real changes.",
    "If a tool call fails because its arguments are malformed, retry with corrected arguments instead of stopping.",
    "If a risky write/terminal action needs approval, request that approval and wait.",
    "",
    "Approved plan:",
    planContent,
  ].join("\n");
}

function approvedPlanRequiresMutation(originalPrompt: string, planContent: string) {
  const text = `${originalPrompt}\n${planContent}`;

  if (/\b(?:no files? to change|no code changes?|read[-\s]?only|analysis only|plan only)\b/i.test(text)) {
    return false;
  }

  return /\b(?:add|append|change|create|delete|edit|fix|implement|insert|move|patch|refactor|remove|rename|replace|update|write|files? to change)\b/i.test(text);
}

function hasSuccessfulApprovedPlanWorkspaceTool(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some((toolCall) => {
    if (toolCall.status !== "complete") {
      return false;
    }

    const toolId = toolCall.toolId ?? "";
    return (
      toolId.startsWith("files_") ||
      toolId.startsWith("git_") ||
      toolId === "terminal_run" ||
      toolId === "browser_preview_open"
    );
  });
}

function hasSuccessfulApprovedPlanMutation(toolCalls: ChatToolCall[] = []) {
  return toolCalls.some((toolCall) => {
    if (toolCall.status !== "complete") {
      return false;
    }

    const toolId = toolCall.toolId ?? "";
    const input = toolCall.input ?? "";
    const dryRun = /"dryRun"\s*:\s*true|dryRun:\s*true/i.test(input);
    const changedFiles = (toolCall.fileChanges?.length ?? 0) > 0 ||
      (toolCall.batchSummary?.successCount ?? 0) > 0 ||
      toolCall.batchFileResults?.some((result) => result.status === "ok");

    if (changedFiles && !dryRun) {
      return true;
    }

    return (
      !dryRun &&
      /^(?:files_(?:append|apply_patch|create_directory|edit_many|exact_replace|insert_at_line|move|replace_range|write|write_many)|git_(?:branch|commit|stage))$/.test(toolId)
    );
  });
}

function createApprovedPlanExecutionRetryInstruction(context: ApprovedPlanExecutionContext, attemptedAnswer: string, toolCalls: ChatToolCall[] = []) {
  const hasWorkspaceTool = hasSuccessfulApprovedPlanWorkspaceTool(toolCalls);
  const hasMutation = hasSuccessfulApprovedPlanMutation(toolCalls);
  const excerpt = attemptedAnswer.replace(/\s+/g, " ").trim().slice(0, 700);

  return [
    "APPROVED PLAN EXECUTION NOT COMPLETE",
    `Original request: ${context.originalPrompt}`,
    "The user approved the plan, so a descriptive recap is not an acceptable final answer.",
    !hasWorkspaceTool
      ? "No successful current workspace file/edit/terminal/browser/git tool call has run yet in this execution pass."
      : context.requiresMutation && !hasMutation
        ? "Current workspace tools have run, but no successful file/edit/write mutation from the approved plan is recorded yet."
        : "",
    "Continue executing the approved plan with the real app-exposed tools now. Prefer files_read_many/files_search/files_list for current source, files_create_directory for folders, files_edit_many/files_apply_patch/files_write_many for changes, and terminal_run with cwd/workingDirectory for verification.",
    "Do not use memory_search as a substitute for current source. Do not say you lack file access while workspace tools are attached.",
    excerpt ? `Rejected non-execution answer excerpt: ${excerpt}` : "",
    "",
    "Approved plan:",
    context.planContent,
  ].filter(Boolean).join("\n\n");
}

function createApprovedPlanExecutionFailedAnswer(context: ApprovedPlanExecutionContext, toolCalls: ChatToolCall[] = []) {
  const hasWorkspaceTool = hasSuccessfulApprovedPlanWorkspaceTool(toolCalls);
  const hasMutation = hasSuccessfulApprovedPlanMutation(toolCalls);

  return [
    "I could not start the approved plan execution cleanly.",
    !hasWorkspaceTool
      ? "The model did not produce a successful current workspace tool call after the plan was approved."
      : context.requiresMutation && !hasMutation
        ? "The model inspected tools but did not produce a successful file edit/write from the approved plan."
        : "",
    "No file changes were applied from that approved plan.",
  ].filter(Boolean).join("\n\n");
}

export interface InitialChatState {
  activeChatId: string;
  chats: ChatSummary[];
}

function loadInitialChatState(): InitialChatState {
  const durableChats = sortChatsByUpdatedAt(loadChats().filter((chat) => !isDiscardableEmptyChat(chat)));
  const hashChatId = getChatIdFromLocationHash();
  const hashChat = hashChatId ? durableChats.find((chat) => chat.id === hashChatId && !chat.archived) : undefined;

  if (hashChat) {
    return {
      activeChatId: hashChat.id,
      chats: durableChats,
    };
  }

  const storedActiveChatId = loadActiveChatId();
  const storedActiveChat = durableChats.find((chat) => chat.id === storedActiveChatId && !chat.archived);

  if (storedActiveChat) {
    return {
      activeChatId: storedActiveChat.id,
      chats: durableChats,
    };
  }

  const lastProjectName = normalizeProjectName(loadPersistentString(LAST_ACTIVE_PROJECT_KEY) || durableChats.find((chat) => !chat.archived)?.project || DEFAULT_PROJECT);
  const startupChat = createEmptyChat(lastProjectName);

  return {
    activeChatId: startupChat.id,
    chats: sortChatsByUpdatedAt([startupChat, ...durableChats]),
  };
}

function pruneEmptyChats(chats: ChatSummary[], keepChatId?: string) {
  return chats.filter((chat) => chat.id === keepChatId || !isDiscardableEmptyChat(chat));
}

function sameProjectName(left?: string | null, right?: string | null) {
  return normalizeProjectName(left).toLowerCase() === normalizeProjectName(right).toLowerCase();
}

function sameComposerDraft(left?: ChatComposerDraft | null, right?: ChatComposerDraft | null) {
  const normalizedLeft = hasComposerDraftContent(left) ? left : null;
  const normalizedRight = hasComposerDraftContent(right) ? right : null;

  if (!normalizedLeft && !normalizedRight) {
    return true;
  }

  if (!normalizedLeft || !normalizedRight) {
    return false;
  }

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function createNoProjectWorkspace(current?: LocalWorkspaceSettings): LocalWorkspaceSettings {
  if (current?.enabled && current.scope === "full-computer") {
    return current;
  }

  return {
    enabled: false,
    indexReason: undefined,
    indexSummary: undefined,
    indexStatus: "idle",
    indexUpdatedAt: undefined,
    lastError: undefined,
    permissionMode: current?.permissionMode ?? "default",
    roots: [],
    scope: "selected-folder",
  };
}

function createApprovalWorkspaceSessionKey(settings: LocalWorkspaceSettings) {
  const roots = settings.roots.map((root) => root.trim().replace(/[\\/]+$/, "")).filter(Boolean).sort();

  return JSON.stringify({
    enabled: settings.enabled,
    roots,
    scope: settings.scope,
  });
}

function createLocationAwareToolSettings(tools: unknown, locationServicesEnabled: boolean): ToolRegistrySettings {
  const normalizedTools = normalizeToolRegistrySettings(tools);

  return {
    ...normalizedTools,
    weatherTools: locationServicesEnabled && normalizedTools.weatherTools,
  };
}

function shouldOpenProviderConnectionDialog(settings: ProviderSettings) {
  if (settings.provider === NINE_ROUTER_PROVIDER_ID || settings.provider === "openrouter") {
    return false;
  }

  return !getProviderApiKey(settings).trim();
}

function isSubscriptionRouteModel(model: string | undefined) {
  const normalizedModel = model?.trim().toLowerCase() ?? "";

  return Boolean(
    normalizedModel &&
    (
      normalizedModel.startsWith("cx/") ||
      normalizedModel.startsWith("gh/") ||
      normalizedModel.startsWith("github/") ||
      normalizedModel.startsWith("github-copilot/") ||
      normalizedModel.startsWith("github_copilot/") ||
      isNineRouterCodexModelId(normalizedModel) ||
      isNineRouterGithubCopilotModelId(normalizedModel)
    ),
  );
}

function createDiscordRuntimeContextMessages(workspaceSettings: LocalWorkspaceSettings, webSearchToolAvailable: boolean, webSearchProvider: WebSearchSettings["provider"]) {
  const providerLabel = formatWebSearchProviderLabel(webSearchProvider);

  return [
    createMessage(
      "user",
      [
        "DISCORD REMOTE REQUEST CONTEXT",
        "The latest user message came from Discord through Gilbert's signed bridge. Treat it like a normal Gilbert Codex app request.",
        "Use only app-exposed provider tools that are attached to this request. Do not invent visible terminal, Git, file, browser preview, MCP, workflow, or weather actions.",
        workspaceSettings.enabled
          ? "Local workspace metadata may be attached as host-provided context; use actual tool results when precise file, Git, terminal, or preview evidence is required."
          : "No local folder is selected for this request.",
        webSearchToolAvailable
          ? `The web_search tool may be attached with ${providerLabel}. Call it only when current, latest, date-sensitive, source-backed, or official web evidence is actually needed.`
          : "Web search is disabled for this turn. If current, latest, date-sensitive, or source-backed facts are needed, say what could not be verified instead of inventing a search.",
      ].join("\n"),
    ),
  ];
}

interface WorkspaceAppProps {
  authSession: AuthSession;
  onLogout: () => void;
}

export function WorkspaceApp({ authSession, onLogout }: WorkspaceAppProps) {
  const initialChatStateRef = useRef<InitialChatState | null>(null);
  if (!initialChatStateRef.current) {
    initialChatStateRef.current = loadInitialChatState();
  }

  const [activeRoute, setActiveRoute] = useState<PrimaryRoute>("chat");
  const [chats, setChatsState] = useState<ChatSummary[]>(() => initialChatStateRef.current?.chats ?? [createEmptyChat(DEFAULT_PROJECT)]);
  const [projects, setProjects] = useState<ProjectSummary[]>(() => mergeProjectsWithChats(loadProjects(), initialChatStateRef.current?.chats ?? []));
  const [activeChatId, setActiveChatId] = useState(() => initialChatStateRef.current?.activeChatId ?? "");
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(() => loadProviderSettings());
  const [discordBridgeSettings, setDiscordBridgeSettings] = useState<DiscordBridgeSettings>(() => loadDiscordBridgeSettings());
  const [localWorkspace, setLocalWorkspace] = useState<LocalWorkspaceSettings>(() => loadLocalWorkspaceSettings());
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(() => loadAppearanceMode());
  const [personalizationSettings, setPersonalizationSettings] = useState<AppPersonalizationSettings>(() => loadAppPersonalizationSettings());
  const [appInfo, setAppInfo] = useState<AppInfo>({
    name: "Gilbert Codex",
    phase: "Public alpha",
    runtime: isTauriDesktopRuntime() ? "Tauri desktop" : "Frontend preview",
    version: "0.2.3",
  });
  const [sendingChatIds, setSendingChatIds] = useState<string[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSettingsSection, setActiveSettingsSection] = useState<SettingsSectionId>("general");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalAttachedSession, setTerminalAttachedSession] = useState<TerminalAttachedSession | null>(null);
  const [browserPreviewTarget, setBrowserPreviewTarget] = useState<{ id: number; url: string } | null>(null);
  const [terminalHeight, setTerminalHeight] = useState(284);
  const [defaultTerminalWorkingDirectory, setDefaultTerminalWorkingDirectory] = useState("");
  const [aboutOpen, setAboutOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => loadPersistentString(ONBOARDING_NEVER_SHOW_KEY) !== "true");
  const [providerConnectionOpen, setProviderConnectionOpen] = useState(() => shouldOpenProviderConnectionDialog(providerSettings));
  const [noticeDialog, setNoticeDialog] = useState<{ description?: string; title: string } | null>(null);
  const [renameChatId, setRenameChatId] = useState<string | null>(null);
  const [renameChatTitle, setRenameChatTitle] = useState("");
  const [renameChatError, setRenameChatError] = useState<string | null>(null);
  const [pendingDeleteChatId, setPendingDeleteChatId] = useState<string | null>(null);
  const [pendingDeleteProjectName, setPendingDeleteProjectName] = useState<string | null>(null);
  const [bulkDeleteChatsOpen, setBulkDeleteChatsOpen] = useState(false);
  const [bulkDeleteChatIds, setBulkDeleteChatIds] = useState<string[]>([]);
  const [composerDraftToRestore, setComposerDraftToRestore] = useState<ComposerDraftRestoreRequest | null>(null);
  const [contextWindow, setContextWindow] = useState<{ source: "estimate" | "openrouter" | "provider"; tokens: number }>(() => ({
    source: "estimate",
    tokens: getFallbackContextWindowTokens(providerSettings.model),
  }));
  const [modelContextWindows, setModelContextWindows] = useState<ModelContextWindowMap>(() =>
    getFallbackModelContextWindows([...PINNED_MODEL_IDS, providerSettings.model]),
  );
  const [lastProviderContextUsage, setLastProviderContextUsage] = useState<{ chatId: string; compactedMessageCount: number; usage: ContextWindowUsage } | null>(null);
  const [lastContextCompaction, setLastContextCompaction] = useState<ContextCompactionNotice | null>(null);
  // Mirrors of contextWindow / modelContextWindows so long-running async work
  // (tool-call loops, streaming responses, follow-up compactions) always
  // reads the latest resolved values instead of the snapshot captured when
  // the request was kicked off.
  const contextWindowRef = useRef(contextWindow);
  const lastProviderContextUsageRef = useRef(lastProviderContextUsage);
  const modelContextWindowsRef = useRef(modelContextWindows);
  useEffect(() => {
    contextWindowRef.current = contextWindow;
  }, [contextWindow]);
  useEffect(() => {
    lastProviderContextUsageRef.current = lastProviderContextUsage;
  }, [lastProviderContextUsage]);
  useEffect(() => {
    modelContextWindowsRef.current = modelContextWindows;
  }, [modelContextWindows]);
  const [queuedChatSends, setQueuedChatSends] = useState<QueuedChatSend[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRun[]>([]);
  const isDesktopRuntime = isTauriDesktopRuntime() || appInfo.runtime.toLowerCase().includes("tauri");
  const locationServicesEnabled = personalizationSettings.locationServicesEnabled;
  const toolSettings = createLocationAwareToolSettings(providerSettings.tools, locationServicesEnabled);
  const activeSendRef = useRef(0);
  const activeGenerationsRef = useRef(new Map<string, ActiveGeneration>());
  const activeRequestChatIdsRef = useRef(new Map<number, string>());
  const discordAutoStartKeyRef = useRef<string | null>(null);
  const discordBridgeSettingsRef = useRef(discordBridgeSettings);
  const titleGenerationRequestsRef = useRef(new Map<string, AbortController>());
  const activeChatIdRef = useRef(activeChatId);
  const localWorkspaceRef = useRef(localWorkspace);
  const projectsRef = useRef<ProjectSummary[]>(projects);
  const pendingChatsRef = useRef<ChatSummary[]>(chats);
  const agentRunsRef = useRef<AgentRun[]>([]);
  const queuedChatSendsRef = useRef<QueuedChatSend[]>([]);
  const queuedStartersRef = useRef(new Set<string>());
  const sessionApprovalDecisionsRef = useRef<SessionApprovalDecisionsByWorkspace>({});
  const chatMemoryFingerprintsRef = useRef(new Map<string, string>());
  const runtime = {} as WorkspaceRuntimeDeps;
  const durableMemoryBackfillTimerRef = useRef<number | null>(null);
  const durableMemoryFlushTimerRef = useRef<number | null>(null);
  const pendingDurableMemoryChatIdsRef = useRef(new Set<string>());
  const priorityDurableMemoryChatIdsRef = useRef(new Set<string>());
  function persistChatState(nextChats: ChatSummary[], previousChats: ChatSummary[] = pendingChatsRef.current) {
    return (persistChatStateImpl as any)(runtime, nextChats, previousChats);
  }

  function setChats(update: SetStateAction<ChatSummary[]>) {
    return (setChatsImpl as any)(runtime, update);
  }

  function handleComposerDraftChange(chatId: string, draft: ChatComposerDraft | null) {
    return (handleComposerDraftChangeImpl as any)(runtime, chatId, draft);
  }

  function queueDurableMemoryForChangedChats(nextChats: ChatSummary[], previousChats: ChatSummary[]) {
    return (queueDurableMemoryForChangedChatsImpl as any)(runtime, nextChats, previousChats);
  }

  function queueDurableMemoryForChatIds(chatIds: string[], delayMs = DURABLE_MEMORY_PERSIST_DELAY_MS, priority = false) {
    return (queueDurableMemoryForChatIdsImpl as any)(runtime, chatIds, delayMs, priority);
  }

  function scheduleDurableMemoryFlush(delayMs: number) {
    return (scheduleDurableMemoryFlushImpl as any)(runtime, delayMs);
  }

  function flushDurableMemoryQueue() {
    return (flushDurableMemoryQueueImpl as any)(runtime);
  }

  function takeNextDurableMemoryChatId() {
    return (takeNextDurableMemoryChatIdImpl as any)(runtime);
  }

  function persistDurableMemoryForChatId(chatId: string) {
    return (persistDurableMemoryForChatIdImpl as any)(runtime, chatId);
  }


  useEffect(() => {
    return () => {
      if (durableMemoryBackfillTimerRef.current !== null) {
        window.clearTimeout(durableMemoryBackfillTimerRef.current);
      }
      if (durableMemoryFlushTimerRef.current !== null) {
        window.clearTimeout(durableMemoryFlushTimerRef.current);
      }

      for (const activeGeneration of activeGenerationsRef.current.values()) {
        activeGeneration.controller.abort();
      }
      activeGenerationsRef.current.clear();
      activeRequestChatIdsRef.current.clear();
      queuedChatSendsRef.current = [];
      queuedStartersRef.current.clear();

      for (const controller of titleGenerationRequestsRef.current.values()) {
        controller.abort();
      }

      titleGenerationRequestsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    durableMemoryBackfillTimerRef.current = window.setTimeout(() => {
      queueDurableMemoryForChatIds(
        pendingChatsRef.current
          .filter((chat) => !isEmptyChat(chat))
          .map((chat) => chat.id),
        DURABLE_MEMORY_BATCH_DELAY_MS,
        false,
      );
    }, DURABLE_MEMORY_BACKFILL_DELAY_MS);

    return () => {
      if (durableMemoryBackfillTimerRef.current !== null) {
        window.clearTimeout(durableMemoryBackfillTimerRef.current);
        durableMemoryBackfillTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return scheduleIdleTask(() => {
      void getAppInfo().then(setAppInfo);
    }, 500);
  }, []);

  useEffect(() => {
    let mounted = true;
    const cancelIdleLoad = scheduleIdleTask(() => {
      void listAgentRuns().then(async (storedRuns) => {
        if (!mounted) {
          return;
        }

        const now = new Date().toISOString();
        const recoveredRuns = storedRuns.map((run) => recoverInterruptedAgentRun(run, now));
        agentRunsRef.current = recoveredRuns;
        setAgentRuns(recoveredRuns);

        await Promise.all(
          recoveredRuns
            .filter((run, index) => run !== storedRuns[index])
            .map((run) => saveAgentRun(run).catch(() => undefined)),
        );
      });
    }, 1_200);

    return () => {
      mounted = false;
      cancelIdleLoad();
    };
  }, []);

  useEffect(() => {
    agentRunsRef.current = agentRuns;
  }, [agentRuns]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    return scheduleIdleTask(() => {
      void prepareDesktopNotifications();
    }, 3_000);
  }, [isDesktopRuntime]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let disposed = false;
    const cancelIdleLoad = scheduleIdleTask(() => {
      void getDefaultTerminalWorkingDirectory()
        .then((path) => {
          if (!disposed) {
            setDefaultTerminalWorkingDirectory(path);
          }
        })
        .catch(() => undefined);
    }, 900);

    return () => {
      disposed = true;
      cancelIdleLoad();
    };
  }, [isDesktopRuntime]);

  useEffect(() => {
    if (pendingChatsRef.current !== chats) {
      persistChatState(chats);
    }
  }, [chats]);

  useEffect(() => {
    queuedChatSendsRef.current = queuedChatSends;
  }, [queuedChatSends]);

  useEffect(() => {
    if (queuedChatSends.length === 0 || !toolSettings.provider) {
      return;
    }

    const startingChatIds = new Set<string>();
    const queuedSendsToStart: QueuedChatSend[] = [];

    for (const queuedSend of queuedChatSends) {
      if (queuedSend.held || activeGenerationsRef.current.has(queuedSend.chatId) || startingChatIds.has(queuedSend.chatId) || queuedStartersRef.current.has(queuedSend.id)) {
        continue;
      }

      startingChatIds.add(queuedSend.chatId);
      queuedSendsToStart.push(queuedSend);
    }

    if (queuedSendsToStart.length === 0) {
      return;
    }

    const startingIds = new Set(queuedSendsToStart.map((queuedSend) => queuedSend.id));

    for (const queuedSend of queuedSendsToStart) {
      queuedStartersRef.current.add(queuedSend.id);
    }

    setQueuedChatSends((currentQueue) => {
      const nextQueue = currentQueue.filter((queuedSend) => !startingIds.has(queuedSend.id));
      queuedChatSendsRef.current = nextQueue;
      return nextQueue;
    });

    for (const queuedSend of queuedSendsToStart) {
      void startSendMessage(queuedSend.input, {
        chatId: queuedSend.chatId,
        queuedMessageId: queuedSend.userMessageId,
      }).finally(() => {
        queuedStartersRef.current.delete(queuedSend.id);
      });
    }
  }, [queuedChatSends, sendingChatIds, toolSettings.provider]);

  useEffect(() => {
    function savePendingChats() {
      persistChatState(pendingChatsRef.current);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        savePendingChats();
      }
    }

    window.addEventListener("pagehide", savePendingChats);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pagehide", savePendingChats);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    projectsRef.current = projects;
    saveProjects(projects);
  }, [projects]);

  useEffect(() => {
    saveProviderSettings(providerSettings);
  }, [providerSettings]);

  useEffect(() => {
    saveAppPersonalizationSettings(personalizationSettings);
  }, [personalizationSettings]);

  useEffect(() => {
    if (locationServicesEnabled) {
      return;
    }

    if (activeRoute === "radar") {
      setActiveRoute("chat");
      setNoticeDialog({
        description: "Weather, radar, Mapbox weather settings, and location-based refreshes stay hidden while location services are off. Turn them back on in Settings > Weather & Maps.",
        title: "Location services are off",
      });
    }

    if (activeSettingsSection === "mapbox") {
      setActiveSettingsSection("weatherSources");
    }
  }, [activeRoute, activeSettingsSection, locationServicesEnabled]);

  useEffect(() => {
    discordBridgeSettingsRef.current = discordBridgeSettings;
    saveDiscordBridgeSettings(discordBridgeSettings);
  }, [discordBridgeSettings]);

  useEffect(() => {
    if (!isDesktopRuntime) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listenForDiscordInteractions((interaction) => {
      if (!disposed) {
        void handleDiscordInteraction(interaction);
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }

      unlisten = nextUnlisten;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [discordBridgeSettings.enabled, discordBridgeSettings.mode, isDesktopRuntime, localWorkspace, providerSettings, toolSettings.provider, toolSettings.webSearch]);

  useEffect(() => {
    if (!isDesktopRuntime || !discordBridgeSettings.enabled || !discordBridgeSettings.autoStartBridge || discordBridgeSettings.mode !== "interactions") {
      return;
    }

    if (!discordBridgeSettings.applicationId.trim() || !discordBridgeSettings.publicKey.trim()) {
      return;
    }

    const autoStartKey = [
      discordBridgeSettings.applicationId,
      discordBridgeSettings.publicKey,
      discordBridgeSettings.bridgePort,
      discordBridgeSettings.tunnelProvider,
      discordBridgeSettings.ngrokPath,
      discordBridgeSettings.ngrokAuthToken ? "token" : "no-token",
      discordBridgeSettings.responseStyle,
      discordBridgeSettings.allowedGuildIds,
      discordBridgeSettings.allowedChannelIds,
    ].join("|");

    if (discordAutoStartKeyRef.current === autoStartKey) {
      return;
    }

    discordAutoStartKeyRef.current = autoStartKey;

    return scheduleIdleTask(() => {
      void startDiscordBridge({
        allowedChannelIds: discordBridgeSettings.allowedChannelIds,
        allowedGuildIds: discordBridgeSettings.allowedGuildIds,
        applicationId: discordBridgeSettings.applicationId,
        localPort: discordBridgeSettings.bridgePort,
        ngrokAuthToken: discordBridgeSettings.ngrokAuthToken,
        ngrokPath: discordBridgeSettings.ngrokPath,
        publicKey: discordBridgeSettings.publicKey,
        responseStyle: discordBridgeSettings.responseStyle,
        tunnelProvider: discordBridgeSettings.tunnelProvider,
      })
        .then((status) => {
          if (!status.publicUrl) {
            return;
          }

          setDiscordBridgeSettings((currentSettings) => ({
            ...currentSettings,
            interactionsEndpointUrl: status.publicUrl ?? currentSettings.interactionsEndpointUrl,
            publicInteractionsUrl: status.publicUrl ?? currentSettings.publicInteractionsUrl,
          }));
        })
        .catch(() => {
          discordAutoStartKeyRef.current = null;
        });
    }, 1_500);
  }, [discordBridgeSettings, isDesktopRuntime]);

  useEffect(() => {
    localWorkspaceRef.current = localWorkspace;
    saveLocalWorkspaceSettings(localWorkspace);
    return scheduleIdleTask(() => {
      void refreshWorkspaceContext(localWorkspace);
    }, localWorkspace.roots.length > 0 ? 1_500 : 300);
  }, [localWorkspace]);

  useEffect(() => {
    if (!toolSettings.terminal && terminalOpen) {
      setTerminalOpen(false);
    }
  }, [terminalOpen, toolSettings.terminal]);

  useEffect(() => {
    if (!toolSettings.browserPreview) {
      setBrowserPreviewTarget(null);
    }
  }, [toolSettings.browserPreview]);

  const activeChat =
    chats.find((chat) => chat.id === activeChatId && !chat.archived) ??
    chats.find((chat) => !chat.archived) ??
    createEmptyChat(DEFAULT_PROJECT);
  const activeChatProviderSettings = createChatProviderSettings(activeChat);

  useEffect(() => {
    const selectedSettings = activeChatProviderSettings;
    const selectedModel = selectedSettings.model.trim();
    const modelIds = Array.from(new Set([...PINNED_MODEL_IDS, selectedModel].filter(Boolean)));
    const fallbackWindows = getFallbackModelContextWindows(modelIds);
    const manualSelectedOverride = selectedModel ? getManualModelBudgetOverride(selectedSettings, selectedModel) : null;
    const configuredSelectedWindow = selectedModel && manualSelectedOverride?.contextWindowTokens
      ? { maxOutputTokens: manualSelectedOverride.maxOutputTokens, source: "provider" as const, tokens: manualSelectedOverride.contextWindowTokens }
      : selectedModel ? getConfiguredContextWindow(selectedSettings) : null;
    if (selectedModel && configuredSelectedWindow) {
      fallbackWindows[selectedModel] = configuredSelectedWindow;
    }
    const controller = new AbortController();
    const fallbackCandidate = selectedModel
      ? fallbackWindows[selectedModel] ?? getFallbackModelContextWindow(selectedModel)
      : getFallbackModelContextWindow("");

    // Merge with previously-resolved values. A transient settings change
    // (api key edit, baseUrl tweak, sibling provider apiKey added) re-runs
    // this effect; previously we would synchronously overwrite a known-good
    // provider/openrouter value with the static fallback and only restore
    // the real value once the /models round-trip completed. While the fetch
    // was in flight, compaction would evaluate the 80% threshold against
    // the downgraded window, firing far too aggressively. We now preserve
    // any value sourced from the provider until something better is known.
    setModelContextWindows((previousWindows) => {
      const merged: ModelContextWindowMap = { ...fallbackWindows };
      for (const [modelId, existingWindow] of Object.entries(previousWindows)) {
        const fallback = merged[modelId];
        const previousIsBetter =
          existingWindow.source !== "estimate" ||
          (fallback ? existingWindow.tokens > fallback.tokens : true);
        if (previousIsBetter) {
          merged[modelId] = existingWindow;
        } else if (!fallback) {
          merged[modelId] = existingWindow;
        }
      }
      return merged;
    });

    // Same idea for the singular active contextWindow. If we already have
    // a resolved (provider/openrouter) value for the selected model, keep
    // it. If we only have an older estimate but it's larger than the new
    // fallback, keep it (covers releases where the registry hasn't been
    // updated yet). Otherwise show the new fallback.
    const previousWindowForModel = selectedModel ? modelContextWindowsRef.current[selectedModel] : null;
    const initialSelectedWindow =
      previousWindowForModel &&
      (previousWindowForModel.source !== "estimate" || previousWindowForModel.tokens >= fallbackCandidate.tokens)
        ? previousWindowForModel
        : fallbackCandidate;
    setContextWindow(initialSelectedWindow);

    const cancelContextLengthFetch = scheduleIdleTask(() => {
      void fetchProviderModelContextLengths(selectedSettings, modelIds, {
        signal: controller.signal,
      })
        .then((contextLengths) => {
          if (controller.signal.aborted) {
            return;
          }

          setModelContextWindows((previousWindows) => {
            const merged: ModelContextWindowMap = { ...previousWindows };
            for (const [model, tokens] of Object.entries(contextLengths)) {
              if (configuredSelectedWindow && model === selectedModel) {
                merged[model] = configuredSelectedWindow;
                continue;
              }
              const fallbackTokens = fallbackWindows[model]?.tokens ?? 0;
              const providerTokens = Math.max(tokens, fallbackTokens);
              const existing = merged[model];
              if (!existing || providerTokens >= existing.tokens || existing.source === "estimate") {
                merged[model] = { source: "provider", tokens: providerTokens };
              }
            }
            return merged;
          });

          const providerTokensForSelected = contextLengths[selectedModel];
          if (selectedModel && configuredSelectedWindow) {
            setContextWindow(configuredSelectedWindow);
          } else if (selectedModel && typeof providerTokensForSelected === "number" && providerTokensForSelected > 0) {
            const candidateTokens = Math.max(providerTokensForSelected, fallbackCandidate.tokens);
            setContextWindow((current) =>
              candidateTokens >= current.tokens || current.source === "estimate"
                ? { source: "provider", tokens: candidateTokens }
                : current,
            );
          }
        })
        .catch(() => {
          return;
        });
    }, 1_000);

    return () => {
      cancelContextLengthFetch();
      controller.abort();
    };
  }, [
    activeChatProviderSettings.model,
    activeChatProviderSettings.provider,
    activeChatProviderSettings.apiKeys,
    activeChatProviderSettings.baseUrls,
    activeChatProviderSettings.contextWindowTokens,
    activeChatProviderSettings.modelBudgetOverrides,
  ]);

  useEffect(() => {
    saveAppearanceMode(appearanceMode);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");

    function applyAppearance() {
      const resolvedTheme = appearanceMode === "system" ? (mediaQuery.matches ? "light" : "dark") : appearanceMode;
      document.documentElement.dataset.theme = resolvedTheme;
      document.documentElement.dataset.themePreference = appearanceMode;
      document.documentElement.style.colorScheme = resolvedTheme;
    }

    applyAppearance();
    mediaQuery.addEventListener("change", applyAppearance);

    return () => mediaQuery.removeEventListener("change", applyAppearance);
  }, [appearanceMode]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;

    if (activeChatId) {
      saveActiveChatId(activeChatId);
    }
  }, [activeChatId]);

  useEffect(() => {
    if (chats.some((chat) => chat.id === activeChatId && !chat.archived)) {
      return;
    }

    const lastProjectName = normalizeProjectName(loadPersistentString(LAST_ACTIVE_PROJECT_KEY) || chats.find((chat) => !chat.archived)?.project || DEFAULT_PROJECT);
    const nextChat = createEmptyChat(lastProjectName);
    const nextChats = sortChatsByUpdatedAt([nextChat, ...pruneEmptyChats(chats)]);

    pendingChatsRef.current = nextChats;
    setChats(nextChats);
    setActiveChatId(nextChat.id);
  }, [activeChatId, chats]);

  useEffect(() => {
    savePersistentString(LAST_ACTIVE_PROJECT_KEY, normalizeProjectName(activeChat.project));
  }, [activeChat.project]);

  useEffect(() => {
    function selectChatFromHash() {
      const chatId = getChatIdFromLocationHash();

      if (!chatId) {
        return;
      }

      const targetChat = pendingChatsRef.current.find((chat) => chat.id === chatId && !chat.archived);

      if (!targetChat) {
        return;
      }

      const nextChats = pruneEmptyChats(pendingChatsRef.current, targetChat.id);
      if (nextChats.length !== pendingChatsRef.current.length) {
        pendingChatsRef.current = nextChats;
        setChats(nextChats);
      }
      restoreProjectLocalWorkspace(targetChat.project);
      activeChatIdRef.current = targetChat.id;
      setActiveChatId(targetChat.id);
      setActiveRoute("chat");
    }

    selectChatFromHash();
    window.addEventListener("hashchange", selectChatFromHash);

    return () => window.removeEventListener("hashchange", selectChatFromHash);
  }, []);

  useEffect(() => {
    const activeProjectName = normalizeProjectName(activeChat.project);
    const currentWorkspace = localWorkspaceRef.current;

    if (isNoProjectName(activeProjectName)) {
      const noProjectWorkspace = createNoProjectWorkspace(currentWorkspace);

      if (!sameLocalWorkspaceSettings(noProjectWorkspace, currentWorkspace)) {
        localWorkspaceRef.current = noProjectWorkspace;
        setLocalWorkspace(noProjectWorkspace);
      }

      return;
    }

    const projectWorkspace = projects.find((project) => project.name.toLowerCase() === activeProjectName.toLowerCase())?.localWorkspace;

    if (projectWorkspace && !sameLocalWorkspaceSettings(projectWorkspace, currentWorkspace)) {
      localWorkspaceRef.current = projectWorkspace;
      setLocalWorkspace(projectWorkspace);
      return;
    }

    if (!projectWorkspace && currentWorkspace.enabled) {
      const noProjectWorkspace = createNoProjectWorkspace(currentWorkspace);
      localWorkspaceRef.current = noProjectWorkspace;
      setLocalWorkspace(noProjectWorkspace);
    }
  }, [activeChat.project, projects]);
  function resolveWorkspaceForChatProject(projectName: string, fallback: LocalWorkspaceSettings = localWorkspaceRef.current) {
    return (resolveWorkspaceForChatProjectImpl as any)(runtime, projectName, fallback);
  }

  function isActiveChatProject(projectName: string) {
    return (isActiveChatProjectImpl as any)(runtime, projectName);
  }

  function persistAgentRun(nextRun: AgentRun) {
    return (persistAgentRunImpl as any)(runtime, nextRun);
  }

  function createAgentRunForMessage(params: {
    chatId: string;
    localWorkspace?: LocalWorkspaceSettings;
    messageId: string;
    mode: "chat" | "plan";
    prompt: string;
    title?: string;
  }) {
    return (createAgentRunForMessageImpl as any)(runtime, params);
  }

  function updateAgentRun(runId: string | undefined, updater: (run: AgentRun, now: string) => AgentRun) {
    return (updateAgentRunImpl as any)(runtime, runId, updater);
  }

  function setAgentRunWaiting(runId: string | undefined, label: string, detail?: string, approvals: AgentApproval[] = [], pendingToolCallContent?: string) {
    return (setAgentRunWaitingImpl as any)(runtime, runId, label, detail, approvals, pendingToolCallContent);
  }

  function setAgentRunCompleted(runId: string | undefined, message: ChatMessage) {
    return (setAgentRunCompletedImpl as any)(runtime, runId, message);
  }

  function setAgentRunFailed(runId: string | undefined, errorMessage: string) {
    return (setAgentRunFailedImpl as any)(runtime, runId, errorMessage);
  }

  function setAgentRunCancelled(runId: string | undefined, detail?: string) {
    return (setAgentRunCancelledImpl as any)(runtime, runId, detail);
  }

  function setAgentRunContinuing(runId: string | undefined, label: string, detail?: string) {
    return (setAgentRunContinuingImpl as any)(runtime, runId, label, detail);
  }

  function createPlanningExecutionApproval(runId: string, messageId: string, planContent: string, prompt: string): AgentApproval {
    return (createPlanningExecutionApprovalImpl as any)(runtime, runId, messageId, planContent, prompt);
  }

  function handleNewChat(project?: string) {
    return (handleNewChatImpl as any)(runtime, project);
  }

  function handleSelectChat(chatId: string) {
    return (handleSelectChatImpl as any)(runtime, chatId);
  }

  function handleActiveChatModelChange(nextModel: string, nextProvider: ProviderSettings["provider"]) {
    return (handleActiveChatModelChangeImpl as any)(runtime, nextModel, nextProvider);
  }

  function handleProviderConnectionChoice(nextProvider: ProviderSettings["provider"], nextModel: string) {
    return (handleProviderConnectionChoiceImpl as any)(runtime, nextProvider, nextModel);
  }

  function handleSubscriptionSandboxUninstalled(nextSettings: ProviderSettings) {
    const openRouterModel = nextSettings.providerModels.openrouter?.trim() || nextSettings.model.trim() || getDefaultModelForProvider("openrouter");
    const fallbackSettings: ProviderSettings = {
      ...nextSettings,
      model: openRouterModel,
      provider: "openrouter",
      providerModels: {
        ...nextSettings.providerModels,
        [NINE_ROUTER_PROVIDER_ID]: "",
        openrouter: openRouterModel,
      },
    };

    setProviderSettings(fallbackSettings);
    setChats((currentChats) => {
      let changed = false;
      const nextChats = currentChats.map((chat) => {
        if (chat.provider !== NINE_ROUTER_PROVIDER_ID && !isSubscriptionRouteModel(chat.model)) {
          return chat;
        }

        changed = true;
        return {
          ...chat,
          model: openRouterModel,
          provider: "openrouter" as const,
        };
      });

      return changed ? nextChats : currentChats;
    });
  }

  function handleSelectProject(project: string) {
    return (handleSelectProjectImpl as any)(runtime, project);
  }

  async function openCreateProjectDialog(options: CreateProjectOptions = {}): Promise<string | null> {
    return (openCreateProjectDialogImpl as any)(runtime, options);
  }

  function createProjectFromFolder(folderPath: string, options: { bindToActiveChat?: boolean; projectNameHint?: string } = {}): string | null {
    return (createProjectFromFolderImpl as any)(runtime, folderPath, options);
  }

  function handleLocalWorkspaceChange(nextWorkspace: LocalWorkspaceSettings) {
    return (handleLocalWorkspaceChangeImpl as any)(runtime, nextWorkspace);
  }

  function bindActiveChatToProject(project: string, workspaceOverride?: LocalWorkspaceSettings) {
    return (bindActiveChatToProjectImpl as any)(runtime, project, workspaceOverride);
  }

  function handleToggleTerminal() {
    return (handleToggleTerminalImpl as any)(runtime);
  }

  function attachLiveTerminalSession(toolCalls?: ChatToolCall[]) {
    return (attachLiveTerminalSessionImpl as any)(runtime, toolCalls);
  }

  function handleTogglePin(chatId: string) {
    return (handleTogglePinImpl as any)(runtime, chatId);
  }

  function handleOpenRenameChat(chat: ChatSummary) {
    return (handleOpenRenameChatImpl as any)(runtime, chat);
  }

  function confirmRenameChat() {
    return (confirmRenameChatImpl as any)(runtime);
  }

  function handleArchiveActiveChat() {
    return (handleArchiveActiveChatImpl as any)(runtime);
  }

  async function handleCopyWorkingDirectory() {
    return (handleCopyWorkingDirectoryImpl as any)(runtime);
  }

  async function handleCopySessionId() {
    return (handleCopySessionIdImpl as any)(runtime);
  }

  async function handleCopyChatDeeplink() {
    return (handleCopyChatDeeplinkImpl as any)(runtime);
  }

  async function handleCopyChatMarkdown() {
    return (handleCopyChatMarkdownImpl as any)(runtime);
  }

  function handleForkActiveChatLocal() {
    return (handleForkActiveChatLocalImpl as any)(runtime);
  }

  async function handleForkActiveChatWorktree() {
    return (handleForkActiveChatWorktreeImpl as any)(runtime);
  }

  function handleAddAutomation() {
    return (handleAddAutomationImpl as any)(runtime);
  }

  async function handleOpenActiveChatInNewWindow() {
    return (handleOpenActiveChatInNewWindowImpl as any)(runtime);
  }

  function getActiveWorkingDirectory() {
    return (getActiveWorkingDirectoryImpl as any)(runtime);
  }

  async function copyLabeledTextToClipboard(label: string, text: string) {
    return (copyLabeledTextToClipboardImpl as any)(runtime, label, text);
  }

  function activateForkedChat(forkedChat: ChatSummary, workspace: LocalWorkspaceSettings) {
    return (activateForkedChatImpl as any)(runtime, forkedChat, workspace);
  }

  function notifyPlanningInputNeeded(inputRequest: ChatPlanningInputRequest) {
    return (notifyPlanningInputNeededImpl as any)(runtime, inputRequest);
  }

  function notifyRunNeedsAttention(detail?: string) {
    return (notifyRunNeedsAttentionImpl as any)(runtime, detail);
  }

  function notifyRunComplete(message: ChatMessage) {
    return (notifyRunCompleteImpl as any)(runtime, message);
  }

  function touchProject(projectName: string) {
    return (touchProjectImpl as any)(runtime, projectName);
  }

  function restoreProjectLocalWorkspace(projectName: string, workspaceOverride?: LocalWorkspaceSettings) {
    return (restoreProjectLocalWorkspaceImpl as any)(runtime, projectName, workspaceOverride);
  }

  function saveWorkspaceForProject(projectName: string, nextWorkspace: LocalWorkspaceSettings) {
    return (saveWorkspaceForProjectImpl as any)(runtime, projectName, nextWorkspace);
  }

  function handleDeleteChat(chatId: string) {
    return (handleDeleteChatImpl as any)(runtime, chatId);
  }

  function handleDeleteProject(projectName: string) {
    return (handleDeleteProjectImpl as any)(runtime, projectName);
  }

  function handleOpenBulkDeleteChats() {
    return (handleOpenBulkDeleteChatsImpl as any)(runtime);
  }

  function handleToggleBulkDeleteChat(chatId: string) {
    return (handleToggleBulkDeleteChatImpl as any)(runtime, chatId);
  }

  function handleSelectAllBulkDeleteChats() {
    return (handleSelectAllBulkDeleteChatsImpl as any)(runtime);
  }

  function handleClearBulkDeleteChats() {
    return (handleClearBulkDeleteChatsImpl as any)(runtime);
  }

  function confirmDeleteChat() {
    return (confirmDeleteChatImpl as any)(runtime);
  }

  function confirmDeleteProject() {
    return (confirmDeleteProjectImpl as any)(runtime);
  }

  function confirmBulkDeleteChats() {
    return (confirmBulkDeleteChatsImpl as any)(runtime);
  }

  function isChatSending(chatId: string | undefined) {
    return (isChatSendingImpl as any)(runtime, chatId);
  }

  function isAnyChatSending(chatIds: Iterable<string>) {
    return (isAnyChatSendingImpl as any)(runtime, chatIds);
  }

  function getSendingChatIds(chatIds: Iterable<string>) {
    return (getSendingChatIdsImpl as any)(runtime, chatIds);
  }

  function setChatSending(chatId: string, sending: boolean) {
    return (setChatSendingImpl as any)(runtime, chatId, sending);
  }

  function getActiveGenerationByRequest(requestId: number) {
    return (getActiveGenerationByRequestImpl as any)(runtime, requestId);
  }

  function getActiveGenerationByMessage(messageId: string | undefined) {
    return (getActiveGenerationByMessageImpl as any)(runtime, messageId);
  }

  function createActiveGeneration(chatId: string, previousChat: ChatSummary, previousChatExisted: boolean, restoreDraft?: ChatComposerDraft, target?: { messageId: string }) {
    return (createActiveGenerationImpl as any)(runtime, chatId, previousChat, previousChatExisted, restoreDraft, target);
  }

  function setActiveGenerationTarget(requestId: number, chatId: string, messageId: string) {
    return (setActiveGenerationTargetImpl as any)(runtime, requestId, chatId, messageId);
  }

  function isRequestInactive(requestId: number, controller: AbortController) {
    return (isRequestInactiveImpl as any)(runtime, requestId, controller);
  }

  function finishActiveGeneration(requestId: number) {
    return (finishActiveGenerationImpl as any)(runtime, requestId);
  }

  function handleStopGeneration(messageId?: unknown) {
    return (handleStopGenerationImpl as any)(runtime, messageId);
  }

  function stopActiveGeneration(arg0: { activeGeneration?: ActiveGeneration; messageId?: string; restoreDraft: boolean }) {
    return (stopActiveGenerationImpl as any)(runtime, arg0);
  }

  function stopStreamingMessage(messageId: string) {
    return (stopStreamingMessageImpl as any)(runtime, messageId);
  }

  function stopStaleStreamingMessages(chatId: string, exceptMessageId?: string) {
    return (stopStaleStreamingMessagesImpl as any)(runtime, chatId, exceptMessageId);
  }

  function stopStreamingAssistantMessage(message: ChatMessage, stoppedAt: string): ChatMessage {
    return (stopStreamingAssistantMessageImpl as any)(runtime, message, stoppedAt);
  }

  function completeActiveProgress(progress: ChatProgressItem[] | undefined) {
    return (completeActiveProgressImpl as any)(runtime, progress);
  }

  function preserveQueuedMessagesForSnapshot(chatSnapshot: ChatSummary) {
    return (preserveQueuedMessagesForSnapshotImpl as any)(runtime, chatSnapshot);
  }

  function restoreChatSnapshot(chatSnapshot: ChatSummary, existed: boolean) {
    return (restoreChatSnapshotImpl as any)(runtime, chatSnapshot, existed);
  }

  function updateQueuedChatSends(updater: (currentQueue: QueuedChatSend[]) => QueuedChatSend[]) {
    return (updateQueuedChatSendsImpl as any)(runtime, updater);
  }

  function scheduleGeneratedChatTitle(arg0: {
    attachments: ChatAttachment[];
    chatId: string;
    content: string;
    fallbackTitle: string;
    settings: ProviderSettings;
    userMessageId: string;
  }) {
    return (scheduleGeneratedChatTitleImpl as any)(runtime, arg0);
  }

  function applyGeneratedChatTitle(arg0: {
    chatId: string;
    fallbackTitle: string;
    title: string;
    userMessageId: string;
  }) {
    return (applyGeneratedChatTitleImpl as any)(runtime, arg0);
  }

  function shouldPreserveExistingTitleAfterUserEdit(chat: ChatSummary, userMessage: ChatMessage) {
    return (shouldPreserveExistingTitleAfterUserEditImpl as any)(runtime, chat, userMessage);
  }

  function enqueueChatSend(input: ChatSendInput) {
    return (enqueueChatSendImpl as any)(runtime, input);
  }

  function handleDeleteQueuedMessage(messageId: string) {
    return (handleDeleteQueuedMessageImpl as any)(runtime, messageId);
  }

  function handleHoldQueuedMessage(messageId: string, held: boolean) {
    return (handleHoldQueuedMessageImpl as any)(runtime, messageId, held);
  }

  function handleUpdateQueuedMessage(messageId: string, content: string) {
    return (handleUpdateQueuedMessageImpl as any)(runtime, messageId, content);
  }

  async function handleEditUserMessageAndRegenerate(messageId: string, content: string) {
    return (handleEditUserMessageAndRegenerateImpl as any)(runtime, messageId, content);
  }

  function handleSteerQueuedMessage(messageId: string, contentOverride?: string) {
    return (handleSteerQueuedMessageImpl as any)(runtime, messageId, contentOverride);
  }

  async function steerActiveResponse(arg0: {
    activeGeneration: ActiveGeneration;
    assistantMessageIndex: number;
    contentOverride?: string;
    currentChat: ChatSummary;
    queuedSend: QueuedChatSend;
  }) {
    return (steerActiveResponseImpl as any)(runtime, arg0);
  }

  async function createMessagesForProvider(existingMessages: ChatMessage[], userMessage: ChatMessage, projectName: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, webContextMessages: ChatMessage[] = [], settings: ProviderSettings = createToolAwareProviderSettings(), onCompaction?: (notice: ContextCompactionNotice) => void) {
    return (createMessagesForProviderImpl as any)(runtime, existingMessages, userMessage, projectName, workspaceSettings, prompt, webContextMessages, settings, onCompaction);
  }

  function createChatToolSelectionPrompt(prompt: string, existingMessages: ChatMessage[], workspaceSettings: LocalWorkspaceSettings) {
    return (createChatToolSelectionPromptImpl as any)(runtime, prompt, existingMessages, workspaceSettings);
  }

  function referencesSelectedWorkspaceForToolSelection(prompt: string) {
    return (referencesSelectedWorkspaceForToolSelectionImpl as any)(runtime, prompt);
  }

  function resolveChatResearchReferences(input: ChatSendInput, currentChatId: string): ChatResearchReference[] {
    return (resolveChatResearchReferencesImpl as any)(runtime, input, currentChatId);
  }

  function getChatResearchCandidates(currentChatId: string) {
    return (getChatResearchCandidatesImpl as any)(runtime, currentChatId);
  }

  function createChatResearchContextMessages(references?: ChatResearchReference[]) {
    return (createChatResearchContextMessagesImpl as any)(runtime, references);
  }

  function createActiveProjectBoundaryMessage(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (createActiveProjectBoundaryMessageImpl as any)(runtime, projectName, workspaceSettings);
  }

  function createMemorySearchForRequest(chatId: string, projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (createMemorySearchForRequestImpl as any)(runtime, chatId, projectName, workspaceSettings);
  }

  function clampMemoryToolInteger(value: number | undefined, fallback: number, min: number, max: number) {
    return (clampMemoryToolIntegerImpl as any)(runtime, value, fallback, min, max);
  }

  function limitMemoryToolContent(content: string, maxChars: number) {
    return (limitMemoryToolContentImpl as any)(runtime, content, maxChars);
  }

  function rememberProjectMapSnapshot(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (rememberProjectMapSnapshotImpl as any)(runtime, projectName, workspaceSettings);
  }

  function loadToolMemoryForProject(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (loadToolMemoryForProjectImpl as any)(runtime, projectName, workspaceSettings);
  }

  function saveToolMemoryForProject(state: ReturnType<typeof loadProjectToolMemoryState>) {
    return (saveToolMemoryForProjectImpl as any)(runtime, state);
  }

  function createToolMemoryScope(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (createToolMemoryScopeImpl as any)(runtime, projectName, workspaceSettings);
  }

  function getEnabledWorkspaceRoots(workspaceSettings: LocalWorkspaceSettings) {
    return (getEnabledWorkspaceRootsImpl as any)(runtime, workspaceSettings);
  }

  function rememberProjectToolMemoryFromBridgeRun(chatId: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, run: ToolBridgeExecutionBatch) {
    return (rememberProjectToolMemoryFromBridgeRunImpl as any)(runtime, chatId, workspaceSettings, prompt, run);
  }

  function rememberProjectToolMemoryFromChatToolCalls(chatId: string, workspaceSettings: LocalWorkspaceSettings, prompt: string, toolCalls: ChatToolCall[]) {
    return (rememberProjectToolMemoryFromChatToolCallsImpl as any)(runtime, chatId, workspaceSettings, prompt, toolCalls);
  }

  function getToolMemoryProjectName(chatId: string) {
    return (getToolMemoryProjectNameImpl as any)(runtime, chatId);
  }

  async function createSourceControlContextMessages(_prompt: string) {
    return (createSourceControlContextMessagesImpl as any)(runtime, _prompt);
  }

  function shouldSkipLocalContextForGithub(_prompt: string) {
    return (shouldSkipLocalContextForGithubImpl as any)(runtime, _prompt);
  }

  async function createLocalWorkspaceContextMessages(workspaceSettings: LocalWorkspaceSettings, prompt: string, projectName: string) {
    return (createLocalWorkspaceContextMessagesImpl as any)(runtime, workspaceSettings, prompt, projectName);
  }

  function hasAnyLocalWorkspaceToolEnabled() {
    return (hasAnyLocalWorkspaceToolEnabledImpl as any)(runtime);
  }

  function getAutomaticWorkspaceContextCharBudget(contextWindowTokens: number) {
    return (getAutomaticWorkspaceContextCharBudgetImpl as any)(runtime, contextWindowTokens);
  }

  async function syncLocalWorkspaceIndexSummary(projectName: string, workspaceSettings: LocalWorkspaceSettings) {
    return (syncLocalWorkspaceIndexSummaryImpl as any)(runtime, projectName, workspaceSettings);
  }

  function compactProviderMessages(messages: ChatMessage[], settingsOverride?: ProviderSettings, options: { target?: number; threshold?: number; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return (compactProviderMessagesImpl as any)(runtime, messages, settingsOverride, options);
  }

  function resolveContextWindowForModel(model: string, settings: ProviderSettings = providerSettings): { maxOutputTokens?: number; source: "estimate" | "openrouter" | "provider"; tokens: number } {
    return (resolveContextWindowForModelImpl as any)(runtime, model, settings);
  }

  function getManualModelBudgetOverride(settings: ProviderSettings, model: string) {
    return (getManualModelBudgetOverrideImpl as any)(runtime, settings, model);
  }

  function getConfiguredContextWindow(settings: ProviderSettings): { source: "provider"; tokens: number } | null {
    return (getConfiguredContextWindowImpl as any)(runtime, settings);
  }

  function createContextBoundLocalToolExecutionPolicy(basePolicy: LocalComputerToolExecutionPolicy): LocalComputerToolExecutionPolicy {
    return (createContextBoundLocalToolExecutionPolicyImpl as any)(runtime, basePolicy);
  }

  function getModelVisibleToolResultCharBudget(contextWindowTokens: number) {
    return (getModelVisibleToolResultCharBudgetImpl as any)(runtime, contextWindowTokens);
  }

  function minNullableCharCap(cap: number | null, budget: number) {
    return (minNullableCharCapImpl as any)(runtime, cap, budget);
  }

  function getProviderCompactionBaseline(threshold: number) {
    return (getProviderCompactionBaselineImpl as any)(runtime, threshold);
  }

  function recordContextCompaction(compaction: ReturnType<typeof compactMessagesForContext>, providerBaseline: ContextWindowUsage | null): ContextCompactionNotice {
    return (recordContextCompactionImpl as any)(runtime, compaction, providerBaseline);
  }

  function createContextCompactionProgress(compaction: ReturnType<typeof compactMessagesForContext> & { contextCompaction?: ContextCompactionNotice }): ChatProgressItem {
    return (createContextCompactionProgressImpl as any)(runtime, compaction);
  }

  function withContextCompactionProgress(compactionProgress: ChatProgressItem, progress: ChatProgressItem[] | undefined) {
    return (withContextCompactionProgressImpl as any)(runtime, compactionProgress, progress);
  }

  function withContextCompactionMarker(message: ChatMessage, notice: ContextCompactionNotice | undefined): ChatMessage {
    return (withContextCompactionMarkerImpl as any)(runtime, message, notice);
  }

  function createChatContextCompaction(notice: ContextCompactionNotice): ChatContextCompaction {
    return (createChatContextCompactionImpl as any)(runtime, notice);
  }

  function getContextCompactionMarkerKey(compaction: ChatContextCompaction) {
    return (getContextCompactionMarkerKeyImpl as any)(runtime, compaction);
  }

  function recordProviderContextUsage(chatId: string, messages: ChatMessage[], settings: ProviderSettings, options: { allowDecrease?: boolean; stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return (recordProviderContextUsageImpl as any)(runtime, chatId, messages, settings, options);
  }

  function recordProviderActualUsage(chatId: string, messages: ChatMessage[], settings: ProviderSettings, usage: Awaited<ReturnType<typeof streamProviderMessage>>["usage"], options: { allowDecrease?: boolean; stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return (recordProviderActualUsageImpl as any)(runtime, chatId, messages, settings, usage, options);
  }

  function estimateProviderContextUsageForDisplay(messages: ChatMessage[], settings: ProviderSettings, options: { stream?: boolean; toolBridge?: ProviderToolBridgeOptions } = {}) {
    return (estimateProviderContextUsageForDisplayImpl as any)(runtime, messages, settings, options);
  }

  function createProviderPayloadGuardrailProgress(usage: ContextWindowUsage): ChatProgressItem | null {
    return (createProviderPayloadGuardrailProgressImpl as any)(runtime, usage);
  }

  function withProviderPayloadGuardrailProgress(guardrailProgress: ChatProgressItem | null, progress: ChatProgressItem[] | undefined) {
    return (withProviderPayloadGuardrailProgressImpl as any)(runtime, guardrailProgress, progress);
  }

  function recordPlanningProviderRequest(chatId: string, request: PlanningProviderRequest) {
    return (recordPlanningProviderRequestImpl as any)(runtime, chatId, request);
  }

  function recordPlanningProviderUsage(chatId: string, request: PlanningProviderRequest, usage: Awaited<ReturnType<typeof streamProviderMessage>>["usage"]) {
    return (recordPlanningProviderUsageImpl as any)(runtime, chatId, request, usage);
  }

  function createChatProviderSettings(chat: ChatSummary | null | undefined, overrides: Partial<ProviderSettings> = {}): ProviderSettings {
    const baseSettings = {
      ...providerSettings,
      ...overrides,
      providerModels: {
        ...providerSettings.providerModels,
        ...overrides.providerModels,
      },
    };
    const overrideProvider = isModelProviderId(overrides.provider) ? overrides.provider : undefined;
    const chatProvider = isModelProviderId(chat?.provider) ? chat.provider : undefined;
    const provider = overrideProvider ?? chatProvider ?? baseSettings.provider;
    const overrideModel = typeof overrides.model === "string" ? overrides.model.trim() : "";
    const chatModel = typeof chat?.model === "string" ? chat.model.trim() : "";
    const rememberedProviderModel = baseSettings.providerModels[provider]?.trim() ?? "";
    const model =
      overrideModel ||
      chatModel ||
      rememberedProviderModel ||
      (provider === baseSettings.provider ? baseSettings.model.trim() : "") ||
      getModelProvider(provider).defaultModel;

    return {
      ...baseSettings,
      model,
      provider,
      providerModels: {
        ...baseSettings.providerModels,
        [provider]: model,
      },
    };
  }

  function createToolAwareProviderSettings(overrides: Partial<ProviderSettings> = {}, chat: ChatSummary | null | undefined = activeChat): ProviderSettings {
    return (createToolAwareProviderSettingsImpl as any)(runtime, overrides, chat);
  }

  function createPromptAwareProviderSettings(prompt: string, overrides: Partial<ProviderSettings> = {}, chat: ChatSummary | null | undefined = activeChat): ProviderSettings {
    return (createPromptAwareProviderSettingsImpl as any)(runtime, prompt, overrides, chat);
  }

  function hasRequestScopedWorkspaceToolsEnabled(settings: ProviderSettings) {
    return (hasRequestScopedWorkspaceToolsEnabledImpl as any)(runtime, settings);
  }

  function createPromptAwareThinkingSettings(thinking: ProviderSettings["thinking"], prompt: string): ProviderSettings["thinking"] {
    return (createPromptAwareThinkingSettingsImpl as any)(runtime, thinking, prompt);
  }

  function shouldUseLighterThinkingForPrompt(prompt: string) {
    return (shouldUseLighterThinkingForPromptImpl as any)(runtime, prompt);
  }

  function createFinalOnlyProviderSettings(prompt?: string, chat: ChatSummary | null | undefined = activeChat): ProviderSettings {
    return (createFinalOnlyProviderSettingsImpl as any)(runtime, prompt, chat);
  }

  function rememberSessionApprovalDecision(approval: AgentApproval, decision: AgentApprovalDecision, workspaceSettings: LocalWorkspaceSettings) {
    return (rememberSessionApprovalDecisionImpl as any)(runtime, approval, decision, workspaceSettings);
  }

  function createRuntimeApprovalDecisions(workspaceSettings: LocalWorkspaceSettings, approvalDecisions?: Record<string, AgentApprovalDecision>) {
    return (createRuntimeApprovalDecisionsImpl as any)(runtime, workspaceSettings, approvalDecisions);
  }

  function getRuntimeWebSearchMaxResults(settings: ProviderSettings, requestedMaxResults?: number) {
    return (getRuntimeWebSearchMaxResultsImpl as any)(runtime, settings, requestedMaxResults);
  }

  function getRuntimeWebSearchSettings(settings: ProviderSettings, requestedWebSearch?: ChatSendInput["webSearch"] | ChatWebSearch): WebSearchSettings {
    return (getRuntimeWebSearchSettingsImpl as any)(runtime, settings, requestedWebSearch);
  }

  function supportsProviderParallelToolCalls(provider: ProviderSettings["provider"]) {
    return (supportsProviderParallelToolCallsImpl as any)(runtime, provider);
  }

  function createLocationAwareWebSearchSettings(settings: WebSearchSettings, locationServicesEnabled: boolean): WebSearchSettings {
    return (createLocationAwareWebSearchSettingsImpl as any)(runtime, settings, locationServicesEnabled);
  }

  function createAppAgentToolCall(messageId: string, status: ChatToolCall["status"], detail: string, output?: string, fileChanges?: ChatToolCall["fileChanges"]): ChatToolCall {
    return (createAppAgentToolCallImpl as any)(runtime, messageId, status, detail, output, fileChanges);
  }

  function appendAgentRuntimeStep(runId: string | undefined, type: AgentRun["steps"][number]["type"], label: string, detail?: string) {
    return (appendAgentRuntimeStepImpl as any)(runtime, runId, type, label, detail);
  }

  function completeLatestAgentRuntimeStep(runId: string | undefined, status: AgentRun["steps"][number]["status"], detail?: string) {
    return (completeLatestAgentRuntimeStepImpl as any)(runtime, runId, status, detail);
  }

  function mapAgentDecisionToStepType(decision: AgentRuntimeDecision): AgentRun["steps"][number]["type"] {
    return (mapAgentDecisionToStepTypeImpl as any)(runtime, decision);
  }

  async function runAppOwnedCodingAgent(arg0: {
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
    return (runAppOwnedCodingAgentImpl as any)(runtime, arg0);
  }

  async function streamAssistantWithLocalTools(arg0: {
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
    return (streamAssistantWithLocalToolsImpl as any)(runtime, arg0);
  }

  function createToolFinalAnswerUnavailableMessage(toolCalls: ChatToolCall[] = [], originalPrompt = "") {
    return (createToolFinalAnswerUnavailableMessageImpl as any)(runtime, toolCalls, originalPrompt);
  }

  function createSynthesisRecoveryFallback(toolCall: ChatToolCall, fallbackOutput: string) {
    return (createSynthesisRecoveryFallbackImpl as any)(runtime, toolCall, fallbackOutput);
  }

  function summarizeUserFacingFailure(output: string) {
    return (summarizeUserFacingFailureImpl as any)(runtime, output);
  }

  function createRecoverableBridgeToolRetryInstruction(toolCalls: ChatToolCall[], originalPrompt: string) {
    return (createRecoverableBridgeToolRetryInstructionImpl as any)(runtime, toolCalls, originalPrompt);
  }

  function getToolCallRawOutput(toolCall: ChatToolCall) {
    return (getToolCallRawOutputImpl as any)(runtime, toolCall);
  }

  function extractSuggestedFileReadCandidates(output: string) {
    return (extractSuggestedFileReadCandidatesImpl as any)(runtime, output);
  }

  function extractNearbyPathCandidates(output: string) {
    return (extractNearbyPathCandidatesImpl as any)(runtime, output);
  }

  function extractSuggestedFileSearchQuery(output: string) {
    return (extractSuggestedFileSearchQueryImpl as any)(runtime, output);
  }

  function isMissingFileReadToolCall(toolCall: ChatToolCall, output: string) {
    return (isMissingFileReadToolCallImpl as any)(runtime, toolCall, output);
  }

  function isMissingFileReadError(output: string) {
    return (isMissingFileReadErrorImpl as any)(runtime, output);
  }

  function extractMissingReadPath(output: string) {
    return (extractMissingReadPathImpl as any)(runtime, output);
  }

  function extractToolInputPath(input: string | undefined) {
    return (extractToolInputPathImpl as any)(runtime, input);
  }

  function createMissingReadSearchQuery(path: string) {
    return (createMissingReadSearchQueryImpl as any)(runtime, path);
  }

  function getLastPathSegment(path: string) {
    return (getLastPathSegmentImpl as any)(runtime, path);
  }

  function isRecoverableBridgeArgumentError(output: string) {
    return (isRecoverableBridgeArgumentErrorImpl as any)(runtime, output);
  }

  function summarizeCompletedToolFallback(toolCall: ChatToolCall, output: string) {
    return (summarizeCompletedToolFallbackImpl as any)(runtime, toolCall, output);
  }

  function shouldKeepToolOutputOutOfChat(toolCall: ChatToolCall, output: string) {
    return (shouldKeepToolOutputOutOfChatImpl as any)(runtime, toolCall, output);
  }

  function countTextLines(value: string) {
    return (countTextLinesImpl as any)(runtime, value);
  }

  function limitFallbackToolOutput(output: string) {
    return (limitFallbackToolOutputImpl as any)(runtime, output);
  }

  function createGitToolFallbackAnswer(toolCalls: ChatToolCall[], originalPrompt: string) {
    return (createGitToolFallbackAnswerImpl as any)(runtime, toolCalls, originalPrompt);
  }

  function parseGitStatusFallbackFiles(output: string) {
    return (parseGitStatusFallbackFilesImpl as any)(runtime, output);
  }

  function parseGitDiffStatFallbackFiles(output: string) {
    return (parseGitDiffStatFallbackFilesImpl as any)(runtime, output);
  }

  function extractToolStdout(output: string) {
    return (extractToolStdoutImpl as any)(runtime, output);
  }

  function cleanGitFallbackPath(value: string) {
    return (cleanGitFallbackPathImpl as any)(runtime, value);
  }

  function dedupeGitFallbackFiles(files: Array<{ path: string; status: string }>) {
    return (dedupeGitFallbackFilesImpl as any)(runtime, files);
  }

  function groupGitStatusFallbackFiles(files: Array<{ path: string; status: string }>) {
    return (groupGitStatusFallbackFilesImpl as any)(runtime, files);
  }

  function formatGitStatusFallbackGroup(label: string, files: Array<{ path: string; status: string }>) {
    return (formatGitStatusFallbackGroupImpl as any)(runtime, label, files);
  }

  function formatGitStatSuffix(file: { additions: number; deletions: number }) {
    return (formatGitStatSuffixImpl as any)(runtime, file);
  }

  function createNoExecutedToolFinalInstruction(contextMessage: string, retryBudgetExhausted = false) {
    return (createNoExecutedToolFinalInstructionImpl as any)(runtime, contextMessage, retryBudgetExhausted);
  }

  function createNoExecutedToolFinalAnswer(contextMessage: string) {
    return (createNoExecutedToolFinalAnswerImpl as any)(runtime, contextMessage);
  }

  function extractFirstUnsuccessfulToolSection(contextMessage: string) {
    return (extractFirstUnsuccessfulToolSectionImpl as any)(runtime, contextMessage);
  }

  function summarizeUnsuccessfulToolSection(section: string) {
    return (summarizeUnsuccessfulToolSectionImpl as any)(runtime, section);
  }

  function stripToolSectionHeader(section: string) {
    return (stripToolSectionHeaderImpl as any)(runtime, section);
  }

  function stripToolAdaptationRecommendation(value: string) {
    return (stripToolAdaptationRecommendationImpl as any)(runtime, value);
  }

  function appendAutoCompactionContinuation(messages: ChatMessage[], prompt: string, executedToolCalls: number) {
    return (appendAutoCompactionContinuationImpl as any)(runtime, messages, prompt, executedToolCalls);
  }

  function isAutoCompactionContinuationMessage(message: ChatMessage) {
    return (isAutoCompactionContinuationMessageImpl as any)(runtime, message);
  }

  async function runParallelSubagents(tasks: LocalSubagentTask[], baseMessages: ChatMessage[], prompt: string, signal?: AbortSignal, chat: ChatSummary | null | undefined = activeChat): Promise<LocalSubagentResult[]> {
    return (runParallelSubagentsImpl as any)(runtime, tasks, baseMessages, prompt, signal, chat);
  }

  async function streamProviderMessageWithRetry(chatId: string, settings: ProviderSettings, messages: ChatMessage[], onUpdate: Parameters<typeof streamProviderMessage>[2], options: Parameters<typeof streamProviderMessage>[3] = {}, messageId?: string) {
    return (streamProviderMessageWithRetryImpl as any)(runtime, chatId, settings, messages, onUpdate, options, messageId);
  }

  async function runProviderRetryWithTimeout<T>(parentSignal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) {
    return (runProviderRetryWithTimeoutImpl as any)(runtime, parentSignal, run);
  }

  function createProviderRetryInstruction(messages: ChatMessage[], emptyResponse: boolean) {
    return (createProviderRetryInstructionImpl as any)(runtime, messages, emptyResponse);
  }

  function isRetryableProviderMessageError(error: unknown) {
    return (isRetryableProviderMessageErrorImpl as any)(runtime, error);
  }

  function hasLocalToolEvidence(messages: ChatMessage[]) {
    return (hasLocalToolEvidenceImpl as any)(runtime, messages);
  }

  function createEmptyResponseRetrySettings(settings: ProviderSettings): ProviderSettings {
    return (createEmptyResponseRetrySettingsImpl as any)(runtime, settings);
  }

  function updateGeneratedMessage(chatId: string, messageId: string, updateMessage: (message: ChatMessage) => ChatMessage, sortByUpdatedAt = false) {
    return (updateGeneratedMessageImpl as any)(runtime, chatId, messageId, updateMessage, sortByUpdatedAt);
  }

  function preserveVisibleResponseThinking(previousMessage: ChatMessage, nextMessage: ChatMessage): ChatMessage {
    return (preserveVisibleResponseThinkingImpl as any)(runtime, previousMessage, nextMessage);
  }

  function createInterruptedResponseContextMessages(message: ChatMessage, prompt: string) {
    return (createInterruptedResponseContextMessagesImpl as any)(runtime, message, prompt);
  }

  function createSteeringInstruction(steerContent: string, originalPrompt: string) {
    return (createSteeringInstructionImpl as any)(runtime, steerContent, originalPrompt);
  }

  function withSteeringProgress(progress: ChatProgressItem[] | undefined) {
    return (withSteeringProgressImpl as any)(runtime, progress);
  }

  function removeSteeringProgress(progress: ChatProgressItem[] | undefined) {
    return (removeSteeringProgressImpl as any)(runtime, progress);
  }


  function findActiveAssistantMessageIndex(messages: ChatMessage[]) {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (message?.role === "assistant" && message.isStreaming) {
        return index;
      }
    }

    return -1;
  }
  async function handleDiscordInteraction(interaction: DiscordInteractionEvent) {
    return (handleDiscordInteractionImpl as any)(runtime, interaction);
  }

  function resolveDiscordSourceChat(interaction: DiscordInteractionEvent) {
    return (resolveDiscordSourceChatImpl as any)(runtime, interaction);
  }

  function findLatestDiscordConversationChat(interaction: DiscordInteractionEvent) {
    return (findLatestDiscordConversationChatImpl as any)(runtime, interaction);
  }

  function discordSourceMatchesInteraction(source: NonNullable<ChatMessage["source"]>, interaction: DiscordInteractionEvent) {
    return (discordSourceMatchesInteractionImpl as any)(runtime, source, interaction);
  }

  function createDiscordMessageSource(interaction: DiscordInteractionEvent): NonNullable<ChatMessage["source"]> {
    return (createDiscordMessageSourceImpl as any)(runtime, interaction);
  }

  function isDiscordNewChatCommand(interaction: DiscordInteractionEvent) {
    return (isDiscordNewChatCommandImpl as any)(runtime, interaction);
  }

  function normalizeDiscordCommandName(commandName?: string | null) {
    return (normalizeDiscordCommandNameImpl as any)(runtime, commandName);
  }

  function resolveDiscordChatProject() {
    return (resolveDiscordChatProjectImpl as any)(runtime);
  }

  async function sendDiscordReply(target: DiscordReplyTarget | undefined, content: string) {
    return (sendDiscordReplyImpl as any)(runtime, target, content);
  }

  function createDiscordResponseStreamer(target: DiscordReplyTarget) {
    return (createDiscordResponseStreamerImpl as any)(runtime, target);
  }

  async function handleSendMessage(input: ChatSendInput) {
    return (handleSendMessageImpl as any)(runtime, input);
  }

  async function startSendMessage(input: ChatSendInput, queuedSend?: { chatId: string; queuedMessageId: string }, options: StartSendMessageOptions = {}) {
    return (startSendMessageImpl as any)(runtime, input, queuedSend, options);
  }

  async function handleResolveToolApproval(messageId: string, approvalId: string, decision: AgentApprovalDecision) {
    return (handleResolveToolApprovalImpl as any)(runtime, messageId, approvalId, decision);
  }

  async function handleSubmitPlanningInput(messageId: string, answers: ChatPlanningInputAnswer[]) {
    return (handleSubmitPlanningInputImpl as any)(runtime, messageId, answers);
  }

  async function handleRequestPlanRevision(messageId: string, feedback: string) {
    return (handleRequestPlanRevisionImpl as any)(runtime, messageId, feedback);
  }

  async function handleRegenerateResponse(messageId: string) {
    return (handleRegenerateResponseImpl as any)(runtime, messageId);
  }

  function renderUtilityPage() {
    return (renderUtilityPageImpl as any)(runtime);
  }

  function renderChatPage() {
    return (renderChatPageImpl as any)(runtime);
  }

  function handleSkipOnboarding() {
    return (handleSkipOnboardingImpl as any)(runtime);
  }

  function handleNeverShowOnboarding() {
    return (handleNeverShowOnboardingImpl as any)(runtime);
  }

  function handleOpenOnboardingSettings() {
    return (handleOpenOnboardingSettingsImpl as any)(runtime);
  }

  function handleOpenProviderConnectionNineRouterSettings() {
    return (handleOpenProviderConnectionNineRouterSettingsImpl as any)(runtime);
  }

  function handleOpenProviderConnectionKeySettings() {
    return (handleOpenProviderConnectionKeySettingsImpl as any)(runtime);
  }

  function handleRouteChange(route: PrimaryRoute) {
    return (handleRouteChangeImpl as any)(runtime, route);
  }

  function handleSettingsSectionChange(section: SettingsSectionId) {
    return (handleSettingsSectionChangeImpl as any)(runtime, section);
  }



  Object.assign(runtime, {
    activateForkedChat,
    activeChat,
    activeChatId,
    activeChatIdRef,
    activeChatProviderSettings,
    activeGenerationsRef,
    activeRequestChatIdsRef,
    activeRoute,
    activeSendRef,
    activeSettingsSection,
    agentRunsRef,
    annotateProviderPayloadSpike,
    appearanceMode,
    appendAgentRuntimeStep,
    appendAutoCompactionContinuation,
    appInfo,
    applyGeneratedChatTitle,
    applyProviderUsageToContextEstimate,
    approvedPlanRequiresMutation,
    AppsPage,
    attachLiveTerminalSession,
    AUTO_COMPACT_CONTEXT_TARGET,
    AUTO_COMPACT_CONTEXT_THRESHOLD,
    bindActiveChatToProject,
    BRIDGE_TOOL_APPROVAL_RESUME_KIND,
    browserPreviewTarget,
    buildComputerFileIndex,
    bulkDeleteChatIds,
    chatMemoryFingerprintsRef,
    ChatPage,
    chats,
    clampMemoryToolInteger,
    cleanGitFallbackPath,
    coalesceToolBridgeCalls,
    compactMessagesForContext,
    compactProviderMessages,
    completeActiveProgress,
    completeLatestAgentRuntimeStep,
    completeStreamingWorkThinking,
    COMPLEX_THINKING_PROMPT_PATTERN,
    composerDraftToRestore,
    contentReferencesChatTitle,
    CONTEXT_COMPACTION_PROGRESS_ID,
    CONTEXT_COMPACTION_STRATEGY,
    CONTEXT_COMPACTION_SUMMARY_VERSION,
    contextWindow,
    contextWindowRef,
    copyLabeledTextToClipboard,
    copyTextToClipboard,
    countAutoCompactedProviderMessages,
    countTextLines,
    createActiveGeneration,
    createActiveLocalToolCalls,
    createActiveProjectBoundaryMessage,
    createAgentPrimitiveToolContent,
    createAgentRunForMessage,
    createAgentRunRequest,
    createAgentRuntimeDecisionInstruction,
    createAgentRunWorkflowToolContent,
    createAppAgentToolCall,
    createApprovalSessionDecisionKey,
    createApprovalWorkspaceSessionKey,
    createApprovedPlanExecutionFailedAnswer,
    createApprovedPlanExecutionInstruction,
    createApprovedPlanExecutionPrompt,
    createApprovedPlanExecutionRetryInstruction,
    createAssistantToolRequestContent,
    createBridgeChatToolCall,
    createChatContextCompaction,
    createChatDeeplink,
    createChatMemoryFingerprint,
    createChatProviderSettings,
    createChatResearchContextContent,
    createChatResearchContextMessages,
    createChatToolSelectionPrompt,
    createCompletedToolFallbackSummary,
    createComputerGitWorktree,
    createContextBoundLocalToolExecutionPolicy,
    createContextCompactionProgress,
    createDefaultToolRegistry,
    createDiscordMessageSource,
    createDiscordResponseStreamer,
    createDiscordRuntimeContextMessages,
    createDurableMemoryContext,
    createDurableMemoryScopeFromChat,
    createDurableProjectMemoryScope,
    createEmptyChat,
    createEmptyResponseRetrySettings,
    createFabricatedToolProgressRecoveryInstruction,
    createFallbackChatTitle,
    createFinalAnswerRecoveryInstruction,
    createFinalOnlyProviderSettings,
    createForkedChat,
    createFreshLocalToolEvidenceInstruction,
    createGitToolFallbackAnswer,
    createId,
    createInterruptedResponseContextMessages,
    createInterruptedResponseContinuationInstruction,
    createLocalComputerProgress,
    createLocalToolBudgetFinalInstruction,
    createLocalToolFinalInstruction,
    createLocalWorkspaceContext,
    createLocalWorkspaceContextMessages,
    createLocationAwareToolSettings,
    createLocationAwareWebSearchSettings,
    createMalformedToolCallRecoveryInstruction,
    createMemorySearchForRequest,
    createMessage,
    createMessagesForProvider,
    createMissingReadSearchQuery,
    createNeedsAttentionNotification,
    createNeedsInputNotification,
    createNeutralToolSynthesisFailureMessage,
    createNoExecutedToolFinalAnswer,
    createNoExecutedToolFinalInstruction,
    createNoProjectWorkspace,
    createPdfLibraryContextMessages,
    createPlanningAnswerMessages,
    createPlanningExecutionApproval,
    createPlanningInputRequest,
    createPlanningProgress,
    createPlanResearchFollowupInstruction,
    createPlanResearchInstruction,
    createProjectBaseName,
    createProjectFromFolder,
    createProjectToolMemoryContext,
    createProjectToolMemoryScope,
    createPromptAwareProviderSettings,
    createPromptAwareThinkingSettings,
    createProviderPayloadGuardrailProgress,
    createProviderRetryInstruction,
    createRecoverableBridgeToolRetryInstruction,
    createRecoverableLocalEditRetryInstruction,
    createRuntimeApprovalDecisions,
    createSimpleLocalTaskCompletionAnswer,
    createSourceControlContextMessages,
    createSteeringInstruction,
    createSynthesisRecoveryFallback,
    createToolActionPromiseRecoveryInstruction,
    createToolAwareProviderSettings,
    createToolFinalAnswerUnavailableMessage,
    createToolMemoryScope,
    createToolProtocolNarrationRecoveryInstruction,
    createUnappliedFileEditRecoveryInstruction,
    createUniqueProjectName,
    createUnnecessaryLocalActionConfirmationRecoveryInstruction,
    dedupeGitFallbackFiles,
    DEFAULT_PROJECT,
    defaultTerminalWorkingDirectory,
    detectSimpleLocalTaskCompletion,
    DISCORD_NEW_CHAT_COMMAND,
    DISCORD_STREAM_UPDATE_INTERVAL_MS,
    discordBridgeSettings,
    discordBridgeSettingsRef,
    discordSourceMatchesInteraction,
    DOMException,
    DURABLE_MEMORY_BATCH_DELAY_MS,
    DURABLE_MEMORY_BATCH_SIZE,
    DURABLE_MEMORY_PERSIST_DELAY_MS,
    durableMemoryFlushTimerRef,
    enqueueChatSend,
    estimateModelProviderPayloadUsage,
    estimateProviderContextUsageForDisplay,
    executeToolBridgeCalls,
    extractFirstUnsuccessfulToolSection,
    extractMissingReadPath,
    extractNearbyPathCandidates,
    extractSuggestedFileReadCandidates,
    extractSuggestedFileSearchQuery,
    extractToolInputPath,
    extractToolStdout,
    findActiveAssistantMessageIndex,
    findLatestDiscordConversationChat,
    finishActiveGeneration,
    flushDurableMemoryQueue,
    formatChatAsMarkdown,
    formatDiscordStreamMessage,
    formatDiscordToolStatus,
    formatGitStatSuffix,
    formatGitStatusFallbackGroup,
    formatLocalToolPreviewProgress,
    formatResearchPayload,
    formatTokenCount,
    generateChatTitle,
    getActiveGenerationByMessage,
    getActiveGenerationByRequest,
    getActiveWorkingDirectory,
    getAutomaticWorkspaceContextCharBudget,
    getChatResearchCandidates,
    getComputerFileIndexSummary,
    getConfiguredContextWindow,
    getContextCompactionMarkerKey,
    getDefaultBaseUrlForProvider,
    getEffectiveMaxOutputTokens,
    getEnabledWorkspaceRoots,
    getFallbackContextWindowTokens,
    getLastPathSegment,
    getLatestUserPrompt,
    getManualModelBudgetOverride,
    getModelProvider,
    getModelVisibleToolResultCharBudget,
    getPendingPlanningInputRequest,
    getPlanningInputRequests,
    getProviderApiKey,
    getProviderCompactionBaseline,
    getRuntimeWebSearchMaxResults,
    getRuntimeWebSearchSettings,
    getSendingChatIds,
    getToolCallRawOutput,
    getToolMemoryProjectName,
    groupGitStatusFallbackFiles,
    handleActiveChatModelChange,
    handleAddAutomation,
    handleArchiveActiveChat,
    handleComposerDraftChange,
    handleCopyChatDeeplink,
    handleCopyChatMarkdown,
    handleCopySessionId,
    handleCopyWorkingDirectory,
    handleDeleteQueuedMessage,
    handleEditUserMessageAndRegenerate,
    handleForkActiveChatLocal,
    handleForkActiveChatWorktree,
    handleHoldQueuedMessage,
    handleLocalWorkspaceChange,
    handleNewChat,
    handleOpenActiveChatInNewWindow,
    handleOpenRenameChat,
    handleRegenerateResponse,
    handleRequestPlanRevision,
    handleResolveToolApproval,
    handleRouteChange,
    handleSelectChat,
    handleSelectProject,
    handleSendMessage,
    handleSteerQueuedMessage,
    handleStopGeneration,
    handleSubscriptionSandboxUninstalled,
    handleSubmitPlanningInput,
    handleTogglePin,
    handleToggleTerminal,
    handleUpdateQueuedMessage,
    hasAnyLocalWorkspaceToolEnabled,
    hasComposerDraftContent,
    hasLocalComputerToolCalls,
    hasLocalToolEvidence,
    hasRequestScopedWorkspaceToolsEnabled,
    hasSuccessfulApprovedPlanMutation,
    hasSuccessfulApprovedPlanWorkspaceTool,
    isAbortError,
    isActiveChatProject,
    isAnyChatSending,
    isAutoCompactionContinuationMessage,
    isChatSending,
    isDiscardableEmptyChat,
    isDiscordNewChatCommand,
    isEmptyChat,
    isEmptySelectedScaffoldProbe,
    isFileReadSynthesisToolCall,
    isInterruptedAssistantMessage,
    isLocalModelProvider,
    isMissingFileReadError,
    isMissingFileReadToolCall,
    isModelProviderId,
    isNoProjectName,
    isPlainResearchChat,
    isProviderEmptyResponseError,
    isRecoverableBridgeArgumentError,
    isRecoverableLocalEditFailure,
    isRequestInactive,
    isResearchDeepEnough,
    isRetryableProviderMessageError,
    isSimpleLocalScaffoldRequest,
    isToolResultFallbackAnswer,
    isVisibleToolResultLeak,
    lastContextCompaction,
    lastProviderContextUsage,
    lastProviderContextUsageRef,
    learnProjectToolMemoryFromBridgeRun,
    learnProjectToolMemoryFromChatToolCalls,
    limitFallbackToolOutput,
    limitMemoryToolContent,
    loadDurableChatMemoryState,
    loadDurableProjectMemoryState,
    loadPersistentString,
    loadProjectToolMemoryState,
    loadToolMemoryForProject,
    LOCAL_TOOL_FINAL_MIN_TOKENS,
    localWorkspace,
    localWorkspaceRef,
    locationServicesEnabled,
    looksLikeContradictedSuccessfulFileMutationAnswer,
    looksLikeFabricatedToolProgress,
    looksLikeInFlightToolPlanning,
    looksLikeInternalToolRecoveryAnswer,
    looksLikeOnlyToolPrelude,
    looksLikePrivateThinkingNarration,
    looksLikeSubstantiveVisibleAnswer,
    looksLikeToolProtocolNarration,
    looksLikeUnappliedFileEditAnswer,
    looksLikeUnexecutedToolActionPromise,
    looksLikeUnnecessaryLocalActionConfirmation,
    mapAgentDecisionToStepType,
    markPlanningInputAnswered,
    MAX_LOCAL_TOOL_EXECUTIONS,
    MAX_LOCAL_TOOL_PASSES,
    MAX_MALFORMED_TOOL_RECOVERY_RETRIES,
    MAX_PLANNING_INPUT_ROUNDS,
    MAX_RECOVERABLE_LOCAL_EDIT_RETRIES,
    MAX_TOOL_FINALIZATION_RETRIES,
    MAX_WEB_SEARCH_RESULTS,
    mergeAgentApprovals,
    mergeChatArtifacts,
    mergeChatSources,
    mergeMessageWorkTrace,
    MESSAGE_RETRY_TIMEOUT_MS,
    minNullableCharCap,
    modelContextWindows,
    modelContextWindowsRef,
    needsFreshLocalToolEvidence,
    normalizeDiscordCommandName,
    normalizeProjectName,
    normalizeSelectedProjectPath,
    notifyAgentRunStatus,
    notifyPlanningInputNeeded,
    notifyRunComplete,
    notifyRunNeedsAttention,
    ONBOARDING_NEVER_SHOW_KEY,
    openChatWindow,
    openCreateProjectDialog,
    parseAgentRuntimeDecision,
    parseGitDiffStatFallbackFiles,
    parseGitStatusFallbackFiles,
    parseVisibleTextToolCalls,
    PENDING_CHAT_TITLE,
    pendingChatsRef,
    pendingDeleteChatId,
    pendingDeleteProjectName,
    pendingDurableMemoryChatIdsRef,
    persistAgentRun,
    persistChatState,
    persistDurableMemoryForChatId,
    persistDurableMemoryFromChat,
    personalizationSettings,
    pickComputerFolder,
    PLAN_RESEARCH_BUDGET,
    preserveContextUsageHighWaterMark,
    preserveQueuedMessagesForSnapshot,
    preserveVisibleResponseThinking,
    priorityDurableMemoryChatIdsRef,
    projectNameFromPath,
    projects,
    projectsRef,
    PROVIDER_PAYLOAD_GUARDRAIL_PROGRESS_ID,
    providerSettings,
    pruneEmptyChats,
    queuedChatSends,
    queuedChatSendsRef,
    queueDurableMemoryForChangedChats,
    queueDurableMemoryForChatIds,
    readErrorMessage,
    recordContextCompaction,
    recordPlanningProviderRequest,
    recordPlanningProviderUsage,
    recordProviderActualUsage,
    recordProviderContextUsage,
    referencesSelectedWorkspaceForToolSelection,
    rememberProjectMapSnapshot,
    rememberProjectToolMemoryFromBridgeRun,
    rememberProjectToolMemoryFromChatToolCalls,
    rememberSessionApprovalDecision,
    removeSteeringProgress,
    renameChatId,
    renameChatTitle,
    requiresWorkspaceToolCallForPrompt,
    resolveChatResearchReferences,
    resolveContextWindowForModel,
    resolveDiscordChatProject,
    resolveDiscordSourceChat,
    resolveLocalWorkspaceRoots,
    resolveSettingsNavSection,
    resolveToolPermission,
    resolveWorkspaceForChatProject,
    restoreChatSnapshot,
    restoreProjectLocalWorkspace,
    routePrimitiveEvidenceBatchToWorkflow,
    runAppOwnedCodingAgent,
    runLocalComputerToolCalls,
    runParallelSubagents,
    runPlanningMode,
    runProviderRetryWithTimeout,
    sameComposerDraft,
    samePathSet,
    sameProjectName,
    sanitizeLocalToolCallsForDisplay,
    saveAgentRun,
    saveChats,
    saveDurableProjectMemoryState,
    savePersistentString,
    saveProjectToolMemoryState,
    saveToolMemoryForProject,
    saveWorkspaceForProject,
    scheduleDurableMemoryFlush,
    scheduleGeneratedChatTitle,
    selectAdvertisedBridgeTools,
    sendDiscordInteractionResponse,
    sendDiscordReply,
    sendProviderMessage,
    sessionApprovalDecisionsRef,
    setActiveChatId,
    setActiveGenerationTarget,
    setActiveRoute,
    setActiveSettingsSection,
    setAgentRunCancelled,
    setAgentRunCompleted,
    setAgentRunContinuing,
    setAgentRunFailed,
    setAgentRuns,
    setAgentRunWaiting,
    setAppearanceMode,
    setBrowserPreviewTarget,
    setBulkDeleteChatIds,
    setBulkDeleteChatsOpen,
    setChats,
    setChatSending,
    setChatsState,
    setComposerDraftToRestore,
    setDiscordBridgeSettings,
    setLastContextCompaction,
    setLastProviderContextUsage,
    setLocalWorkspace,
    setNoticeDialog,
    setOnboardingOpen,
    setPendingDeleteChatId,
    setPendingDeleteProjectName,
    setPersonalizationSettings,
    setProjects,
    setProviderConnectionOpen,
    setProviderSettings,
    setQueuedChatSends,
    setRenameChatError,
    setRenameChatId,
    setRenameChatTitle,
    setSearchOpen,
    setSendingChatIds,
    setTerminalAttachedSession,
    setTerminalOpen,
    SettingsPage,
    shouldAttachWebSearch,
    shouldHoldStreamingContentForToolCalls,
    shouldKeepToolOutputOutOfChat,
    shouldPreserveExistingTitleAfterUserEdit,
    shouldSkipLocalContextForGithub,
    shouldStartAppAgentRun,
    shouldSynthesizeEmptyFinalFromToolResults,
    shouldUseLighterThinkingForPrompt,
    SIMPLE_THINKING_PROMPT_MAX_WORDS,
    SIMPLE_THINKING_PROMPT_PATTERN,
    sortChatsByUpdatedAt,
    sortProjectsByUpdatedAt,
    stampLocalToolCallIds,
    STANDARD_LOCAL_COMPUTER_TOOL_EXECUTION_POLICY,
    startSendMessage,
    steerActiveResponse,
    STEERING_PROGRESS_ID,
    stopActiveGeneration,
    stopStaleStreamingMessages,
    stopStreamingAssistantMessage,
    stopStreamingMessage,
    streamAssistantWithLocalTools,
    streamProviderMessage,
    streamProviderMessageWithRetry,
    stripLeadingToolPreludeForDisplay,
    stripToolAdaptationRecommendation,
    stripToolSectionHeader,
    summarizeAgentRuntimeDecision,
    summarizeCompletedToolFallback,
    summarizeResearchEvidence,
    summarizeUnsuccessfulToolSection,
    summarizeUserFacingFailure,
    SupportPage,
    supportsProviderParallelToolCalls,
    supportsProviderThinking,
    syncLocalWorkspaceIndexSummary,
    syncPdfLibraryFromChats,
    takeNextDurableMemoryChatId,
    terminalOpen,
    titleFromMessage,
    titleGenerationRequestsRef,
    toolSettings,
    touchProject,
    updateAgentRun,
    updateDurableProjectMemoryMap,
    updateGeneratedMessage,
    updateQueuedChatSends,
    upsertToolCall,
    validateToolArguments,
    waitForDiscordFlushSlot,
    WeatherRadarPage,
    withContextCompactionMarker,
    withContextCompactionProgress,
    withLocalComputerProgress,
    withProviderPayloadGuardrailProgress,
    withSteeringProgress,
    withStreamingWorkThinking,
    withWebSearchProgress,
  });

  const pendingDeleteChat = pendingDeleteChatId ? chats.find((chat) => chat.id === pendingDeleteChatId) : undefined;
  const pendingRenameChat = renameChatId ? chats.find((chat) => chat.id === renameChatId) : undefined;
  const pendingDeleteProject = pendingDeleteProjectName ? projects.find((project) => project.name.toLowerCase() === pendingDeleteProjectName.toLowerCase()) : undefined;
  const pendingDeleteProjectChats = pendingDeleteProject
    ? chats.filter((chat) => chat.project.toLowerCase() === pendingDeleteProject.name.toLowerCase())
    : [];

  return (
    <>
      <AppShell
        activeChatId={activeChatId}
        activeRoute={activeRoute}
        activeSettingsSection={activeSettingsSection}
        appInfo={appInfo}
        appearanceMode={appearanceMode}
        authUser={authSession.user}
        chats={chats}
        desktopRuntime={isDesktopRuntime}
        locationServicesEnabled={locationServicesEnabled}
        projects={projects}
        searchOpen={searchOpen}
        sidebarOpen={sidebarOpen}
        onAppearanceModeChange={setAppearanceMode}
        onCreateProject={openCreateProjectDialog}
        onCloseSearch={() => setSearchOpen(false)}
        onDeleteChat={handleDeleteChat}
        onDeleteProject={handleDeleteProject}
        onNewChat={handleNewChat}
        onOpenBulkDeleteChats={handleOpenBulkDeleteChats}
        onOpenSearch={() => setSearchOpen(true)}
        onLogout={onLogout}
        onRouteChange={handleRouteChange}
        onShowAbout={() => setAboutOpen(true)}
        onCloseTerminal={() => setTerminalOpen(false)}
        onSelectChat={handleSelectChat}
        onSettingsSectionChange={handleSettingsSectionChange}
        onTerminalHeightChange={setTerminalHeight}
        onToggleTerminal={handleToggleTerminal}
        onTogglePin={handleTogglePin}
        onToggleSidebar={() => setSidebarOpen((open) => !open)}
        terminalAttachedSession={terminalAttachedSession}
        terminalHeight={terminalHeight}
        terminalOpen={terminalOpen}
        terminalWorkingDirectory={localWorkspace.enabled && localWorkspace.roots[0] ? localWorkspace.roots[0] : defaultTerminalWorkingDirectory}
      >
        <div className="route-stack">
          <div className="route-panel" data-active={activeRoute === "chat"} data-route="chat" aria-hidden={activeRoute !== "chat"}>
            {renderChatPage()}
          </div>
          {activeRoute !== "chat" ? (
            <div className="route-panel" data-active="true" data-route={activeRoute}>
              <Suspense fallback={<RouteLoading />}>
                {renderUtilityPage()}
              </Suspense>
            </div>
          ) : null}
        </div>
      </AppShell>

      <ProviderConnectionDialog
        open={providerConnectionOpen}
        settings={providerSettings}
        onActivateProvider={handleProviderConnectionChoice}
        onClose={() => setProviderConnectionOpen(false)}
        onOpenNineRouterSettings={handleOpenProviderConnectionNineRouterSettings}
        onOpenProviderSettings={handleOpenProviderConnectionKeySettings}
      />

      <OnboardingDialog
        open={!providerConnectionOpen && onboardingOpen}
        onClose={handleSkipOnboarding}
        onNeverShowAgain={handleNeverShowOnboarding}
        onOpenSettings={handleOpenOnboardingSettings}
      />

      <BulkDeleteChatsDialog
        chats={chats}
        open={bulkDeleteChatsOpen}
        selectedChatIds={bulkDeleteChatIds}
        sendingChatIds={sendingChatIds}
        onClearSelection={handleClearBulkDeleteChats}
        onClose={() => {
          setBulkDeleteChatsOpen(false);
          setBulkDeleteChatIds([]);
        }}
        onConfirm={confirmBulkDeleteChats}
        onSelectAll={handleSelectAllBulkDeleteChats}
        onToggleChat={handleToggleBulkDeleteChat}
      />

      <TextInputDialog
        confirmLabel="Rename"
        description={pendingRenameChat ? `Current project: ${pendingRenameChat.project}` : undefined}
        error={renameChatError}
        label="Chat name"
        open={Boolean(pendingRenameChat)}
        placeholder="Chat name"
        title="Rename chat"
        value={renameChatTitle}
        onChange={(value) => {
          setRenameChatTitle(value);
          setRenameChatError(null);
        }}
        onClose={() => {
          setRenameChatId(null);
          setRenameChatTitle("");
          setRenameChatError(null);
        }}
        onSubmit={confirmRenameChat}
      />

      <ConfirmDialog
        confirmLabel="Delete chat"
        description="This removes the chat from local history."
        icon={Trash2}
        open={Boolean(pendingDeleteChat)}
        title="Delete chat?"
        tone="danger"
        onClose={() => setPendingDeleteChatId(null)}
        onConfirm={confirmDeleteChat}
      >
        {pendingDeleteChat ? (
          <dl className="dialog-detail-list">
            <div>
              <dt>Chat</dt>
              <dd>{pendingDeleteChat.title}</dd>
            </div>
            <div>
              <dt>Project</dt>
              <dd>{pendingDeleteChat.project}</dd>
            </div>
            <div>
              <dt>Messages</dt>
              <dd>{pendingDeleteChat.messages.length}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>

      <ConfirmDialog
        confirmLabel="Delete project"
        description="This removes the project and all of its chats from local history."
        icon={Trash2}
        open={Boolean(pendingDeleteProject)}
        title="Delete project?"
        tone="danger"
        onClose={() => setPendingDeleteProjectName(null)}
        onConfirm={confirmDeleteProject}
      >
        {pendingDeleteProject ? (
          <dl className="dialog-detail-list">
            <div>
              <dt>Project</dt>
              <dd>{pendingDeleteProject.name}</dd>
            </div>
            <div>
              <dt>Chats</dt>
              <dd>{pendingDeleteProjectChats.length}</dd>
            </div>
          </dl>
        ) : null}
      </ConfirmDialog>

      <NoticeDialog
        description={noticeDialog?.description}
        open={Boolean(noticeDialog)}
        title={noticeDialog?.title ?? ""}
        onClose={() => setNoticeDialog(null)}
      />

      <NoticeDialog
        buttonLabel="Close"
        description="Desktop agent workspace"
        icon={Info}
        open={aboutOpen}
        title={appInfo.name}
        onClose={() => setAboutOpen(false)}
      >
        <dl className="dialog-detail-list">
          <div>
            <dt>Version</dt>
            <dd>{appInfo.version}</dd>
          </div>
          <div>
            <dt>Phase</dt>
            <dd>{appInfo.phase}</dd>
          </div>
          <div>
            <dt>Runtime</dt>
            <dd>{appInfo.runtime}</dd>
          </div>
        </dl>
      </NoticeDialog>
    </>
  );
}
