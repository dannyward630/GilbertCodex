import type { ChatArtifact, ChatAttachment, ChatMessage } from "../types/chat";
import { getChatModelOption } from "./models";
import type { ModelProviderId } from "../types/settings";

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 128000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16_384;
const MODEL_CONTEXT_WINDOW_OVERRIDES: Record<string, number> = {
  "nvidia/nemotron-3-super-120b-a12b:free": 262144,
};
export const AUTO_COMPACT_CONTEXT_THRESHOLD = 0.8;
export const AUTO_COMPACT_CONTEXT_TARGET = 0.55;
export const CONTEXT_COMPACTION_STRATEGY = "hybrid-checkpoint-v1";
export const CONTEXT_COMPACTION_SUMMARY_VERSION = 2;
const TOOL_CONTEXT_SURFACE_OUTPUT_WINDOW_RATIO = 0.3;
const TOOL_CONTEXT_SURFACE_INPUT_WINDOW_RATIO = 0.06;
const MIN_TOOL_CONTEXT_SURFACE_OUTPUT_CHARS = 64_000;
const MAX_TOOL_CONTEXT_SURFACE_OUTPUT_CHARS = 1_200_000;
const MIN_TOOL_CONTEXT_SURFACE_INPUT_CHARS = 16_000;
const MAX_TOOL_CONTEXT_SURFACE_INPUT_CHARS = 240_000;

export interface ContextWindowUsage {
  availableTokens: number;
  contextWindowTokens: number;
  draftTokens: number;
  fitsContextWindow?: boolean;
  inputTokens: number;
  maxOutputTokens: number;
  maxOutputTokenSource?: "estimate" | "manual" | "provider" | "request" | "settings";
  messageTokens: number;
  model: string;
  openRouterCompletionTokens?: number;
  openRouterTotalTokens?: number;
  overflowTokens?: number;
  payloadBreakdown?: ContextWindowPayloadBreakdownItem[];
  payloadSpike?: ContextWindowPayloadSpike;
  requestOverheadTokens: number;
  requestedTotalTokens?: number;
  reasoningReserveTokens?: number;
  safetyMarginTokens?: number;
  source: "estimate" | "openrouter" | "provider";
  systemTokens: number;
  tokenSource: "estimate" | "openrouter" | "provider" | "projected";
  totalTokens: number;
}

export interface ContextWindowPayloadBreakdownItem {
  detail?: string;
  id:
    | "attachments"
    | "chatHistory"
    | "draft"
    | "maxOutput"
    | "memory"
    | "providerEnvelope"
    | "reasoningReserve"
    | "safetyMargin"
    | "system"
    | "toolOutput"
    | "toolSchemas"
    | "web";
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
  strategy?: string;
  summaryVersion?: number;
  thresholdTokens: number;
}

export interface ModelContextWindow {
  maxOutputTokens?: number;
  source: "estimate" | "openrouter" | "provider";
  tokens: number;
}

export type ModelContextWindowMap = Record<string, ModelContextWindow>;

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
  const beforeRequestOverBudget = isContextRequestOverBudget(beforeUsage, boundedContextWindow);

  if ((!beforeRequestOverBudget && beforeUsage.inputTokens <= thresholdTokens) || messages.length <= 1) {
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
  let compactedMessages = messages;
  let afterUsage = beforeUsage;
  let compactedMessageCount = 0;

  for (let protectedKeepCount = Math.max(protectedSuffix.length, 1); protectedKeepCount >= 1; protectedKeepCount -= 1) {
    const protectedSplitIndex = Math.max(protectedSuffix.length - protectedKeepCount, 0);
    const compactableMessages = [...conversationalMessages, ...protectedSuffix.slice(0, protectedSplitIndex)];
    const keptProtectedSuffix = protectedSuffix.slice(protectedSplitIndex);
    let keepRecentCount = Math.min(8, compactableMessages.length);

    while (keepRecentCount >= 0) {
      const splitIndex = Math.max(compactableMessages.length - keepRecentCount, 0);
      const prefix = compactableMessages.slice(0, splitIndex);
      const recent = compactableMessages.slice(splitIndex);

      if (prefix.length > 0) {
        const summaryMessage = createCompactedContextMessage(prefix, beforeUsage, boundedContextWindow);
        const candidateMessages = [summaryMessage, ...recent, ...keptProtectedSuffix];
        const candidateUsage = estimateUsage(candidateMessages);

        if (isBetterCompactionCandidate(candidateUsage, afterUsage, boundedContextWindow)) {
          compactedMessages = candidateMessages;
          afterUsage = candidateUsage;
          compactedMessageCount = prefix.length;
        }

        if (!isContextRequestOverBudget(candidateUsage, boundedContextWindow) && candidateUsage.inputTokens <= targetTokens) {
          return {
            afterUsage: candidateUsage,
            beforeUsage,
            compacted: true,
            compactedMessageCount: prefix.length,
            messages: candidateMessages,
            thresholdTokens,
          };
        }
      }

      keepRecentCount -= 1;
    }
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

function getContextRequestTokens(usage: ContextWindowUsage) {
  return usage.requestedTotalTokens ?? usage.totalTokens;
}

function isContextRequestOverBudget(usage: ContextWindowUsage, contextWindowTokens: number) {
  return usage.fitsContextWindow === false ||
    (usage.overflowTokens ?? 0) > 0 ||
    getContextRequestTokens(usage) > Math.max(contextWindowTokens, 1);
}

function isBetterCompactionCandidate(candidate: ContextWindowUsage, current: ContextWindowUsage, contextWindowTokens: number) {
  const candidateOverBudget = isContextRequestOverBudget(candidate, contextWindowTokens);
  const currentOverBudget = isContextRequestOverBudget(current, contextWindowTokens);

  if (candidateOverBudget !== currentOverBudget) {
    return !candidateOverBudget;
  }

  const candidateTokens = getContextRequestTokens(candidate);
  const currentTokens = getContextRequestTokens(current);

  if (candidateTokens !== currentTokens) {
    return candidateTokens < currentTokens;
  }

  return candidate.inputTokens < current.inputTokens;
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
  const messageTokens = messages.reduce((total, message) => total + estimateMessageTokens(message, contextWindowTokens), 0);
  const boundedContextWindow = Math.max(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS, 1);
  const boundedMaxOutput = Math.max(Math.round(maxOutputTokens || 0), 0);
  const inputTokens = systemTokens + messageTokens;
  const totalTokens = inputTokens + boundedMaxOutput;

  return {
    availableTokens: Math.max(boundedContextWindow - totalTokens, 0),
    contextWindowTokens: boundedContextWindow,
    draftTokens: 0,
    fitsContextWindow: totalTokens <= boundedContextWindow,
    inputTokens,
    maxOutputTokens: boundedMaxOutput,
    maxOutputTokenSource: "settings",
    messageTokens,
    model,
    overflowTokens: Math.max(totalTokens - boundedContextWindow, 0),
    requestOverheadTokens: 0,
    requestedTotalTokens: totalTokens,
    reasoningReserveTokens: 0,
    safetyMarginTokens: 0,
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

  const patternTokens = inferContextWindowTokensFromModelId(normalizedModel);

  if (patternTokens) {
    return patternTokens;
  }

  return DEFAULT_CONTEXT_WINDOW_TOKENS;
}

// Pattern-match common model families when neither the static registry nor a
// provider /models response covers the selected model id (e.g. discovered
// OpenRouter routes, BYOK custom ids, or freshly released models). The values
// below mirror the verified entries in CHAT_MODEL_OPTIONS so an unrecognized
// id still gets a reasonable upper bound instead of collapsing to 128k.
function inferContextWindowTokensFromModelId(normalizedModel: string): number | null {
  if (!normalizedModel) {
    return null;
  }

  // 2M+ context families
  if (normalizedModel.includes("grok-4-1-fast") || normalizedModel.includes("grok-4.1-fast")) {
    return 2_000_000;
  }
  if (normalizedModel === "openrouter/auto") {
    return 2_000_000;
  }

  // ~1M context families
  if (normalizedModel.includes("gpt-5.4-mini") || normalizedModel.includes("gpt-5.4-nano") || normalizedModel.includes("gpt-5.3-codex") || normalizedModel.includes("gpt-5-nano") || normalizedModel.includes("gpt-5-mini")) {
    return 400_000;
  }
  if (normalizedModel.includes("gpt-5.5") || normalizedModel.includes("gpt-5.4") || normalizedModel.includes("gpt-latest")) {
    return 1_050_000;
  }
  if (normalizedModel.includes("gemini-2.5") || normalizedModel.includes("gemini-3") || normalizedModel.includes("gemini-pro")) {
    return 1_048_576;
  }
  if (normalizedModel.includes("owl-alpha")) {
    return 1_048_756;
  }
  if (/claude-(opus|sonnet)-4/.test(normalizedModel) || normalizedModel.includes("claude-sonnet-latest") || normalizedModel.includes("claude-opus-latest")) {
    return 1_000_000;
  }
  if (normalizedModel.includes("grok-4.3") || normalizedModel.includes("grok-4-3")) {
    return 1_000_000;
  }
  if (normalizedModel.includes("deepseek-v4")) {
    return 1_000_000;
  }

  // ~256k context families
  if (normalizedModel.includes("ring-2.6") || normalizedModel.includes("nemotron-3-super")) {
    return 262_144;
  }
  if (normalizedModel.includes("nemotron-omni") || normalizedModel.includes("nemotron-3-nano")) {
    return 256_000;
  }
  if (normalizedModel.includes("mistral-medium-3") || normalizedModel.includes("mistral-large") || normalizedModel.includes("devstral")) {
    return 256_000;
  }

  // 200k context (Claude Haiku family and other 200k routes)
  if (normalizedModel.includes("claude-haiku") || normalizedModel.includes("claude-3-7-sonnet")) {
    return 200_000;
  }

  // ~128k families (free OpenRouter routes, Groq-hosted models, Laguna, CoBuddy, GPT-OSS, Llama 3.3)
  if (
    normalizedModel.includes("laguna") ||
    normalizedModel.includes("cobuddy") ||
    normalizedModel.includes("gpt-oss") ||
    normalizedModel.includes("llama-3.3") ||
    normalizedModel.includes("compound")
  ) {
    return 131_072;
  }

  return null;
}

export function getFallbackModelContextWindow(model: string): ModelContextWindow {
  return {
    maxOutputTokens: getFallbackMaxOutputTokens(model),
    source: "estimate",
    tokens: getFallbackContextWindowTokens(model),
  };
}

export function getFallbackMaxOutputTokens(model: string, provider?: ModelProviderId, contextWindowTokens = getFallbackContextWindowTokens(model)) {
  const registryTokens = getChatModelOption(model, provider)?.maxOutputTokens;

  if (registryTokens) {
    return registryTokens;
  }

  const inferredTokens = inferMaxOutputTokensFromModelId(model.toLowerCase(), provider, contextWindowTokens);

  if (inferredTokens) {
    return inferredTokens;
  }

  return Math.min(DEFAULT_MAX_OUTPUT_TOKENS, Math.max(Math.floor(contextWindowTokens * 0.25), 256));
}

export function getContextWindowSafetyMarginTokens(contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS) {
  const boundedContextWindow = Math.max(Math.round(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS), 1);

  return clampInteger(Math.round(boundedContextWindow * 0.01), 512, 8_192);
}

function inferMaxOutputTokensFromModelId(normalizedModel: string, provider?: ModelProviderId, contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS): number | null {
  if (!normalizedModel) {
    return null;
  }

  if (provider === "lmstudio" || provider === "ollama" || provider === "vllm") {
    return Math.min(32_768, Math.max(Math.floor(contextWindowTokens * 0.25), 1_024));
  }

  if (normalizedModel.includes("gpt-5") || normalizedModel.includes("gpt-4.1") || normalizedModel.includes("gpt-latest")) {
    return 128_000;
  }

  if (normalizedModel.includes("deepseek-v4") || normalizedModel.includes("deepseek-reasoner")) {
    return 384_000;
  }

  if (normalizedModel.includes("gemini")) {
    return 65_536;
  }

  if (normalizedModel.includes("grok")) {
    return 65_536;
  }

  if (normalizedModel.includes("claude")) {
    return normalizedModel.includes("haiku") ? 16_384 : 32_768;
  }

  if (normalizedModel.includes("mistral") || normalizedModel.includes("devstral")) {
    return 32_768;
  }

  if (normalizedModel.includes("gpt-oss") || normalizedModel.includes("llama") || normalizedModel.includes("qwen")) {
    return 32_768;
  }

  return null;
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

export interface ContextSurfaceOptions {
  contextWindowTokens?: number;
  maxToolInputChars?: number;
  maxToolOutputChars?: number;
}

export function createMessageContextSurface(message: Pick<ChatMessage, "content"> & Partial<ChatMessage>, options: ContextSurfaceOptions = {}) {
  const sections: string[] = [];
  const surfaceBudget = getContextSurfaceBudget(options.contextWindowTokens);
  const maxToolInputChars = options.maxToolInputChars ?? surfaceBudget.maxToolInputChars;
  const maxToolOutputChars = options.maxToolOutputChars ?? surfaceBudget.maxToolOutputChars;

  if (message.toolCalls?.length) {
    let remainingToolOutputChars = maxToolOutputChars;

    sections.push(
      [
        "TOOL CALLS",
        ...message.toolCalls.map((toolCall, index) => {
          const outputLimit = Math.max(remainingToolOutputChars, 0);
          const input = getContextToolInput(toolCall.input);
          const rawOutput = getContextToolOutput(toolCall.output);
          const output = rawOutput ? limitContextSurfaceValue(rawOutput, outputLimit, "Tool output") : "";
          remainingToolOutputChars -= Math.min(rawOutput.length, outputLimit);

          return [
            `${index + 1}. ${toolCall.label} [${toolCall.status}]`,
            toolCall.detail ? `detail: ${toolCall.detail}` : "",
            input ? `input:\n${limitContextSurfaceValue(input, maxToolInputChars, "Tool input")}` : "",
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

  const progressItems = getProviderVisibleProgressItems(message);

  if (progressItems.length) {
    sections.push(
      [
        "PROGRESS",
        ...progressItems.map((item, index) => `${index + 1}. ${item.label} [${item.status}]${item.detail ? ` - ${item.detail}` : ""}`),
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
        ...message.artifacts.map(formatArtifactContextLine),
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

function getContextToolInput(input: string | undefined) {
  const trimmed = input?.trim() ?? "";

  return !trimmed || trimmed === "{}" || trimmed === "[]" ? "" : trimmed;
}

function getContextToolOutput(output: string | undefined) {
  const trimmed = output?.trim() ?? "";

  if (!trimmed || /^preparing tool call\.?$/i.test(trimmed)) {
    return "";
  }

  return trimmed;
}

function getProviderVisibleProgressItems(message: Pick<ChatMessage, "content"> & Partial<ChatMessage>) {
  return (message.progress ?? []).filter((item) => item.id !== "context-compaction");
}

function formatArtifactContextLine(artifact: ChatArtifact, index: number) {
  return `${index + 1}. ${artifact.title}${artifact.kind ? ` (${artifact.kind})` : ""}${formatArtifactContextUrl(artifact)}${artifact.detail ? `\n   ${artifact.detail}` : ""}`;
}

function formatArtifactContextUrl(artifact: ChatArtifact) {
  const url = artifact.url?.trim();

  if (!url) {
    return "";
  }

  if (isDataUrl(url)) {
    const mimeType = artifact.mimeType || readDataUrlMimeType(url) || artifact.kind || "artifact";
    const size = typeof artifact.sizeBytes === "number" ? `, ${formatByteCount(artifact.sizeBytes)}` : "";

    return ` - [embedded ${mimeType}${size}; binary data omitted from text context]`;
  }

  return ` - ${limitContextSurfaceValue(url, 320, "Artifact URL")}`;
}

function isDataUrl(value: string) {
  return /^data:/i.test(value);
}

function readDataUrlMimeType(dataUrl: string) {
  return dataUrl.match(/^data:([^;,]+)[;,]/i)?.[1];
}

function formatByteCount(sizeBytes: number) {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 bytes";
  }

  if (sizeBytes < 1024) {
    return `${Math.round(sizeBytes)} bytes`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${Math.ceil(sizeBytes / 1024)} KB`;
  }

  return `${(sizeBytes / 1024 / 1024).toFixed(sizeBytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

export function getContextSurfaceBudget(contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS) {
  const boundedContextWindow = Math.max(Math.round(contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS), 1);
  const contextWindowChars = boundedContextWindow * 4;

  return {
    maxToolInputChars: clampInteger(
      Math.round(contextWindowChars * TOOL_CONTEXT_SURFACE_INPUT_WINDOW_RATIO),
      MIN_TOOL_CONTEXT_SURFACE_INPUT_CHARS,
      MAX_TOOL_CONTEXT_SURFACE_INPUT_CHARS,
    ),
    maxToolOutputChars: clampInteger(
      Math.round(contextWindowChars * TOOL_CONTEXT_SURFACE_OUTPUT_WINDOW_RATIO),
      MIN_TOOL_CONTEXT_SURFACE_OUTPUT_CHARS,
      MAX_TOOL_CONTEXT_SURFACE_OUTPUT_CHARS,
    ),
  };
}

function estimateMessageTokens(message: Pick<ChatMessage, "content"> & Partial<ChatMessage>, contextWindowTokens = DEFAULT_CONTEXT_WINDOW_TOKENS) {
  const roleTokens = message.role ? 4 : 0;
  const attachmentTokens = (message.attachments ?? []).reduce((total, attachment) => total + estimateAttachmentTokens(attachment), 0);
  const contextSurfaceTokens = estimateTextTokens(createMessageContextSurface(message, { contextWindowTokens }));

  return estimateTextTokens(message.content) + contextSurfaceTokens + roleTokens + attachmentTokens + 6;
}

function estimateAttachmentTokens(attachment: ChatAttachment) {
  if (attachment.kind === "image") {
    return 1200;
  }

  if (attachment.kind === "video") {
    return Math.max(2400, Math.ceil(attachment.size / 32));
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
  const summary = summarizeMessagesForCompaction(messages, summaryBudget, contextWindowTokens);

  return {
    content: [
      "AUTO COMPACTED CONTEXT",
      `Strategy: ${CONTEXT_COMPACTION_STRATEGY}; summary_version=${CONTEXT_COMPACTION_SUMMARY_VERSION}.`,
      `Older conversation turns were automatically compacted because this chat crossed ${Math.round(AUTO_COMPACT_CONTEXT_THRESHOLD * 100)}% of the selected model context window.`,
      `Compacted messages: ${messages.length}`,
      `Before compaction prompt estimate: ${formatTokenCount(beforeUsage.inputTokens)} / ${formatTokenCount(beforeUsage.contextWindowTokens)} tokens. The response cap is tracked separately.`,
      "Use this checkpoint as continuity for older context. It is a provider replay summary only; the full local transcript and tool records remain saved outside this compacted message.",
      "Recent turns, active tool requests, unresolved approvals/questions, file edits, tool results, web results, and the current user request are preserved after this summary so the response can continue without restarting.",
      "",
      summary,
    ].join("\n"),
    createdAt: now,
    id: createContextCompactionId(),
    role: "user",
  };
}

function summarizeMessagesForCompaction(messages: ChatMessage[], characterBudget: number, contextWindowTokens: number) {
  const checkpoint = createHybridCompactionCheckpoint(messages, contextWindowTokens);
  const sections = [
    formatCompactionLedgerSection("CURRENT GOAL AND RECENT USER INTENT", checkpoint.goals),
    formatCompactionLedgerSection("REQUIREMENTS, PREFERENCES, AND DECISIONS", checkpoint.decisions),
    formatCompactionLedgerSection("FILES, EDITS, AND LOCAL STATE", checkpoint.files),
    formatCompactionLedgerSection("TOOL AND COMMAND EVIDENCE", checkpoint.tools),
    formatCompactionLedgerSection("WEB SOURCES AND EXTERNAL FACTS", checkpoint.sources),
    formatCompactionLedgerSection("PENDING WORK, APPROVALS, AND QUESTIONS", checkpoint.pending),
    formatCompactionLedgerSection("FAILURES, BLOCKERS, AND RISKS", checkpoint.failures),
    formatCompactionLedgerSection("TIMELINE CHECKPOINT", checkpoint.timeline),
  ].filter(Boolean);
  const summary = sections.join("\n\n");

  if (summary.length <= characterBudget) {
    return summary;
  }

  return `${summary.slice(0, Math.max(characterBudget - 180, 0)).trim()}\n[Compaction checkpoint ended because the provider replay budget was reached. Newer raw turns remain preserved after this checkpoint.]`;
}

function getPlanningRequestsForContext(message: Pick<ChatMessage, "content"> & Partial<ChatMessage>) {
  const requests = message.planning?.inputRequests?.length
    ? message.planning.inputRequests
    : message.planning?.inputRequest
      ? [message.planning.inputRequest]
      : [];

  return requests;
}

interface HybridCompactionCheckpoint {
  decisions: string[];
  failures: string[];
  files: string[];
  goals: string[];
  pending: string[];
  sources: string[];
  timeline: string[];
  tools: string[];
}

function createHybridCompactionCheckpoint(messages: ChatMessage[], contextWindowTokens: number): HybridCompactionCheckpoint {
  const checkpoint: HybridCompactionCheckpoint = {
    decisions: [],
    failures: [],
    files: [],
    goals: [],
    pending: [],
    sources: [],
    timeline: [],
    tools: [],
  };

  for (const [index, message] of messages.entries()) {
    const label = `${index + 1}. ${message.role.toUpperCase()} ${message.createdAt}`;
    const normalizedContent = normalizeCompactionText(message.content);
    const contextSurface = normalizeCompactionText(createMessageContextSurface(message, { contextWindowTokens }));
    const combinedContent = [normalizedContent, contextSurface].filter(Boolean).join(" ");
    const attachmentNote = message.attachments?.length ? `attachments=${message.attachments.map((attachment) => attachment.name).join(", ")}` : "";
    const timelineBody = limitCompactionLine([normalizedContent, attachmentNote].filter(Boolean).join(" "));

    if (message.role === "user" && normalizedContent) {
      pushUniqueLimited(checkpoint.goals, `${label}: ${limitCompactionLine(normalizedContent, 700)}`, 10);
    }

    if (looksLikeDecisionContent(combinedContent)) {
      pushUniqueLimited(checkpoint.decisions, `${label}: ${extractImportantCompactionSentence(combinedContent)}`, 18);
    }

    if (message.toolCalls?.length) {
      for (const toolCall of message.toolCalls) {
        const toolLine = [
          `${label}: ${toolCall.label} [${toolCall.status}]`,
          toolCall.toolId ? `tool=${toolCall.toolId}` : "",
          toolCall.detail ? `detail=${limitCompactionLine(toolCall.detail, 260)}` : "",
        ].filter(Boolean).join("; ");
        pushUniqueLimited(checkpoint.tools, toolLine, 24);

        if (toolCall.status === "error" || toolCall.status === "skipped") {
          pushUniqueLimited(checkpoint.failures, `${toolLine}; output=${limitCompactionLine(toolCall.output ?? "", 360)}`, 18);
        }

        if (toolCall.fileChanges?.length) {
          for (const fileChange of toolCall.fileChanges) {
            pushUniqueLimited(
              checkpoint.files,
              `${label}: ${fileChange.kind ?? "update"} ${fileChange.path} (+${fileChange.additions}/-${fileChange.deletions})`,
              30,
            );
          }
        }

        const inputPath = extractPathFromToolInput(toolCall.input);
        if (inputPath) {
          pushUniqueLimited(checkpoint.files, `${label}: tool referenced ${inputPath}`, 30);
        }
      }
    }

    if (message.sources?.length) {
      for (const source of message.sources) {
        pushUniqueLimited(checkpoint.sources, `${label}: ${source.title} - ${source.url}${source.detail ? ` (${limitCompactionLine(source.detail, 180)})` : ""}`, 18);
      }
    }

    if (message.webSearch?.enabled) {
      pushUniqueLimited(
        checkpoint.sources,
        `${label}: web search ${message.webSearch.provider} ${message.webSearch.status ?? "unknown"}${message.webSearch.query ? ` for "${limitCompactionLine(message.webSearch.query, 120)}"` : ""}`,
        18,
      );
    }

    const progressItems = getProviderVisibleProgressItems(message);

    if (progressItems.some((item) => item.status !== "complete")) {
      for (const item of progressItems.filter((progress) => progress.status !== "complete")) {
        pushUniqueLimited(checkpoint.pending, `${label}: ${item.label} [${item.status}]${item.detail ? ` - ${limitCompactionLine(item.detail, 220)}` : ""}`, 18);
      }
    }

    for (const request of getPlanningRequestsForContext(message)) {
      const state = request.answeredAt ? "answered" : "pending";
      pushUniqueLimited(checkpoint.pending, `${label}: planning question ${request.title} [${state}]`, 18);
    }

    if (message.approvals?.some((approval) => approval.status === "pending")) {
      for (const approval of message.approvals.filter((item) => item.status === "pending")) {
        pushUniqueLimited(checkpoint.pending, `${label}: approval pending ${approval.title}`, 18);
      }
    }

    if (message.status === "error" || /\b(error|failed|blocked|cannot|can't|denied|timeout|timed out|maximum context|too many tokens)\b/i.test(combinedContent)) {
      pushUniqueLimited(checkpoint.failures, `${label}: ${extractImportantCompactionSentence(combinedContent)}`, 18);
    }

    if (timelineBody) {
      pushUniqueLimited(checkpoint.timeline, `${label}: ${timelineBody}`, 30);
    }
  }

  return checkpoint;
}

function formatCompactionLedgerSection(title: string, items: string[]) {
  if (items.length === 0) {
    return "";
  }

  return [`${title}:`, ...items.map((item) => `- ${item}`)].join("\n");
}

function pushUniqueLimited(items: string[], item: string, limit: number) {
  const normalized = item.replace(/\s+/g, " ").trim();

  if (!normalized || items.includes(normalized) || items.length >= limit) {
    return;
  }

  items.push(normalized);
}

function looksLikeDecisionContent(content: string) {
  return /\b(?:must|need(?:s|ed)?|should|prefer|default|requirement|decision|accepted|rejected|scope|do not|don't|never|always|user asked|user wants|fix|implemented|changed|verified)\b/i.test(content);
}

function extractImportantCompactionSentence(content: string) {
  const sentences = content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const important = sentences.find(looksLikeDecisionContent) ?? sentences[0] ?? content;

  return limitCompactionLine(important, 700);
}

function extractPathFromToolInput(input: string | undefined) {
  if (!input?.trim()) {
    return "";
  }

  try {
    const parsed = JSON.parse(input) as { path?: unknown; paths?: unknown };
    if (typeof parsed.path === "string") {
      return parsed.path;
    }
    if (Array.isArray(parsed.paths)) {
      return parsed.paths.filter((item): item is string => typeof item === "string").slice(0, 4).join(", ");
    }
  } catch {
    const match = input.match(/[A-Za-z]:\\[^"'{}\n]+|(?:\.{1,2}[\\/])?[\w .-]+[\\/][\w .\\/.-]+/);
    return match?.[0]?.trim() ?? "";
  }

  return "";
}

function limitCompactionLine(value: string, maxLength = 500) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trim()}...`;
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

  return Math.min(Math.max(scaledBudget, 8_000), 96_000);
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

function clampInteger(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max);
}
