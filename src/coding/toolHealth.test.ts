import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../toolBridge/types";
import { createToolHealthSnapshot } from "./toolHealth";

function tool(id: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  const risk = overrides.risk ?? "read";
  return {
    description: `${id} test tool`,
    execute: () => ({ content: "ok", ok: true }),
    executorMetadata: { family: "files", version: 1 },
    id,
    inputSchema: { type: "object" },
    permission: risk === "terminal" ? "terminal" : risk === "mutating" ? "mutating" : "read-only",
    risk,
    title: id,
    ...overrides,
  };
}

describe("tool health snapshot", () => {
  it("explains provider incompatibility, approval gating, hidden settings, and budget exhaustion", () => {
    const readTool = tool("files_read");
    const disabledTool = tool("memory_search");
    const terminalTool = tool("terminal_run", { executorMetadata: { family: "terminal", version: 1 }, permission: "terminal", risk: "terminal" });
    const incompatibleTool = tool("media_generate_image", { compatibleProviders: ["openai-responses"], executorMetadata: { family: "media", version: 1 }, risk: "network" });

    const snapshot = createToolHealthSnapshot({
      availableTools: [readTool],
      model: "test-model",
      passIndex: 0,
      permissionMode: "default",
      prompt: "inspect tools",
      provider: "openrouter",
      registryTools: [readTool, disabledTool, terminalTool, incompatibleTool],
      selectedTools: [readTool],
      workspaceRoots: ["C:/repo"],
    });

    expect(snapshot.selectedTools.map((item) => item.id)).toEqual(["files_read"]);
    expect(snapshot.hiddenTools.find((item) => item.id === "media_generate_image")?.reason).toContain("Provider request format");
    expect(snapshot.hiddenTools.find((item) => item.id === "terminal_run")?.reason).toMatch(/require.*approval/i);
    expect(snapshot.hiddenTools.find((item) => item.id === "memory_search")?.reason).toContain("setting or request context");

    const budgetSnapshot = createToolHealthSnapshot({
      availableTools: [readTool],
      budgetReached: true,
      model: "test-model",
      passIndex: 1,
      permissionMode: "default",
      prompt: "inspect tools",
      provider: "openrouter",
      registryTools: [readTool, disabledTool],
      selectedTools: [readTool],
      workspaceRoots: ["C:/repo"],
    });

    expect(budgetSnapshot.hiddenTools.find((item) => item.id === "memory_search")?.reason).toContain("budget");
  });

  it("stores the capability plan summary for provider-visible diagnostics", () => {
    const readTool = tool("files_read");
    const snapshot = createToolHealthSnapshot({
      availableTools: [readTool],
      model: "test-model",
      passIndex: 0,
      permissionMode: "default",
      prompt: "inspect tools",
      provider: "openrouter",
      registryTools: [readTool],
      selectedTools: [readTool],
      toolCapabilityPlan: {
        blockedReasons: [{
          code: "required_family_unavailable",
          detail: "None of the required tool families are provider-visible for this pass: files.",
        }],
        canCallProvider: false,
        intent: ["workspace_evidence"],
        mustUseTools: true,
        prompt: "inspect tools",
        providerFormat: "openai-compatible",
        providerVisibleToolIds: [],
        requiredFamilies: ["files"],
        selectedToolIds: ["files_read"],
        selectedTools: [readTool],
        toolChoice: "none",
      },
      toolChoice: "none",
      workspaceRoots: ["C:/repo"],
    });

    expect(snapshot.capabilityPlan).toMatchObject({
      canCallProvider: false,
      mustUseTools: true,
      providerVisibleToolIds: [],
      requiredFamilies: ["files"],
    });
    expect(snapshot.capabilityPlan?.blockedReasons[0]).toContain("required_family_unavailable");
  });
});
