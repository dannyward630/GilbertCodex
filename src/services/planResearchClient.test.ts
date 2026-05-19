import { describe, expect, it } from "vitest";
import type { ChatToolCall } from "../types/chat";
import {
  createPlanResearchFollowupInstruction,
  createPlanResearchInstruction,
  formatResearchPayload,
  isResearchDeepEnough,
  PLAN_RESEARCH_BUDGET,
  summarizeResearchEvidence,
} from "./planResearchClient";

function makeToolCall(partial: Partial<ChatToolCall> & { id: string; label: string }): ChatToolCall {
  return {
    label: partial.label,
    id: partial.id,
    status: partial.status ?? "complete",
    toolId: partial.toolId,
    input: partial.input,
    output: partial.output,
    detail: partial.detail,
    fileChanges: partial.fileChanges,
  };
}

describe("createPlanResearchInstruction", () => {
  it("includes the user request and demands tool calls", () => {
    const message = createPlanResearchInstruction("rewire the auth middleware");
    expect(message.role).toBe("user");
    expect(message.content).toContain("rewire the auth middleware");
    expect(message.content).toContain("RESEARCH PHASE FOR PLAN MODE");
    expect(message.content).toContain("aggressively");
    expect(message.content).toMatch(/at least \d+ real tool calls/);
    expect(message.content).toContain("Do NOT write the plan");
  });

  it("directs plan research toward codebase tools instead of memory search", () => {
    const message = createPlanResearchInstruction("redesign the plan UI");

    expect(message.content).toContain("file-search");
    expect(message.content).toContain("file-read");
    expect(message.content).toContain("Do not use memory_search as a substitute");
    expect(message.content).not.toContain("query it for prior project decisions");
  });

  it("cites the configured minimum counts", () => {
    const message = createPlanResearchInstruction("anything");
    expect(message.content).toContain(`at least ${PLAN_RESEARCH_BUDGET.minToolCalls} real tool calls`);
    expect(message.content).toContain(`read at least ${PLAN_RESEARCH_BUDGET.minFilesRead} distinct files`);
  });

  it("names workspace roots when provided so the agent knows what to grep", () => {
    const message = createPlanResearchInstruction("any", { workspaceRoots: ["C:\\repos\\foo", "/srv/bar"] });
    expect(message.content).toContain("ACTIVE WORKSPACE ROOTS");
    expect(message.content).toContain("- C:\\repos\\foo");
    expect(message.content).toContain("- /srv/bar");
  });

  it("falls back to a no-workspace note when no roots are provided", () => {
    const message = createPlanResearchInstruction("any", { workspaceRoots: [] });
    expect(message.content).toContain("No local workspace is attached");
    expect(message.content).not.toContain("ACTIVE WORKSPACE ROOTS");
  });

  it("ignores empty / whitespace-only roots", () => {
    const message = createPlanResearchInstruction("any", { workspaceRoots: ["", "   "] });
    expect(message.content).toContain("No local workspace is attached");
  });
});

describe("createPlanResearchFollowupInstruction", () => {
  it("names the gap in tool calls explicitly", () => {
    const followup = createPlanResearchFollowupInstruction({
      toolCallCount: 1,
      filesRead: ["a.ts"],
      searchQueries: [],
      webQueries: [],
    });
    expect(followup.content).toContain("RESEARCH IS TOO SHALLOW");
    expect(followup.content).toMatch(/only made 1 tool call/);
  });

  it("names the gap in files read explicitly", () => {
    const followup = createPlanResearchFollowupInstruction({
      toolCallCount: 8,
      filesRead: ["a.ts"],
      searchQueries: ["foo"],
      webQueries: [],
    });
    expect(followup.content).toMatch(/only read 1 file in full/);
  });

  it("falls back to a generic nudge when nothing specific is missing", () => {
    const followup = createPlanResearchFollowupInstruction({
      toolCallCount: 10,
      filesRead: ["a.ts", "b.ts", "c.ts"],
      searchQueries: [],
      webQueries: [],
    });
    // Even at the threshold, the helper still wants more depth — it always emits *something*.
    expect(followup.content.length).toBeGreaterThan(0);
    expect(followup.content).toContain("RESEARCH IS TOO SHALLOW");
  });
});

describe("summarizeResearchEvidence", () => {
  it("counts read tools and dedupes paths", () => {
    const evidence = summarizeResearchEvidence([
      makeToolCall({ id: "1", label: "Read file", toolId: "files_read", input: JSON.stringify({ path: "src/foo.ts" }) }),
      makeToolCall({ id: "2", label: "Read file", toolId: "files_read", input: JSON.stringify({ path: "src/foo.ts" }) }),
      makeToolCall({ id: "3", label: "Read file", toolId: "files_read_range", input: JSON.stringify({ filePath: "src/bar.ts" }) }),
    ]);
    expect(evidence.toolCallCount).toBe(3);
    expect(evidence.filesRead).toEqual(["src/foo.ts", "src/bar.ts"]);
  });

  it("counts search tools and extracts queries", () => {
    const evidence = summarizeResearchEvidence([
      makeToolCall({ id: "1", label: "Grep workspace", toolId: "files_search", input: JSON.stringify({ query: "useAuth" }) }),
      makeToolCall({ id: "2", label: "List directory", toolId: "files_list", input: JSON.stringify({ path: "src/" }) }),
    ]);
    expect(evidence.toolCallCount).toBe(2);
    expect(evidence.searchQueries).toContain("useAuth");
  });

  it("ignores incomplete or error tool calls", () => {
    const evidence = summarizeResearchEvidence([
      makeToolCall({ id: "1", label: "Read", toolId: "files_read", status: "active" }),
      makeToolCall({ id: "2", label: "Read", toolId: "files_read", status: "error" }),
      makeToolCall({ id: "3", label: "Read", toolId: "files_read", input: JSON.stringify({ path: "src/ok.ts" }) }),
    ]);
    expect(evidence.toolCallCount).toBe(1);
    expect(evidence.filesRead).toEqual(["src/ok.ts"]);
  });

  it("handles undefined and empty inputs gracefully", () => {
    expect(summarizeResearchEvidence(undefined)).toEqual({
      toolCallCount: 0,
      filesRead: [],
      searchQueries: [],
      webQueries: [],
    });
    expect(summarizeResearchEvidence([])).toEqual({
      toolCallCount: 0,
      filesRead: [],
      searchQueries: [],
      webQueries: [],
    });
  });

  it("does not count memory search as codebase research depth", () => {
    const evidence = summarizeResearchEvidence([
      makeToolCall({ id: "1", label: "Search memory", toolId: "memory_search", input: JSON.stringify({ query: "prior auth middleware decisions" }) }),
    ]);
    expect(evidence.toolCallCount).toBe(0);
    expect(evidence.filesRead).toEqual([]);
  });

  it("falls back to label backticks when input is unparsable", () => {
    const evidence = summarizeResearchEvidence([
      makeToolCall({ id: "1", label: "Read `src/legacy.ts`", toolId: "files_read", input: "not json" }),
    ]);
    expect(evidence.filesRead).toEqual(["src/legacy.ts"]);
  });
});

describe("isResearchDeepEnough", () => {
  it("requires both the tool-call and file-read floors", () => {
    expect(isResearchDeepEnough({ toolCallCount: 0, filesRead: [], searchQueries: [], webQueries: [] })).toBe(false);
    expect(
      isResearchDeepEnough({
        toolCallCount: PLAN_RESEARCH_BUDGET.minToolCalls,
        filesRead: [],
        searchQueries: [],
        webQueries: [],
      }),
    ).toBe(false);
    expect(
      isResearchDeepEnough({
        toolCallCount: 0,
        filesRead: Array(PLAN_RESEARCH_BUDGET.minFilesRead).fill("x"),
        searchQueries: [],
        webQueries: [],
      }),
    ).toBe(false);
    expect(
      isResearchDeepEnough({
        toolCallCount: PLAN_RESEARCH_BUDGET.minToolCalls,
        filesRead: Array(PLAN_RESEARCH_BUDGET.minFilesRead).fill("x"),
        searchQueries: [],
        webQueries: [],
      }),
    ).toBe(true);
  });
});

describe("formatResearchPayload", () => {
  it("renders structured headers and the model digest", () => {
    const payload = formatResearchPayload(
      "## Research observations\n- finding A\n- finding B",
      {
        toolCallCount: 5,
        filesRead: ["src/a.ts", "src/b.ts"],
        searchQueries: ["useAuth"],
        webQueries: [],
      },
    );
    expect(payload).toContain("# Research evidence");
    expect(payload).toContain("Tool calls made: 5");
    expect(payload).toContain("Files read: 2");
    expect(payload).toContain("- src/a.ts");
    expect(payload).toContain("- useAuth");
    expect(payload).toContain("# Model digest");
    expect(payload).toContain("finding A");
  });

  it("omits empty sections cleanly", () => {
    const payload = formatResearchPayload("", {
      toolCallCount: 0,
      filesRead: [],
      searchQueries: [],
      webQueries: [],
    });
    expect(payload).toContain("Tool calls made: 0");
    expect(payload).not.toContain("Files inspected:");
    expect(payload).not.toContain("Searches performed:");
    expect(payload).not.toContain("# Model digest");
  });
});
