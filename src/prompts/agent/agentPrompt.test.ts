import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultProviderSettings } from "../../lib/appStorage";
import type { ChatMessage } from "../../types/chat";
import type { ToolDefinition } from "../../toolBridge/types";
import { buildAgentSystemPrompt, buildAgentSystemPromptWithMetadata } from "./agentPrompt";

function userMessage(content = "Help me write a response."): ChatMessage {
  return {
    content,
    createdAt: new Date(0).toISOString(),
    id: "message-1",
    role: "user",
  };
}

function tool(id: string, family: NonNullable<ToolDefinition["executorMetadata"]>["family"]): ToolDefinition {
  return {
    description: `${id} test tool`,
    execute: () => ({ content: "ok", ok: true }),
    executorMetadata: { family, version: 1 },
    id,
    inputSchema: { type: "object" },
    permission: family === "terminal" ? "terminal" : "read-only",
    risk: family === "terminal" ? "terminal" : family === "web" ? "network" : "read",
    title: id,
  };
}

describe("buildAgentSystemPrompt", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("grounds the assistant response language in the user's device language", () => {
    vi.stubGlobal("navigator", {
      language: "es-MX",
      languages: ["es-MX", "es", "en-US"],
    });

    const prompt = buildAgentSystemPrompt({
      messages: [userMessage()],
      settings: defaultProviderSettings,
    });

    expect(prompt).toContain("Primary user/device language: es-MX.");
    expect(prompt).toContain("User/device language preferences: es-MX, es, en-US.");
    expect(prompt).toContain("Default assistant language: reply in the primary device language/locale (es-MX)");
  });

  it("keeps meta/tool-audit prompts lean and avoids language chunk drift", () => {
    const prompt = buildAgentSystemPromptWithMetadata({
      messages: [userMessage("our system prompt for tools and everything else how unoptimized it is and what tokens it uses")],
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [tool("memory_search", "memory")],
      },
    });
    const chunkIds = prompt.selectedChunks.map((entry) => entry.chunk.id);

    expect(prompt.tokenEstimate).toBeLessThan(2000);
    expect(chunkIds).toContain("core.gilbert-codex");
    expect(chunkIds).not.toContain("skill.language-node");
    expect(chunkIds).not.toContain("skill.language-python");
  });

  it("keeps normal code-work prompts below the runtime budget with exact attached tools", () => {
    const prompt = buildAgentSystemPromptWithMetadata({
      messages: [userMessage("fix the app, read the relevant files, edit code, run tests and build")],
      settings: defaultProviderSettings,
      toolBridge: {
        runtimeBudget: {
          maxExecutions: 48,
          maxPasses: 12,
          maxToolResultContentChars: 24000,
          remainingExecutions: 48,
          remainingPasses: 12,
        },
        tools: [
          tool("memory_search", "memory"),
          tool("files_read", "files"),
          tool("files_read_many", "files"),
          tool("files_search", "files"),
          tool("files_edit_many", "editing"),
          tool("files_apply_patch", "editing"),
          tool("files_write_many", "editing"),
          tool("terminal_run", "terminal"),
        ],
      },
    });

    expect(prompt.tokenEstimate).toBeLessThan(4000);
    expect(prompt.prompt).toContain("Available provider tools for this request");
    expect(prompt.prompt).toContain("files_read_many");
    expect(prompt.prompt).toContain("budget: passes 12/12; executions 48/48");
  });

  it("places stable core instructions before per-request runtime context for provider prompt caches", () => {
    const prompt = buildAgentSystemPromptWithMetadata({
      messages: [userMessage("run the tests")],
      settings: defaultProviderSettings,
      toolBridge: {
        tools: [tool("terminal_run", "terminal")],
      },
    });

    expect(prompt.cacheablePrompt).toContain("# Gilbert Codex Core");
    expect(prompt.dynamicPrompt).toContain("# Current Runtime Context");
    expect(prompt.prompt.indexOf("# Gilbert Codex Core")).toBeGreaterThanOrEqual(0);
    expect(prompt.prompt.indexOf("# Gilbert Codex Core")).toBeLessThan(prompt.prompt.indexOf("# Current Runtime Context"));
    expect(prompt.prompt.startsWith("# Current Runtime Context")).toBe(false);
  });
});
