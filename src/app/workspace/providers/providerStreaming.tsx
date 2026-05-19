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

export async function runParallelSubagents(deps: WorkspaceRuntimeDeps, tasks: LocalSubagentTask[], baseMessages: ChatMessage[], prompt: string, signal: AbortSignal, chat: ChatSummary | null | undefined): Promise<LocalSubagentResult[]> {
  const { createFinalOnlyProviderSettings, createMessage, resolveContextWindowForModel, sendProviderMessage } = deps;

    const baseSubagentSettings = createFinalOnlyProviderSettings(undefined, chat);
    const subagentSettings: ProviderSettings = {
      ...baseSubagentSettings,
      maxTokens: Math.max(baseSubagentSettings.maxTokens, 2048),
      temperature: Math.min(baseSubagentSettings.temperature ?? 0.7, 0.3),
    };

    return Promise.all(
      tasks.map(async (task, index) => {
        const title = task.title || `Sub-agent ${index + 1}`;

        try {
          const response = await sendProviderMessage(
            subagentSettings,
            [
              ...baseMessages,
              createMessage(
                "user",
                [
                  "PARALLEL SUB-AGENT TASK",
                  `Main user request: ${prompt}`,
                  `Sub-agent title: ${title}`,
                  task.prompt,
                  "Return concise findings with evidence from the provided chat/tool context. Do not claim to edit files or run tools.",
                ].join("\n\n"),
              ),
            ],
            {
              contextWindowTokens: resolveContextWindowForModel(subagentSettings.model, subagentSettings).tokens,
              signal,
            },
          );

          return {
            content: response.content,
            id: task.id || `subagent-${index + 1}`,
            title,
          };
        } catch (error) {
          return {
            content: "",
            error: error instanceof Error ? error.message : "Sub-agent failed.",
            id: task.id || `subagent-${index + 1}`,
            title,
          };
        }
      }),
    );
  }

export async function streamProviderMessageWithRetry(deps: WorkspaceRuntimeDeps, chatId: string, settings: ProviderSettings, messages: ChatMessage[], onUpdate: Parameters<typeof streamProviderMessage>[2], options: Parameters<typeof streamProviderMessage>[3], messageId: string) {
  const { compactProviderMessages, createContextCompactionProgress, createEmptyResponseRetrySettings, createMessage, createProviderPayloadGuardrailProgress, createProviderRetryInstruction, isProviderEmptyResponseError, isRetryableProviderMessageError, recordProviderActualUsage, recordProviderContextUsage, runProviderRetryWithTimeout, streamProviderMessage, updateGeneratedMessage, withContextCompactionMarker, withContextCompactionProgress, withProviderPayloadGuardrailProgress } = deps;

    const initialUsage = recordProviderContextUsage(chatId, messages, settings, { toolBridge: options.toolBridge });
    const initialPayloadGuardrailProgress = createProviderPayloadGuardrailProgress(initialUsage);

    if (messageId && initialPayloadGuardrailProgress) {
      updateGeneratedMessage(chatId, messageId, (message) => ({
        ...message,
        progress: withProviderPayloadGuardrailProgress(initialPayloadGuardrailProgress, message.progress),
      }));
    }

    try {
      const response = await streamProviderMessage(settings, messages, onUpdate, {
        ...options,
        contextWindowTokens: initialUsage.contextWindowTokens,
      });
      recordProviderActualUsage(chatId, messages, settings, response.usage, { toolBridge: options.toolBridge });
      return response;
    } catch (error) {
      if (options.signal?.aborted || !isRetryableProviderMessageError(error)) {
        throw error;
      }

      const retrySettings = createEmptyResponseRetrySettings(settings);
      const retryCompaction = compactProviderMessages(messages, retrySettings, {
        toolBridge: options.toolBridge,
      });
      const compactedMessages = retryCompaction.messages;

      if (messageId && retryCompaction.contextCompaction) {
        const compactionProgress = createContextCompactionProgress(retryCompaction);

        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...withContextCompactionMarker(message, retryCompaction.contextCompaction),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      }

      const retryInstruction = createMessage(
        "user",
        createProviderRetryInstruction(messages, isProviderEmptyResponseError(error)),
      );
      const retryMessages = [...compactedMessages, retryInstruction];

      const retryUsage = recordProviderContextUsage(chatId, retryMessages, retrySettings, { toolBridge: options.toolBridge });
      const retryPayloadGuardrailProgress = createProviderPayloadGuardrailProgress(retryUsage);

      if (messageId && retryPayloadGuardrailProgress) {
        updateGeneratedMessage(chatId, messageId, (message) => ({
          ...message,
          progress: withProviderPayloadGuardrailProgress(retryPayloadGuardrailProgress, message.progress),
        }));
      }

      const response = await runProviderRetryWithTimeout(options.signal, (signal) =>
        streamProviderMessage(retrySettings, retryMessages, onUpdate, {
          ...options,
          contextWindowTokens: retryUsage.contextWindowTokens,
          signal,
        }),
      );
      recordProviderActualUsage(chatId, retryMessages, retrySettings, response.usage, { toolBridge: options.toolBridge });
      return response;
    }
  }

export async function runProviderRetryWithTimeout<T>(deps: WorkspaceRuntimeDeps, parentSignal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>) {
  const { DOMException, MESSAGE_RETRY_TIMEOUT_MS } = deps;

    const retryController = new AbortController();
    const abortRetry = () => retryController.abort();
    const timeoutId = window.setTimeout(abortRetry, MESSAGE_RETRY_TIMEOUT_MS);

    if (parentSignal?.aborted) {
      window.clearTimeout(timeoutId);
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    parentSignal?.addEventListener("abort", abortRetry, { once: true });

    try {
      return await run(retryController.signal);
    } catch (error) {
      if (retryController.signal.aborted && !parentSignal?.aborted) {
        throw new Error("The response retry did not finish within 10 seconds.");
      }

      throw error;
    } finally {
      window.clearTimeout(timeoutId);
      parentSignal?.removeEventListener("abort", abortRetry);
    }
  }

export function createProviderRetryInstruction(deps: WorkspaceRuntimeDeps, messages: ChatMessage[], emptyResponse: boolean) {
  const { hasLocalToolEvidence } = deps;

    return [
      emptyResponse ? "RETRY AFTER EMPTY PROVIDER RESPONSE" : "RETRY AFTER TRANSIENT PROVIDER FAILURE",
      emptyResponse ? "The previous stream produced no visible final answer." : "The previous provider request failed before a complete visible answer was produced.",
      hasLocalToolEvidence(messages)
        ? "Previously gathered observations are already present above. Use them silently: emit the next needed tool_call only if work is unfinished, or write the direct final answer if it is done."
        : "Answer the latest real user request above now.",
      "Produce visible answer text. Do not leave the visible answer blank.",
      "Do not mention provider behavior, app recovery, saved evidence, tool loops, continuation, fallback text, or retry attempts.",
    ].join("\n\n");
  }

export function isRetryableProviderMessageError(deps: WorkspaceRuntimeDeps, error: unknown) {
  const { isProviderEmptyResponseError } = deps;

    if (isProviderEmptyResponseError(error)) {
      return true;
    }

    if (!(error instanceof Error)) {
      return false;
    }

    const message = error.message.toLowerCase();

    return (
      /\bhttp\s+(?:408|409|425|429|500|502|503|504|520|521|522|523|524)\b/.test(message) ||
      /\b(max(?:imum)? context length|context length|context window|too many tokens|requested about \d+ tokens|reduce the length)\b/.test(message) ||
      /\b(fetch failed|failed to fetch|network|timeout|timed out|temporarily unavailable|connection reset|connection refused|econnreset|etimedout)\b/.test(message)
    );
  }

export function hasLocalToolEvidence(deps: WorkspaceRuntimeDeps, messages: ChatMessage[]) {

    return messages.some(
      (message) =>
        message.content.includes("AGENT TOOL RESULTS") ||
        message.content.includes("LOCAL COMPUTER TOOL RESULTS") ||
        message.toolCalls?.some((toolCall) => toolCall.status === "complete" || toolCall.status === "error" || toolCall.status === "skipped"),
    );
  }

export function createEmptyResponseRetrySettings(deps: WorkspaceRuntimeDeps, settings: ProviderSettings): ProviderSettings {
  const { LOCAL_TOOL_FINAL_MIN_TOKENS } = deps;

    const retrySettings: ProviderSettings = {
      ...settings,
      maxTokens: Math.max(settings.maxTokens, LOCAL_TOOL_FINAL_MIN_TOKENS),
      temperature: Math.min(settings.temperature, 0.25),
    };

    if (!settings.thinking.enabled) {
      return retrySettings;
    }

    return {
      ...retrySettings,
      thinking: {
        ...settings.thinking,
        enabled: false,
        effort: "low",
      },
    };
  }

export function updateGeneratedMessage(deps: WorkspaceRuntimeDeps, chatId: string, messageId: string, updateMessage: (message: ChatMessage) => ChatMessage, sortByUpdatedAt) {
  const { pendingChatsRef, preserveVisibleResponseThinking, setChats, sortChatsByUpdatedAt } = deps;

    setChats((currentChats) => {
      const nextChats = currentChats.map((chat) =>
        chat.id === chatId
          ? {
              ...chat,
              messages: chat.messages.map((message) => (message.id === messageId ? preserveVisibleResponseThinking(message, updateMessage(message)) : message)),
              updatedAt: sortByUpdatedAt ? new Date().toISOString() : chat.updatedAt,
            }
          : chat,
      );

      const committedChats = sortByUpdatedAt ? sortChatsByUpdatedAt(nextChats) : nextChats;
      pendingChatsRef.current = committedChats;
      return committedChats;
    });
  }

export function preserveVisibleResponseThinking(deps: WorkspaceRuntimeDeps, previousMessage: ChatMessage, nextMessage: ChatMessage): ChatMessage {
  const { mergeMessageWorkTrace } = deps;

    if (previousMessage.role !== "assistant" || nextMessage.role !== "assistant") {
      return nextMessage;
    }

    return {
      ...nextMessage,
      reasoning: undefined,
      responseThinking: nextMessage.responseThinking ?? previousMessage.responseThinking,
      workTrace: mergeMessageWorkTrace(previousMessage, nextMessage),
    };
  }

export function createInterruptedResponseContextMessages(deps: WorkspaceRuntimeDeps, message: ChatMessage, prompt: string) {
  const { createId, createInterruptedResponseContinuationInstruction, createMessage, isToolResultFallbackAnswer } = deps;

    const content = message.content.includes("I reached the agent tool budget for this run") || isToolResultFallbackAnswer(message.content) ? "" : message.content;
    const assistantContext: ChatMessage = {
      ...message,
      agentRunStatus: undefined,
      content,
      id: createId("interrupted-response-context"),
      isStreaming: false,
      status: undefined,
    };

    return [assistantContext, createMessage("user", createInterruptedResponseContinuationInstruction(prompt, message))];
  }

export function createSteeringInstruction(deps: WorkspaceRuntimeDeps, steerContent: string, originalPrompt: string) {

    return [
      "USER STEERING MESSAGE",
      originalPrompt ? `Original user request: ${originalPrompt}` : "",
      "The user sent this while your response was in progress. Use it to steer the same response, not as a separate follow-up turn.",
      "Adjust course immediately and continue with one coherent answer.",
      steerContent,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

export function withSteeringProgress(deps: WorkspaceRuntimeDeps, progress: ChatProgressItem[] | undefined) {
  const { removeSteeringProgress, STEERING_PROGRESS_ID } = deps;

    const progressWithoutSteering = removeSteeringProgress(progress) ?? [];

    return [
      {
        detail: "Applying queued steering message to this response",
        id: STEERING_PROGRESS_ID,
        label: "Steer response",
        status: "active",
      } satisfies ChatProgressItem,
      ...progressWithoutSteering,
    ];
  }

export function removeSteeringProgress(deps: WorkspaceRuntimeDeps, progress: ChatProgressItem[] | undefined) {
  const { STEERING_PROGRESS_ID } = deps;

    const nextProgress = (progress ?? []).filter((item) => item.id !== STEERING_PROGRESS_ID);

    return nextProgress.length > 0 ? nextProgress : undefined;
  }
