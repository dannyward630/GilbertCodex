import { clampPromptText, estimatePromptTokens } from "./promptBudget";
import {
  clampSelectedChunkContent,
  createAgentPromptRetrievalContext,
  selectPromptChunks,
  type SelectedPromptChunk,
} from "./promptRetrieval";
import { createRuntimeToolPrompt } from "./runtimeToolPrompt";
import { formatWorkspaceContextForPrompt, getWorkspaceContextSnapshot } from "../../localWorkspace/workspaceContext";
import { formatBackgroundTerminalSessionsForPrompt } from "../../lib/terminalSessions";
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
    formatCurrentWorkspaceContext(),
    formatBackgroundTerminalSessionsForPrompt(),
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
    formatSessionLedger(messages),
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

function formatCurrentWorkspaceContext() {
  return formatWorkspaceContextForPrompt(getWorkspaceContextSnapshot());
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

const MAX_LEDGER_ENTRIES = 30;
const MAX_LEDGER_INPUT_CHARS = 140;

interface LedgerEntry {
  detail?: string;
  label: string;
  tool: string;
}

// Builds a compact session ledger so follow-up turns do not rerun completed tool work.
function formatSessionLedger(messages: ChatMessage[]): string {
  const entries: LedgerEntry[] = [];
  const seen = new Set<string>();

  for (const message of messages) {
    if (message.role !== "assistant" || !Array.isArray(message.toolCalls)) {
      continue;
    }
    for (const toolCall of message.toolCalls) {
      if (toolCall.status !== "complete") {
        continue;
      }
      const tool = sanitizeLedgerToken(toolCall.label || "tool");
      const detail = summarizeLedgerInput(toolCall.input);
      const key = `${tool}::${detail ?? ""}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      entries.push({ detail, label: toolCall.label || tool, tool });
    }
  }

  if (entries.length === 0) {
    return "";
  }

  const totalCount = entries.length;
  const visibleEntries = totalCount > MAX_LEDGER_ENTRIES ? entries.slice(-MAX_LEDGER_ENTRIES) : entries;
  const omittedCount = totalCount - visibleEntries.length;

  const lines = [
    "# Session Ledger",
    "The following tool actions already completed in this conversation. Do not redo any of them. If the user's follow-up does not contradict a prior result, build on it: read the latest tool output and continue. Re-running an identical action is wasteful and confuses the user.",
    omittedCount > 0
      ? `Showing the most recent ${visibleEntries.length} of ${totalCount} completed tool actions (${omittedCount} older entries omitted).`
      : `Total completed tool actions: ${totalCount}.`,
    "",
    ...visibleEntries.map((entry) => entry.detail ? `- ${entry.label}: ${entry.detail}` : `- ${entry.label}`),
  ];

  return lines.join("\n");
}

function sanitizeLedgerToken(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 60);
}

function summarizeLedgerInput(input: string | undefined): string | undefined {
  if (!input) {
    return undefined;
  }
  // Prefer the most distinguishing preview line instead of the whole approval-style block.
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const distinguishing = lines.find((line) =>
    /^(Path|Command|Query|URL|Repository|Branch|Tag):/i.test(line),
  );
  const chosen = distinguishing ?? lines[0];
  if (!chosen) {
    return undefined;
  }
  return chosen.length > MAX_LEDGER_INPUT_CHARS
    ? `${chosen.slice(0, MAX_LEDGER_INPUT_CHARS - 1)}…`
    : chosen;
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
