import {
  estimateTextTokens,
  type ContextWindowPayloadBreakdownItem,
  type ContextWindowUsage,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
} from "../lib/contextWindow";
import { createProviderUsageRequestBody, modelForMessages, type ProviderUsage } from "./modelProviderClient";
import type { ChatAttachment, ChatMessage, ChatSummary } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import type { ProviderToolBridgeOptions } from "../toolBridge/types";
import { finalizeToolResult } from "../toolBridge/resultFinalizer";
import { decrementRemainingChars, normalizeRemainingChars } from "../toolBridge/adapters/sharedUtils";

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
  const payloadBreakdown = createProviderPayloadBreakdown({
    draftCount,
    draftTokens,
    messages,
    messageTokens,
    requestOverheadTokens,
    systemTokens,
    toolBridge,
  });

  return {
    availableTokens: Math.max(boundedContextWindow - totalTokens, 0),
    contextWindowTokens: boundedContextWindow,
    draftTokens,
    inputTokens,
    maxOutputTokens: boundedMaxOutput,
    messageTokens,
    model,
    payloadBreakdown,
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
    payloadBreakdown: mergeProjectedPayloadBreakdown(baseUsage.payloadBreakdown, draftEstimate.payloadBreakdown, draftTokens),
    payloadSpike: baseUsage.payloadSpike,
    source: draftEstimate.source,
    tokenSource: "projected",
    totalTokens,
  };
}

export function annotateProviderPayloadSpike(
  usage: ContextWindowUsage,
  previousUsage: ContextWindowUsage | null | undefined,
): ContextWindowUsage {
  if (!previousUsage || previousUsage.inputTokens <= 0) {
    return usage;
  }

  const deltaTokens = Math.round(usage.inputTokens - previousUsage.inputTokens);
  const percentOfWindow = usage.inputTokens / Math.max(usage.contextWindowTokens, 1);
  const previousPercentOfWindow = previousUsage.inputTokens / Math.max(previousUsage.contextWindowTokens, 1);
  const jumpedByRatio = usage.inputTokens >= previousUsage.inputTokens * 1.35 && deltaTokens >= 8_000;
  const crossedHighWater = percentOfWindow >= 0.7 && previousPercentOfWindow < 0.6 && deltaTokens >= 8_000;

  if (!jumpedByRatio && !crossedHighWater) {
    return usage;
  }

  const topContributors = [...(usage.payloadBreakdown ?? [])]
    .filter((item) => item.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens)
    .slice(0, 3);
  const summary = [
    `Payload estimate jumped by ${formatTokenDelta(deltaTokens)} to ${formatTokenCountForDetail(usage.inputTokens)}.`,
    topContributors.length > 0
      ? `Largest parts: ${topContributors.map((item) => `${item.label} ${formatTokenCountForDetail(item.tokens)}`).join("; ")}.`
      : "",
  ].filter(Boolean).join(" ");

  return {
    ...usage,
    payloadSpike: {
      currentInputTokens: usage.inputTokens,
      deltaTokens,
      percentOfWindow,
      previousInputTokens: previousUsage.inputTokens,
      summary,
      topContributors,
    },
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

function createProviderPayloadBreakdown({
  draftCount,
  draftTokens,
  messages,
  messageTokens,
  requestOverheadTokens,
  systemTokens,
  toolBridge,
}: {
  draftCount: number;
  draftTokens: number;
  messages: ChatMessage[];
  messageTokens: number;
  requestOverheadTokens: number;
  systemTokens: number;
  toolBridge?: ProviderToolBridgeOptions;
}): ContextWindowPayloadBreakdownItem[] {
  const attachmentTokens = estimateAttachmentPayloadTokens(messages);
  const persistedToolOutputTokens = estimatePersistedToolOutputTokens(messages);
  const bridgeToolOutputTokens = estimateBridgeToolResultTokens(toolBridge);
  const toolSchemaTokens = estimateToolSchemaTokens(toolBridge);
  const toolOutputTokens = persistedToolOutputTokens + bridgeToolOutputTokens;
  const chatHistoryTokens = Math.max(messageTokens - attachmentTokens - persistedToolOutputTokens - draftTokens, 0);
  const providerEnvelopeTokens = Math.max(requestOverheadTokens - bridgeToolOutputTokens - toolSchemaTokens, 0);
  const toolOutputCount = countToolOutputs(messages, toolBridge);
  const attachmentCount = countAttachments(messages);
  const toolSchemaCount = toolBridge?.tools?.length ?? 0;
  const items: ContextWindowPayloadBreakdownItem[] = [
    {
      detail: `${Math.max(messages.length - draftCount, 0)} chat message${messages.length - draftCount === 1 ? "" : "s"}`,
      id: "chatHistory",
      label: "Chat history",
      tokens: chatHistoryTokens,
    },
    {
      detail: `${toolOutputCount} tool output surface${toolOutputCount === 1 ? "" : "s"}`,
      id: "toolOutput",
      label: "Tool output",
      tokens: toolOutputTokens,
    },
    {
      detail: `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`,
      id: "attachments",
      label: "Attachments",
      tokens: attachmentTokens,
    },
    {
      id: "draft",
      label: "Draft",
      tokens: draftTokens,
    },
    {
      id: "system",
      label: "System/runtime",
      tokens: systemTokens,
    },
    {
      detail: `${toolSchemaCount} advertised tool schema${toolSchemaCount === 1 ? "" : "s"}`,
      id: "toolSchemas",
      label: "Tool schemas",
      tokens: toolSchemaTokens,
    },
    {
      id: "providerEnvelope",
      label: "Provider envelope",
      tokens: providerEnvelopeTokens,
    },
  ];

  return items.filter((item) => item.tokens > 0 || item.id === "chatHistory");
}

function mergeProjectedPayloadBreakdown(
  baseBreakdown: ContextWindowPayloadBreakdownItem[] | undefined,
  draftBreakdown: ContextWindowPayloadBreakdownItem[] | undefined,
  draftTokens: number,
) {
  const items = [...(baseBreakdown ?? [])];
  const draftItem = draftBreakdown?.find((item) => item.id === "draft");
  const existingDraftIndex = items.findIndex((item) => item.id === "draft");
  const projectedDraft: ContextWindowPayloadBreakdownItem = {
    detail: draftItem?.detail ?? (draftTokens > 0 ? "Current composer draft" : undefined),
    id: "draft",
    label: "Draft",
    tokens: draftTokens,
  };

  if (existingDraftIndex >= 0) {
    items[existingDraftIndex] = projectedDraft;
  } else if (draftTokens > 0) {
    items.push(projectedDraft);
  }

  return items.length > 0 ? items : undefined;
}

function estimateSerializedTokens(value: unknown): number {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  return estimateTextTokens(serialized || "");
}

function estimateSerializedPartsTokens(parts: unknown[]): number {
  return parts.reduce<number>((total, part) => total + estimateSerializedTokens(part), 0);
}

function estimateAttachmentPayloadTokens(messages: ChatMessage[]) {
  return estimateTextTokens(safeSerialize(messages.flatMap((message) => message.attachments ?? [])));
}

function estimatePersistedToolOutputTokens(messages: ChatMessage[]) {
  return estimateTextTokens(
    messages
      .flatMap((message) => message.toolCalls ?? [])
      .map((toolCall) => [toolCall.label, toolCall.input, toolCall.output, toolCall.detail].filter(Boolean).join("\n"))
      .join("\n\n"),
  );
}

function estimateBridgeToolResultTokens(toolBridge: ProviderToolBridgeOptions | undefined) {
  if (!toolBridge?.toolResultMessages?.length) {
    return 0;
  }

  let remainingToolResultChars = normalizeRemainingChars(toolBridge.maxToolResultContentChars);
  const finalizedContents = toolBridge.toolResultMessages.map((message) => {
    const finalization = finalizeToolResult({
        arguments: message.arguments,
        maxProviderChars: remainingToolResultChars,
        result: message.result,
        toolId: message.name,
    });
    remainingToolResultChars = decrementRemainingChars(remainingToolResultChars, finalization.providerRawCharCount);
    return finalization.providerContent;
  });

  return estimateTextTokens(finalizedContents.join("\n\n"));
}

function estimateToolSchemaTokens(toolBridge: ProviderToolBridgeOptions | undefined) {
  return estimateSerializedTokens((toolBridge?.tools ?? []).map((tool) => ({
    description: tool.description,
    inputSchema: tool.inputSchema,
    name: tool.id,
  })));
}

function countToolOutputs(messages: ChatMessage[], toolBridge: ProviderToolBridgeOptions | undefined) {
  return messages.reduce((count, message) => count + (message.toolCalls?.length ?? 0), 0) + (toolBridge?.toolResultMessages?.length ?? 0);
}

function countAttachments(messages: ChatMessage[]) {
  return messages.reduce((count, message) => count + (message.attachments?.length ?? 0), 0);
}

function safeSerialize(value: unknown) {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function formatTokenDelta(tokens: number) {
  const prefix = tokens >= 0 ? "+" : "-";
  return `${prefix}${formatTokenCountForDetail(Math.abs(tokens))}`;
}

function formatTokenCountForDetail(tokens: number) {
  const rounded = Math.max(Math.round(tokens), 0);

  if (rounded >= 1_000_000) {
    return `${trimTokenNumber(rounded / 1_000_000)}M tokens`;
  }

  if (rounded >= 1_000) {
    return `${trimTokenNumber(rounded / 1_000)}k tokens`;
  }

  return `${rounded} tokens`;
}

function trimTokenNumber(value: number) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
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
