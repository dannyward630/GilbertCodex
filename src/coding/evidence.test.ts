import { describe, expect, it } from "vitest";
import type { AgentRun } from "../types/agentRun";
import type { ChatToolCall } from "../types/chat";
import { createInitialCodingEvidence, finalizeCodingEvidenceForMessage, withCodingBridgeBatch, withCodingTelemetryEvent } from "./evidence";

function run(overrides: Partial<AgentRun> = {}): AgentRun {
  const createdAt = "2026-05-19T12:00:00.000Z";
  return {
    approvals: [],
    artifacts: [],
    chatId: "chat-1",
    createdAt,
    events: [],
    id: "run-1",
    mode: "chat",
    prompt: "implement evidence",
    sources: [],
    status: "running",
    steps: [],
    title: "Implement evidence",
    toolCalls: [],
    updatedAt: createdAt,
    ...overrides,
  };
}

describe("coding evidence", () => {
  it("captures bridge batches, terminal results, final review, and verification", () => {
    const toolCalls: ChatToolCall[] = [
      {
        fileChanges: [{ additions: 4, deletions: 1, kind: "update", path: "src/toolBridge/index.ts" }],
        id: "edit-1",
        label: "Edited tool bridge",
        status: "complete",
        toolId: "editing_apply_patch",
      },
      {
        id: "term-1",
        label: "Run typecheck",
        status: "complete",
        terminal: { command: "npm run typecheck", exitCode: 0 },
        toolId: "terminal_run",
      },
    ];

    const baseRun = run({
      coding: createInitialCodingEvidence({
        chatId: "chat-1",
        prompt: "implement evidence",
        workspaceRoots: ["C:/repo"],
      }),
      toolCalls,
    });

    const batched = withCodingBridgeBatch(baseRun, toolCalls, "2026-05-19T12:01:00.000Z");
    const finalized = finalizeCodingEvidenceForMessage(batched, {
      completedAt: "2026-05-19T12:02:00.000Z",
      content: "Implemented durable coding evidence.",
      toolCalls,
    });

    expect(finalized.coding?.events.map((event) => event.kind)).toEqual(expect.arrayContaining(["file-change", "terminal"]));
    expect(finalized.coding?.review?.changedFiles[0]).toMatchObject({ path: "src/toolBridge/index.ts" });
    expect(finalized.coding?.verification?.items.find((item) => item.command === "npm run typecheck")).toMatchObject({ status: "passed" });
    expect(finalized.coding?.finalSummary).toContain("Implemented durable coding evidence.");
  });

  it("redacts secret-looking telemetry details before storing event data", () => {
    const next = withCodingTelemetryEvent(run(), {
      callId: "call-1",
      durationMs: 12,
      error: "authorization: sk-testsecret123456789",
      ok: false,
      toolId: "web_search",
      type: "tool-invoked",
    });

    const serialized = JSON.stringify(next.coding?.events[0]);
    expect(serialized).not.toContain("sk-testsecret123456789");
    expect(serialized).toContain("[redacted]");
  });
});
