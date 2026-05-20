import { describe, expect, it } from "vitest";
import type { ChatToolCall } from "../types/chat";
import { createVerificationPlan, recommendChecks } from "./verificationPlanner";

describe("verification planner", () => {
  it("recommends bridge, typecheck, Rust, and browser checks for mixed coding changes", () => {
    const checks = recommendChecks([
      "src/toolBridge/tools/terminal.ts",
      "src-tauri/src/commands/terminal.rs",
      "src/components/coding/CodingSidecarPanel.tsx",
    ]);

    expect(checks.map((check) => check.id)).toEqual(
      expect.arrayContaining(["tool-bridge-tests", "typecheck", "frontend-build", "rust-fmt", "rust-check", "browser-preview"]),
    );
  });

  it("marks captured terminal checks as passed or failed", () => {
    const toolCalls: ChatToolCall[] = [
      {
        id: "tc-1",
        label: "Run typecheck",
        status: "complete",
        terminal: { command: "npm run typecheck", exitCode: 0 },
        toolId: "terminal_run",
      },
      {
        id: "tc-2",
        label: "Run build",
        status: "error",
        terminal: { command: "npm run build", exitCode: 1 },
        toolId: "terminal_run",
      },
    ];

    const plan = createVerificationPlan({
      changedPaths: ["src/app/workspace/tools/localToolStreaming.tsx"],
      toolCalls,
    });

    expect(plan.items.find((item) => item.command === "npm run typecheck")).toMatchObject({ status: "passed", toolCallId: "tc-1" });
    expect(plan.items.find((item) => item.command === "npm run build")).toMatchObject({ status: "failed", toolCallId: "tc-2" });
  });
});
