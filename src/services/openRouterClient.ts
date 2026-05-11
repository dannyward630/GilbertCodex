import type { ChatMessage } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { attachmentSummary, isImageAttachment } from "../lib/chatAttachments";
import { createMessageContextSurface } from "../lib/contextWindow";
import { getProviderBaseUrl, IMAGE_REASONING_MODEL, isOpenRouterRouterModel, normalizeProviderModelId } from "../lib/models";
import { buildAgentSystemPrompt } from "../prompts/agent";
import { applyOpenRouterFreeModelRouting } from "./openRouterRouting";

const STREAM_FLUSH_MS = 80;
const MAX_STREAM_REASONING_CHARS = 80_000;
const TRIMMED_REASONING_PREFIX = "[Earlier reasoning trimmed to keep the app responsive.]\n\n";

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: OpenRouterReasoningDetail[];
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: OpenRouterUsage;
}

interface OpenRouterReasoningDetail {
  data?: string;
  summary?: string;
  text?: string;
  type?: string;
}

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: OpenRouterReasoningDetail[];
    };
    message?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
      reasoning_details?: OpenRouterReasoningDetail[];
    };
  }>;
  error?: {
    message?: string;
  };
  usage?: OpenRouterUsage | null;
}

interface OpenRouterModelsResponse {
  data?: Array<{
    context_length?: number;
    id?: string;
  }>;
  error?: {
    message?: string;
  };
}

interface StreamSnapshot {
  content: string;
  reasoning?: string;
  usage?: OpenRouterUsage;
}

export interface OpenRouterUsage {
  completion_tokens?: number;
  prompt_tokens?: number;
  total_tokens?: number;
}

interface OpenRouterRequestOptions {
  signal?: AbortSignal;
}

type OpenRouterMessageContent =
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

type OpenRouterRequestBody = Record<string, unknown> & {
  messages: unknown[];
  model?: string;
};

export class OpenRouterEmptyResponseError extends Error {
  constructor(message = "OpenRouter returned an empty response.") {
    super(message);
    this.name = "OpenRouterEmptyResponseError";
  }
}

export function isOpenRouterEmptyResponseError(error: unknown) {
  return error instanceof OpenRouterEmptyResponseError;
}

export async function sendOpenRouterMessage(settings: ProviderSettings, messages: ChatMessage[], options: OpenRouterRequestOptions = {}) {
  const apiKey = settings.openRouterApiKey.trim();
  const model = modelForMessages(settings, messages);

  assertUsableSettings(apiKey, model);

  const response = await fetch(`${getOpenRouterBaseUrl(settings)}/chat/completions`, {
    body: JSON.stringify(createOpenRouterChatRequestBody(settings, messages, model)),
    headers: createOpenRouterHeaders(apiKey),
    method: "POST",
    signal: options.signal,
  });

  const payload = (await readJson(response)) as OpenRouterChatResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter request failed with HTTP ${response.status}.`);
  }

  const message = payload.choices?.[0]?.message;
  const content = message?.content?.trim();

  if (!content) {
    throw new OpenRouterEmptyResponseError(extractReasoningText(message).trim() ? "OpenRouter returned reasoning but no final answer." : undefined);
  }

  return {
    content,
    reasoning: settings.thinking.enabled ? createReasoningSnapshotFromRaw(extractReasoningText(message)) : undefined,
    usage: normalizeOpenRouterUsage(payload.usage),
  };
}

export async function streamOpenRouterMessage(
  settings: ProviderSettings,
  messages: ChatMessage[],
  onUpdate: (snapshot: StreamSnapshot) => void,
  options: OpenRouterRequestOptions = {},
) {
  const apiKey = settings.openRouterApiKey.trim();
  const model = modelForMessages(settings, messages);

  assertUsableSettings(apiKey, model);

  const response = await fetch(`${getOpenRouterBaseUrl(settings)}/chat/completions`, {
    body: JSON.stringify(createOpenRouterStreamRequestBody(settings, messages, model)),
    headers: createOpenRouterHeaders(apiKey),
    method: "POST",
    signal: options.signal,
  });

  if (!response.ok) {
    const payload = (await readJson(response)) as OpenRouterChatResponse;
    throw new Error(payload.error?.message || `OpenRouter request failed with HTTP ${response.status}.`);
  }

  if (!response.body) {
    throw new Error("OpenRouter did not return a streaming response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let reasoningTrimmed = false;
  let usage: OpenRouterUsage | undefined;
  let flushTimer: number | null = null;
  let lastFlushedContent = "";
  let lastFlushedReasoning = "";

  function flushSnapshot(force = false) {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }

    const nextReasoning = createReasoningSnapshot(reasoning, reasoningTrimmed);

    if (!force && content === lastFlushedContent && (nextReasoning ?? "") === lastFlushedReasoning) {
      return;
    }

    lastFlushedContent = content;
    lastFlushedReasoning = nextReasoning ?? "";
    onUpdate({
      content,
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
        const delta = parseStreamLine(line);

        if (!delta) {
          continue;
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
    }

    const finalDelta = parseStreamLine(buffer);

    if (finalDelta) {
      content = appendStreamText(content, finalDelta.contentDelta);
      usage = finalDelta.usage ?? usage;
      const finalReasoningDelta = settings.thinking.enabled ? finalDelta.reasoningDelta : "";
      reasoning = appendReasoningDelta(reasoning, finalReasoningDelta);
      reasoningTrimmed = reasoningTrimmed || reasoning.length > MAX_STREAM_REASONING_CHARS;
    }

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

  const finalContent = content.trim();

  if (!finalContent) {
    throw new OpenRouterEmptyResponseError(reasoning.trim() ? "OpenRouter returned reasoning but no final answer." : undefined);
  }

  return {
    content: finalContent,
    reasoning: createReasoningSnapshot(reasoning, reasoningTrimmed),
    usage,
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

export async function validateOpenRouterSettings(settings: ProviderSettings) {
  const apiKey = settings.openRouterApiKey.trim();

  if (!apiKey) {
    throw new Error("Enter an OpenRouter API key first.");
  }

  const response = await fetch(`${getOpenRouterBaseUrl(settings)}/models`, {
    headers: createOpenRouterHeaders(apiKey),
    method: "GET",
  });

  const payload = (await readJson(response)) as OpenRouterModelsResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter models check failed with HTTP ${response.status}.`);
  }

  const model = normalizeProviderModelId("openrouter", settings.model.trim());
  const modelExists = isOpenRouterRouterModel(model) || Boolean(model && payload.data?.some((entry) => entry.id === model));

  return modelExists ? `Connected. ${model} is available.` : "Connected. The key works, but this model was not listed.";
}

export async function fetchOpenRouterModelContextLength(settings: ProviderSettings, options: OpenRouterRequestOptions = {}) {
  const model = settings.model.trim();
  const contextLengths = await fetchOpenRouterModelContextLengths(settings, [model], options);

  return contextLengths[model] ?? null;
}

export async function fetchOpenRouterModelContextLengths(settings: ProviderSettings, models: string[], options: OpenRouterRequestOptions = {}) {
  const requestedModels = new Set(models.map((model) => model.trim()).filter(Boolean));

  if (requestedModels.size === 0) {
    return {};
  }

  const response = await fetch(`${getOpenRouterBaseUrl(settings)}/models`, {
    headers: createOpenRouterHeaders(settings.openRouterApiKey.trim()),
    method: "GET",
    signal: options.signal,
  });

  const payload = (await readJson(response)) as OpenRouterModelsResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter models check failed with HTTP ${response.status}.`);
  }

  return (payload.data ?? []).reduce<Record<string, number>>((contextLengths, entry) => {
    const modelId = entry.id;
    const contextLength = entry.context_length;

    if (modelId && requestedModels.has(modelId) && typeof contextLength === "number" && Number.isFinite(contextLength) && contextLength > 0) {
      contextLengths[modelId] = Math.round(contextLength);
    }

    return contextLengths;
  }, {});
}

export function createOpenRouterChatRequestBody(settings: ProviderSettings, messages: ChatMessage[], model = modelForMessages(settings, messages)) {
  const systemPrompt = buildAgentSystemPrompt({ messages, settings });

  const body: OpenRouterRequestBody = {
    max_tokens: settings.maxTokens,
    messages: [
      { role: "system", content: systemPrompt },
      ...messages.map((message) => ({
        role: message.role,
        content: createOpenRouterMessageContent(message),
      })),
    ],
    model,
    reasoning: settings.thinking.enabled
      ? {
          effort: settings.thinking.effort,
          exclude: false,
        }
      : {
          effort: "none",
          exclude: true,
    },
  };

  applyOpenRouterFreeModelRouting(body, model, messages);

  return body;
}

export function createOpenRouterStreamRequestBody(settings: ProviderSettings, messages: ChatMessage[], model = modelForMessages(settings, messages)) {
  return {
    ...createOpenRouterChatRequestBody(settings, messages, model),
    stream: true,
    stream_options: {
      include_usage: true,
    },
  };
}

export function modelForMessages(settings: ProviderSettings, messages: ChatMessage[]) {
  const configuredModel = normalizeProviderModelId("openrouter", settings.model.trim());
  const hasImages = messages.some((message) => message.attachments?.some(isImageAttachment));

  return hasImages ? IMAGE_REASONING_MODEL : configuredModel;
}

export function createOpenRouterMessageContent(message: ChatMessage): OpenRouterMessageContent {
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

function createOpenRouterHeaders(apiKey: string) {
  return {
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    "Content-Type": "application/json",
    "HTTP-Referer": window.location.origin,
    "X-Title": "Gilbert Codex",
  };
}

function getOpenRouterBaseUrl(settings: ProviderSettings) {
  return getProviderBaseUrl({ ...settings, provider: "openrouter" });
}

function assertUsableSettings(apiKey: string, model: string) {
  if (!apiKey) {
    throw new Error("Add an OpenRouter API key in Settings before sending a message.");
  }

  if (!model) {
    throw new Error("Choose an OpenRouter model in Settings before sending a message.");
  }
}

function parseStreamLine(line: string) {
  const trimmedLine = line.trim();

  if (!trimmedLine || trimmedLine.startsWith(":") || !trimmedLine.startsWith("data:")) {
    return null;
  }

  const data = trimmedLine.replace(/^data:\s*/, "");

  if (data === "[DONE]") {
    return null;
  }

  let payload: OpenRouterStreamChunk;

  try {
    payload = JSON.parse(data) as OpenRouterStreamChunk;
  } catch {
    throw new Error("OpenRouter returned a malformed streaming response.");
  }

  if (payload.error?.message) {
    throw new Error(payload.error.message);
  }

  const choice = payload.choices?.[0];
  const delta = choice?.delta ?? choice?.message;

  return {
    contentDelta: delta?.content ?? "",
    reasoningDelta: extractReasoningText(delta),
    usage: normalizeOpenRouterUsage(payload.usage),
  };
}

function normalizeOpenRouterUsage(usage: OpenRouterUsage | null | undefined): OpenRouterUsage | undefined {
  if (!usage) {
    return undefined;
  }

  const promptTokens = normalizeUsageToken(usage.prompt_tokens);
  const completionTokens = normalizeUsageToken(usage.completion_tokens);
  const totalTokens = normalizeUsageToken(usage.total_tokens);

  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined) {
    return undefined;
  }

  return {
    completion_tokens: completionTokens,
    prompt_tokens: promptTokens,
    total_tokens: totalTokens,
  };
}

function normalizeUsageToken(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined;
}

function extractReasoningText(
  delta:
    | {
        reasoning?: string;
        reasoning_content?: string;
        reasoning_details?: OpenRouterReasoningDetail[];
      }
    | undefined,
) {
  if (!delta) {
    return "";
  }

  return firstReasoningText(delta.reasoning, delta.reasoning_content, extractReasoningDetailsText(delta.reasoning_details));
}

function extractReasoningDetailsText(details: OpenRouterReasoningDetail[] | undefined) {
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
