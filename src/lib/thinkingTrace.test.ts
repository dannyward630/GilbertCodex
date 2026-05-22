import { describe, expect, it } from "vitest";
import { createVisibleToolApprovalThinking, createVisibleToolPlanThinking, createVisibleToolResultThinking } from "./thinkingTrace";
import type { ChatToolCall } from "../types/chat";

describe("thinking trace summaries", () => {
  it("creates a visible next-step note before structured tool calls", () => {
    const toolCall: ChatToolCall = {
      id: "tool-1",
      input: JSON.stringify({ path: "C:/repo/src/components/chat/ChatThread.tsx" }),
      label: "Read workspace file",
      status: "active",
      toolId: "files_read",
    };

    const note = createVisibleToolPlanThinking([toolCall]);

    expect(note).toContain("Reading workspace evidence");
    expect(note).toContain("`src/components/chat/ChatThread.tsx`");
    expect(note).not.toContain("**Next:**");
    expect(note).not.toContain("I’m using that");
  });

  it("summarizes completed file changes without turning paths into the headline", () => {
    const toolCall: ChatToolCall = {
      batchFileResults: [
        { additions: 12, deletions: 4, kind: "update", path: "C:/repo/src/components/chat/AssistantActivityIndicator.tsx", status: "ok" },
        { additions: 6, deletions: 1, kind: "update", path: "C:/repo/src/styles/chat.css", status: "ok" },
      ],
      id: "tool-2",
      label: "Edit many workspace files",
      status: "complete",
      toolId: "files_edit_many",
    };

    const note = createVisibleToolResultThinking([toolCall]);

    expect(note).toContain("Applied file changes to 2 files");
    expect(note).toContain("+18 -5");
    expect(note).not.toContain("`src/components/chat/AssistantActivityIndicator.tsx`");
    expect(note).not.toContain("and 1 more");
    expect(note).not.toContain("**Found:**");
    expect(note).not.toContain("**Next:**");
  });

  it("summarizes mixed coding runs as tool activity before file changes", () => {
    const toolCalls: ChatToolCall[] = [
      {
        id: "search",
        input: JSON.stringify({ query: "AssistantActivityIndicator" }),
        label: "Search workspace files",
        status: "complete",
        toolId: "files_search",
      },
      {
        id: "read",
        input: JSON.stringify({ path: "src/components/chat/AssistantActivityIndicator.tsx" }),
        label: "Read workspace file",
        status: "complete",
        toolId: "files_read",
      },
      {
        batchFileResults: [
          { additions: 8, deletions: 2, kind: "update", path: "C:/repo/src/components/chat/AssistantActivityIndicator.tsx", status: "ok" },
          { additions: 4, deletions: 1, kind: "update", path: "C:/repo/src/lib/thinkingTrace.ts", status: "ok" },
          { additions: 2, deletions: 0, kind: "update", path: "C:/repo/src/styles/chat.css", status: "ok" },
          { additions: 3, deletions: 1, kind: "update", path: "C:/repo/src/components/chat/AssistantActivityIndicator.test.ts", status: "ok" },
        ],
        id: "edit",
        label: "Edit many workspace files",
        status: "complete",
        toolId: "files_edit_many",
      },
      {
        id: "test",
        label: "Run terminal command",
        status: "complete",
        terminal: { command: "npm test", exitCode: 0, shell: "powershell" },
        toolId: "terminal_run",
      },
    ];

    const note = createVisibleToolResultThinking(toolCalls);

    expect(note).toBe("Used 4 tools: searched workspace, read workspace evidence, edited 4 files, and ran 1 command (+17 -4).");
    expect(note).not.toContain("4 files changed in");
    expect(note).not.toContain("and 2 more");
  });

  it("keeps connected-app summaries clean and avoids raw OAuth scope noise", () => {
    const toolCall: ChatToolCall = {
      id: "gmail-account",
      label: "Check Gmail account",
      output: "Gmail connected accounts: 1/6. Active account: primary@example.com | Scopes: https://www.googleapis.com/auth/gmail.compose",
      status: "complete",
      toolId: "gmail_check_account",
    };

    const note = createVisibleToolResultThinking([toolCall]);

    expect(note).toBe("Gmail account checked. Active account: primary@example.com.");
    expect(note).not.toContain("Scopes");
    expect(note).not.toContain("https://www.googleapis.com");
  });

  it("does not describe workspace root targets as a dot", () => {
    const toolCall: ChatToolCall = {
      id: "tree",
      input: JSON.stringify({ path: "." }),
      label: "Summarize workspace tree",
      status: "active",
      toolId: "files_tree_summary",
    };

    const note = createVisibleToolPlanThinking([toolCall]);

    expect(note).toBe("Reading workspace evidence.");
    expect(note).not.toContain("`.");
  });

  it("uses calm copy for approval gates and denied actions", () => {
    const waiting: ChatToolCall = {
      id: "gmail-draft-waiting",
      label: "Create Gmail draft",
      status: "waiting_approval",
      toolId: "gmail_create_draft",
    };
    const denied: ChatToolCall = {
      detail: "Approval denied.",
      id: "gmail-draft-denied",
      label: "Create Gmail draft",
      output: "Approval denied. No tool action ran.",
      status: "skipped",
      toolId: "gmail_create_draft",
    };

    expect(createVisibleToolApprovalThinking([waiting])).toBe("This action needs review before it runs.");
    expect(createVisibleToolResultThinking([denied])).toBe("Action canceled before running.");
  });
});
