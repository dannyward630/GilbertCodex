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

/**
 * Runtime tools were intentionally removed. Web search remains a host-managed
 * pre-generation context path so model compatibility does not depend on native
 * or text-emitted tool calls.
 */
export function createRuntimeToolPrompt({ hasLocalComputerContext, hasWebContext, settings }: RuntimeToolPromptInput) {
  const tools = normalizeToolRegistrySettings(settings.tools);
  const sections = [
    "Model-callable runtime tools are disabled in this build. Do not emit tool-call JSON, XML, function-call syntax, terminal commands as actions, file-edit protocols, MCP calls, Git calls, workflow calls, or local-computer tool names.",
    tools.webSearch
      ? "Web search is host-managed. When a request needs current or source-backed information, Gilbert may attach live DuckDuckGo or Brave results before the model answers. Use attached web sources directly and cite supported claims with Markdown links."
      : "Web search is disabled.",
    hasWebContext
      ? "Live web-search context is present. Treat it as the only current external evidence for this answer and cite only the provided URLs."
      : "If live web evidence is unavailable, say what could not be verified instead of pretending a search ran.",
    hasLocalComputerContext
      ? "Local workspace context may be attached as bounded metadata. It is not proof that any file was read, edited, tested, committed, or executed during this turn."
      : "",
    isDeepResearchThinking(settings.thinking)
      ? "Deep Research should synthesize from conversation and host-attached web context only; do not attempt iterative tool loops."
      : "",
    "Visible answers should be normal Markdown. Never mention hidden tool protocols, removed tools, or unavailable tool syntax unless the user directly asks about tool availability.",
  ];

  return sections.filter(Boolean).join("\n");
}
