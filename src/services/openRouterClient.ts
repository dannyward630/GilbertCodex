import type { ChatMessage } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { attachmentSummary, isImageAttachment } from "../lib/chatAttachments";
import { createMessageContextSurface } from "../lib/contextWindow";
import { IMAGE_REASONING_MODEL } from "../lib/models";
import { normalizeToolRegistrySettings } from "../types/tools";
import type { ToolRegistrySettings } from "../types/tools";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
const STREAM_FLUSH_MS = 32;
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

  const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
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

  const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
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
  let flushTimer: ReturnType<typeof window.setTimeout> | null = null;
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
        usage = delta.usage ?? usage;
        content += delta.contentDelta;
        reasoningTrimmed = reasoningTrimmed || reasoning.length + reasoningDelta.length > MAX_STREAM_REASONING_CHARS;
        reasoning = appendReasoningDelta(reasoning, reasoningDelta);

        if (delta.contentDelta || reasoningDelta) {
          scheduleSnapshot();
        }
      }
    }

    const finalDelta = parseStreamLine(buffer);

    if (finalDelta) {
      content += finalDelta.contentDelta;
      usage = finalDelta.usage ?? usage;
      const finalReasoningDelta = settings.thinking.enabled ? finalDelta.reasoningDelta : "";
      reasoningTrimmed = reasoningTrimmed || reasoning.length + finalReasoningDelta.length > MAX_STREAM_REASONING_CHARS;
      reasoning = appendReasoningDelta(reasoning, finalReasoningDelta);
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
  if (!delta) {
    return reasoning;
  }

  const nextReasoning = reasoning + delta;
  return limitReasoningText(nextReasoning);
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

  const response = await fetch(`${OPENROUTER_API_URL}/models`, {
    headers: createOpenRouterHeaders(apiKey),
    method: "GET",
  });

  const payload = (await readJson(response)) as OpenRouterModelsResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter models check failed with HTTP ${response.status}.`);
  }

  const model = settings.model.trim();
  const modelExists = Boolean(model && payload.data?.some((entry) => entry.id === model));

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

  const response = await fetch(`${OPENROUTER_API_URL}/models`, {
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
  const systemPrompt = [
    settings.systemPrompt,
    createRuntimeToolSystemPrompt(settings.tools),
    messages.some(hasWebSearchContext)
      ? "A DuckDuckGo web-search context message is present. For this response, use those web results as the authority for current factual claims, cite relevant sources with Markdown links, and do not answer from memory when the web context is missing or insufficient."
      : "",
    messages.some(hasWebToolResults)
      ? "A web_search tool result is present. Use those sources as live web evidence and cite relevant URLs with Markdown links."
      : "",
    messages.some(hasLocalComputerContext)
      ? [
          "A local computer file tool context is present. Treat it as real filesystem access supplied by the app.",
          "Available local tools: view_code, read_file, list_directory, search_files, build_index, edit_file, write_file.",
          "search_files uses the local vector index to find relevant code and documents before reading or editing.",
          "When you need more local file evidence, request one or more compact <tool_call> blocks and wait for tool results. Do not tell the user to run shell commands for basic file viewing when local tools are enabled.",
          "The app shows requested tool calls in Activity. Do not paste raw tool XML as the final answer; after tool results arrive, answer directly from them.",
          "When an AGENT TOOL RESULTS or LOCAL COMPUTER TOOL RESULTS message is present, produce a normal final answer from those results instead of replying only that you will read, inspect, check, or analyze more files.",
          "Never end the response with only a promise to read more files after local tool results have already been provided.",
          "Full computer scope is read-only. Edits and writes are allowed only inside the selected/current folder workspace and never in Ask first mode without user confirmation.",
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
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
    temperature: settings.temperature,
  };
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

function createRuntimeToolSystemPrompt(settings: ToolRegistrySettings) {
  const tools = normalizeToolRegistrySettings(settings);
  const localTools = [
    tools.fileSearch ? "search_files" : "",
    tools.codeView ? "view_code" : "",
    tools.codeView ? "read_file" : "",
    tools.fileBrowser ? "list_directory" : "",
    tools.fileBrowser ? "build_index" : "",
    tools.codeEdit ? "edit_file" : "",
    tools.codeEdit ? "write_file" : "",
  ].filter(Boolean);
  const enabledTools = [tools.webSearch ? "web_search" : "", ...localTools].filter(Boolean);

  if (enabledTools.length === 0) {
    return "Runtime tool calling is disabled in Toolbox. Answer from the provided conversation and context only.";
  }

  return [
    "Runtime tools are available through compact tool_call blocks. Use them when they materially improve correctness, especially for bug fixing, code edits, current facts, official docs, changelogs, APIs, errors, or source-backed answers.",
    `Enabled runtime tools: ${enabledTools.join(", ")}.`,
    tools.webSearch ? "web_search is available on demand; the user does not need to turn web on first." : "web_search is disabled in Toolbox.",
    localTools.length > 0 ? `Local workspace tools enabled when local workspace context is available: ${localTools.join(", ")}.` : "Local workspace tools are disabled in Toolbox.",
    tools.fileSearch ? "Prefer search_files before guessing file locations." : "",
    tools.codeView ? "Prefer view_code with start_line/end_line or start_char/end_char before precise edits." : "",
    tools.codeEdit ? "edit_file supports exact replacement with old_text/new_text, line-range replacement with start_line/end_line/content, and single-character edits with start_char/end_char/content. It can change one letter or punctuation mark." : "",
    tools.webSearch ? "Use this XML shape and then stop so the app can run the tool: <tool_call>\nweb_search\n<arg_key>query</arg_key><arg_value>latest React release notes</arg_value>\n</tool_call>" : "",
    tools.codeEdit ? "For code edits, use a focused edit_file call rather than rewriting whole files when a small patch is enough." : "",
    "After tool results arrive, continue from the evidence and do not print raw tool calls.",
  ].filter(Boolean).join("\n");
}

function hasWebSearchContext(message: ChatMessage) {
  return message.id.startsWith("web-context") || message.content.includes("WEB SEARCH CONTEXT - DuckDuckGo");
}

function hasWebToolResults(message: ChatMessage) {
  return message.content.includes("WEB TOOL RESULTS");
}

function hasLocalComputerContext(message: ChatMessage) {
  return message.content.includes("LOCAL COMPUTER FILE TOOL") || message.content.includes("LOCAL COMPUTER TOOL RESULTS") || message.content.includes("AGENT TOOL RESULTS");
}

export function modelForMessages(settings: ProviderSettings, messages: ChatMessage[]) {
  const configuredModel = settings.model.trim();
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

  return [delta.reasoning, delta.reasoning_content, extractReasoningDetailsText(delta.reasoning_details)].filter(Boolean).join("");
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
