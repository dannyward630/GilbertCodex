import type { ChatAttachment, ChatMessage, ChatSummary } from "../types/chat";
import { getChatModelOption } from "./models";

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
const MODEL_CONTEXT_WINDOW_OVERRIDES: Record<string, number> = {
  "nvidia/nemotron-3-super-120b-a12b:free": 262144,
};
export const AUTO_COMPACT_CONTEXT_THRESHOLD = 0.8;
export const AUTO_COMPACT_CONTEXT_TARGET = 0.55;
// Provider context keeps bounded tool summaries while full tool records remain in storage.
const MAX_TOOL_CONTEXT_SURFACE_OUTPUT_CHARS = 32_000;
const MAX_TOOL_CONTEXT_SURFACE_INPUT_CHARS = 12_000;

export interface ContextWindowUsage {
  availableTokens: number;
  contextWindowTokens: number;
  draftTokens: number;
  inputTokens: number;
  maxOutputTokens: number;
  messageTokens: number;
  model: string;
  openRouterCompletionTokens?: number;
  openRouterTotalTokens?: number;
  payloadBreakdown?: ContextWindowPayloadBreakdownItem[];
  payloadSpike?: ContextWindowPayloadSpike;
  requestOverheadTokens: number;
  source: "estimate" | "openrouter" | "provider";
  systemTokens: number;
  tokenSource: "estimate" | "openrouter" | "provider" | "projected";
  totalTokens: number;
}

export interface ContextWindowPayloadBreakdownItem {
  detail?: string;
  id: "attachments" | "chatHistory" | "draft" | "providerEnvelope" | "system" | "toolOutput" | "toolSchemas";
  label: string;
  tokens: number;
}

export interface ContextWindowPayloadSpike {
  currentInputTokens: number;
  deltaTokens: number;
  percentOfWindow: number;
  previousInputTokens: number;
  summary: string;
  topContributors: ContextWindowPayloadBreakdownItem[];
}

export interface ContextCompactionNotice {
  afterTokens: number;
  beforeTokens: number;
  chatId: string;
  compactedAt: string;
  compactedMessageCount: number;
  contextWindowTokens: number;
  forcedByProviderUsage: boolean;
  thresholdTokens: number;
}

export interface ModelContextWindow {
  source: "estimate" | "openrouter" | "provider";
  tokens: number;
}

export type ModelContextWindowMap = Record<string, ModelContextWindow>;

interface ContextWindowUsageInput {
  chat: ChatSummary;
  contextWindowTokens: number;
  draftAttachments: ChatAttachment[];
  draftContent: string;
  maxOutputTokens: number;
  model: string;
  source: "estimate" | "openrouter" | "provider";
  systemPrompt: string;
}

interface ProviderContextUsageInput {
  contextWindowTokens: number;
  maxOutputTokens: number;
  messages: ChatMessage[];
  model: string;
  source: "estimate" | "openrouter" | "provider";
  systemPrompt: string;
}

interface CompactMessagesInput extends ProviderContextUsageInput {
  target?: number;
  threshold?: number;
  usageEstimator?: (messages: ChatMessage[]) => ContextWindowUsage;
}

export interface ContextCompactionResult {
  afterUsage: ContextWindowUsage;
  beforeUsage: ContextWindowUsage;
  compacted: boolean;
  compactedMessageCount: number;
  messages: ChatMessage[];
  thresholdTokens: number;
}

export function estimateContextWindowUsage({
  chat,
  contextWindowTokens,
  draftAttachments,
  draftContent,
  maxOutputTokens,
  model,
  source,
  systemPrompt,
}: ContextWindowUsageInput): ContextWindowUsage {
  const systemTokens = estimateTextTokens(systemPrompt) + 8;
  const messageTokens = chat.messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
  const draftTokens = draftContent.trim() || draftAttachments.length > 0 ? estimateMessageTokens({ attachments: draftAttachments, content: draftContent }) : 0;
  const boundedContextWindow = Math.max(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS, 1);
  const boundedMaxOutput = Math.max(Math.round(maxOutputTokens || 0), 0);
  const inputTokens = systemTokens + messageTokens + draftTokens;
  const totalTokens = inputTokens + boundedMaxOutput;

  return {
    availableTokens: Math.max(boundedContextWindow - totalTokens, 0),
    contextWindowTokens: boundedContextWindow,
    draftTokens,
    inputTokens,
    maxOutputTokens: boundedMaxOutput,
    messageTokens,
    model,
    requestOverheadTokens: 0,
    source,
    systemTokens,
    tokenSource: "estimate",
    totalTokens,
  };
}

export function compactMessagesForContext({
  contextWindowTokens,
  maxOutputTokens,
  messages,
  model,
  source,
  systemPrompt,
  target = AUTO_COMPACT_CONTEXT_TARGET,
  threshold = AUTO_COMPACT_CONTEXT_THRESHOLD,
  usageEstimator,
}: CompactMessagesInput): ContextCompactionResult {
  const estimateUsage =
    usageEstimator ??
    ((candidateMessages: ChatMessage[]) =>
      estimateProviderContextUsage({
        contextWindowTokens,
        maxOutputTokens,
        messages: candidateMessages,
        model,
        source,
        systemPrompt,
      }));
  const beforeUsage = estimateUsage(messages);
  const boundedContextWindow = Math.max(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS, 1);
  const thresholdTokens = Math.floor(boundedContextWindow * threshold);

  if (beforeUsage.totalTokens <= thresholdTokens || messages.length <= 3) {
    return {
      afterUsage: beforeUsage,
      beforeUsage,
      compacted: false,
      compactedMessageCount: 0,
      messages,
      thresholdTokens,
    };
  }

  const protectedStart = findProtectedSuffixStart(messages);
  const protectedSuffix = messages.slice(protectedStart);
  const conversationalMessages = messages.slice(0, protectedStart);
  const targetTokens = Math.floor(boundedContextWindow * target);
  let keepRecentCount = Math.min(8, conversationalMessages.length);
  let compactedMessages = messages;
  let afterUsage = beforeUsage;
  let compactedMessageCount = 0;

  while (keepRecentCount >= 1) {
    const prefix = conversationalMessages.slice(0, Math.max(conversationalMessages.length - keepRecentCount, 0));
    const recent = conversationalMessages.slice(Math.max(conversationalMessages.length - keepRecentCount, 0));

    if (prefix.length === 0) {
      break;
    }

    const summaryMessage = createCompactedContextMessage(prefix, beforeUsage, boundedContextWindow);
    const candidateMessages = [summaryMessage, ...recent, ...protectedSuffix];
    const candidateUsage = estimateUsage(candidateMessages);

    compactedMessages = candidateMessages;
    afterUsage = candidateUsage;
    compactedMessageCount = prefix.length;

    if (candidateUsage.totalTokens <= targetTokens || keepRecentCount === 1) {
      break;
    }

    keepRecentCount -= 1;
  }

  return {
    afterUsage,
    beforeUsage,
    compacted: compactedMessageCount > 0,
    compactedMessageCount,
    messages: compactedMessages,
    thresholdTokens,
  };
}

export function estimateProviderContextUsage({
  contextWindowTokens,
  maxOutputTokens,
  messages,
  model,
  source,
  systemPrompt,
}: ProviderContextUsageInput): ContextWindowUsage {
  const systemTokens = estimateTextTokens(systemPrompt) + 8;
  const messageTokens = messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
  const boundedContextWindow = Math.max(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS, 1);
  const boundedMaxOutput = Math.max(Math.round(maxOutputTokens || 0), 0);
  const inputTokens = systemTokens + messageTokens;
  const totalTokens = inputTokens + boundedMaxOutput;

  return {
    availableTokens: Math.max(boundedContextWindow - totalTokens, 0),
    contextWindowTokens: boundedContextWindow,
    draftTokens: 0,
    inputTokens,
    maxOutputTokens: boundedMaxOutput,
    messageTokens,
    model,
    requestOverheadTokens: 0,
    source,
    systemTokens,
    tokenSource: "estimate",
    totalTokens,
  };
}

export function getFallbackContextWindowTokens(model: string) {
  const normalizedModel = model.toLowerCase();
  const overrideTokens = MODEL_CONTEXT_WINDOW_OVERRIDES[normalizedModel];

  if (overrideTokens) {
    return overrideTokens;
  }

  const registryTokens = getChatModelOption(model)?.contextWindowTokens;

  if (registryTokens) {
    return registryTokens;
  }

  if (normalizedModel.includes("ring-2.6") || normalizedModel.includes("nemotron-3")) {
    return DEFAULT_CONTEXT_WINDOW_TOKENS;
  }

  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

export function getFallbackModelContextWindow(model: string): ModelContextWindow {
  return {
    source: "estimate",
    tokens: getFallbackContextWindowTokens(model),
  };
}

export function getFallbackModelContextWindows(models: string[]): ModelContextWindowMap {
  return models.reduce<ModelContextWindowMap>((windows, model) => {
    const normalizedModel = model.trim();

    if (normalizedModel) {
      windows[normalizedModel] = getFallbackModelContextWindow(normalizedModel);
    }

    return windows;
  }, {});
}

export function formatTokenCount(tokens: number) {
  const roundedTokens = Math.max(Math.round(tokens), 0);

  if (roundedTokens >= 1000000) {
    return `${trimTokenNumber(roundedTokens / 1000000)}M`;
  }

  if (roundedTokens >= 1000) {
    return `${trimTokenNumber(roundedTokens / 1000)}k`;
  }

  return `${roundedTokens}`;
}

export function createMessageContextSurface(message: Pick<ChatMessage, "content"> & Partial<ChatMessage>) {
  const sections: string[] = [];

  if (message.toolCalls?.length) {
    let remainingToolOutputChars = MAX_TOOL_CONTEXT_SURFACE_OUTPUT_CHARS;

    sections.push(
      [
        "TOOL CALLS",
        ...message.toolCalls.map((toolCall, index) => {
          const outputLimit = Math.max(remainingToolOutputChars, 0);
          const output = toolCall.output ? limitContextSurfaceValue(toolCall.output, outputLimit, "Tool output") : "";
          remainingToolOutputChars -= Math.min(toolCall.output?.length ?? 0, outputLimit);

          return [
            `${index + 1}. ${toolCall.label} [${toolCall.status}]`,
            toolCall.detail ? `detail: ${toolCall.detail}` : "",
            toolCall.input ? `input:\n${limitContextSurfaceValue(toolCall.input, MAX_TOOL_CONTEXT_SURFACE_INPUT_CHARS, "Tool input")}` : "",
            output ? `output:\n${output}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        }),
      ].join("\n\n"),
    );
  }

  if (message.sources?.length) {
    sections.push(
      [
        "SOURCES USED",
        ...message.sources.map((source, index) => `${index + 1}. ${source.title} - ${source.url}${source.detail ? `\n   ${source.detail}` : ""}`),
      ].join("\n"),
    );
  }

  if (message.progress?.length) {
    sections.push(
      [
        "PROGRESS",
        ...message.progress.map((item, index) => `${index + 1}. ${item.label} [${item.status}]${item.detail ? ` - ${item.detail}` : ""}`),
      ].join("\n"),
    );
  }

  if (message.webSearch?.enabled) {
    sections.push(
      [
        "WEB SEARCH STATE",
        `provider: ${message.webSearch.provider}`,
        `status: ${message.webSearch.status ?? "unknown"}`,
        message.webSearch.query ? `query: ${message.webSearch.query}` : "",
        typeof message.webSearch.resultCount === "number" ? `results: ${message.webSearch.resultCount}` : "",
        message.webSearch.error ? `error: ${message.webSearch.error}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (message.artifacts?.length) {
    sections.push(
      [
        "ARTIFACTS",
        ...message.artifacts.map((artifact, index) => `${index + 1}. ${artifact.title}${artifact.kind ? ` (${artifact.kind})` : ""}${artifact.url ? ` - ${artifact.url}` : ""}${artifact.detail ? `\n   ${artifact.detail}` : ""}`),
      ].join("\n"),
    );
  }

  if (message.planning) {
    sections.push(
      [
        "PLANNING STATE",
        `passes: ${message.planning.passCount}/${message.planning.maxPasses}`,
        message.planning.completedAt ? `completed: ${message.planning.completedAt}` : "",
        ...getPlanningRequestsForContext(message).map((request, index) =>
          [
            `request ${index + 1}: ${request.title}`,
            request.detail ? `detail: ${request.detail}` : "",
            request.answeredAt ? `answered: ${request.answeredAt}` : "pending",
            ...(request.answers ?? []).map((answer) => `answer ${answer.questionId}: ${answer.value}`),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return sections.length > 0
    ? `[CONVERSATION CONTEXT SURFACE]\nInternal evidence only. Never quote this surface or present it as visible tool progress; real tool work must come from app tool-call records.\n\n${sections.join("\n\n")}`
    : "";
}

function estimateMessageTokens(message: Pick<ChatMessage, "content"> & Partial<ChatMessage>) {
  const roleTokens = message.role ? 4 : 0;
  const attachmentTokens = (message.attachments ?? []).reduce((total, attachment) => total + estimateAttachmentTokens(attachment), 0);
  const contextSurfaceTokens = estimateTextTokens(createMessageContextSurface(message));

  return estimateTextTokens(message.content) + contextSurfaceTokens + roleTokens + attachmentTokens + 6;
}

function estimateAttachmentTokens(attachment: ChatAttachment) {
  if (attachment.kind === "image") {
    return 1200;
  }

  return Math.max(80, Math.ceil((attachment.name.length + attachment.size / 16) / 4));
}

function findProtectedSuffixStart(messages: ChatMessage[]) {
  let index = Math.max(messages.length - 1, 0);

  while (index > 0 && shouldPreserveCompactionSuffix(messages[index - 1])) {
    index -= 1;
  }

  return index;
}

function shouldPreserveCompactionSuffix(message: ChatMessage) {
  return isProtectedContextMessage(message) || hasRawToolCallRequest(message.content);
}

function isProtectedContextMessage(message: ChatMessage) {
  return (
    message.content.includes("AUTO COMPACTION CONTINUATION") ||
    message.content.includes("FINAL ANSWER REQUIRED") ||
    message.content.includes("LOCAL COMPUTER TOOL RESULTS") ||
    message.content.includes("AGENT TOOL RESULTS") ||
    message.content.includes("WEB TOOL RESULTS") ||
    message.content.includes("WEB SEARCH CONTEXT - ") ||
    message.content.includes("LOCAL TOOL BUDGET REACHED")
  );
}

function hasRawToolCallRequest(content: string) {
  const normalizedContent = content.toLowerCase();

  return normalizedContent.includes("<tool_call") || (normalizedContent.includes('"tool"') && normalizedContent.includes('"args"'));
}

function createCompactedContextMessage(messages: ChatMessage[], beforeUsage: ContextWindowUsage, contextWindowTokens: number): ChatMessage {
  const now = new Date().toISOString();
  const summaryBudget = getCompactionSummaryBudget(contextWindowTokens);
  const summary = summarizeMessagesForCompaction(messages, summaryBudget);

  return {
    content: [
      "AUTO COMPACTED CONTEXT",
      `Older conversation turns were automatically compacted because this chat crossed ${Math.round(AUTO_COMPACT_CONTEXT_THRESHOLD * 100)}% of the selected model context window.`,
      `Compacted messages: ${messages.length}`,
      `Before compaction estimate: ${formatTokenCount(beforeUsage.totalTokens)} / ${formatTokenCount(beforeUsage.contextWindowTokens)} tokens. The response cap is tracked separately.`,
      "Use this summary as continuity for older context. Recent turns, active tool requests, file edits, tool results, web results, and the current user request are preserved after this summary so the response can continue without restarting.",
      "",
      summary,
    ].join("\n"),
    createdAt: now,
    id: createContextCompactionId(),
    role: "user",
  };
}

function summarizeMessagesForCompaction(messages: ChatMessage[], characterBudget: number) {
  let remainingBudget = characterBudget;
  const sections: string[] = [];

  for (const [index, message] of messages.entries()) {
    if (remainingBudget <= 0) {
      sections.push(`[${messages.length - index} older messages omitted from compacted summary.]`);
      break;
    }

    const remainingMessages = Math.max(messages.length - index, 1);
    const perMessageBudget = Math.min(1200, Math.max(220, Math.floor(remainingBudget / remainingMessages)));
    const normalizedContent = normalizeCompactionText([message.content, createMessageContextSurface(message)].filter(Boolean).join("\n\n"));
    const attachmentNote = message.attachments?.length ? ` attachments=${message.attachments.map((attachment) => attachment.name).join(", ")}` : "";
    const body = normalizedContent.length > perMessageBudget ? `${normalizedContent.slice(0, perMessageBudget).trim()}...` : normalizedContent;
    const section = `${index + 1}. ${message.role.toUpperCase()} ${message.createdAt}${attachmentNote}\n${body}`;

    sections.push(section);
    remainingBudget -= section.length + 2;
  }

  return sections.join("\n\n");
}

function getPlanningRequestsForContext(message: Pick<ChatMessage, "content"> & Partial<ChatMessage>) {
  const requests = message.planning?.inputRequests?.length
    ? message.planning.inputRequests
    : message.planning?.inputRequest
      ? [message.planning.inputRequest]
      : [];

  return requests;
}

function limitContextSurfaceValue(value: string, limit: number, label = "Context surface") {
  if (limit <= 0) {
    return `[${label} replay excerpt omitted because the persisted context surface reached its recovery budget]`;
  }

  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit)}\n[${label} replay excerpt ended for provider context recovery. The original saved result was not changed.]`;
}

function normalizeCompactionText(content: string) {
  return content
    .replace(/<tool_call\b[^>]*>[\s\S]*?<\/tool_call>/gi, "[local tool call requested]")
    .replace(/\s+/g, " ")
    .trim();
}

function getCompactionSummaryBudget(contextWindowTokens: number) {
  const scaledBudget = Math.round(contextWindowTokens * 0.12);

  return Math.min(Math.max(scaledBudget, 4000), 24000);
}

function createContextCompactionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `context-compaction-${crypto.randomUUID()}`;
  }

  return `context-compaction-${Date.now()}-${Math.round(Math.random() * 100000)}`;
}

export function estimateTextTokens(text: string) {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return 0;
  }

  return Math.ceil(normalizedText.length / 4);
}

function trimTokenNumber(value: number) {
  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1).replace(/\.0$/, "") : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
