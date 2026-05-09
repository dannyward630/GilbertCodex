import type { ChatMessage } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { attachmentSummary, isImageAttachment } from "../lib/chatAttachments";
import { IMAGE_REASONING_MODEL } from "../lib/models";

const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";
const STREAM_FLUSH_MS = 32;

interface OpenRouterChatResponse {
  choices?: Array<{
    message?: {
      content?: string;
      reasoning?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      reasoning?: string;
    };
    message?: {
      content?: string;
      reasoning?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface OpenRouterModelsResponse {
  data?: Array<{
    id?: string;
  }>;
  error?: {
    message?: string;
  };
}

interface StreamSnapshot {
  content: string;
  reasoning?: string;
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

export async function sendOpenRouterMessage(settings: ProviderSettings, messages: ChatMessage[]) {
  const apiKey = settings.openRouterApiKey.trim();
  const model = modelForMessages(settings, messages);

  assertUsableSettings(apiKey, model);

  const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
    body: JSON.stringify(createChatRequestBody(settings, messages, model)),
    headers: createOpenRouterHeaders(apiKey),
    method: "POST",
  });

  const payload = (await readJson(response)) as OpenRouterChatResponse;

  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenRouter request failed with HTTP ${response.status}.`);
  }

  const message = payload.choices?.[0]?.message;
  const content = message?.content?.trim();

  if (!content) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return {
    content,
    reasoning: settings.thinking.showReasoning ? message?.reasoning?.trim() : undefined,
  };
}

export async function streamOpenRouterMessage(
  settings: ProviderSettings,
  messages: ChatMessage[],
  onUpdate: (snapshot: StreamSnapshot) => void,
) {
  const apiKey = settings.openRouterApiKey.trim();
  const model = modelForMessages(settings, messages);

  assertUsableSettings(apiKey, model);

  const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
    body: JSON.stringify({
      ...createChatRequestBody(settings, messages, model),
      stream: true,
    }),
    headers: createOpenRouterHeaders(apiKey),
    method: "POST",
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
  let flushTimer: ReturnType<typeof window.setTimeout> | null = null;
  let lastFlushedContent = "";
  let lastFlushedReasoning = "";

  function flushSnapshot(force = false) {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }

    const nextReasoning = reasoning.trim() ? reasoning : undefined;

    if (!force && content === lastFlushedContent && (nextReasoning ?? "") === lastFlushedReasoning) {
      return;
    }

    lastFlushedContent = content;
    lastFlushedReasoning = nextReasoning ?? "";
    onUpdate({
      content,
      reasoning: nextReasoning,
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

        const reasoningDelta = settings.thinking.showReasoning ? delta.reasoningDelta : "";
        content += delta.contentDelta;
        reasoning += reasoningDelta;

        if (delta.contentDelta || reasoningDelta) {
          scheduleSnapshot();
        }
      }
    }

    const finalDelta = parseStreamLine(buffer);

    if (finalDelta) {
      content += finalDelta.contentDelta;
      reasoning += settings.thinking.showReasoning ? finalDelta.reasoningDelta : "";
    }

    flushSnapshot(true);
  } finally {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
    }

    reader.releaseLock();
  }

  const finalContent = content.trim();

  if (!finalContent) {
    throw new Error("OpenRouter returned an empty response.");
  }

  return {
    content: finalContent,
    reasoning: reasoning.trim() || undefined,
  };
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

function createChatRequestBody(settings: ProviderSettings, messages: ChatMessage[], model: string) {
  return {
    max_tokens: settings.maxTokens,
    messages: [
      { role: "system", content: settings.systemPrompt },
      ...messages.map((message) => ({
        role: message.role,
        content: createOpenRouterMessageContent(message),
      })),
    ],
    model,
    reasoning: settings.thinking.enabled
      ? {
          effort: settings.thinking.effort,
          exclude: !settings.thinking.showReasoning,
        }
      : {
          effort: "none",
          exclude: true,
        },
    temperature: settings.temperature,
  };
}

function modelForMessages(settings: ProviderSettings, messages: ChatMessage[]) {
  const configuredModel = settings.model.trim();
  const hasImages = messages.some((message) => message.attachments?.some(isImageAttachment));

  return hasImages ? IMAGE_REASONING_MODEL : configuredModel;
}

function createOpenRouterMessageContent(message: ChatMessage): OpenRouterMessageContent {
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

function createMessageTextForProvider(message: ChatMessage) {
  const content = message.content.trim();
  const attachments = message.attachments ?? [];

  if (attachments.length === 0) {
    return message.content;
  }

  const summary = attachmentSummary(attachments);

  if (!summary) {
    return content;
  }

  return content ? `${content}\n\nAttachments:\n${summary}` : `Attachments:\n${summary}`;
}

function createOpenRouterHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
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
    reasoningDelta: delta?.reasoning ?? "",
  };
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
