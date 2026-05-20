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

export async function handleSendMessage(deps: WorkspaceRuntimeDeps, input: ChatSendInput) {
  const { activeChat, enqueueChatSend, handleSteerQueuedMessage, isChatSending, startSendMessage } = deps;

    if (isChatSending(activeChat.id)) {
      const queuedMessageId = enqueueChatSend(input);

      if (input.followUpBehavior === "steer" && queuedMessageId) {
        const defer = typeof window === "undefined" ? setTimeout : window.setTimeout;
        defer(() => handleSteerQueuedMessage(queuedMessageId, input.content), 0);
      }

      return;
    }

    await startSendMessage(input);
  }

export async function startSendMessage(deps: WorkspaceRuntimeDeps, input: ChatSendInput, queuedSend: { chatId: string; queuedMessageId: string }, options: StartSendMessageOptions) {
  const { activeChat, CONTEXT_COMPACTION_PROGRESS_ID, createActiveGeneration, createAgentRunForMessage, createChatToolSelectionPrompt, createDiscordResponseStreamer, createDiscordRuntimeContextMessages, createEmptyChat, createFallbackChatTitle, createId, createMessage, createMessagesForProvider, createPlanningExecutionApproval, createPlanningInputRequest, createPlanningProgress, createPlanResearchFollowupInstruction, createPlanResearchInstruction, createPromptAwareProviderSettings, createToolAwareProviderSettings, DEFAULT_PROJECT, finishActiveGeneration, formatResearchPayload, formatTokenCount, getEnabledWorkspaceRoots, getRuntimeWebSearchSettings, isAbortError, isChatSending, isRequestInactive, isResearchDeepEnough, localWorkspaceRef, mergeAgentApprovals, mergeChatArtifacts, mergeChatSources, notifyPlanningInputNeeded, notifyRunComplete, notifyRunNeedsAttention, PENDING_CHAT_TITLE, pendingChatsRef, PLAN_RESEARCH_BUDGET, preserveVisibleResponseThinking, providerSettings, recordPlanningProviderRequest, recordPlanningProviderUsage, resolveChatResearchReferences, resolveWorkspaceForChatProject, runAppOwnedCodingAgent, runPlanningMode, scheduleGeneratedChatTitle, sendDiscordReply, setActiveChatId, setActiveGenerationTarget, setActiveRoute, setAgentRunCompleted, setAgentRunFailed, setAgentRunWaiting, setChats, setNoticeDialog, shouldStartAppAgentRun, sortChatsByUpdatedAt, stopStaleStreamingMessages, streamAssistantWithLocalTools, summarizeResearchEvidence, toolSettings, touchProject, updateAgentRun, updateGeneratedMessage, withContextCompactionMarker, withContextCompactionProgress, withLocalComputerProgress, withWebSearchProgress } = deps;

    const content = input.content.trim();
    const attachments = input.attachments;
    const sourceChat = options.sourceChat ?? (queuedSend ? pendingChatsRef.current.find((chat) => chat.id === queuedSend.chatId && !chat.archived) : activeChat);
    const currentChat = sourceChat ?? createEmptyChat(DEFAULT_PROJECT);

    if (isChatSending(currentChat.id)) {
      await sendDiscordReply(options.discordReply, "Gilbert is already working in that conversation. Try again after that response finishes.");
      return;
    }

    if (!toolSettings.provider) {
      setNoticeDialog({
        description: "Turn Model Provider back on in Settings before sending a chat request.",
        title: "Model Provider is off",
      });
      await sendDiscordReply(options.discordReply, "Gilbert's model provider is off. Turn it back on in Settings before using Discord chat.");
      return;
    }

    const isPlanningMode = toolSettings.planning && input.mode === "plan";
    const workspaceSettings = resolveWorkspaceForChatProject(currentChat.project, input.localWorkspace ?? localWorkspaceRef.current);
    const effectiveProviderSettings = createPromptAwareProviderSettings(content, {}, currentChat);
    const runtimeWebSearchSettings = getRuntimeWebSearchSettings(providerSettings, input.webSearch);
    const webSearchToolAvailable = Boolean(toolSettings.webSearch && runtimeWebSearchSettings.enabled);
    const discordStreamer = options.discordReply ? createDiscordResponseStreamer(options.discordReply) : undefined;
    const queuedMessageIndex = queuedSend ? currentChat.messages.findIndex((message) => message.id === queuedSend.queuedMessageId && message.role === "user") : -1;
    const queuedMessage = queuedMessageIndex >= 0 ? currentChat.messages[queuedMessageIndex] : undefined;

    const currentChatExisted = pendingChatsRef.current.some((chat) => chat.id === currentChat.id);
    const restoreDraft: ChatComposerDraft = { attachments, content };
    const messagesBeforeUser = queuedSend ? (queuedMessage ? currentChat.messages.slice(0, queuedMessageIndex) : currentChat.messages) : currentChat.messages;
    const messagesAfterUser = queuedSend && queuedMessage ? currentChat.messages.slice(queuedMessageIndex + 1) : [];
    const shouldGenerateChatTitle = messagesBeforeUser.length === 0 && !options.preserveExistingTitle;
    const fallbackChatTitle = createFallbackChatTitle({ attachments, content });
    const researchReferences = resolveChatResearchReferences(
      {
        ...input,
        content,
      },
      currentChat.id,
    );
    const previousChatSnapshot = queuedSend
      ? {
          ...currentChat,
          messages: [...messagesBeforeUser, ...messagesAfterUser],
          title: shouldGenerateChatTitle ? "New chat" : currentChat.title,
        }
      : currentChat;
    const { controller, requestId } = createActiveGeneration(currentChat.id, previousChatSnapshot, currentChatExisted, restoreDraft);
    const now = new Date().toISOString();
    const userMessage =
      queuedSend && queuedMessage
        ? {
            ...queuedMessage,
            attachments: attachments.length > 0 ? attachments : undefined,
            content,
            researchReferences: researchReferences.length > 0 ? researchReferences : undefined,
            source: options.userMessageSource ?? queuedMessage.source,
            status: undefined,
          }
        : {
            ...createMessage("user", content, undefined, undefined, attachments),
            ...(queuedSend ? { id: queuedSend.queuedMessageId } : {}),
            researchReferences: researchReferences.length > 0 ? researchReferences : undefined,
            source: options.userMessageSource,
          };
    const effectiveThinkingSettings = effectiveProviderSettings.thinking;
    const discordContextMessages = options.discordReply ? createDiscordRuntimeContextMessages(workspaceSettings, webSearchToolAvailable, runtimeWebSearchSettings.provider) : [];
    const assistantMessage: ChatMessage = {
      ...createMessage("assistant", ""),
      isStreaming: true,
      mode: isPlanningMode ? "plan" : "chat",
      planning: isPlanningMode
        ? {
            maxPasses: 1,
            passCount: 0,
            startedAt: now,
          }
        : undefined,
      progress: isPlanningMode ? createPlanningProgress("input") : undefined,
      thinking: toolSettings.thinking && (isPlanningMode || effectiveThinkingSettings.enabled)
        ? {
            effort: isPlanningMode ? "high" : effectiveThinkingSettings.effort,
            startedAt: now,
          }
        : undefined,
    };
    const agentRun = createAgentRunForMessage({
      chatId: currentChat.id,
      localWorkspace: workspaceSettings,
      messageId: assistantMessage.id,
      mode: isPlanningMode ? "plan" : "chat",
      prompt: content,
    });
    assistantMessage.agentRunId = agentRun.id;
    assistantMessage.agentRunStatus = agentRun.status;
    setActiveGenerationTarget(requestId, currentChat.id, assistantMessage.id);

    setActiveChatId(currentChat.id);
    setActiveRoute("chat");

    setChats((currentChats) => {
      const hasCurrentChat = currentChats.some((chat) => chat.id === currentChat.id);
      const nextMessages = queuedSend ? [...messagesBeforeUser, userMessage, assistantMessage, ...messagesAfterUser] : [...currentChat.messages, userMessage, assistantMessage];
      const updatedChat: ChatSummary = {
        ...currentChat,
        composerDraft: undefined,
        isDraft: undefined,
        messages: nextMessages,
        model: effectiveProviderSettings.model,
        provider: effectiveProviderSettings.provider,
        title: shouldGenerateChatTitle ? PENDING_CHAT_TITLE : currentChat.title,
        updatedAt: now,
      };

      const nextChats = hasCurrentChat ? currentChats.map((chat) => (chat.id === currentChat.id ? updatedChat : chat)) : [updatedChat, ...currentChats];

      const sortedChats = sortChatsByUpdatedAt(nextChats);
      pendingChatsRef.current = sortedChats;
      return sortedChats;
    });
    stopStaleStreamingMessages(currentChat.id, assistantMessage.id);
    touchProject(currentChat.project);

    if (shouldGenerateChatTitle) {
      scheduleGeneratedChatTitle({
        attachments,
        chatId: currentChat.id,
        content,
        fallbackTitle: fallbackChatTitle,
        settings: effectiveProviderSettings,
        userMessageId: userMessage.id,
      });
    }

    try {
      const messagesForProvider = await createMessagesForProvider(messagesBeforeUser, userMessage, currentChat.project, workspaceSettings, content, discordContextMessages, effectiveProviderSettings, (notice) => {
        const compactionProgress = {
          detail: `${notice.compactedMessageCount} older messages compacted. Active request is now ${formatTokenCount(notice.afterTokens)} / ${formatTokenCount(notice.contextWindowTokens)}.`,
          id: CONTEXT_COMPACTION_PROGRESS_ID,
          label: "Automatically compacting context",
          status: "complete",
        } satisfies ChatProgressItem;

        updateGeneratedMessage(currentChat.id, assistantMessage.id, (message) => ({
          ...withContextCompactionMarker(message, notice),
          progress: withContextCompactionProgress(compactionProgress, message.progress),
        }));
      });

      if (isRequestInactive(requestId, controller)) {
        return;
      }

      if (isPlanningMode) {
        const inputRequest = await createPlanningInputRequest(effectiveProviderSettings, messagesForProvider, {
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
          signal: controller.signal,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        if (inputRequest) {
          setChats((currentChats) =>
            sortChatsByUpdatedAt(
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? {
                              ...message,
                              agentRunStatus: "waiting_for_approval",
                              isStreaming: false,
                              planning: message.planning
                                ? {
                                    ...message.planning,
                                    inputRequest,
                                    inputRequests: [inputRequest],
                                  }
                                : undefined,
                              progress: withWebSearchProgress(message.webSearch, createPlanningProgress("input")),
                            }
                          : message,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : chat,
              ),
            ),
          );
          setAgentRunWaiting(agentRun.id, "Planning input needed", inputRequest.detail || inputRequest.title);
          touchProject(currentChat.project);
          notifyPlanningInputNeeded(inputRequest, currentChat.id);
          if (discordStreamer) {
            await discordStreamer.finish("Gilbert needs input inside the app before this Discord request can continue.");
          } else {
            await sendDiscordReply(options.discordReply, "Gilbert needs input inside the app before this Discord request can continue.");
          }
          return;
        }

        // --- Plan research phase ---
        // Run the agentic research loop with prompts that DEMAND real tool
        // calls. If the agent settles without enough evidence (it sometimes
        // just summarizes from context), re-prompt once with a follow-up that
        // tells it exactly what's missing.
        //
        // Force-enable the read-only research tools regardless of chat-mode
        // toggles. The user opted into plan mode, which implies they want real
        // research — chat-mode toggles for fileSearch/fileBrowser/codeView
        // shouldn't gate that. Edit/run tools remain governed by user prefs.
        const planResearchToolOverrides: Partial<ProviderSettings["tools"]> = {
          codeView: true,
          fileBrowser: true,
          fileSearch: true,
        };
        const researchInstruction = createPlanResearchInstruction(content, {
          workspaceRoots: getEnabledWorkspaceRoots(workspaceSettings),
        });
        const planResearchToolSelectionPrompt = [
          "Plan mode codebase research. Search workspace directories, grep source files, and read relevant files before drafting.",
          content,
        ].join("\n");
        let researchMessages: ChatMessage[] = [...messagesForProvider, researchInstruction];
        let researchResponse = await streamAssistantWithLocalTools({
          chatId: currentChat.id,
          controller,
          messageId: assistantMessage.id,
          memoryToolsEnabled: false,
          messagesForProvider: researchMessages,
          prompt: content,
          requestId,
          runId: agentRun.id,
          runtimeToolOverrides: planResearchToolOverrides,
          toolSelectionPrompt: planResearchToolSelectionPrompt,
          webSearchSettingsOverride: runtimeWebSearchSettings,
          workspaceSettings,
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        if (researchResponse.waitingForApproval) {
          setChats((currentChats) =>
            sortChatsByUpdatedAt(
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? {
                              ...message,
                              agentRunStatus: "waiting_for_approval",
                              approvals: researchResponse.approvalRequests && researchResponse.approvalRequests.length > 0
                                ? mergeAgentApprovals(message.approvals ?? [], researchResponse.approvalRequests)
                                : message.approvals,
                              content: researchResponse.content,
                              isStreaming: false,
                              progress: withLocalComputerProgress(researchResponse.progress, message.progress),
                              toolCalls: researchResponse.toolCalls ?? message.toolCalls,
                            }
                          : message,
                      ),
                      updatedAt: new Date().toISOString(),
                    }
                  : chat,
              ),
            ),
          );
          setAgentRunWaiting(
            agentRun.id,
            "Approval required during plan research",
            "A prior local-tool approval is still pending from saved chat state.",
            researchResponse.approvalRequests ?? [],
            researchResponse.pendingToolCallContent,
          );
          notifyRunNeedsAttention("An approval is waiting during plan research.", currentChat.id);
          touchProject(currentChat.project);
          return;
        }

        // Combine tool calls from across all research passes so the evidence
        // ledger reflects the full picture, not just the most recent call.
        let accumulatedResearchToolCalls: ChatToolCall[] = researchResponse.toolCalls ?? [];
        let accumulatedResearchContent = researchResponse.content?.trim() || "";
        let researchEvidence = summarizeResearchEvidence(accumulatedResearchToolCalls);
        let followupPasses = 0;

        while (!isResearchDeepEnough(researchEvidence) && followupPasses < PLAN_RESEARCH_BUDGET.maxFollowupPasses) {
          followupPasses += 1;
          const followupInstruction = createPlanResearchFollowupInstruction(researchEvidence);
          // Build the next conversation: prior research messages + the agent's
          // prior digest (so the model can see what it already wrote) + the
          // follow-up nudge.
          researchMessages = [
            ...researchMessages,
            createMessage("assistant", accumulatedResearchContent || "(no digest produced)"),
            followupInstruction,
          ];

          const followupResponse = await streamAssistantWithLocalTools({
            chatId: currentChat.id,
            controller,
            messageId: assistantMessage.id,
            memoryToolsEnabled: false,
            messagesForProvider: researchMessages,
            prompt: content,
            requestId,
            runId: agentRun.id,
            runtimeToolOverrides: planResearchToolOverrides,
            toolSelectionPrompt: planResearchToolSelectionPrompt,
            webSearchSettingsOverride: runtimeWebSearchSettings,
            workspaceSettings,
          });

          if (isRequestInactive(requestId, controller)) {
            return;
          }

          if (followupResponse.waitingForApproval) {
            // Abandon further research; the existing approval-handling path is
            // adjacent (above) and the chat state already reflects the pending
            // approval from the helper. Fall through with whatever we have.
            break;
          }

          accumulatedResearchToolCalls = followupResponse.toolCalls ?? accumulatedResearchToolCalls;
          accumulatedResearchContent = (followupResponse.content?.trim() || accumulatedResearchContent);
          researchEvidence = summarizeResearchEvidence(accumulatedResearchToolCalls);
          researchResponse = followupResponse;
        }

        const researchFindings = formatResearchPayload(accumulatedResearchContent, researchEvidence);

        setChats((currentChats) =>
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? preserveVisibleResponseThinking(message, {
                          ...message,
                          content: "",
                          isStreaming: true,
                          progress: withWebSearchProgress(
                            message.webSearch,
                            createPlanningProgress("drafting", {
                              filesRead: researchEvidence.filesRead.length,
                              searches: researchEvidence.searchQueries.length + researchEvidence.webQueries.length,
                            }),
                          ),
                          toolCalls: researchResponse.toolCalls ?? message.toolCalls,
                        })
                      : message,
                  ),
                }
              : chat,
          ),
        );

        const assistantResponse = await runPlanningMode({
          messages: messagesForProvider,
          researchFindings,
          signal: controller.signal,
          settings: createToolAwareProviderSettings({}, currentChat),
          onProviderRequest: (request) => recordPlanningProviderRequest(currentChat.id, request),
          onProviderUsage: (request, usage) => recordPlanningProviderUsage(currentChat.id, request, usage),
          onUpdate: (snapshot) => {
            if (isRequestInactive(requestId, controller)) {
              return;
            }

            setChats((currentChats) =>
              currentChats.map((chat) =>
                chat.id === currentChat.id
                  ? {
                      ...chat,
                      messages: chat.messages.map((message) =>
                        message.id === assistantMessage.id
                          ? preserveVisibleResponseThinking(message, {
                              ...message,
                              content: snapshot.content ?? message.content,
                              progress: withWebSearchProgress(message.webSearch, snapshot.progress),
                            })
                          : message,
                      ),
                    }
                  : chat,
              ),
            );
          },
        });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        const planApproval = createPlanningExecutionApproval(agentRun.id, assistantMessage.id, assistantResponse.content, content);

        setChats((currentChats) =>
          sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === assistantMessage.id
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: "waiting_for_approval",
                            approvals: mergeAgentApprovals(message.approvals ?? [], [planApproval]),
                            content: assistantResponse.content,
                            isStreaming: false,
                            planning: message.planning
                              ? {
                                  ...message.planning,
                                  completedAt: new Date().toISOString(),
                                  passCount: 1,
                                  planContent: assistantResponse.content,
                                }
                              : undefined,
                            progress: withWebSearchProgress(message.webSearch, assistantResponse.progress),
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          })
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          ),
        );
        setAgentRunWaiting(agentRun.id, "Plan approval required", "Approve the plan to hand it into the executable agent loop.", [planApproval]);
        notifyRunNeedsAttention("A plan is ready for approval before execution.", currentChat.id);
        touchProject(currentChat.project);
        if (discordStreamer) {
          await discordStreamer.finish("Gilbert made a plan, but it needs approval inside the app before execution.");
        } else {
          await sendDiscordReply(options.discordReply, "Gilbert made a plan, but it needs approval inside the app before execution.");
        }
        return;
      } else {
        const useAppAgentRuntime = shouldStartAppAgentRun({
          mode: "chat",
          prompt: content,
          toolSettings,
          workspace: workspaceSettings,
        });

        if (useAppAgentRuntime) {
          updateAgentRun(agentRun.id, (run, eventAt) => ({
            ...run,
            events: [
              ...run.events,
              {
                at: eventAt,
                detail: "Gilbert will run workspace actions through the app-owned agent runtime instead of model-facing primitive tools.",
                id: createId("agent-event"),
                label: "App-owned agent runtime selected",
                type: "status",
              },
            ],
            updatedAt: eventAt,
          }));
        }

        const assistantResponse = useAppAgentRuntime
          ? await runAppOwnedCodingAgent({
              chatId: currentChat.id,
              controller,
              messageId: assistantMessage.id,
              messagesForProvider,
              onExternalUpdate: discordStreamer?.update,
              prompt: content,
              requestId,
              runId: agentRun.id,
              webSearchSettingsOverride: runtimeWebSearchSettings,
              workspaceSettings,
            })
          : await streamAssistantWithLocalTools({
              chatId: currentChat.id,
              controller,
              messageId: assistantMessage.id,
              messagesForProvider,
              onExternalUpdate: discordStreamer?.update,
              prompt: content,
              requestId,
              runId: agentRun.id,
              toolSelectionPrompt: createChatToolSelectionPrompt(content, messagesBeforeUser, workspaceSettings),
              webSearchSettingsOverride: runtimeWebSearchSettings,
              workspaceSettings,
            });

        if (isRequestInactive(requestId, controller)) {
          return;
        }

        setChats((currentChats) => {
          const nextChats = sortChatsByUpdatedAt(
            currentChats.map((chat) =>
              chat.id === currentChat.id
                ? {
                    ...chat,
                    messages: chat.messages.map((message) =>
                      message.id === assistantMessage.id
                        ? preserveVisibleResponseThinking(message, {
                            ...message,
                            agentRunStatus: assistantResponse.waitingForApproval ? "waiting_for_approval" : "completed",
                            approvals: assistantResponse.approvalRequests && assistantResponse.approvalRequests.length > 0
                              ? mergeAgentApprovals(message.approvals ?? [], assistantResponse.approvalRequests)
                              : message.approvals,
                            artifacts: mergeChatArtifacts(message.artifacts, assistantResponse.artifacts),
                            content: assistantResponse.content,
                            isStreaming: false,
                            progress: withLocalComputerProgress(assistantResponse.progress, message.progress),
                            sources: assistantResponse.sources && assistantResponse.sources.length > 0 ? mergeChatSources(message.sources, assistantResponse.sources) : message.sources,
                            toolCalls: assistantResponse.toolCalls ?? message.toolCalls,
                            thinking: message.thinking
                              ? {
                                  ...message.thinking,
                                  completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                                }
                              : undefined,
                          })
                        : message,
                    ),
                    updatedAt: new Date().toISOString(),
                  }
                : chat,
            ),
          );

          pendingChatsRef.current = nextChats;
          return nextChats;
        });
        if (assistantResponse.waitingForApproval) {
          setAgentRunWaiting(
            agentRun.id,
            "Tool approval required",
            "Review the pending tool action, then allow, deny, or approve edited arguments to continue the same run.",
            assistantResponse.approvalRequests ?? [],
            assistantResponse.pendingToolCallContent,
          );
          notifyRunNeedsAttention("A tool action is waiting for your approval.", currentChat.id);
          touchProject(currentChat.project);
          if (discordStreamer) {
            await discordStreamer.finish("Gilbert needs tool approval inside the app before this Discord request can finish.");
          } else {
            await sendDiscordReply(options.discordReply, "Gilbert needs tool approval inside the app before this Discord request can finish.");
          }
          return;
        }

        const completedAssistantMessage: ChatMessage = {
          ...assistantMessage,
          agentRunStatus: "completed",
          artifacts: mergeChatArtifacts(assistantMessage.artifacts, assistantResponse.artifacts),
          content: assistantResponse.content,
          isStreaming: false,
          sources: assistantResponse.sources && assistantResponse.sources.length > 0 ? mergeChatSources(assistantMessage.sources, assistantResponse.sources) : assistantMessage.sources,
          toolCalls: assistantResponse.toolCalls,
        };
        setAgentRunCompleted(agentRun.id, completedAssistantMessage);
        notifyRunComplete(completedAssistantMessage, currentChat.id);
        if (discordStreamer) {
          await discordStreamer.finish(assistantResponse.content, {
            sources: assistantResponse.sources ?? [],
          });
        } else {
          await sendDiscordReply(options.discordReply, assistantResponse.content);
        }
      }
      touchProject(currentChat.project);
    } catch (error) {
      if (isAbortError(error) || isRequestInactive(requestId, controller)) {
        return;
      }

      const errorContent = error instanceof Error ? error.message : "The provider request failed.";

      setChats((currentChats) =>
        sortChatsByUpdatedAt(
          currentChats.map((chat) =>
            chat.id === currentChat.id
              ? {
                  ...chat,
                  messages: chat.messages.map((message) =>
                    message.id === assistantMessage.id
                      ? {
                          ...message,
                          agentRunStatus: "failed",
                          content: errorContent,
                          isStreaming: false,
                          status: "error",
                          thinking: message.thinking
                            ? {
                                ...message.thinking,
                                completedAt: message.thinking.completedAt ?? new Date().toISOString(),
                              }
                            : undefined,
                        }
                      : message,
                  ),
                  updatedAt: new Date().toISOString(),
                }
              : chat,
          ),
        ),
      );
      setAgentRunFailed(agentRun.id, errorContent);
      notifyRunNeedsAttention(errorContent, currentChat.id);
      touchProject(currentChat.project);
      if (discordStreamer) {
        await discordStreamer.fail(`Gilbert hit an error while handling the Discord request: ${errorContent}`);
      } else {
        await sendDiscordReply(options.discordReply, `Gilbert hit an error while handling the Discord request: ${errorContent}`);
      }
    } finally {
      finishActiveGeneration(requestId);
    }
  }
