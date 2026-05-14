import { describe, expect, it } from "vitest";
import { annotateProviderPayloadSpike, estimateModelProviderPayloadUsage } from "./modelProviderUsage";
import type { ChatMessage } from "../types/chat";
import { DEFAULT_BRAVE_SEARCH_SETTINGS } from "../types/settings";
import type { ProviderSettings } from "../types/settings";
import { DEFAULT_TOOL_REGISTRY_SETTINGS } from "../types/tools";

const settings: ProviderSettings = {
  apiKeys: {},
  baseUrls: {},
  maxTokens: 4096,
  model: "test-model",
  openRouterApiKey: "",
  provider: "openrouter",
  providerModels: {},
  systemPrompt: "",
  temperature: 0.2,
  thinking: {
    enabled: false,
    effort: "medium",
  },
  tools: DEFAULT_TOOL_REGISTRY_SETTINGS,
  topK: 0,
  topP: 1,
  userInstructions: "",
  webSearch: {
    brave: DEFAULT_BRAVE_SEARCH_SETTINGS,
    enabled: false,
    maxResults: 6,
    provider: "duckduckgo",
  },
  workspaceDependencies: {
    enabled: false,
  },
};

function message(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    content,
    createdAt: "2026-05-14T00:00:00.000Z",
    id: `message-${content.length}`,
    role: "user",
    ...extra,
  };
}

describe("provider payload usage guardrail", () => {
  it("breaks provider-visible payload estimates into obvious causes", () => {
    const usage = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [
        message("hello", {
          attachments: [{
            createdAt: "2026-05-14T00:00:00.000Z",
            id: "attachment",
            kind: "file",
            mimeType: "text/plain",
            name: "notes.txt",
            size: 2048,
            text: "attached text",
          }],
        }),
        message("tool result", {
          role: "assistant",
          toolCalls: [{
            id: "tool-1",
            label: "Read workspace file",
            output: "x".repeat(20_000),
            status: "complete",
          }],
        }),
      ],
      settings,
      source: "estimate",
    });

    expect(usage.payloadBreakdown?.map((item) => item.id)).toContain("toolOutput");
    expect(usage.payloadBreakdown?.map((item) => item.id)).toContain("attachments");
    expect(usage.payloadBreakdown?.find((item) => item.id === "toolOutput")?.tokens).toBeGreaterThan(4_000);
  });

  it("annotates large jumps with top contributors", () => {
    const previous = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [message("small")],
      settings,
      source: "estimate",
    });
    const current = estimateModelProviderPayloadUsage({
      contextWindowTokens: 128_000,
      messages: [
        message("small"),
        message("tool result", {
          role: "assistant",
          toolCalls: [{
            id: "tool-1",
            label: "Read workspace file",
            output: "x".repeat(220_000),
            status: "complete",
          }],
        }),
      ],
      settings,
      source: "estimate",
    });
    const annotated = annotateProviderPayloadSpike(current, previous);

    expect(annotated.payloadSpike?.summary).toContain("Payload estimate jumped");
    expect(annotated.payloadSpike?.topContributors[0]?.id).toBe("toolOutput");
  });
});
