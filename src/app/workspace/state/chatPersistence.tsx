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

const DRAFT_CHAT_PERSISTENCE_DELAY_MS = 1_200;

export function persistChatState(deps: WorkspaceRuntimeDeps, nextChats: ChatSummary[], previousChats: ChatSummary[]) {
  const { pendingChatsRef, queueDurableMemoryForChangedChats, scheduleChatStatePersistence } = deps;

    pendingChatsRef.current = nextChats;
    scheduleChatStatePersistence(nextChats);
    queueDurableMemoryForChangedChats(nextChats, previousChats);
  }

export function setChats(deps: WorkspaceRuntimeDeps, update: SetStateAction<ChatSummary[]>) {
  const { chats, pendingChatsRef, persistChatState, setChatsState } = deps;

    const currentChats = pendingChatsRef.current;
    const nextChats = typeof update === "function" ? (update as (currentChats: ChatSummary[]) => ChatSummary[])(currentChats) : update;

    if (nextChats === currentChats) {
      if (nextChats !== chats) {
        persistChatState(nextChats, chats);
        setChatsState(nextChats);
      }
      return;
    }

    persistChatState(nextChats);
    setChatsState(nextChats);
  }

export function handleComposerDraftChange(deps: WorkspaceRuntimeDeps, chatId: string, draft: ChatComposerDraft | null) {
  const { activeChatIdRef, hasComposerDraftContent, pendingChatsRef, pruneEmptyChats, sameComposerDraft, scheduleChatStatePersistence, setChatsState, sortChatsByUpdatedAt } = deps;

    const nextDraft = hasComposerDraftContent(draft) ? draft : undefined;
    let changed = false;
    let shouldSort = false;
    const now = new Date().toISOString();
    const nextChats = pendingChatsRef.current.map((chat) => {
      if (chat.id !== chatId) {
        return chat;
      }

      if (sameComposerDraft(chat.composerDraft, nextDraft)) {
        return chat;
      }

      changed = true;
      const hadDraft = hasComposerDraftContent(chat.composerDraft);
      const nextUpdatedAt = !hadDraft && nextDraft ? now : chat.updatedAt;
      shouldSort = shouldSort || nextUpdatedAt !== chat.updatedAt;
      return {
        ...chat,
        composerDraft: nextDraft,
        isDraft: chat.messages.length === 0 ? true : chat.isDraft,
        updatedAt: nextUpdatedAt,
      };
    });

    if (!changed) {
      return;
    }

    const nextPrunedChats = pruneEmptyChats(nextChats, activeChatIdRef.current);
    const prunedChats = shouldSort || nextPrunedChats.length !== nextChats.length
      ? sortChatsByUpdatedAt(nextPrunedChats)
      : nextPrunedChats;
    pendingChatsRef.current = prunedChats;
    scheduleChatStatePersistence(prunedChats, DRAFT_CHAT_PERSISTENCE_DELAY_MS);
    setChatsState(prunedChats);
  }

export function queueDurableMemoryForChangedChats(deps: WorkspaceRuntimeDeps, nextChats: ChatSummary[], previousChats: ChatSummary[]) {
  const { chatMemoryFingerprintsRef, DURABLE_MEMORY_PERSIST_DELAY_MS, isEmptyChat, pendingDurableMemoryChatIdsRef, priorityDurableMemoryChatIdsRef, queueDurableMemoryForChatIds } = deps;

    const previousById = new Map(previousChats.map((chat) => [chat.id, chat]));
    const changedChatIds: string[] = [];

    for (const chat of nextChats) {
      if (chat.messagesLoaded === false) {
        continue;
      }

      if (chat.messages.some((message) => message.role === "assistant" && message.isStreaming)) {
        continue;
      }

      if (isEmptyChat(chat)) {
        chatMemoryFingerprintsRef.current.delete(chat.id);
        pendingDurableMemoryChatIdsRef.current.delete(chat.id);
        priorityDurableMemoryChatIdsRef.current.delete(chat.id);
        continue;
      }

      if (previousById.get(chat.id) === chat) {
        continue;
      }

      changedChatIds.push(chat.id);
    }

    queueDurableMemoryForChatIds(changedChatIds, DURABLE_MEMORY_PERSIST_DELAY_MS, true);
  }

export function queueDurableMemoryForChatIds(deps: WorkspaceRuntimeDeps, chatIds: string[], delayMs, priority) {
  const { pendingDurableMemoryChatIdsRef, priorityDurableMemoryChatIdsRef, scheduleDurableMemoryFlush } = deps;

    for (const chatId of chatIds) {
      pendingDurableMemoryChatIdsRef.current.add(chatId);

      if (priority) {
        priorityDurableMemoryChatIdsRef.current.add(chatId);
      }
    }

    if (chatIds.length > 0) {
      scheduleDurableMemoryFlush(delayMs);
    }
  }

export function scheduleDurableMemoryFlush(deps: WorkspaceRuntimeDeps, delayMs: number) {
  const { DURABLE_MEMORY_BATCH_DELAY_MS, durableMemoryFlushTimerRef, flushDurableMemoryQueue } = deps;

    if (durableMemoryFlushTimerRef.current !== null && delayMs >= DURABLE_MEMORY_BATCH_DELAY_MS) {
      return;
    }

    if (durableMemoryFlushTimerRef.current !== null) {
      window.clearTimeout(durableMemoryFlushTimerRef.current);
    }

    durableMemoryFlushTimerRef.current = window.setTimeout(flushDurableMemoryQueue, delayMs);
  }

export function flushDurableMemoryQueue(deps: WorkspaceRuntimeDeps) {
  const { DURABLE_MEMORY_BATCH_DELAY_MS, DURABLE_MEMORY_BATCH_SIZE, durableMemoryFlushTimerRef, pendingDurableMemoryChatIdsRef, persistDurableMemoryForChatId, scheduleDurableMemoryFlush, takeNextDurableMemoryChatId } = deps;

    durableMemoryFlushTimerRef.current = null;

    for (let index = 0; index < DURABLE_MEMORY_BATCH_SIZE; index += 1) {
      const chatId = takeNextDurableMemoryChatId();

      if (!chatId) {
        break;
      }

      persistDurableMemoryForChatId(chatId);
    }

    if (pendingDurableMemoryChatIdsRef.current.size > 0) {
      scheduleDurableMemoryFlush(DURABLE_MEMORY_BATCH_DELAY_MS);
    }
  }

export function takeNextDurableMemoryChatId(deps: WorkspaceRuntimeDeps) {
  const { pendingDurableMemoryChatIdsRef, priorityDurableMemoryChatIdsRef } = deps;

    const priorityChatId = priorityDurableMemoryChatIdsRef.current.values().next().value as string | undefined;
    const chatId = priorityChatId ?? (pendingDurableMemoryChatIdsRef.current.values().next().value as string | undefined);

    if (!chatId) {
      return undefined;
    }

    priorityDurableMemoryChatIdsRef.current.delete(chatId);
    pendingDurableMemoryChatIdsRef.current.delete(chatId);
    return chatId;
  }

export function persistDurableMemoryForChatId(deps: WorkspaceRuntimeDeps, chatId: string) {
  const { chatMemoryFingerprintsRef, createChatMemoryFingerprint, isEmptyChat, loadPersistentString, localWorkspaceRef, pendingChatsRef, persistDurableMemoryFromChat, resolveWorkspaceForChatProject, savePersistentString } = deps;

    const chat = pendingChatsRef.current.find((candidate) => candidate.id === chatId);

    if (!chat || chat.messagesLoaded === false || isEmptyChat(chat) || chat.messages.some((message) => message.role === "assistant" && message.isStreaming)) {
      chatMemoryFingerprintsRef.current.delete(chatId);
      return;
    }

    try {
      const workspaceSettings = resolveWorkspaceForChatProject(chat.project, localWorkspaceRef.current);
      const fingerprint = createChatMemoryFingerprint(chat, workspaceSettings);

      if (chatMemoryFingerprintsRef.current.get(chat.id) === fingerprint) {
        return;
      }

      persistDurableMemoryFromChat({
        chat,
        indexSummary: workspaceSettings.indexSummary,
        now: new Date().toISOString(),
        storage: {
          read: loadPersistentString,
          write: savePersistentString,
        },
        workspaceSettings,
      });
      chatMemoryFingerprintsRef.current.set(chat.id, fingerprint);
    } catch {
      // Memory must never block or break the chat UI.
    }
  }
