import { estimatePromptTokens, clampPromptText } from "./promptBudget";
import { PROMPT_CATALOG, createPromptChunkSearchText, type PromptChunk } from "./promptCatalog";
import { cosineSimilarity, createPromptEmbedding, createPromptTermSet, type PromptEmbedding } from "./promptEmbedding";
import { isDeepResearchThinking } from "../../types/settings";
import { normalizeToolRegistrySettings } from "../../types/tools";
import { getDetectedProjectTypes } from "../../tools/workspaceContext";
import type { ChatMessage } from "../../types/chat";
import type { ProviderSettings } from "../../types/settings";

const STANDARD_SKILL_TOKEN_BUDGET = 2200;
const DEEP_RESEARCH_SKILL_TOKEN_BUDGET = 2900;
const MAX_RETRIEVED_CHUNKS = 7;
const MIN_RELEVANCE_SCORE = 0.055;
const HIGH_PRIORITY_FLOOR_EXEMPTION = 75;

interface IndexedPromptChunk {
  chunk: PromptChunk;
  embedding: PromptEmbedding;
}

export interface AgentPromptRetrievalContext {
  enabledToolNames: string[];
  hasLocalComputerContext: boolean;
  hasWebContext: boolean;
  latestUserPrompt: string;
  mode: "chat" | "planning";
  query: string;
  settings: ProviderSettings;
}

export interface SelectedPromptChunk {
  chunk: PromptChunk;
  score: number;
  tokens: number;
}

const PROMPT_INDEX: IndexedPromptChunk[] = PROMPT_CATALOG.map((chunk) => ({
  chunk,
  embedding: createPromptEmbedding(createPromptChunkSearchText(chunk)),
}));

export function createAgentPromptRetrievalContext(settings: ProviderSettings, messages: ChatMessage[]): AgentPromptRetrievalContext {
  const tools = normalizeToolRegistrySettings(settings.tools);
  const enabledToolNames = getEnabledToolNames(settings);
  const recentMessages = messages.slice(-6);
  const latestUserPrompt = getLatestUserPrompt(messages);
  const mode = recentMessages.some((message) => message.mode === "plan" || message.planning || message.content.includes("Planning passes")) ? "planning" : "chat";
  const hasLocalComputerContext = messages.some(hasLocalComputerContextMessage);
  const hasWebContext = messages.some(hasWebContextMessage);
  const query = [
    latestUserPrompt,
    mode === "planning" ? "planning architecture tradeoffs requirements" : "chat implementation answer",
    isDeepResearchThinking(settings.thinking) ? "deep research current facts official docs source backed" : "",
    tools.thinking ? "thinking enabled" : "",
    enabledToolNames.length > 0 ? `enabled tools ${enabledToolNames.join(" ")}` : "no runtime tools",
    hasLocalComputerContext ? "local computer tool results filesystem code workspace" : "",
    hasWebContext ? "web search results source citations current facts" : "",
    recentMessages.map((message) => `${message.role}: ${message.content.slice(0, 900)}`).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    enabledToolNames,
    hasLocalComputerContext,
    hasWebContext,
    latestUserPrompt,
    mode,
    query,
    settings,
  };
}

export function selectPromptChunks(context: AgentPromptRetrievalContext): SelectedPromptChunk[] {
  const queryEmbedding = createPromptEmbedding(context.query);
  const queryTerms = createPromptTermSet(context.query);
  const tokenBudget = isDeepResearchThinking(context.settings.thinking) ? DEEP_RESEARCH_SKILL_TOKEN_BUDGET : STANDARD_SKILL_TOKEN_BUDGET;
  const forcedChunkIds = getForcedChunkIds(context);
  const rankedChunks = PROMPT_INDEX.map(({ chunk, embedding }) => {
    const score = scorePromptChunk(chunk, embedding, queryEmbedding, queryTerms, context, forcedChunkIds.has(chunk.id));
    const tokens = estimatePromptTokens(clampPromptText(chunk.content, chunk.maxTokens ?? 400));

    return {
      chunk,
      score,
      tokens,
    };
  })
    .filter((entry) => {
      if (entry.chunk.alwaysInclude || forcedChunkIds.has(entry.chunk.id)) {
        return true;
      }

      if (!isChunkAllowed(entry.chunk, context)) {
        return false;
      }

      // High-priority chunks (project recipes, runtime tooling) skip the
      // similarity floor — they carry load-bearing instructions and should
      // surface whenever the chunk is allowed by toggles, even on short or
      // generic prompts.
      if (entry.chunk.priority >= HIGH_PRIORITY_FLOOR_EXEMPTION) {
        return true;
      }

      return entry.score >= MIN_RELEVANCE_SCORE;
    })
    .sort((left, right) => {
      if (left.chunk.alwaysInclude !== right.chunk.alwaysInclude) {
        return left.chunk.alwaysInclude ? -1 : 1;
      }

      if (forcedChunkIds.has(left.chunk.id) !== forcedChunkIds.has(right.chunk.id)) {
        return forcedChunkIds.has(left.chunk.id) ? -1 : 1;
      }

      return right.score - left.score || right.chunk.priority - left.chunk.priority;
    });

  const selected: SelectedPromptChunk[] = [];
  let usedTokens = 0;

  for (const entry of rankedChunks) {
    const alwaysInclude = Boolean(entry.chunk.alwaysInclude || forcedChunkIds.has(entry.chunk.id));
    const optionalCount = selected.filter((item) => !item.chunk.alwaysInclude && !forcedChunkIds.has(item.chunk.id)).length;

    if (!alwaysInclude && optionalCount >= MAX_RETRIEVED_CHUNKS) {
      continue;
    }

    if (!alwaysInclude && usedTokens + entry.tokens > tokenBudget) {
      continue;
    }

    selected.push(entry);
    usedTokens += entry.tokens;
  }

  return sortSelectedChunksForPrompt(selected, forcedChunkIds);
}

export function clampSelectedChunkContent(chunk: PromptChunk) {
  return clampPromptText(chunk.content, chunk.maxTokens ?? 400);
}

function scorePromptChunk(
  chunk: PromptChunk,
  chunkEmbedding: PromptEmbedding,
  queryEmbedding: PromptEmbedding,
  queryTerms: Set<string>,
  context: AgentPromptRetrievalContext,
  forced: boolean,
) {
  if (chunk.alwaysInclude) {
    return 1;
  }

  const semanticScore = cosineSimilarity(chunkEmbedding.vector, queryEmbedding.vector);
  const keywordScore = scoreKeywordOverlap(chunk, queryTerms);
  const priorityScore = chunk.priority / 1000;
  const modeBoost = chunk.id === "mode.planning" && context.mode === "planning" ? 0.24 : 0;
  const researchBoost = chunk.id === "skill.research-current-facts" && isResearchLike(context.latestUserPrompt, context.settings) ? 0.22 : 0;
  const codingBoost = chunk.id === "skill.coding-agent-workflow" && isCodingLike(context.latestUserPrompt) ? 0.2 : 0;
  const reviewBoost = chunk.id === "skill.code-review" && /\b(review|audit|production-ready|risk|bug hunt|findings)\b/i.test(context.latestUserPrompt) ? 0.18 : 0;
  const frontendBoost = chunk.id === "skill.frontend-product-quality" && /\b(ui|ux|frontend|screen|css|layout|responsive|visual|preview)\b/i.test(context.latestUserPrompt) ? 0.18 : 0;
  const forcedBoost = forced ? 0.35 : 0;

  return semanticScore * 0.58 + keywordScore * 0.28 + priorityScore + modeBoost + researchBoost + codingBoost + reviewBoost + frontendBoost + forcedBoost;
}

function scoreKeywordOverlap(chunk: PromptChunk, queryTerms: Set<string>) {
  const matchingKeywords = chunk.keywords.filter((keyword) => {
    const keywordTerms = createPromptTermSet(keyword);

    return [...keywordTerms].some((term) => queryTerms.has(term)) || queryTerms.has(keyword.toLowerCase());
  });

  return Math.min(matchingKeywords.length / Math.max(chunk.keywords.length, 1), 1);
}

function getForcedChunkIds(context: AgentPromptRetrievalContext) {
  const tools = normalizeToolRegistrySettings(context.settings.tools);
  const forced = new Set<string>();

  if (context.enabledToolNames.length > 0) {
    forced.add("tool.runtime-format");
  }

  if (hasAnyLocalTool(context.settings) || context.hasLocalComputerContext) {
    forced.add("tool.local-computer");
  }

  if (tools.webSearch || context.hasWebContext) {
    forced.add("tool.web-search");
  }

  if (tools.fileCreation && isFileCreationLike(context.query)) {
    forced.add("tool.file-creation");
  }

  if (context.mode === "planning") {
    forced.add("mode.planning");
  }

  if (isResearchLike(context.latestUserPrompt, context.settings)) {
    forced.add("skill.research-current-facts");
  }

  if (isCodingLike(context.latestUserPrompt) || hasAnyLocalTool(context.settings)) {
    forced.add("skill.coding-agent-workflow");
  }

  const detectedTypes = getDetectedProjectTypes();
  const promptText = context.latestUserPrompt;

  if (detectedTypes.has("node") || detectedTypes.has("tauri") || isNodeLike(promptText)) {
    forced.add("skill.language-node");
  }

  if (detectedTypes.has("python") || isPythonLike(promptText)) {
    forced.add("skill.language-python");
  }

  return forced;
}

function isFileCreationLike(query: string) {
  return /\b(create|write|file|markdown|react|html|pdf|artifact|folder|app|project|scaffold|init|setup|generate|build me|new|todo|crud|cli|server|api)\b/i.test(query);
}

function isNodeLike(prompt: string) {
  return /\b(node|nodejs|node\.js|npm|pnpm|yarn|bun|package\.json|express|next\.?js|vite|react|tauri|expo|react native|typescript|tsx|jsx|monorepo)\b/i.test(prompt);
}

function isPythonLike(prompt: string) {
  return /\b(python|py|pip|pipenv|poetry|uv|venv|virtualenv|pyproject|requirements\.txt|django|flask|fastapi|pytest|mypy|ruff|conda)\b/i.test(prompt);
}

function isChunkAllowed(chunk: PromptChunk, context: AgentPromptRetrievalContext) {
  const tools = normalizeToolRegistrySettings(context.settings.tools);

  if (chunk.id === "tool.runtime-format") {
    return context.enabledToolNames.length > 0;
  }

  if (chunk.id === "tool.local-computer") {
    return hasAnyLocalTool(context.settings) || context.hasLocalComputerContext;
  }

  if (chunk.id === "tool.web-search") {
    return tools.webSearch || context.hasWebContext;
  }

  if (chunk.id === "tool.file-creation") {
    return tools.fileCreation;
  }

  return true;
}

function sortSelectedChunksForPrompt(chunks: SelectedPromptChunk[], forcedChunkIds: Set<string>) {
  const kindOrder: Record<PromptChunk["kind"], number> = {
    core: 0,
    mode: 1,
    skill: 2,
    tool: 3,
  };

  return [...chunks].sort((left, right) => {
    if (kindOrder[left.chunk.kind] !== kindOrder[right.chunk.kind]) {
      return kindOrder[left.chunk.kind] - kindOrder[right.chunk.kind];
    }

    if (left.chunk.alwaysInclude !== right.chunk.alwaysInclude) {
      return left.chunk.alwaysInclude ? -1 : 1;
    }

    if (forcedChunkIds.has(left.chunk.id) !== forcedChunkIds.has(right.chunk.id)) {
      return forcedChunkIds.has(left.chunk.id) ? -1 : 1;
    }

    return right.chunk.priority - left.chunk.priority || right.score - left.score;
  });
}

function getLatestUserPrompt(messages: ChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user" && message.content.trim())?.content.trim() ?? "";
}

function getEnabledToolNames(settings: ProviderSettings) {
  const tools = normalizeToolRegistrySettings(settings.tools);

  return [
    tools.webSearch ? "web_search" : "",
    tools.weatherTools ? "weather" : "",
    tools.fileSearch ? "recall_context" : "",
    tools.fileSearch ? "search_files" : "",
    tools.codeView ? "view_code" : "",
    tools.codeView ? "read_file" : "",
    tools.fileBrowser ? "list_directory" : "",
    tools.fileBrowser ? "build_index" : "",
    tools.codeEdit ? "edit_file" : "",
    tools.codeEdit ? "write_file" : "",
    tools.fileCreation ? "create_files" : "",
    tools.fileCreation ? "create_vite_project" : "",
    tools.fileSafety ? "delete_file" : "",
    tools.testingTools ? "run_tests" : "",
    tools.typescriptTools ? "typescript_check" : "",
    tools.terminal ? "run_terminal" : "",
    tools.browserPreview ? "open_browser_preview" : "",
  ].filter(Boolean);
}

function hasAnyLocalTool(settings: ProviderSettings) {
  const tools = normalizeToolRegistrySettings(settings.tools);

  return (
    tools.fileBrowser ||
    tools.fileSearch ||
    tools.codeView ||
    tools.codeEdit ||
    tools.fileCreation ||
    tools.fileSafety ||
    tools.pdfTools ||
    tools.colorTools ||
    tools.testingTools ||
    tools.typescriptTools ||
    tools.sqlTools ||
    tools.reactNativeTools ||
    tools.codeGeneration ||
    tools.terminal ||
    tools.browserPreview ||
    tools.weatherTools
  );
}

function isResearchLike(prompt: string, settings: ProviderSettings) {
  return isDeepResearchThinking(settings.thinking) || /\b(deep research|research|latest|current|today|docs?|official|verify|look up|source|cite|api|changelog|standard)\b/i.test(prompt);
}

function isCodingLike(prompt: string) {
  return /\b(code|coding|implement|fix|debug|refactor|repo|repository|folder|file|build|test|senior dev|senior engineer|typescript|react|tauri|rust|app)\b/i.test(prompt);
}

function hasLocalComputerContextMessage(message: ChatMessage) {
  return message.content.includes("LOCAL COMPUTER FILE TOOL") || message.content.includes("LOCAL COMPUTER TOOL RESULTS") || message.content.includes("AGENT TOOL RESULTS");
}

function hasWebContextMessage(message: ChatMessage) {
  return message.id.startsWith("web-context") || message.content.includes("WEB SEARCH CONTEXT - ") || message.content.includes("WEB TOOL RESULTS");
}
