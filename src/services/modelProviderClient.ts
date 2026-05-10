import { attachmentSummary, isImageAttachment } from "../lib/chatAttachments";
import { createMessageContextSurface } from "../lib/contextWindow";
import { applyLocalSamplingParameters } from "../lib/generationSettings";
import {
  getDefaultModelForProvider,
  getModelProvider,
  getProviderApiKey,
  getProviderBaseUrl,
  isOpenRouterRouterModel,
  normalizeProviderModelId,
  supportsProviderThinking,
} from "../lib/models";
import type { ProviderModelMetadata } from "../lib/models";
import { buildAgentSystemPrompt } from "../prompts/agent";
import type { ChatMessage } from "../types/chat";
import type { ModelProviderId, ProviderSettings, ReasoningEffort } from "../types/settings";
import { applyOpenRouterFreeModelRouting } from "./openRouterRouting";

const STREAM_FLUSH_MS = 80;
const MAX_STREAM_REASONING_CHARS = 80_000;
const TRIMMED_REASONING_PREFIX = "[Earlier reasoning trimmed to keep the app responsive.]\n\n";
const STREAM_OPTIONS_PROVIDER_IDS = new Set<ModelProviderId>(["deepseek", "groq", "openai", "openrouter", "xai"]);
const INLINE_THINKING_TAGS = "think|thinking|thought|reasoning";
const INLINE_THINKING_BLOCK_PATTERN = new RegExp(`<(${INLINE_THINKING_TAGS})\\b[^>]*>([\\s\\S]*?)<\\/\\1>`, "gi");
const INLINE_THINKING_OPEN_PATTERN = new RegExp(`<(${INLINE_THINKING_TAGS})\\b[^>]*>`, "i");
const INLINE_THINKING_CLOSE_PATTERN = new RegExp(`<\\/(${INLINE_THINKING_TAGS})>`, "gi");

interface ProviderChatResponse {
  choices?: Array<{
    message?: {
      content?: ProviderContentOutput;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: ProviderReasoningDetail[];
      thinking?: string;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: ProviderUsage;
}

interface ProviderReasoningDetail {
  data?: string;
  summary?: string;
  text?: string;
  type?: string;
}

interface ProviderStreamChunk {
  choices?: Array<{
    delta?: {
      content?: ProviderContentOutput;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: ProviderReasoningDetail[];
      thinking?: string;
    };
    message?: {
      content?: ProviderContentOutput;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: ProviderReasoningDetail[];
      thinking?: string;
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: ProviderUsage | null;
}

interface AnthropicMessageResponse {
  content?: Array<{
    text?: string;
    thinking?: string;
    type?: string;
  }>;
  error?: {
    message?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface ProviderContentChunk {
  content?: string;
  text?: string;
  thinking?: string | Array<{ text?: string; type?: string }>;
  type?: string;
}

type ProviderContentOutput = string | ProviderContentChunk[];

interface ResponsesApiResponse {
  error?: {
    message?: string;
  };
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    summary?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  }>;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    output_tokens_details?: {
      reasoning_tokens?: number;
    };
    total_tokens?: number;
  };
}

interface ResponsesStreamEvent {
  delta?: string;
  error?: {
    message?: string;
  };
  item?: {
    content?: Array<{
      text?: string;
      type?: string;
    }>;
    summary?: Array<{
      text?: string;
      type?: string;
    }>;
    type?: string;
  };
  response?: ResponsesApiResponse;
  text?: string;
  type?: string;
  usage?: ResponsesApiResponse["usage"];
}

interface AnthropicStreamChunk {
  delta?: {
    text?: string;
    thinking?: string;
    type?: string;
  };
  error?: {
    message?: string;
  };
  message?: {
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  type?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface ProviderModelsResponse {
  data?: Array<{
    canonical_slug?: string;
    context_length?: number;
    description?: string;
    display_name?: string;
    expiration_date?: string | null;
    id?: string;
    max_context_length?: number;
    max_input_tokens?: number;
    name?: string;
    owned_by?: string;
    supported_parameters?: string[];
    top_provider?: {
      context_length?: number;
      max_completion_tokens?: number;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface StreamSnapshot {
  content: string;
  reasoning?: string;
  usage?: ProviderUsage;
}

export interface ProviderUsage {
  completion_tokens?: number;
  reasoning_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

interface ProviderRequestOptions {
  signal?: AbortSignal;
}

type ProviderMessageContent =
  | string
  | Array<
      | {
          text: string;
          type: "text";
        }
      | {
          image_url: {
            url: string;
          };
          type: "image_url";
        }
    >;

export class ProviderEmptyResponseError extends Error {
  constructor(message = "The selected provider returned an empty response.") {
    super(message);
    this.name = "ProviderEmptyResponseError";
  }
}

export function isProviderEmptyResponseError(error: unknown) {
  return error instanceof ProviderEmptyResponseError;
}

export async function sendProviderMessage(settings: ProviderSettings, messages: ChatMessage[], options: ProviderRequestOptions = {}) {
  const provider = getModelProvider(settings.provider);
  const apiKey = getProviderApiKey(settings);
  const model = modelForMessages(settings, messages);

  assertUsableSettings(settings.provider, apiKey, model);

  if (provider.apiStyle === "anthropic-messages") {
    const response = await fetch(joinUrl(getProviderBaseUrl(settings), "/messages"), {
      body: JSON.stringify(createAnthropicRequestBody(settings, messages, model, false)),
      headers: createProviderHeaders(settings.provider, apiKey),
      method: "POST",
      signal: options.signal,
    });
    const payload = (await readJson(response)) as AnthropicMessageResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message || `${provider.label} request failed with HTTP ${response.status}.`);
    }

    const content = extractAnthropicText(payload).trim();

    if (!content) {
      throw new ProviderEmptyResponseError(`${provider.label} returned no final answer.`);
    }

    return {
      content,
      reasoning: settings.thinking.enabled ? createReasoningSnapshotFromRaw(extractAnthropicReasoning(payload)) : undefined,
      usage: normalizeAnthropicUsage(payload.usage),
    };
  }

  if (usesResponsesApi(settings, model)) {
    const response = await fetch(joinUrl(getProviderBaseUrl(settings), "/responses"), {
      body: JSON.stringify(createResponsesRequestBody(settings, messages, model, false)),
      headers: createProviderHeaders(settings.provider, apiKey),
      method: "POST",
      signal: options.signal,
    });
    const payload = (await readJson(response)) as ResponsesApiResponse;

    if (!response.ok) {
      throw new Error(payload.error?.message || `${provider.label} request failed with HTTP ${response.status}.`);
    }

    const { content, reasoning } = extractResponsesOutput(payload);

    if (!content.trim()) {
      throw new ProviderEmptyResponseError(reasoning.trim() ? `${provider.label} returned reasoning but no final answer.` : undefined);
    }

    return {
      content: content.trim(),
      reasoning: settings.thinking.enabled ? createReasoningSnapshotFromRaw(reasoning) : undefined,
      usage: normalizeResponsesUsage(payload.usage),
    };
  }

  const response = await fetch(joinUrl(getProviderBaseUrl(settings), "/chat/completions"), {
    body: JSON.stringify(createProviderChatRequestBody(settings, messages, model)),
    headers: createProviderHeaders(settings.provider, apiKey),
    method: "POST",
    signal: options.signal,
  });
  const payload = (await readJson(response)) as ProviderChatResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `${provider.label} request failed with HTTP ${response.status}.`);
  }

  const message = payload.choices?.[0]?.message;
  const extractedMessage = extractProviderMessageOutput(message);
  const content = extractedMessage.content.trim();
  const reasoning = [extractReasoningText(message), extractedMessage.reasoning].filter(Boolean).join("");

  if (!content) {
    throw new ProviderEmptyResponseError(reasoning.trim() ? `${provider.label} returned reasoning but no final answer.` : undefined);
  }

  return {
    content,
    reasoning: settings.thinking.enabled ? createReasoningSnapshotFromRaw(reasoning) : undefined,
    usage: normalizeProviderUsage(payload.usage),
  };
}

export async function streamProviderMessage(
  settings: ProviderSettings,
  messages: ChatMessage[],
  onUpdate: (snapshot: StreamSnapshot) => void,
  options: ProviderRequestOptions = {},
) {
  const provider = getModelProvider(settings.provider);
  const apiKey = getProviderApiKey(settings);
  const model = modelForMessages(settings, messages);
  const useResponsesApi = usesResponsesApi(settings, model);

  assertUsableSettings(settings.provider, apiKey, model);

  const response = await fetch(
    joinUrl(getProviderBaseUrl(settings), provider.apiStyle === "anthropic-messages" ? "/messages" : useResponsesApi ? "/responses" : "/chat/completions"),
    {
      body: JSON.stringify(
        provider.apiStyle === "anthropic-messages"
          ? createAnthropicRequestBody(settings, messages, model, true)
          : useResponsesApi
            ? createResponsesRequestBody(settings, messages, model, true)
          : createProviderStreamRequestBody(settings, messages, model),
      ),
      headers: createProviderHeaders(settings.provider, apiKey),
      method: "POST",
      signal: options.signal,
    },
  );

  if (!response.ok) {
    const payload = (await readJson(response)) as ProviderChatResponse | AnthropicMessageResponse;
    throw new Error(payload.error?.message || `${provider.label} request failed with HTTP ${response.status}.`);
  }

  if (!response.body) {
    throw new Error(`${provider.label} did not return a streaming response body.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let reasoningTrimmed = false;
  let usage: ProviderUsage | undefined;
  let flushTimer: number | null = null;
  let lastFlushedContent = "";
  let lastFlushedReasoning = "";

  function flushSnapshot(force = false) {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }

    const separatedContent = separateInlineThinking(content);
    const nextContent = separatedContent.content;
    const nextReasoning = createReasoningSnapshot([reasoning, separatedContent.reasoning].filter(Boolean).join(""), reasoningTrimmed);

    if (!force && nextContent === lastFlushedContent && (nextReasoning ?? "") === lastFlushedReasoning) {
      return;
    }

    lastFlushedContent = nextContent;
    lastFlushedReasoning = nextReasoning ?? "";
    onUpdate({
      content: nextContent,
      reasoning: nextReasoning,
      usage,
    });
  }

  function scheduleSnapshot() {
    if (flushTimer) {
      return;
    }

    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      flushSnapshot();
    }, STREAM_FLUSH_MS);
  }

  function applyStreamDelta(delta: ReturnType<typeof parseProviderStreamLine>) {
    if (!delta) {
      return;
    }

    const reasoningDelta = settings.thinking.enabled ? delta.reasoningDelta : "";
    const nextContent = appendStreamText(content, delta.contentDelta);
    const rawNextReasoning = appendStreamText(reasoning, reasoningDelta);
    const nextReasoning = limitReasoningText(rawNextReasoning);

    usage = delta.usage ?? usage;
    reasoningTrimmed = reasoningTrimmed || rawNextReasoning.length > MAX_STREAM_REASONING_CHARS;

    if (nextContent !== content || nextReasoning !== reasoning) {
      content = nextContent;
      reasoning = nextReasoning;
      scheduleSnapshot();
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        applyStreamDelta(parseProviderStreamLine(settings.provider, line, useResponsesApi));
      }
    }

    applyStreamDelta(parseProviderStreamLine(settings.provider, buffer, useResponsesApi));
    flushSnapshot(true);
  } finally {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
    }

    try {
      reader.releaseLock();
    } catch {
      // The stream can already be released after an AbortController cancellation.
    }
  }

  const separatedFinalContent = separateInlineThinking(content);
  const finalContent = separatedFinalContent.content.trim();
  const finalReasoning = [reasoning, separatedFinalContent.reasoning].filter(Boolean).join("");

  if (!finalContent) {
    throw new ProviderEmptyResponseError(finalReasoning.trim() ? `${provider.label} returned reasoning but no final answer.` : undefined);
  }

  return {
    content: finalContent,
    reasoning: createReasoningSnapshot(finalReasoning, reasoningTrimmed),
    usage,
  };
}

export async function validateProviderSettings(settings: ProviderSettings) {
  const provider = getModelProvider(settings.provider);
  const apiKey = getProviderApiKey(settings);
  const model = settings.model.trim();

  assertUsableSettings(settings.provider, apiKey, model);

  const response = await fetch(joinUrl(getProviderBaseUrl(settings), provider.listModelsPath), {
    headers: createProviderHeaders(settings.provider, apiKey),
    method: "GET",
  });
  const payload = (await readJson(response)) as ProviderModelsResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `${provider.label} models check failed with HTTP ${response.status}.`);
  }

  const modelExists = settings.provider === "openrouter" && isOpenRouterRouterModel(model) ? true : Boolean(model && payload.data?.some((entry) => entry.id === model));

  return modelExists
    ? `Connected. ${model} is available on ${provider.label}.`
    : `Connected to ${provider.label}. The key works, but this model was not listed.`;
}

export async function fetchProviderModels(settings: ProviderSettings, options: ProviderRequestOptions = {}): Promise<ProviderModelMetadata[]> {
  const provider = getModelProvider(settings.provider);
  const apiKey = getProviderApiKey(settings);

  if (settings.provider !== "openrouter") {
    assertProviderApiKey(settings.provider, apiKey);
  }

  const response = await fetch(joinUrl(getProviderBaseUrl(settings), provider.listModelsPath), {
    headers: createProviderHeaders(settings.provider, apiKey),
    method: "GET",
    signal: options.signal,
  });
  const payload = (await readJson(response)) as ProviderModelsResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `${provider.label} models check failed with HTTP ${response.status}.`);
  }

  return normalizeProviderModels(payload);
}

export async function fetchProviderModelContextLengths(settings: ProviderSettings, models: string[], options: ProviderRequestOptions = {}) {
  const requestedModels = new Set(models.map((model) => model.trim()).filter(Boolean));

  if (requestedModels.size === 0) {
    return {};
  }

  const providerModels = await fetchProviderModels(settings, options);

  return providerModels.reduce<Record<string, number>>((contextLengths, model) => {
    if (requestedModels.has(model.id) && typeof model.contextWindowTokens === "number" && Number.isFinite(model.contextWindowTokens) && model.contextWindowTokens > 0) {
      contextLengths[model.id] = Math.round(model.contextWindowTokens);
    }

    return contextLengths;
  }, {});
}

export function createProviderChatRequestBody(settings: ProviderSettings, messages: ChatMessage[], model = modelForMessages(settings, messages)) {
  const body: Record<string, unknown> = {
    messages: [
      { role: "system", content: createProviderSystemPrompt(settings, messages) },
      ...messages.map((message) => ({
        role: message.role,
        content: createProviderMessageContent(message),
      })),
    ],
    model,
  };

  applyChatMaxTokens(settings, body);
  applyLocalSamplingParameters(settings, body);

  if (settings.provider === "openrouter") {
    applyOpenRouterFreeModelRouting(body, model, messages);
  }

  applyReasoningToRequestBody(settings, body);
  return body;
}

export function createProviderStreamRequestBody(settings: ProviderSettings, messages: ChatMessage[], model = modelForMessages(settings, messages)) {
  const body: Record<string, unknown> = {
    ...createProviderChatRequestBody(settings, messages, model),
    stream: true,
  };

  if (STREAM_OPTIONS_PROVIDER_IDS.has(settings.provider)) {
    body.stream_options = {
      include_usage: true,
    };
  }

  return body;
}

export function modelForMessages(settings: ProviderSettings, _messages: ChatMessage[]) {
  return normalizeProviderModelId(settings.provider, settings.model.trim() || getDefaultModelForProvider(settings.provider));
}

export function createResponsesRequestBody(settings: ProviderSettings, messages: ChatMessage[], model = modelForMessages(settings, messages), stream = false) {
  const body: Record<string, unknown> = {
    input: messages.map((message) => ({
      content: createResponsesMessageContent(message),
      role: message.role,
    })),
    instructions: createProviderSystemPrompt(settings, messages),
    max_output_tokens: settings.maxTokens,
    model,
    stream,
  };

  applyLocalSamplingParameters(settings, body);
  applyResponsesReasoningToRequestBody(settings, body);

  return body;
}

export function createProviderUsageRequestBody(settings: ProviderSettings, messages: ChatMessage[], model = modelForMessages(settings, messages)) {
  return usesResponsesApi(settings, model) ? createResponsesRequestBody(settings, messages, model, true) : createProviderStreamRequestBody(settings, messages, model);
}

export function createProviderMessageContent(message: ChatMessage): ProviderMessageContent {
  const imageAttachments = message.attachments?.filter(isImageAttachment) ?? [];
  const text = createMessageTextForProvider(message);

  if (imageAttachments.length === 0) {
    return text;
  }

  return [
    {
      text: text || "User attached image.",
      type: "text",
    },
    ...imageAttachments.map((attachment) => ({
      image_url: {
        url: attachment.dataUrl,
      },
      type: "image_url" as const,
    })),
  ];
}

function createResponsesMessageContent(message: ChatMessage) {
  return createMessageTextForProvider(message) || message.content || " ";
}

export function createMessageTextForProvider(message: ChatMessage) {
  const content = message.content.trim();
  const attachments = message.attachments ?? [];
  const contextSurface = createMessageContextSurface(message);
  const body = contextSurface ? [content, contextSurface].filter(Boolean).join("\n\n") : content;

  if (attachments.length === 0) {
    return body || message.content;
  }

  const summary = attachmentSummary(attachments);

  if (!summary) {
    return body;
  }

  return body ? `${body}\n\nAttachments:\n${summary}` : `Attachments:\n${summary}`;
}

function createAnthropicRequestBody(settings: ProviderSettings, messages: ChatMessage[], model: string, stream: boolean) {
  const thinkingBudget = createAnthropicThinkingBudget(settings, model);
  const body: Record<string, unknown> = {
    max_tokens: thinkingBudget ? Math.max(settings.maxTokens, thinkingBudget + 1024) : settings.maxTokens,
    messages: messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: createAnthropicMessageContent(message),
    })),
    model,
    stream,
    system: createProviderSystemPrompt(settings, messages),
  };

  if (thinkingBudget) {
    body.thinking = {
      type: "enabled",
      budget_tokens: thinkingBudget,
    };
  }

  return body;
}

function createAnthropicMessageContent(message: ChatMessage) {
  const imageAttachments = message.attachments?.filter(isImageAttachment) ?? [];
  const text = createMessageTextForProvider(message);

  if (imageAttachments.length === 0) {
    return text || message.content || " ";
  }

  return [
    {
      text: text || "User attached image.",
      type: "text",
    },
    ...imageAttachments.flatMap((attachment) => {
      const parsed = parseDataUrl(attachment.dataUrl);

      if (!parsed) {
        return [];
      }

      return [
        {
          source: {
            data: parsed.data,
            media_type: parsed.mediaType,
            type: "base64",
          },
          type: "image",
        },
      ];
    }),
  ];
}

function createProviderSystemPrompt(settings: ProviderSettings, messages: ChatMessage[]) {
  return buildAgentSystemPrompt({ messages, settings });
}

function applyChatMaxTokens(settings: ProviderSettings, body: Record<string, unknown>) {
  if (settings.provider === "openai") {
    body.max_completion_tokens = settings.maxTokens;
    return;
  }

  body.max_tokens = settings.maxTokens;
}

function usesResponsesApi(settings: ProviderSettings, model: string) {
  const provider = getModelProvider(settings.provider);

  return provider.reasoningMode === "local-responses" && settings.thinking.enabled && supportsProviderThinking(settings.provider, settings.thinking.effort, model);
}

function createAnthropicThinkingBudget(settings: ProviderSettings, model: string) {
  if (!settings.thinking.enabled || !supportsProviderThinking(settings.provider, settings.thinking.effort, model)) {
    return 0;
  }

  const effortBudget: Record<ReasoningEffort, number> = {
    minimal: 1024,
    low: 1024,
    medium: 2048,
    high: 4096,
    xhigh: 8192,
  };

  return effortBudget[settings.thinking.effort] ?? effortBudget.medium;
}

function applyReasoningToRequestBody(settings: ProviderSettings, body: Record<string, unknown>) {
  const provider = getModelProvider(settings.provider);
  const model = typeof body.model === "string" ? body.model : settings.model;

  if (!settings.thinking.enabled || !supportsProviderThinking(settings.provider, settings.thinking.effort, model)) {
    if (provider.reasoningMode === "deepseek-thinking") {
      body.thinking = { type: "disabled" };
    }

    if (provider.reasoningMode === "groq-reasoning" && model.toLowerCase().includes("gpt-oss")) {
      body.include_reasoning = false;
    }

    if (provider.reasoningMode === "mistral-reasoning" && supportsProviderThinking(settings.provider, settings.thinking.effort, model)) {
      body.reasoning_effort = "none";
    }

    if (provider.reasoningMode === "xai-reasoning" && model.toLowerCase().includes("grok-4.3")) {
      body.reasoning_effort = "none";
    }

    return;
  }

  if (provider.reasoningMode === "anthropic-thinking" || provider.reasoningMode === "local-responses") {
    return;
  }

  if (provider.reasoningMode === "openrouter") {
    body.reasoning = {
      effort: mapReasoningEffort(settings.provider, settings.thinking.effort),
      exclude: false,
    };
    return;
  }

  if (provider.reasoningMode === "google-thinking") {
    body.extra_body = {
      google: {
        thinking_config: createGoogleThinkingConfig(settings.thinking.effort, model),
      },
    };
    return;
  }

  if (provider.reasoningMode === "groq-reasoning") {
    body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    body.include_reasoning = true;
    if (model.toLowerCase().includes("qwen3")) {
      body.reasoning_format = "parsed";
    }
    return;
  }

  if (provider.reasoningMode === "mistral-reasoning") {
    body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    return;
  }

  if (provider.reasoningMode === "xai-reasoning") {
    if (model.toLowerCase().includes("multi-agent")) {
      body.reasoning = {
        effort: mapReasoningEffort(settings.provider, settings.thinking.effort),
      };
    } else if (model.toLowerCase().includes("grok-4.3")) {
      body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    }
    return;
  }

  if (provider.reasoningMode === "reasoning-effort") {
    body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    return;
  }

  if (provider.reasoningMode === "deepseek-thinking") {
    body.reasoning_effort = mapReasoningEffort(settings.provider, settings.thinking.effort);
    body.thinking = { type: "enabled" };
  }
}

function applyResponsesReasoningToRequestBody(settings: ProviderSettings, body: Record<string, unknown>) {
  const model = typeof body.model === "string" ? body.model : settings.model;

  if (!settings.thinking.enabled || !supportsProviderThinking(settings.provider, settings.thinking.effort, model)) {
    return;
  }

  body.reasoning = {
    effort: mapReasoningEffort(settings.provider, settings.thinking.effort),
  };
}

function createGoogleThinkingConfig(effort: ReasoningEffort, model: string) {
  const normalizedModel = model.toLowerCase();
  const includeThoughts = true;

  if (normalizedModel.startsWith("gemini-2.5")) {
    const thinkingBudgets: Record<ReasoningEffort, number> = {
      minimal: 1024,
      low: 1024,
      medium: 8192,
      high: 24576,
      xhigh: 24576,
    };

    return {
      include_thoughts: includeThoughts,
      thinking_budget: thinkingBudgets[effort] ?? thinkingBudgets.medium,
    };
  }

  return {
    include_thoughts: includeThoughts,
    thinking_level: mapGoogleThinkingLevel(effort, normalizedModel),
  };
}

function mapGoogleThinkingLevel(effort: ReasoningEffort, normalizedModel: string) {
  if (effort === "xhigh") {
    return "high";
  }

  if (effort === "minimal" && normalizedModel.includes("3.1-pro")) {
    return "low";
  }

  return effort;
}

function mapReasoningEffort(providerId: ModelProviderId, effort: ReasoningEffort) {
  if (providerId === "deepseek") {
    return effort === "xhigh" ? "max" : "high";
  }

  if (providerId === "google") {
    return effort === "xhigh" ? "high" : effort;
  }

  if (providerId === "mistral") {
    return "high";
  }

  if (providerId === "groq" || providerId === "lmstudio" || providerId === "ollama" || providerId === "xai") {
    if (effort === "minimal") {
      return "low";
    }

    return effort === "xhigh" ? "high" : effort;
  }

  return effort;
}

function createProviderHeaders(providerId: ModelProviderId, apiKey: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (providerId === "anthropic") {
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
    return headers;
  }

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  if (providerId === "openrouter") {
    headers["HTTP-Referer"] = window.location.origin;
    headers["X-Title"] = "Gilbert Codex";
  }

  return headers;
}

function assertUsableSettings(providerId: ModelProviderId, apiKey: string, model: string) {
  assertProviderApiKey(providerId, apiKey);

  if (!model) {
    throw new Error(`Choose a ${getModelProvider(providerId).label} model before sending a message.`);
  }
}

function assertProviderApiKey(providerId: ModelProviderId, apiKey: string) {
  const provider = getModelProvider(providerId);

  if (provider.requiresApiKey && !apiKey) {
    throw new Error(`Add a ${provider.label} API key in Settings before sending a message.`);
  }
}

function parseProviderStreamLine(providerId: ModelProviderId, line: string, useResponsesApi = false) {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith(":") || !trimmedLine.startsWith("data:")) {
    return null;
  }

  const data = trimmedLine.replace(/^data:\s*/, "");

  if (data === "[DONE]") {
    return null;
  }

  if (useResponsesApi) {
    return parseResponsesStreamData(data);
  }

  if (providerId === "anthropic") {
    return parseAnthropicStreamData(data);
  }

  return parseOpenAiCompatibleStreamData(data);
}

function parseOpenAiCompatibleStreamData(data: string) {
  let payload: ProviderStreamChunk;

  try {
    payload = JSON.parse(data) as ProviderStreamChunk;
  } catch {
    throw new Error("The selected provider returned a malformed streaming response.");
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const choice = payload.choices?.[0];
  const delta = choice?.delta ?? choice?.message;
  const extracted = extractProviderMessageOutput(delta);

  return {
    contentDelta: extracted.content,
    reasoningDelta: mergeReasoningTextParts(extractReasoningText(delta), extracted.reasoning),
    usage: normalizeProviderUsage(payload.usage),
  };
}

function parseResponsesStreamData(data: string) {
  let payload: ResponsesStreamEvent;

  try {
    payload = JSON.parse(data) as ResponsesStreamEvent;
  } catch {
    throw new Error("The selected provider returned a malformed Responses stream.");
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const type = payload.type ?? "";
  const isTextDelta = type.includes("output_text.delta") || type.includes("text.delta");
  const isReasoningDelta = type.includes("reasoning") && type.includes("delta");

  return {
    contentDelta: isTextDelta ? payload.delta ?? payload.text ?? "" : "",
    reasoningDelta: isReasoningDelta ? payload.delta ?? payload.text ?? "" : "",
    usage: normalizeResponsesUsage(payload.usage ?? payload.response?.usage),
  };
}

function parseAnthropicStreamData(data: string) {
  let payload: AnthropicStreamChunk;

  try {
    payload = JSON.parse(data) as AnthropicStreamChunk;
  } catch {
    throw new Error("Anthropic returned a malformed streaming response.");
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const delta = payload.delta;
  const contentDelta = delta?.type === "text_delta" ? delta.text ?? "" : "";
  const reasoningDelta = delta?.type === "thinking_delta" ? delta.thinking ?? "" : "";

  return {
    contentDelta,
    reasoningDelta,
    usage: normalizeAnthropicUsage(payload.usage ?? payload.message?.usage),
  };
}

function appendReasoningDelta(reasoning: string, delta: string) {
  return limitReasoningText(appendStreamText(reasoning, delta));
}

function appendStreamText(currentText: string, nextChunk: string) {
  if (!nextChunk) {
    return currentText;
  }

  if (nextChunk === currentText || currentText.endsWith(nextChunk)) {
    return currentText;
  }

  if (nextChunk.startsWith(currentText)) {
    return nextChunk;
  }

  const maxOverlap = Math.min(currentText.length, nextChunk.length);

  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (currentText.endsWith(nextChunk.slice(0, overlap))) {
      return currentText + nextChunk.slice(overlap);
    }
  }

  return currentText + nextChunk;
}

function limitReasoningText(reasoning: string) {
  return reasoning.length > MAX_STREAM_REASONING_CHARS ? reasoning.slice(-MAX_STREAM_REASONING_CHARS) : reasoning;
}

function createReasoningSnapshot(reasoning: string, trimmed: boolean) {
  const cleanReasoning = reasoning.trim();

  if (!cleanReasoning) {
    return undefined;
  }

  return trimmed ? `${TRIMMED_REASONING_PREFIX}${cleanReasoning}` : cleanReasoning;
}

function createReasoningSnapshotFromRaw(reasoning: string) {
  return createReasoningSnapshot(limitReasoningText(reasoning), reasoning.length > MAX_STREAM_REASONING_CHARS);
}

function normalizeProviderUsage(usage: ProviderUsage | null | undefined): ProviderUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const promptTokens = normalizeUsageToken(usage.prompt_tokens);
  const completionTokens = normalizeUsageToken(usage.completion_tokens);
  const reasoningTokens = normalizeUsageToken(usage.reasoning_tokens);
  const totalTokens = normalizeUsageToken(usage.total_tokens);

  if (promptTokens === undefined && completionTokens === undefined && reasoningTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    prompt_tokens: promptTokens,
    total_tokens: totalTokens,
  };
}

function normalizeResponsesUsage(usage: ResponsesApiResponse["usage"] | undefined): ProviderUsage | undefined {
  const promptTokens = normalizeUsageToken(usage?.input_tokens);
  const completionTokens = normalizeUsageToken(usage?.output_tokens);
  const reasoningTokens = normalizeUsageToken(usage?.output_tokens_details?.reasoning_tokens);
  const totalTokens = normalizeUsageToken(usage?.total_tokens) ?? (promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined);

  if (promptTokens === undefined && completionTokens === undefined && reasoningTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    completion_tokens: completionTokens,
    reasoning_tokens: reasoningTokens,
    prompt_tokens: promptTokens,
    total_tokens: totalTokens,
  };
}

function normalizeAnthropicUsage(usage: AnthropicMessageResponse["usage"] | AnthropicStreamChunk["usage"] | undefined): ProviderUsage | undefined {
  const promptTokens = normalizeUsageToken(usage?.input_tokens);
  const completionTokens = normalizeUsageToken(usage?.output_tokens);

  if (promptTokens === undefined && completionTokens === undefined) {
    return undefined;
  }

  return {
    completion_tokens: completionTokens,
    prompt_tokens: promptTokens,
    total_tokens: promptTokens !== undefined && completionTokens !== undefined ? promptTokens + completionTokens : undefined,
  };
}

function normalizeUsageToken(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function extractProviderMessageOutput(
  message:
    | {
        content?: ProviderContentOutput;
      }
    | undefined,
) {
  const content = message?.content;

  if (typeof content === "string") {
    return separateInlineThinking(content);
  }

  if (!Array.isArray(content)) {
    return {
      content: "",
      reasoning: "",
    };
  }

  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  for (const chunk of content) {
    if (chunk.type === "thinking" || chunk.type === "reasoning") {
      reasoningParts.push(extractThinkingChunkText(chunk));
      continue;
    }

    if (chunk.type === "text" || chunk.type === "output_text" || !chunk.type) {
      textParts.push(chunk.text ?? chunk.content ?? "");
    }
  }

  const separatedText = separateInlineThinking(textParts.join(""));

  return {
    content: separatedText.content,
    reasoning: [reasoningParts.join(""), separatedText.reasoning].filter(Boolean).join(""),
  };
}

function extractResponsesOutput(payload: ResponsesApiResponse) {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];

  if (payload.output_text) {
    textParts.push(payload.output_text);
  }

  for (const item of payload.output ?? []) {
    if (item.type === "reasoning") {
      reasoningParts.push(...(item.summary ?? []).map((summary) => summary.text ?? ""));
      continue;
    }

    if (item.type === "message" || !item.type) {
      textParts.push(...(item.content ?? []).filter((chunk) => chunk.type === "output_text" || chunk.type === "text" || !chunk.type).map((chunk) => chunk.text ?? ""));
    }
  }

  const separatedText = separateInlineThinking(textParts.join(""));

  return {
    content: separatedText.content,
    reasoning: [reasoningParts.join(""), separatedText.reasoning].filter(Boolean).join(""),
  };
}

function separateInlineThinking(value: string) {
  const reasoningParts: string[] = [];
  let visibleContent = value.replace(INLINE_THINKING_BLOCK_PATTERN, (_match, _tag: string, thinking: string) => {
    reasoningParts.push(thinking);
    return "";
  });
  const openThinkingMatch = INLINE_THINKING_OPEN_PATTERN.exec(visibleContent);

  if (openThinkingMatch && typeof openThinkingMatch.index === "number") {
    const openThinkingIndex = openThinkingMatch.index;
    const beforeThinking = visibleContent.slice(0, openThinkingIndex);
    const afterThinking = visibleContent.slice(openThinkingIndex + openThinkingMatch[0].length);

    reasoningParts.push(afterThinking.replace(INLINE_THINKING_CLOSE_PATTERN, ""));
    visibleContent = beforeThinking;
  }

  return {
    content: visibleContent.replace(INLINE_THINKING_CLOSE_PATTERN, ""),
    reasoning: reasoningParts.join("").trim(),
  };
}

function extractThinkingChunkText(chunk: ProviderContentChunk) {
  if (typeof chunk.thinking === "string") {
    return chunk.thinking;
  }

  if (Array.isArray(chunk.thinking)) {
    return chunk.thinking.map((item) => item.text ?? "").join("");
  }

  return chunk.text ?? chunk.content ?? "";
}

function normalizeProviderModels(payload: ProviderModelsResponse): ProviderModelMetadata[] {
  const seen = new Set<string>();

  return (payload.data ?? []).flatMap((entry) => {
    const modelId = normalizeModelId(entry.id ?? entry.name);

    if (!modelId || seen.has(modelId) || isExpiredModel(entry.expiration_date)) {
      return [];
    }

    seen.add(modelId);

    return [
      {
        contextWindowTokens: normalizeModelContextLength(entry.context_length ?? entry.top_provider?.context_length ?? entry.max_context_length ?? entry.max_input_tokens),
        detail: formatProviderModelDetail(entry),
        id: modelId,
        label: normalizeModelId(entry.display_name ?? entry.name),
      },
    ];
  });
}

function normalizeModelId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function formatProviderModelDetail(entry: NonNullable<ProviderModelsResponse["data"]>[number]) {
  const detailParts = [
    entry.owned_by ? `Owned by ${entry.owned_by}.` : "",
    entry.supported_parameters?.includes("tools") ? "Supports tools." : "",
    entry.supported_parameters?.includes("reasoning") || entry.supported_parameters?.includes("include_reasoning") ? "Supports reasoning." : "",
    entry.description ? cleanInlineText(entry.description).slice(0, 160) : "",
  ].filter(Boolean);

  return detailParts.length > 0 ? detailParts.join(" ") : undefined;
}

function isExpiredModel(expirationDate: string | null | undefined) {
  if (!expirationDate) {
    return false;
  }

  const parsed = Date.parse(expirationDate);
  return Number.isFinite(parsed) && parsed < Date.now();
}

function cleanInlineText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeModelContextLength(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : undefined;
}

function extractReasoningText(
  delta:
    | {
        reasoning?: string;
        reasoning_content?: string;
        reasoning_details?: ProviderReasoningDetail[];
        thinking?: string;
      }
    | undefined,
) {
  if (!delta) {
    return "";
  }

  return firstReasoningText(delta.reasoning, delta.reasoning_content, delta.thinking, extractReasoningDetailsText(delta.reasoning_details));
}

function extractReasoningDetailsText(details: ProviderReasoningDetail[] | undefined) {
  if (!Array.isArray(details) || details.length === 0) {
    return "";
  }

  return details
    .map((detail) => {
      if (typeof detail.text === "string") {
        return detail.text;
      }

      if (typeof detail.summary === "string") {
        return detail.summary;
      }

      return "";
    })
    .join("");
}

function firstReasoningText(...parts: Array<string | undefined>) {
  return parts.find((part) => typeof part === "string" && part.length > 0) ?? "";
}

function mergeReasoningTextParts(...parts: string[]) {
  return parts.reduce((merged, part) => {
    if (!part) {
      return merged;
    }

    if (!merged) {
      return part;
    }

    if (merged.endsWith(part) || part === merged) {
      return merged;
    }

    if (part.startsWith(merged)) {
      return part;
    }

    return merged + part;
  }, "");
}

function extractAnthropicText(payload: AnthropicMessageResponse) {
  return (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

function extractAnthropicReasoning(payload: AnthropicMessageResponse) {
  return (payload.content ?? [])
    .filter((block) => block.type === "thinking")
    .map((block) => block.thinking ?? block.text ?? "")
    .join("");
}

function parseDataUrl(dataUrl: string) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);

  if (!match) {
    return null;
  }

  return {
    data: match[2],
    mediaType: match[1],
  };
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = baseUrl.trim().replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  return `${normalizedBase}${normalizedPath}`;
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}
