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

export function renderUtilityPage(deps: WorkspaceRuntimeDeps) {
  const { activeRoute, activeSettingsSection, appearanceMode, appInfo, AppsPage, discordBridgeSettings, handleLocalWorkspaceChange, handleRouteChange, handleSubscriptionSandboxUninstalled, localWorkspace, locationServicesEnabled, personalizationSettings, projects, providerSettings, setActiveRoute, setActiveSettingsSection, setAppearanceMode, setDiscordBridgeSettings, setPersonalizationSettings, setProviderSettings, SettingsPage, SupportPage, WeatherRadarPage } = deps;

    if (activeRoute === "apps") {
      return (
        <AppsPage
          locationServicesEnabled={locationServicesEnabled}
          onBackToChat={() => setActiveRoute("chat")}
          onOpenRadar={() => handleRouteChange("radar")}
          onOpenSupport={() => handleRouteChange("support")}
        />
      );
    }

    if (activeRoute === "support") {
      return (
        <SupportPage
          onBackToChat={() => setActiveRoute("chat")}
        />
      );
    }

    if (activeRoute === "radar") {
      if (!locationServicesEnabled) {
        return null;
      }

      return (
        <WeatherRadarPage
          onBackToChat={() => setActiveRoute("chat")}
          onOpenMapboxSettings={() => {
            setActiveSettingsSection("weatherSources");
            setActiveRoute("settings");
          }}
        />
      );
    }

    if (activeRoute === "settings") {
      return (
        <SettingsPage
          activeSection={activeSettingsSection}
          appInfo={appInfo}
          appearanceMode={appearanceMode}
          discordBridge={discordBridgeSettings}
          localWorkspace={localWorkspace}
          personalization={personalizationSettings}
          projects={projects}
          settings={providerSettings}
          onAppearanceModeChange={setAppearanceMode}
          onDiscordBridgeChange={setDiscordBridgeSettings}
          onLocalWorkspaceChange={handleLocalWorkspaceChange}
          onPersonalizationChange={setPersonalizationSettings}
          onSettingsChange={setProviderSettings}
          onSubscriptionSandboxUninstalled={handleSubscriptionSandboxUninstalled}
        />
      );
    }

    return null;
  }

export function renderChatPage(deps: WorkspaceRuntimeDeps) {
  const { activeChat, activeChatProviderSettings, activeRoute, appInfo, browserPreviewTarget, ChatPage, chats, composerDraftToRestore, contextWindow, createToolAwareProviderSettings, getModelProvider, getProviderApiKey, handleActiveChatModelChange, handleAddAutomation, handleArchiveActiveChat, handleComposerDraftChange, handleCopyChatDeeplink, handleCopyChatMarkdown, handleCopySessionId, handleCopyWorkingDirectory, handleDeleteQueuedMessage, handleEditUserMessageAndRegenerate, handleForkActiveChatLocal, handleForkActiveChatWorktree, handleHoldQueuedMessage, handleLocalWorkspaceChange, handleNewChat, handleOpenActiveChatInNewWindow, handleOpenRenameChat, handleRegenerateResponse, handleRequestPlanRevision, handleResolveToolApproval, handleSelectChat, handleSelectProject, handleSendMessage, handleSteerQueuedMessage, handleStopGeneration, handleSubmitPlanningInput, handleTogglePin, handleToggleTerminal, handleUpdateQueuedMessage, isChatSending, lastContextCompaction, lastProviderContextUsage, localWorkspace, modelContextWindows, openCreateProjectDialog, projects, queuedChatSends, setComposerDraftToRestore, setProviderSettings, terminalOpen, toolSettings } = deps;

    return (
      <ChatPage
        active={activeRoute === "chat"}
        appInfo={appInfo}
        chat={activeChat}
        chats={chats}
        browserPreviewEnabled={toolSettings.browserPreview}
        browserPreviewRequestId={browserPreviewTarget?.id ?? 0}
        browserPreviewUrl={browserPreviewTarget?.url ?? null}
        composerDraft={activeChat.composerDraft ?? null}
        composerRestoreDraft={composerDraftToRestore?.draft ?? null}
        composerRestoreDraftId={composerDraftToRestore?.id ?? null}
        contextWindowSource={contextWindow.source}
        contextWindowTokens={contextWindow.tokens}
        hasApiKey={!getModelProvider(activeChatProviderSettings.provider).requiresApiKey || Boolean(getProviderApiKey(activeChatProviderSettings).trim())}
        isSending={isChatSending(activeChat.id)}
        lastContextCompaction={lastContextCompaction?.chatId === activeChat.id && lastContextCompaction.contextWindowTokens === contextWindow.tokens ? lastContextCompaction : null}
        localWorkspace={localWorkspace}
        model={activeChatProviderSettings.model}
        modelContextWindows={modelContextWindows}
        onComposerDraftApplied={() => setComposerDraftToRestore(null)}
        onComposerDraftChange={handleComposerDraftChange}
        onAddAutomation={handleAddAutomation}
        onArchiveChat={handleArchiveActiveChat}
        onCopyChatDeeplink={() => void handleCopyChatDeeplink()}
        onCopyChatMarkdown={() => void handleCopyChatMarkdown()}
        onCopySessionId={() => void handleCopySessionId()}
        onCopyWorkingDirectory={() => void handleCopyWorkingDirectory()}
        onForkChatLocal={handleForkActiveChatLocal}
        onForkChatWorktree={handleForkActiveChatWorktree}
        onLocalWorkspaceChange={handleLocalWorkspaceChange}
        onModelChange={handleActiveChatModelChange}
        onEditUserMessage={handleEditUserMessageAndRegenerate}
        onRequestPlanRevision={handleRequestPlanRevision}
        onRegenerateResponse={handleRegenerateResponse}
        onResolveToolApproval={handleResolveToolApproval}
        onSendMessage={handleSendMessage}
        onDeleteQueuedMessage={handleDeleteQueuedMessage}
        onHoldQueuedMessage={handleHoldQueuedMessage}
        onSteerQueuedMessage={handleSteerQueuedMessage}
        onUpdateQueuedMessage={handleUpdateQueuedMessage}
        onStopGeneration={handleStopGeneration}
        onSubmitPlanningInput={handleSubmitPlanningInput}
        lastProviderContextUsage={lastProviderContextUsage?.chatId === activeChat.id ? lastProviderContextUsage.usage : null}
        onCreateProject={openCreateProjectDialog}
        providerSettings={createToolAwareProviderSettings({}, activeChat)}
        projects={projects}
        queuedMessageCount={queuedChatSends.filter((queuedSend) => queuedSend.chatId === activeChat.id).length}
        heldQueuedMessageIds={queuedChatSends.filter((queuedSend) => queuedSend.chatId === activeChat.id && queuedSend.held).map((queuedSend) => queuedSend.userMessageId)}
        onSelectProject={handleSelectProject}
        onImageGenerationChange={(enabled) => setProviderSettings((settings) => ({ ...settings, tools: { ...settings.tools, imageGeneration: enabled } }))}
        onThinkingChange={(nextThinking) => setProviderSettings((settings) => ({ ...settings, thinking: nextThinking }))}
        onWebSearchChange={(nextWebSearch) => setProviderSettings((settings) => ({ ...settings, webSearch: nextWebSearch }))}
        thinking={activeChatProviderSettings.thinking}
        webSearch={activeChatProviderSettings.webSearch}
        onTogglePin={() => activeChat && handleTogglePin(activeChat.id)}
        onToggleTerminal={handleToggleTerminal}
        onOpenChatInNewWindow={handleOpenActiveChatInNewWindow}
        onOpenSideChat={() => handleNewChat(activeChat.project)}
        onRenameChat={() => handleOpenRenameChat(activeChat)}
        onSelectChat={handleSelectChat}
        terminalEnabled={toolSettings.terminal}
        terminalOpen={terminalOpen}
      />
    );
  }

export function handleSkipOnboarding(deps: WorkspaceRuntimeDeps) {
  const { setOnboardingOpen } = deps;

    setOnboardingOpen(false);
  }

export function handleNeverShowOnboarding(deps: WorkspaceRuntimeDeps) {
  const { ONBOARDING_NEVER_SHOW_KEY, savePersistentString, setOnboardingOpen } = deps;

    savePersistentString(ONBOARDING_NEVER_SHOW_KEY, "true");
    setOnboardingOpen(false);
  }

export function handleOpenOnboardingSettings(deps: WorkspaceRuntimeDeps) {
  const { setActiveRoute, setActiveSettingsSection, setOnboardingOpen } = deps;

    setActiveSettingsSection("model");
    setActiveRoute("settings");
    setOnboardingOpen(false);
  }

export function handleOpenProviderConnectionNineRouterSettings(deps: WorkspaceRuntimeDeps) {
  const { setActiveRoute, setActiveSettingsSection, setProviderConnectionOpen } = deps;

    setActiveSettingsSection("nineRouter");
    setActiveRoute("settings");
    setProviderConnectionOpen(false);
  }

export function handleOpenProviderConnectionKeySettings(deps: WorkspaceRuntimeDeps) {
  const { setActiveRoute, setActiveSettingsSection, setProviderConnectionOpen } = deps;

    setActiveSettingsSection("model");
    setActiveRoute("settings");
    setProviderConnectionOpen(false);
  }

export function handleRouteChange(deps: WorkspaceRuntimeDeps, route: PrimaryRoute) {
  const { locationServicesEnabled, setActiveRoute, setNoticeDialog } = deps;

    if (route === "radar" && !locationServicesEnabled) {
      setActiveRoute("chat");
      setNoticeDialog({
        description: "Weather, radar, Mapbox weather settings, and location-based refreshes stay hidden while location services are off. Turn them back on in Settings > Weather & Maps.",
        title: "Location services are off",
      });
      return;
    }

    setActiveRoute(route);
  }

export function handleSettingsSectionChange(deps: WorkspaceRuntimeDeps, section: SettingsSectionId) {
  const { resolveSettingsNavSection, setActiveSettingsSection } = deps;

    setActiveSettingsSection(resolveSettingsNavSection(section));
  }
