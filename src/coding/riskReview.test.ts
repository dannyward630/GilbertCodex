import { describe, expect, it } from "vitest";
import type { ChatToolCall } from "../types/chat";
import { createRiskReviewSummary } from "./riskReview";

describe("risk review summary", () => {
  it("summarizes changed files, sensitive areas, verification, and handoff text", () => {
    const toolCalls: ChatToolCall[] = [
      {
        fileChanges: [
          { additions: 18, deletions: 2, kind: "update", path: "src-tauri/src/commands/terminal.rs" },
          { additions: 9, deletions: 1, kind: "update", path: "src/toolBridge/tools/terminal.ts" },
        ],
        id: "edit-1",
        label: "Edit files",
        status: "complete",
        toolId: "editing_apply_patch",
      },
      {
        id: "test-1",
        label: "Run rust check",
        status: "complete",
        terminal: { command: "npm run rust:check", exitCode: 0 },
        toolId: "terminal_run",
      },
    ];

    const review = createRiskReviewSummary(toolCalls, "Implemented bridge-first terminal evidence.");

    expect(review.riskLevel).toBe("high");
    expect(review.sensitiveAreas).toEqual(expect.arrayContaining(["terminal", "provider calls", "Tauri capabilities"]));
    expect(review.changedFiles.map((file) => file.path)).toEqual([
      "src-tauri/src/commands/terminal.rs",
      "src/toolBridge/tools/terminal.ts",
    ]);
    expect(review.testsRun).toContain("npm run rust:check (exit 0)");
    expect(review.suggestedPrSummary).toContain("Risk areas:");
  });
});
