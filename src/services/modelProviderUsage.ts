import { estimateTextTokens, type ContextWindowUsage, DEFAULT_CONTEXT_WINDOW_TOKENS } from "../lib/contextWindow";
import { createProviderUsageRequestBody, modelForMessages, type ProviderUsage } from "./modelProviderClient";
import type { ChatAttachment, ChatMessage, ChatSummary } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import type { ProviderToolBridgeOptions } from "../toolBridge/types";

interface ProviderContextUsageInput {
  chat: ChatSummary;
  contextWindowTokens: number;
  draftAttachments: ChatAttachment[];
  draftContent: string;
  settings: ProviderSettings;
  source: "estimate" | "openrouter" | "provider";
}

interface ProviderPayloadContextUsageInput {
  contextWindowTokens: number;
  messages: ChatMessage[];
  settings: ProviderSettings;
  source: "estimate" | "openrouter" | "provider";
  stream?: boolean;
  toolBridge?: ProviderToolBridgeOptions;
}

export function estimateModelProviderContextWindowUsage({
  chat,
  contextWindowTokens,
  draftAttachments,
  draftContent,
  settings,
  source,
}: ProviderContextUsageInput): ContextWindowUsage {
  const visibleMessages = chat.messages.filter((message) => message.status !== "error");
  const draftMessage = createDraftUsageMessage(draftContent, draftAttachments);
  const messages = draftMessage ? [...visibleMessages, draftMessage] : visibleMessages;
  const draftCount = draftMessage ? 1 : 0;

  return estimateProviderUsageFromMessages({
    chatMessageCount: visibleMessages.length,
    contextWindowTokens,
    draftCount,
    messages,
    settings,
    source,
  });
}

export function estimateModelProviderPayloadUsage({
  contextWindowTokens,
  messages,
  settings,
  source,
  stream = true,
  toolBridge,
}: ProviderPayloadContextUsageInput): ContextWindowUsage {
  return estimateProviderUsageFromMessages({
    chatMessageCount: messages.length,
    contextWindowTokens,
    draftCount: 0,
    messages,
    settings,
    source,
    stream,
    toolBridge,
  });
}

function estimateProviderUsageFromMessages({
  chatMessageCount,
  contextWindowTokens,
  draftCount,
  messages,
  settings,
  source,
  stream = true,
  toolBridge,
}: {
  chatMessageCount: number;
  contextWindowTokens: number;
  draftCount: number;
  messages: ChatMessage[];
  settings: ProviderSettings;
  source: "estimate" | "openrouter" | "provider";
  stream?: boolean;
  toolBridge?: ProviderToolBridgeOptions;
}): ContextWindowUsage {
  const model = modelForMessages(settings, messages);
  const body = createProviderUsageRequestBody(settings, messages, model, stream, toolBridge);
  const requestBody = body as Record<string, unknown> & { messages?: unknown };
  const promptParts = getProviderPromptParts(requestBody, chatMessageCount, draftCount);
  const systemTokens = estimateSerializedPartsTokens(promptParts.system);
  const messageTokens = estimateSerializedPartsTokens(promptParts.messages);
  const draftTokens = estimateSerializedPartsTokens(promptParts.draft);
  const boundedContextWindow = Math.max(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS, 1);
  const boundedMaxOutput = Math.max(Math.round(settings.maxTokens || 0), 0);
  const serializedBodyTokens = estimateSerializedTokens(body);
  const requestOverheadTokens = Math.max(serializedBodyTokens - systemTokens - messageTokens - draftTokens, estimateProviderControlTokens(body));
  const inputTokens = systemTokens + messageTokens + draftTokens + requestOverheadTokens;
  const totalTokens = inputTokens + boundedMaxOutput;

  return {
    availableTokens: Math.max(boundedContextWindow - totalTokens, 0),
    contextWindowTokens: boundedContextWindow,
    draftTokens,
    inputTokens,
    maxOutputTokens: boundedMaxOutput,
    messageTokens,
    model,
    requestOverheadTokens,
    source,
    systemTokens,
    tokenSource: "estimate",
    totalTokens,
  };
}

export function applyProviderUsageToContextEstimate(estimate: ContextWindowUsage, usage: ProviderUsage | undefined): ContextWindowUsage {
  const promptTokens = normalizeUsageToken(usage?.prompt_tokens);
  const completionTokens = normalizeUsageToken(usage?.completion_tokens);
  const totalUsageTokens = normalizeUsageToken(usage?.total_tokens) ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);

  if (promptTokens === undefined) {
    return estimate;
  }

  const exactPromptTokens = Math.max(promptTokens, 0);
  const promptBreakdown = scalePromptBreakdown(estimate, exactPromptTokens);
  const effectiveOutputBudget = Math.max(estimate.maxOutputTokens, completionTokens ?? 0);
  const totalTokens = exactPromptTokens + effectiveOutputBudget;

  return {
    ...estimate,
    ...promptBreakdown,
    availableTokens: Math.max(estimate.contextWindowTokens - totalTokens, 0),
    inputTokens: exactPromptTokens,
    openRouterCompletionTokens: completionTokens,
    openRouterTotalTokens: totalUsageTokens,
    tokenSource: "provider",
    totalTokens,
  };
}

export function projectDraftOntoProviderUsage(baseUsage: ContextWindowUsage, draftEstimate: ContextWindowUsage): ContextWindowUsage {
  const draftTokens = Math.max(Math.round(draftEstimate.draftTokens), 0);

  if (draftTokens === 0) {
    return baseUsage;
  }

  const maxOutputTokens = Math.max(Math.round(draftEstimate.maxOutputTokens), 0);
  const contextWindowTokens = Math.max(Math.round(draftEstimate.contextWindowTokens), 1);
  const inputTokens = baseUsage.inputTokens + draftTokens;
  const totalTokens = inputTokens + maxOutputTokens;

  return {
    ...baseUsage,
    availableTokens: Math.max(contextWindowTokens - totalTokens, 0),
    contextWindowTokens,
    draftTokens,
    inputTokens,
    maxOutputTokens,
    model: draftEstimate.model,
    openRouterCompletionTokens: undefined,
    openRouterTotalTokens: undefined,
    source: draftEstimate.source,
    tokenSource: "projected",
    totalTokens,
  };
}

function createDraftUsageMessage(content: string, attachments: ChatAttachment[]): ChatMessage | null {
  if (!content.trim() && attachments.length === 0) {
    return null;
  }

  return {
    attachments,
    content,
    createdAt: new Date().toISOString(),
    id: "draft-context-preview",
    role: "user",
  };
}

function estimateSerializedTokens(value: unknown): number {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return estimateTextTokens(serialized || "");
}

function estimateSerializedPartsTokens(parts: unknown[]): number {
  return parts.reduce<number>((total, part) => total + estimateSerializedTokens(part), 0);
}

function estimateProviderControlTokens(body: ReturnType<typeof createProviderUsageRequestBody>): number {
  const {
    input: _input,
    instructions: _instructions,
    messages: _messages,
    system: _system,
    ...controlBody
  } = body as Record<string, unknown> & {
    input?: unknown;
    instructions?: unknown;
    messages?: unknown;
    system?: unknown;
  };

  return estimateSerializedTokens(controlBody);
}

function getProviderPromptParts(
  requestBody: Record<string, unknown>,
  chatMessageCount: number,
  draftCount: number,
): {
  draft: unknown[];
  messages: unknown[];
  system: unknown[];
} {
  if (Array.isArray(requestBody.input)) {
    const inputMessages = requestBody.input;

    return {
      draft: draftCount > 0 ? inputMessages.slice(chatMessageCount, chatMessageCount + draftCount) : [],
      messages: inputMessages.slice(0, chatMessageCount),
      system: requestBody.instructions === undefined ? [] : [requestBody.instructions],
    };
  }

  const bodyMessages = Array.isArray(requestBody.messages) ? requestBody.messages : [];

  if (requestBody.system !== undefined) {
    return {
      draft: draftCount > 0 ? bodyMessages.slice(chatMessageCount, chatMessageCount + draftCount) : [],
      messages: bodyMessages.slice(0, chatMessageCount),
      system: [requestBody.system],
    };
  }

  const hasSystemMessage = isProviderSystemMessage(bodyMessages[0]);
  const firstChatMessageIndex = hasSystemMessage ? 1 : 0;

  return {
    draft: draftCount > 0 ? bodyMessages.slice(firstChatMessageIndex + chatMessageCount, firstChatMessageIndex + chatMessageCount + draftCount) : [],
    messages: bodyMessages.slice(firstChatMessageIndex, firstChatMessageIndex + chatMessageCount),
    system: hasSystemMessage ? [bodyMessages[0]] : [],
  };
}

function isProviderSystemMessage(value: unknown) {
  return Boolean(value && typeof value === "object" && "role" in value && (value as { role?: unknown }).role === "system");
}

function scalePromptBreakdown(estimate: ContextWindowUsage, exactPromptTokens: number) {
  const estimatedPromptTokens = Math.max(estimate.systemTokens + estimate.messageTokens + estimate.draftTokens + estimate.requestOverheadTokens, 1);
  const systemTokens = Math.round((estimate.systemTokens / estimatedPromptTokens) * exactPromptTokens);
  const messageTokens = Math.round((estimate.messageTokens / estimatedPromptTokens) * exactPromptTokens);
  const draftTokens = Math.round((estimate.draftTokens / estimatedPromptTokens) * exactPromptTokens);
  const requestOverheadTokens = Math.max(exactPromptTokens - systemTokens - messageTokens - draftTokens, 0);

  return {
    draftTokens,
    messageTokens,
    requestOverheadTokens,
    systemTokens,
  };
}

function normalizeUsageToken(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}
