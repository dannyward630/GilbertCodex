import { clampPromptText, estimatePromptTokens } from "./promptBudget";
import {
  clampSelectedChunkContent,
  createAgentPromptRetrievalContext,
  selectPromptChunks,
  type SelectedPromptChunk,
} from "./promptRetrieval";
import { createRuntimeToolPrompt } from "./runtimeToolPrompt";
import type { ChatMessage } from "../../types/chat";
import type { ProviderSettings } from "../../types/settings";

const MAX_CONFIGURED_SYSTEM_PROMPT_TOKENS = 800;
const MAX_USER_INSTRUCTIONS_TOKENS = 1200;
const MAX_TOTAL_SYSTEM_PROMPT_TOKENS = 5200;

export interface AgentSystemPromptInput {
  messages: ChatMessage[];
  settings: ProviderSettings;
}

export interface AgentSystemPromptBuild {
  prompt: string;
  selectedChunks: SelectedPromptChunk[];
  tokenEstimate: number;
}

export function buildAgentSystemPrompt(input: AgentSystemPromptInput) {
  return buildAgentSystemPromptWithMetadata(input).prompt;
}

export function buildAgentSystemPromptWithMetadata({ messages, settings }: AgentSystemPromptInput): AgentSystemPromptBuild {
  const retrievalContext = createAgentPromptRetrievalContext(settings, messages);
  const selectedChunks = selectPromptChunks(retrievalContext);
  const selectedChunkIds = new Set(selectedChunks.map((entry) => entry.chunk.id));
  const sections = [
    formatCurrentRuntimeContext(),
    ...selectedChunks.map((entry) => formatPromptChunk(entry)),
    formatConfiguredSystemPrompt(settings.systemPrompt),
    formatUserInstructions(settings.userInstructions),
    formatRuntimePolicySection(
      createRuntimeToolPrompt({
        hasLocalComputerContext: retrievalContext.hasLocalComputerContext,
        hasWebContext: retrievalContext.hasWebContext,
        latestUserPrompt: retrievalContext.latestUserPrompt,
        selectedChunkIds,
        settings,
      }),
    ),
    formatPromptOptimizationSection(selectedChunks),
  ].filter(Boolean);
  const prompt = clampPromptText(sections.join("\n\n"), MAX_TOTAL_SYSTEM_PROMPT_TOKENS);

  return {
    prompt,
    selectedChunks,
    tokenEstimate: estimatePromptTokens(prompt),
  };
}

function formatPromptChunk(entry: SelectedPromptChunk) {
  const content = clampSelectedChunkContent(entry.chunk);

  if (!content) {
    return "";
  }

  return content;
}

function formatCurrentRuntimeContext() {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local timezone";
  const localDateTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
    timeStyle: "long",
  }).format(now);

  return [
    "# Current Runtime Context",
    `Current local date and time: ${localDateTime}`,
    `Current ISO timestamp: ${now.toISOString()}`,
    `User/local timezone: ${timezone}`,
    "Treat this date/time as authoritative for relative dates such as today, tomorrow, yesterday, latest, recent, currently, and now.",
    "For current, latest, changing, or source-backed facts, use provided web context or call web_search when that tool is enabled. If live web evidence is unavailable, say what could not be verified instead of relying on stale model memory.",
  ].join("\n");
}

function formatConfiguredSystemPrompt(systemPrompt: string) {
  const trimmed = systemPrompt.trim();

  if (!trimmed) {
    return "";
  }

  return ["# User Configured Assistant Profile", clampPromptText(trimmed, MAX_CONFIGURED_SYSTEM_PROMPT_TOKENS)].join("\n\n");
}

function formatUserInstructions(userInstructions: string) {
  const trimmed = userInstructions.trim();

  if (!trimmed) {
    return "";
  }

  return ["# User Instructions", clampPromptText(trimmed, MAX_USER_INSTRUCTIONS_TOKENS)].join("\n\n");
}

function formatRuntimePolicySection(content: string) {
  const trimmed = content.trim();

  if (!trimmed) {
    return "";
  }

  return ["# Runtime Policy", trimmed].join("\n\n");
}

function formatPromptOptimizationSection(selectedChunks: SelectedPromptChunk[]) {
  const loadedSkills = selectedChunks
    .filter((entry) => !entry.chunk.alwaysInclude)
    .map((entry) => entry.chunk.id)
    .join(", ");

  if (!loadedSkills) {
    return "# Prompt Loading Policy\n\nOnly the stable core instructions were loaded because no specialized prompt chunk was needed.";
  }

  return [
    "# Prompt Loading Policy",
    "The app loaded only the relevant instruction chunks for this request using the local prompt vector index. Follow loaded chunks; do not assume unloaded skills apply unless tool results or the user request make them relevant.",
    `Loaded chunks: ${loadedSkills}.`,
  ].join("\n\n");
}
