import { attachmentSummary } from "../lib/chatAttachments";
import { createMessage, titleFromMessage } from "../lib/chatUtils";
import type { ChatAttachment } from "../types/chat";
import type { ProviderSettings } from "../types/settings";
import { DEFAULT_TOOL_REGISTRY_SETTINGS, type ToolRegistryId, type ToolRegistrySettings } from "../types/tools";
import { sendProviderMessage } from "./modelProviderClient";

const MAX_CHAT_TITLE_CHARS = 54;
const CHAT_TITLE_MAX_TOKENS = 32;
const TITLE_PREFIX_PATTERN = /^(chat\s*)?title\s*[:\-]\s*/i;

const DISABLED_TITLE_TOOLS = Object.fromEntries(
  (Object.keys(DEFAULT_TOOL_REGISTRY_SETTINGS) as ToolRegistryId[]).map((toolId) => [toolId, false]),
) as ToolRegistrySettings;

interface GenerateChatTitleInput {
  attachments: ChatAttachment[];
  content: string;
}

export async function generateChatTitle(settings: ProviderSettings, input: GenerateChatTitleInput, options: { signal?: AbortSignal } = {}) {
  const fallbackTitle = titleFromMessage(input.content, input.attachments);
  const response = await sendProviderMessage(createTitleProviderSettings(settings), [createMessage("user", createChatTitlePrompt(input))], {
    signal: options.signal,
  });

  return normalizeGeneratedChatTitle(response.content, fallbackTitle);
}

export function normalizeGeneratedChatTitle(value: string, fallbackTitle = "New chat") {
  const firstLine = value
    .replace(/```[\s\S]*?```/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  const normalized = cleanTitle(firstLine ?? value);

  if (!normalized || /<tool_call>|<\/tool_call>/i.test(normalized)) {
    return fallbackTitle;
  }

  return normalized.length > MAX_CHAT_TITLE_CHARS ? `${normalized.slice(0, MAX_CHAT_TITLE_CHARS - 3).trim()}...` : normalized;
}

function createTitleProviderSettings(settings: ProviderSettings): ProviderSettings {
  return {
    ...settings,
    maxTokens: CHAT_TITLE_MAX_TOKENS,
    systemPrompt: [
      "You create concise conversation titles for Gilbert Codex.",
      "Return only the title. Do not explain it, quote it, or add markdown.",
      "Summarize the user's intent instead of copying the first sentence verbatim.",
    ].join(" "),
    temperature: Math.min(settings.temperature, 0.2),
    thinking: {
      ...settings.thinking,
      enabled: false,
      effort: "minimal",
    },
    tools: { ...DISABLED_TITLE_TOOLS },
    userInstructions: "",
    webSearch: {
      ...settings.webSearch,
      enabled: false,
    },
    workspaceDependencies: {
      enabled: false,
    },
  };
}

function createChatTitlePrompt(input: GenerateChatTitleInput) {
  const sections = [
    "Name this chat.",
    "Rules:",
    "- Return only one title.",
    "- Use 2 to 6 words.",
    `- Keep it under ${MAX_CHAT_TITLE_CHARS} characters.`,
    "- Prefer Title Case.",
    "- Do not use ending punctuation.",
    "",
    "User message:",
    input.content.trim() || "(no text)",
  ];
  const attachments = attachmentSummary(input.attachments);

  if (attachments) {
    sections.push("", "Attachments:", attachments);
  }

  return sections.join("\n");
}

function cleanTitle(value: string) {
  return value
    .replace(TITLE_PREFIX_PATTERN, "")
    .replace(/^["'`*_>\-\s]+/, "")
    .replace(/["'`*_\s]+$/, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}
