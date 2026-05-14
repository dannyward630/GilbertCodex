import { isDeepResearchThinking } from "../../types/settings";
import { normalizeToolRegistrySettings } from "../../types/tools";
import type { ProviderSettings } from "../../types/settings";

export interface RuntimeToolPromptInput {
  hasLocalComputerContext: boolean;
  hasWebContext: boolean;
  latestUserPrompt: string;
  selectedChunkIds: Set<string>;
  settings: ProviderSettings;
}

export function createRuntimeToolPrompt({ hasLocalComputerContext, hasWebContext, settings }: RuntimeToolPromptInput) {
  const tools = normalizeToolRegistrySettings(settings.tools);
  const sections = [
    "Use only app-exposed provider tool calls when they are attached to this request. Do not invent text-only tool JSON, XML, local-computer protocols, MCP calls, Git calls, terminal transcripts, or workflow calls in visible Markdown.",
    tools.terminal
      ? "Terminal commands are available only through the approval-gated terminal_run tool, which runs inside the selected workspace with a cwd, timeout, captured output, and optional background session for dev servers."
      : "Terminal execution is disabled.",
    tools.browserPreview
      ? "Browser/app preview is available through browser_preview_open after a local dev server URL exists or a public HTTPS URL is provided."
      : "Browser/app preview is disabled.",
    tools.webSearch
      ? "Use the web_search tool only for current, external, source-backed, or official documentation evidence. Prefer local workspace tools for project code and app behavior; do not search the web just because a prompt mentions an app, API route, source code, or local docs."
      : "Web search is disabled.",
    hasWebContext
      ? "Live web-search context is present. Treat it as the only current external evidence for this answer and cite only the provided URLs."
      : tools.webSearch
        ? "If current web evidence is needed, call web_search with a focused query. If web_search is unavailable or returns no usable sources, say what could not be verified instead of pretending a search ran."
        : "If live web evidence is unavailable, say what could not be verified instead of pretending a search ran.",
    hasLocalComputerContext
      ? "Local workspace context may be attached as bounded metadata. It is not proof that any file was read, edited, tested, committed, or executed during this turn."
      : "",
    isDeepResearchThinking(settings.thinking)
      ? tools.webSearch
        ? "Deep Research may run multiple focused web_search calls when source coverage is insufficient. Use separate searches for distinct subquestions, prefer primary sources, avoid duplicate queries, and synthesize only from cited live sources plus local tool evidence."
        : "Deep Research should stay source-disciplined. If web_search is disabled and attached web context is insufficient, say what could not be verified instead of pretending a search ran."
      : "",
    "Visible answers should be normal Markdown. Never mention hidden tool protocols or unavailable tool syntax unless the user directly asks about tool availability.",
  ];

  return sections.filter(Boolean).join("\n");
}
