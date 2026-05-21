import { describe, expect, it } from "vitest";

import { defaultProviderSettings } from "../../../lib/appStorage";
import type { ChatMessage, ChatToolCall } from "../../../types/chat";
import {
  createEmptyResponseRetrySettings,
  createProviderRetryInstruction,
  hasLocalToolEvidence,
  isRetryableProviderMessageError,
  type ProviderStreamingDeps,
} from "./providerStreaming";

function message(content: string, toolCalls?: ChatToolCall[]): ChatMessage {
  return {
    content,
    createdAt: "2026-05-21T00:00:00.000Z",
    id: `message-${content.length}`,
    role: "assistant",
    toolCalls,
  };
}

describe("provider streaming recovery", () => {
  it("detects saved local tool evidence before retrying provider output", () => {
    expect(hasLocalToolEvidence({} as ProviderStreamingDeps, [message("plain answer")])).toBe(false);
    expect(hasLocalToolEvidence({} as ProviderStreamingDeps, [message("AGENT TOOL RESULTS\nRead src/app.ts")])).toBe(true);
    expect(hasLocalToolEvidence({} as ProviderStreamingDeps, [
      message("working", [{ id: "tool-1", label: "Read file", status: "complete" } as ChatToolCall]),
    ])).toBe(true);
  });

  it("builds a retry instruction that uses prior tool evidence without exposing recovery details", () => {
    const deps = {
      hasLocalToolEvidence: (messages: ChatMessage[]) => hasLocalToolEvidence({} as ProviderStreamingDeps, messages),
    } as ProviderStreamingDeps;

    const instruction = createProviderRetryInstruction(deps, [message("LOCAL COMPUTER TOOL RESULTS\nTests passed")], true);

    expect(instruction).toContain("RETRY AFTER EMPTY PROVIDER RESPONSE");
    expect(instruction).toContain("Previously gathered observations are already present above");
    expect(instruction).toContain("Do not mention provider behavior");
  });

  it("creates lower-risk retry settings for blank or transient provider responses", () => {
    const deps = {
      LOCAL_TOOL_FINAL_MIN_TOKENS: 4096,
    } as ProviderStreamingDeps;

    const retrySettings = createEmptyResponseRetrySettings(deps, {
      ...defaultProviderSettings,
      maxTokens: 512,
      temperature: 0.9,
      thinking: {
        enabled: true,
        effort: "high",
      },
    });

    expect(retrySettings.maxTokens).toBe(4096);
    expect(retrySettings.temperature).toBe(0.25);
    expect(retrySettings.thinking).toEqual({ enabled: false, effort: "low" });
  });

  it("classifies transient provider failures as retryable but leaves validation errors alone", () => {
    const deps = {
      isProviderEmptyResponseError: (error: unknown) => error instanceof Error && error.message === "empty response",
    } as ProviderStreamingDeps;

    expect(isRetryableProviderMessageError(deps, new Error("empty response"))).toBe(true);
    expect(isRetryableProviderMessageError(deps, new Error("HTTP 429: rate limit"))).toBe(true);
    expect(isRetryableProviderMessageError(deps, new Error("maximum context length exceeded"))).toBe(true);
    expect(isRetryableProviderMessageError(deps, new Error("HTTP 401: invalid API key"))).toBe(false);
  });
});
