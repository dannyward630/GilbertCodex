import { describe, expect, it } from "vitest";
import { compactMessagesForContext, createMessageContextSurface, type ContextWindowUsage } from "./contextWindow";
import type { ChatMessage } from "../types/chat";

function message(content: string, index: number): ChatMessage {
  return {
    content,
    createdAt: `2026-05-15T00:00:0${index}.000Z`,
    id: `message-${index}`,
    role: index % 2 === 0 ? "assistant" : "user",
  };
}

function usage(inputTokens: number, totalTokens: number, contextWindowTokens = 1_000): ContextWindowUsage {
  return {
    availableTokens: Math.max(contextWindowTokens - totalTokens, 0),
    contextWindowTokens,
    draftTokens: 0,
    fitsContextWindow: totalTokens <= contextWindowTokens,
    inputTokens,
    maxOutputTokens: Math.max(totalTokens - inputTokens, 0),
    messageTokens: inputTokens,
    model: "test-model",
    overflowTokens: Math.max(totalTokens - contextWindowTokens, 0),
    requestOverheadTokens: 0,
    requestedTotalTokens: totalTokens,
    safetyMarginTokens: 0,
    source: "estimate",
    systemTokens: 0,
    tokenSource: "estimate",
    totalTokens,
  };
}

describe("provider context surface", () => {
  it("does not replay huge saved tool output into later provider requests", () => {
    const hugeOutput = "x".repeat(1_000_000);
    const surface = createMessageContextSurface({
      content: "",
      toolCalls: [
        {
          id: "tool-1",
          input: JSON.stringify({ path: "src/app/App.tsx" }),
          label: "Read workspace file",
          output: hugeOutput,
          status: "complete",
        },
      ],
    });

    expect(surface.length).toBeLessThan(180_000);
    expect(surface).toContain("Tool output replay excerpt ended for provider context recovery");
    expect(surface).not.toContain("Tool output truncated for provider context recovery");
    expect(surface).not.toContain("x".repeat(200_000));
  });

  it("does not feed active placeholder tool input or output back to later provider requests", () => {
    const surface = createMessageContextSurface({
      content: "",
      toolCalls: [
        {
          id: "tool-1",
          input: "{}",
          label: "Read workspace file",
          output: "Preparing tool call.",
          status: "active",
        },
      ],
    });

    expect(surface).toContain("Read workspace file [active]");
    expect(surface).not.toContain("input:");
    expect(surface).not.toContain("output:");
    expect(surface).not.toContain("Preparing tool call");
  });

  it("does not replay the internal context compaction progress row", () => {
    const surface = createMessageContextSurface({
      content: "Done.",
      progress: [
        {
          detail: "1 older message compacted. Active request is now 48.8k / 131k.",
          id: "context-compaction",
          label: "Automatically compacting context",
          status: "complete",
        },
        {
          detail: "2 files read",
          id: "local-computer-tools",
          label: "Tool progress",
          status: "complete",
        },
      ],
    });

    expect(surface).toContain("Tool progress [complete] - 2 files read");
    expect(surface).not.toContain("Automatically compacting context");
  });

  it("scales persisted tool replay with the active model context window", () => {
    const hugeOutput = "x".repeat(300_000);
    const smallSurface = createMessageContextSurface(
      {
        content: "",
        toolCalls: [{
          id: "tool-1",
          label: "Read workspace file",
          output: hugeOutput,
          status: "complete",
        }],
      },
      { contextWindowTokens: 16_000 },
    );
    const largeSurface = createMessageContextSurface(
      {
        content: "",
        toolCalls: [{
          id: "tool-1",
          label: "Read workspace file",
          output: hugeOutput,
          status: "complete",
        }],
      },
      { contextWindowTokens: 1_000_000 },
    );

    expect(smallSurface).toContain("Tool output replay excerpt ended for provider context recovery");
    expect(largeSurface).not.toContain("Tool output replay excerpt ended for provider context recovery");
    expect(largeSurface.length).toBeGreaterThan(smallSurface.length * 3);
  });
});

describe("context compaction threshold", () => {
  it("does not compact just because the reserved output budget crosses the threshold", () => {
    const messages = Array.from({ length: 5 }, (_, index) => message("x".repeat(500), index));
    const result = compactMessagesForContext({
      contextWindowTokens: 1_000,
      maxOutputTokens: 300,
      messages,
      model: "test-model",
      source: "estimate",
      systemPrompt: "",
    });

    expect(result.beforeUsage.inputTokens).toBeLessThanOrEqual(result.thresholdTokens);
    expect(result.beforeUsage.totalTokens).toBeGreaterThan(result.thresholdTokens);
    expect(result.compacted).toBe(false);
  });

  it("compacts when the full provider request would exceed the window", () => {
    const messages = Array.from({ length: 5 }, (_, index) => message(`turn ${index}`, index));
    const result = compactMessagesForContext({
      contextWindowTokens: 1_000,
      maxOutputTokens: 500,
      messages,
      model: "test-model",
      source: "estimate",
      systemPrompt: "",
      usageEstimator: (candidateMessages) => {
        const inputTokens = candidateMessages.reduce((total, candidate) => total + (candidate.content.startsWith("AUTO COMPACTED CONTEXT") ? 100 : 120), 0);

        return usage(inputTokens, inputTokens + 500);
      },
    });

    expect(result.beforeUsage.inputTokens).toBeLessThanOrEqual(result.thresholdTokens);
    expect(result.beforeUsage.overflowTokens).toBeGreaterThan(0);
    expect(result.compacted).toBe(true);
    expect(result.afterUsage.fitsContextWindow).toBe(true);
    expect(result.afterUsage.overflowTokens).toBe(0);
  });

  it("can fold older protected tool-result messages when they would overflow the request", () => {
    const messages = [
      ...Array.from({ length: 6 }, (_, index) => ({
        ...message(`LOCAL COMPUTER TOOL RESULTS\nresult ${index}`, index),
        role: "user" as const,
      })),
      {
        ...message("continue the response", 9),
        role: "user" as const,
      },
    ];
    const result = compactMessagesForContext({
      contextWindowTokens: 1_000,
      maxOutputTokens: 200,
      messages,
      model: "test-model",
      source: "estimate",
      systemPrompt: "",
      usageEstimator: (candidateMessages) => {
        const inputTokens = candidateMessages.reduce((total, candidate) => {
          if (candidate.content.startsWith("AUTO COMPACTED CONTEXT")) return total + 100;
          if (candidate.content.startsWith("LOCAL COMPUTER TOOL RESULTS")) return total + 250;
          return total + 50;
        }, 0);

        return usage(inputTokens, inputTokens + 200);
      },
    });

    expect(result.compacted).toBe(true);
    expect(result.afterUsage.fitsContextWindow).toBe(true);
    expect(result.messages[0]?.content).toContain("AUTO COMPACTED CONTEXT");
    expect(result.messages[result.messages.length - 1]?.content).toBe("continue the response");
    expect(result.messages.filter((candidate) => candidate.content.startsWith("LOCAL COMPUTER TOOL RESULTS")).length).toBeLessThan(6);
  });

  it("compacts when the prompt payload itself crosses the threshold", () => {
    const messages = Array.from({ length: 12 }, (_, index) => message("x".repeat(900), index));
    const result = compactMessagesForContext({
      contextWindowTokens: 1_000,
      maxOutputTokens: 1,
      messages,
      model: "test-model",
      source: "estimate",
      systemPrompt: "",
    });

    expect(result.beforeUsage.inputTokens).toBeGreaterThan(result.thresholdTokens);
    expect(result.compacted).toBe(true);
  });

  it("creates a structured hybrid checkpoint instead of a raw clipped transcript", () => {
    const result = compactMessagesForContext({
      contextWindowTokens: 4_000,
      maxOutputTokens: 1,
      messages: [
        message("We need to preserve user preferences and never lose the file decision.", 1),
        {
          ...message("I read src/app/App.tsx and found the context path.", 2),
          role: "assistant",
          toolCalls: [{
            fileChanges: [{ additions: 3, deletions: 1, path: "src/app/App.tsx" }],
            id: "tool-1",
            input: JSON.stringify({ path: "src/app/App.tsx" }),
            label: "Read workspace file",
            output: "context code",
            status: "complete",
          }],
        },
        message("Now keep the latest request raw.", 3),
        ...Array.from({ length: 8 }, (_, index) => message("x".repeat(4_000), index + 4)),
      ],
      model: "test-model",
      source: "estimate",
      systemPrompt: "",
    });

    expect(result.compacted).toBe(true);
    expect(result.messages[0]?.content).toContain("Strategy: hybrid-checkpoint-v1");
    expect(result.messages[0]?.content).toContain("REQUIREMENTS, PREFERENCES, AND DECISIONS");
    expect(result.messages[0]?.content).toContain("FILES, EDITS, AND LOCAL STATE");
    expect(result.messages[0]?.content).toContain("src/app/App.tsx");
  });
});
