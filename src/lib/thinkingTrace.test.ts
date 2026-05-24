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

    expect(note).toContain("Reading workspace files");
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

    expect(note).toBe("Used 4 tools: searched workspace, read files, edited 4 files, and ran 1 command (+17 -4).");
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

  it("keeps terminal session diagnostics out of visible work summaries", () => {
    const diagnostics: ChatToolCall[] = [
      {
        id: "sessions",
        label: "List terminal sessions",
        output: "No app-owned background terminal sessions are currently registered.",
        status: "complete",
        toolId: "terminal_list_sessions",
      },
      {
        detail: "Could not read that terminal session.",
        id: "read-session",
        label: "Read terminal session",
        output: "Could not read that terminal session.",
        status: "error",
        toolId: "terminal_read_session",
      },
    ];

    expect(createVisibleToolPlanThinking(diagnostics)).toBe("");
    expect(createVisibleToolResultThinking(diagnostics)).toBe("");
  });

  it("summarizes read evidence with concrete files instead of stale file-context filler", () => {
    const toolCall: ChatToolCall = {
      id: "read-tool-bridge",
      input: JSON.stringify({
        paths: [
          "src/toolBridge/registry.ts",
          "src/toolBridge/selection.ts",
          "src/app/workspace/tools/localToolStreaming.tsx",
        ],
      }),
      label: "Read 3 files",
      status: "complete",
      toolId: "files_read",
    };

    const note = createVisibleToolResultThinking([toolCall]);

    expect(note).toBe("Read `src/toolBridge/registry.ts`, `src/toolBridge/selection.ts`, and `src/app/workspace/tools/localToolStreaming.tsx`; focus: tool bridge registration/selection and local tool streaming.");
    expect(note).not.toContain("I have the file context now");
    expect(note).not.toContain("so I can connect");
  });

  it("summarizes searches as evidence instead of generic narrowing copy", () => {
    const toolCall: ChatToolCall = {
      id: "search-thinking",
      input: JSON.stringify({
        path: "src/lib/thinkingTrace.ts",
        query: "I have the file context now",
      }),
      label: "Searched 1 file",
      status: "complete",
      toolId: "files_search",
    };

    const note = createVisibleToolResultThinking([toolCall]);

    expect(note).toBe("Searched `src/lib/thinkingTrace.ts` for `I have the file context now`; focus: visible trace generation/filtering.");
    expect(note).not.toContain("The search narrowed");
  });

  it("drops workspace-root noise and uses focus copy for terminal evidence", () => {
    const searched = createVisibleToolPlanThinking([
      {
        id: "search-root",
        input: JSON.stringify({ path: "Users/Kobe Work/Documents/GilbertCodex", query: "terminal tool" }),
        label: "Search workspace files",
        status: "active",
        toolId: "files_search",
      },
    ]);

    expect(searched).toBe("Searching the workspace for `terminal tool` (focus: terminal session lifecycle).");
    expect(searched).not.toContain("Users/Kobe");
    expect(searched).not.toContain("evidence is tied");

    const read = createVisibleToolResultThinking([
      {
        id: "read-terminal",
        input: JSON.stringify({
          paths: [
            "src/toolBridge/tools/terminal/terminalRun.ts",
            "src/toolBridge/tools/terminal/backend.ts",
            "src/toolBridge/tools/terminal/terminalDiagnostics.ts",
            "src/toolBridge/tools/terminal/sessionRegistry.ts",
          ],
        }),
        label: "Read 4 files",
        status: "complete",
        toolId: "files_read",
      },
    ]);

    expect(read).toBe("Read 4 files in `src/toolBridge/tools/terminal` (`terminalRun.ts`, `backend.ts`, `terminalDiagnostics.ts`, and 1 more); focus: terminal session lifecycle and tool bridge registration/selection.");
  });

  it("uses checked evidence copy for project and web context", () => {
    expect(createVisibleToolResultThinking([{
      id: "git-status",
      input: JSON.stringify({ path: "." }),
      label: "Check Git status",
      status: "complete",
      toolId: "git_status",
    }])).toBe("Checked project context.");

    expect(createVisibleToolResultThinking([{
      id: "web",
      input: JSON.stringify({ query: "OpenAI Codex app docs" }),
      label: "Search web",
      status: "complete",
      toolId: "web_search",
    }])).toBe("Checked current sources for `OpenAI Codex app docs`.");
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

    expect(note).toBe("Reading workspace files.");
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
