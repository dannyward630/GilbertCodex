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

export async function handleDiscordInteraction(deps: WorkspaceRuntimeDeps, interaction: DiscordInteractionEvent) {
  const { createDiscordMessageSource, discordBridgeSettingsRef, isChatSending, localWorkspace, providerSettings, resolveDiscordSourceChat, sendDiscordReply, startSendMessage, toolSettings } = deps;

    const settings = discordBridgeSettingsRef.current;
    const replyTarget: DiscordReplyTarget = {
      applicationId: interaction.applicationId,
      channelId: interaction.channelId,
      interactionId: interaction.id,
      token: interaction.token,
      username: interaction.username,
    };

    if (!settings.enabled || settings.mode !== "interactions") {
      await sendDiscordReply(replyTarget, "Gilbert received the command, but the Discord bridge is disabled in Settings.");
      return;
    }

    if (!toolSettings.provider) {
      await sendDiscordReply(replyTarget, "Gilbert's model provider is off. Turn it back on in Settings before using Discord chat.");
      return;
    }

    const sourceChat = resolveDiscordSourceChat(interaction);

    if (isChatSending(sourceChat.id)) {
      await sendDiscordReply(replyTarget, "Gilbert is already working in that Discord conversation. Try again after that response finishes.");
      return;
    }

    const input: ChatSendInput = {
      attachments: [],
      content: interaction.prompt,
      localWorkspace,
      mode: "chat",
      webSearch:
        toolSettings.webSearch && providerSettings.webSearch.enabled
          ? {
              enabled: true,
              maxResults: providerSettings.webSearch.maxResults,
              provider: providerSettings.webSearch.provider,
            }
          : undefined,
    };

    await startSendMessage(input, undefined, {
      discordReply: replyTarget,
      sourceChat,
      userMessageSource: createDiscordMessageSource(interaction),
    });
  }

export function resolveDiscordSourceChat(deps: WorkspaceRuntimeDeps, interaction: DiscordInteractionEvent) {
  const { createEmptyChat, findLatestDiscordConversationChat, isDiscordNewChatCommand, resolveDiscordChatProject } = deps;

    if (isDiscordNewChatCommand(interaction)) {
      return createEmptyChat(resolveDiscordChatProject());
    }

    return findLatestDiscordConversationChat(interaction) ?? createEmptyChat(resolveDiscordChatProject());
  }

export function findLatestDiscordConversationChat(deps: WorkspaceRuntimeDeps, interaction: DiscordInteractionEvent) {
  const { discordSourceMatchesInteraction, pendingChatsRef } = deps;

    return pendingChatsRef.current
      .filter((chat) => !chat.archived && chat.messages.some((message) => message.source?.kind === "discord" && discordSourceMatchesInteraction(message.source, interaction)))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0];
  }

export function discordSourceMatchesInteraction(deps: WorkspaceRuntimeDeps, source: NonNullable<ChatMessage["source"]>, interaction: DiscordInteractionEvent) {

    if (source.channelId && interaction.channelId && source.channelId === interaction.channelId) {
      return true;
    }

    if (source.guildId && interaction.guildId && source.userId && interaction.userId) {
      return source.guildId === interaction.guildId && source.userId === interaction.userId;
    }

    if (source.userId && interaction.userId && !source.guildId && !interaction.guildId) {
      return source.userId === interaction.userId;
    }

    return false;
  }

export function createDiscordMessageSource(deps: WorkspaceRuntimeDeps, interaction: DiscordInteractionEvent): NonNullable<ChatMessage["source"]> {
  const { normalizeDiscordCommandName } = deps;

    return {
      channelId: interaction.channelId ?? undefined,
      commandName: normalizeDiscordCommandName(interaction.commandName) || undefined,
      guildId: interaction.guildId ?? undefined,
      kind: "discord",
      receivedAt: new Date(interaction.receivedAt).toISOString(),
      userId: interaction.userId ?? undefined,
      username: interaction.username ?? undefined,
    };
  }

export function isDiscordNewChatCommand(deps: WorkspaceRuntimeDeps, interaction: DiscordInteractionEvent) {
  const { DISCORD_NEW_CHAT_COMMAND, normalizeDiscordCommandName } = deps;

    return normalizeDiscordCommandName(interaction.commandName) === DISCORD_NEW_CHAT_COMMAND;
  }

export function normalizeDiscordCommandName(deps: WorkspaceRuntimeDeps, commandName: string | null) {

    return commandName?.trim().toLowerCase() ?? "";
  }

export function resolveDiscordChatProject(deps: WorkspaceRuntimeDeps) {
  const { activeChat, DEFAULT_PROJECT } = deps;

    return activeChat.project.toLowerCase() === "discord" ? DEFAULT_PROJECT : activeChat.project || DEFAULT_PROJECT;
  }

export async function sendDiscordReply(deps: WorkspaceRuntimeDeps, target: DiscordReplyTarget | undefined, content: string) {
  const { sendDiscordInteractionResponse } = deps;

    if (!target) {
      return;
    }

    try {
      await sendDiscordInteractionResponse({
        applicationId: target.applicationId,
        content: content.trim() || "Gilbert finished, but there was no visible response text.",
        token: target.token,
      });
    } catch (error) {
      console.warn("Could not send Discord interaction response", error);
    }
  }

export function createDiscordResponseStreamer(deps: WorkspaceRuntimeDeps, target: DiscordReplyTarget) {
  const { DISCORD_STREAM_UPDATE_INTERVAL_MS, formatDiscordStreamMessage, sendDiscordInteractionResponse, waitForDiscordFlushSlot } = deps;

    let latestUpdate: DiscordStreamUpdate = {
      status: "Gilbert received your Discord request.",
    };
    let latestText = formatDiscordStreamMessage(latestUpdate, false);
    let lastSentText = "";
    let lastSentAt = 0;
    let flushInFlight = false;
    let flushRequested = false;
    let timerId: number | null = null;

    function mergeUpdate(update: DiscordStreamUpdate) {
      latestUpdate = {
        ...latestUpdate,
        ...update,
        content: update.content ?? latestUpdate.content,
        progress: update.progress ?? latestUpdate.progress,
        sources: update.sources && update.sources.length > 0 ? update.sources : latestUpdate.sources,
        toolCall: update.toolCall ?? latestUpdate.toolCall,
      };
      latestText = formatDiscordStreamMessage(latestUpdate, false);
    }

    function update(update: DiscordStreamUpdate) {
      mergeUpdate(update);
      scheduleFlush(false);
    }

    function scheduleFlush(force: boolean) {
      if (force) {
        void flush(true);
        return;
      }

      if (timerId !== null) {
        return;
      }

      const delay = Math.max(DISCORD_STREAM_UPDATE_INTERVAL_MS - (Date.now() - lastSentAt), 250);
      timerId = window.setTimeout(() => {
        timerId = null;
        void flush(false);
      }, delay);
    }

    async function flush(force: boolean) {
      if (flushInFlight) {
        flushRequested = true;

        if (force) {
          await waitForDiscordFlushSlot();
          await flush(true);
        }

        return;
      }

      if (!force && latestText === lastSentText) {
        return;
      }

      flushInFlight = true;

      try {
        lastSentText = latestText;
        lastSentAt = Date.now();
        await sendDiscordInteractionResponse({
          applicationId: target.applicationId,
          content: latestText,
          token: target.token,
        });
      } catch (error) {
        console.warn("Could not stream Discord interaction response", error);
      } finally {
        flushInFlight = false;

        if (flushRequested) {
          flushRequested = false;
          scheduleFlush(false);
        }
      }
    }

    async function finish(content: string, update: DiscordStreamUpdate = {}) {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }

      mergeUpdate({
        ...update,
        content,
        status: "Complete",
      });
      latestText = formatDiscordStreamMessage(latestUpdate, true);
      await flush(true);
    }

    async function fail(content: string) {
      if (timerId !== null) {
        window.clearTimeout(timerId);
        timerId = null;
      }

      latestUpdate = {
        content,
        status: "Error",
      };
      latestText = formatDiscordStreamMessage(latestUpdate, true);
      await flush(true);
    }

    update(latestUpdate);

    return {
      fail,
      finish,
      update,
    };
  }
