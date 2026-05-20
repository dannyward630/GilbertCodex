import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendUsageHistoryRecord, clearUsageHistory, defaultProviderSettings, loadChats, loadPersistentString, loadProjects, loadProviderSettings, loadUsageHistory, saveChats, savePersistentString, saveProjects, saveProviderSettings, setStorageNamespace } from "./appStorage";
import { createEmptyChat } from "./chatUtils";
import type { ChatSummary } from "../types/chat";

function installMemoryStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    get length() {
      return store.size;
    },
  };

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  });
}

describe("app storage", () => {
  beforeEach(() => {
    installMemoryStorage();
    setStorageNamespace(null);
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "window");
  });

  it("persists assistant tool calls with file edit details across a chat reload", () => {
    const chat: ChatSummary = {
      id: "chat-1",
      messages: [
        {
          content: "Done.",
          createdAt: "2026-05-14T12:00:00.000Z",
          id: "message-1",
          role: "assistant",
          toolCalls: [
            {
              fileChanges: [
                {
                  additions: 3,
                  deletions: 1,
                  diffPreview: [
                    { content: "@@ -1 +1,3 @@", kind: "hunk" },
                    { content: "-old", kind: "remove", oldLine: 1 },
                    { content: "+new", kind: "add", newLine: 1 },
                  ],
                  kind: "update",
                  path: "src/app/App.tsx",
                },
              ],
              id: "bridge-call-1",
              input: "{\"path\":\"src/app/App.tsx\"}",
              label: "Edit workspace file",
              output: "1 file changed, +3 -1.",
              resultPolicy: {
                mode: "safe_summary",
                resultKind: "edit",
                synthesizeAfterwards: true,
              },
              status: "complete",
              terminal: {
                command: "npm.cmd run typecheck",
                exitCode: 0,
                live: false,
                sessionId: "terminal-session-1",
                shell: "powershell",
                workingDirectory: "C:/repo",
              },
              toolId: "workspace.edit",
            },
          ],
        },
      ],
      project: "GilbertCodex",
      title: "Tool persistence",
      updatedAt: "2026-05-14T12:00:00.000Z",
    };

    saveChats([chat]);

    const loadedChat = loadChats()[0];
    const loadedToolCall = loadedChat?.messages[0]?.toolCalls?.[0];

    expect(loadedToolCall).toMatchObject({
      id: "bridge-call-1",
      input: "{\"path\":\"src/app/App.tsx\"}",
      label: "Edit workspace file",
      resultPolicy: {
        mode: "safe_summary",
        resultKind: "edit",
        synthesizeAfterwards: true,
      },
      status: "complete",
      terminal: {
        command: "npm.cmd run typecheck",
        exitCode: 0,
        sessionId: "terminal-session-1",
        shell: "powershell",
      },
      toolId: "workspace.edit",
    });
    expect(loadedToolCall?.fileChanges?.[0]).toMatchObject({
      additions: 3,
      deletions: 1,
      diffPreview: [
        { content: "@@ -1 +1,3 @@", kind: "hunk" },
        { content: "-old", kind: "remove", oldLine: 1 },
        { content: "+new", kind: "add", newLine: 1 },
      ],
      kind: "update",
      path: "src/app/App.tsx",
    });
  });

  it("persists assistant message feedback across a chat reload", () => {
    const chat: ChatSummary = {
      id: "chat-feedback",
      messages: [
        {
          content: "Done.",
          createdAt: "2026-05-20T15:00:00.000Z",
          feedback: "liked",
          id: "message-feedback",
          role: "assistant",
        },
      ],
      project: "GilbertCodex",
      title: "Feedback persistence",
      updatedAt: "2026-05-20T15:00:00.000Z",
    };

    saveChats([chat]);

    expect(loadChats()[0]?.messages[0]?.feedback).toBe("liked");
  });

  it("persists visible thinking work-trace notes across a chat reload", () => {
    const chat: ChatSummary = {
      id: "chat-thinking",
      messages: [
        {
          content: "Done.",
          createdAt: "2026-05-19T12:00:00.000Z",
          id: "message-thinking",
          role: "assistant",
          workTrace: [
            {
              content: "Reading workspace evidence for `README.md`.",
              id: "thinking-1",
              kind: "thinking",
              status: "active",
            },
            {
              id: "tool-1",
              kind: "tool",
              toolCall: {
                id: "bridge-call-1",
                input: "{\"path\":\"README.md\"}",
                label: "Read workspace file",
                status: "complete",
                toolId: "files_read",
              },
            },
          ],
        },
      ],
      project: "GilbertCodex",
      title: "Thinking persistence",
      updatedAt: "2026-05-19T12:00:00.000Z",
    };

    saveChats([chat]);

    const loadedTrace = loadChats()[0]?.messages[0]?.workTrace;

    expect(loadedTrace?.[0]).toMatchObject({
      content: "Reading workspace evidence for `README.md`.",
      id: "thinking-1",
      kind: "thinking",
      status: "complete",
    });
    expect(loadedTrace?.[1]).toMatchObject({
      kind: "tool",
      toolCall: {
        label: "Read workspace file",
        status: "complete",
      },
    });
  });

  it("persists per-chat model selection across a reload", () => {
    const chat: ChatSummary = {
      id: "chat-model-1",
      messages: [
        {
          content: "Use this chat model.",
          createdAt: "2026-05-18T12:00:00.000Z",
          id: "message-1",
          role: "user",
        },
      ],
      model: "anthropic/claude-sonnet-4.5",
      project: "GilbertCodex",
      provider: "openrouter",
      title: "Chat model",
      updatedAt: "2026-05-18T12:00:00.000Z",
    };

    saveChats([chat]);

    const loadedChat = loadChats()[0];

    expect(loadedChat?.model).toBe("anthropic/claude-sonnet-4.5");
    expect(loadedChat?.provider).toBe("openrouter");
  });

  it("persists context-bearing chat metadata across a reload", () => {
    const chat: ChatSummary = {
      id: "chat-1",
      messages: [
        {
          content: "I found the source.",
          contextCompactions: [
            {
              afterTokens: 40000,
              beforeTokens: 72000,
              compactedAt: "2026-05-14T12:04:00.000Z",
              compactedMessageCount: 12,
              contextWindowTokens: 100000,
              thresholdTokens: 80000,
            },
          ],
          createdAt: "2026-05-14T12:00:00.000Z",
          id: "message-1",
          mode: "plan",
          planning: {
            inputRequest: {
              answeredAt: "2026-05-14T12:02:00.000Z",
              answers: [{ questionId: "scope", value: "Backend only" }],
              id: "planning-input-1",
              questions: [{ id: "scope", question: "What scope?" }],
              requestedAt: "2026-05-14T12:01:00.000Z",
              title: "Confirm scope",
            },
            maxPasses: 3,
            passCount: 1,
            startedAt: "2026-05-14T12:00:00.000Z",
          },
          role: "assistant",
          sources: [
            {
              detail: "Provider documentation",
              sourceType: "web",
              title: "Provider docs",
              url: "https://example.com/docs",
            },
          ],
          thinking: {
            completedAt: "2026-05-14T12:03:00.000Z",
            effort: "high",
            startedAt: "2026-05-14T12:00:00.000Z",
          },
          webSearch: {
            enabled: true,
            provider: "duckduckgo",
            query: "provider context windows",
            resultCount: 1,
            resultProvider: "duckduckgo",
            searchedAt: "2026-05-14T12:01:00.000Z",
            status: "complete",
          },
        },
      ],
      project: "GilbertCodex",
      title: "Context metadata",
      updatedAt: "2026-05-14T12:00:00.000Z",
    };

    saveChats([chat]);

    const loadedMessage = loadChats()[0]?.messages[0];

    expect(loadedMessage).toMatchObject({
      contextCompactions: [
        {
          afterTokens: 40000,
          beforeTokens: 72000,
          compactedMessageCount: 12,
          contextWindowTokens: 100000,
          thresholdTokens: 80000,
        },
      ],
      mode: "plan",
      planning: {
        inputRequest: {
          answers: [{ questionId: "scope", value: "Backend only" }],
          questions: [{ id: "scope", question: "What scope?" }],
          title: "Confirm scope",
        },
        maxPasses: 3,
        passCount: 1,
      },
      sources: [
        {
          detail: "Provider documentation",
          sourceType: "web",
          title: "Provider docs",
          url: "https://example.com/docs",
        },
      ],
      thinking: {
        effort: "high",
      },
      webSearch: {
        enabled: true,
        provider: "duckduckgo",
        query: "provider context windows",
        resultCount: 1,
        status: "complete",
      },
    });
  });

  it("persists plan content and approval handoff data across a chat reload", () => {
    const planContent = [
      "## Goal",
      "Make plan mode feel like a normal response.",
      "",
      "## Files to change",
      "- `src/components/chat/PlanReviewCard.tsx`",
    ].join("\n");
    const chat: ChatSummary = {
      id: "chat-plan",
      messages: [
        {
          agentRunStatus: "completed",
          approvals: [
            {
              args: {
                plan: planContent,
                prompt: "redesign plan mode",
              },
              createdAt: "2026-05-16T12:00:00.000Z",
              id: "approval-plan-1",
              kind: "other",
              messageId: "message-plan",
              preview: planContent,
              risk: "medium",
              status: "approved",
              title: "Approve plan execution",
              tool: "planning_handoff",
            },
          ],
          content: "Implemented the approved plan.",
          createdAt: "2026-05-16T12:00:00.000Z",
          id: "message-plan",
          mode: "plan",
          planning: {
            completedAt: "2026-05-16T12:01:00.000Z",
            maxPasses: 1,
            passCount: 1,
            planContent,
            startedAt: "2026-05-16T12:00:00.000Z",
          },
          role: "assistant",
        },
      ],
      project: "GilbertCodex",
      title: "Plan persistence",
      updatedAt: "2026-05-16T12:01:00.000Z",
    };

    saveChats([chat]);

    const loadedMessage = loadChats()[0]?.messages[0];

    expect(loadedMessage).toMatchObject({
      approvals: [
        {
          args: {
            plan: planContent,
            prompt: "redesign plan mode",
          },
          preview: planContent,
          status: "approved",
          tool: "planning_handoff",
        },
      ],
      content: "Implemented the approved plan.",
      mode: "plan",
      planning: {
        planContent,
      },
    });
  });

  it("persists dynamic project tool memory keys through app storage", () => {
    const key = "gilbert-codex.project-tool-memory.v1.workspace-scope";
    const value = JSON.stringify({
      entries: [
        {
          failureSummary: "Read used the wrong relative path.",
          retryHint: "Resolve paths against the selected workspace root.",
          toolId: "files.read",
        },
      ],
      projectName: "GilbertCodex",
      version: 1,
    });

    savePersistentString(key, value);

    expect(loadPersistentString(key)).toBe(value);
  });

  it("persists project run config in app-local project storage", () => {
    saveProjects([
      {
        createdAt: "2026-05-19T12:00:00.000Z",
        id: "project-1",
        localWorkspace: {
          enabled: true,
          indexStatus: "idle",
          permissionMode: "default",
          roots: ["C:/workspace/app"],
          scope: "selected-folder",
        },
        name: "Run App",
        runConfig: {
          actions: [
            {
              background: true,
              command: "npm run dev",
              cwd: "C:/workspace/app",
              id: "detected:dev-server",
              kind: "dev-server",
              label: "Run dev server",
              previewUrl: "http://127.0.0.1:5173/",
              source: "user",
              updatedAt: "2026-05-19T12:00:00.000Z",
            },
          ],
          lastRun: {
            actionId: "detected:dev-server",
            ranAt: "2026-05-19T12:01:00.000Z",
            status: "running",
          },
          selectedActionId: "detected:dev-server",
          version: 1,
        },
        updatedAt: "2026-05-19T12:00:00.000Z",
      },
    ]);

    const loadedProject = loadProjects()[0];

    expect(loadedProject?.runConfig).toMatchObject({
      actions: [
        expect.objectContaining({
          command: "npm run dev",
          previewUrl: "http://localhost:5173/",
          source: "user",
        }),
      ],
      lastRun: {
        actionId: "detected:dev-server",
        ranAt: "2026-05-19T12:01:00.000Z",
        status: "running",
      },
      selectedActionId: "detected:dev-server",
    });
  });

  it("persists disabled provider models without disabling the selected model", () => {
    saveProviderSettings({
      ...defaultProviderSettings,
      disabledModels: {
        anthropic: ["claude-opus-4-6"],
        openrouter: ["inclusionai/ling-2.6-flash", "poolside/laguna-m.1:free"],
      },
      model: "poolside/laguna-m.1:free",
      provider: "openrouter",
      providerModels: {
        ...defaultProviderSettings.providerModels,
        openrouter: "poolside/laguna-m.1:free",
      },
    });

    const loadedSettings = loadProviderSettings();

    expect(loadedSettings.model).toBe("poolside/laguna-m.1:free");
    expect(loadedSettings.disabledModels.openrouter).toEqual(["inclusionai/ling-2.6-flash"]);
    expect(loadedSettings.disabledModels.anthropic).toEqual(["claude-opus-4-6"]);
  });

  it("persists subscription Token saver and fallback mode settings", () => {
    saveProviderSettings({
      ...defaultProviderSettings,
      subscriptionOptimization: {
        fallbackMode: "smart-saver",
        tokenSaverLevel: "max",
      },
    });

    const loadedSettings = loadProviderSettings();

    expect(loadedSettings.subscriptionOptimization).toEqual({
      fallbackMode: "smart-saver",
      tokenSaverLevel: "max",
    });
  });

  it("persists provider usage history in account-local app storage", () => {
    appendUsageHistoryRecord({
      completionTokens: 100,
      costSource: "catalog",
      createdAt: "2026-05-19T14:30:00.000Z",
      dateKey: "2026-05-19",
      dayKey: "2026-05-19",
      id: "usage-1",
      inputTokens: 900,
      model: "gpt-5.4-mini",
      monthKey: "2026-05",
      outputTokens: 100,
      provider: "openai",
      providerLabel: "OpenAI",
      reasoningTokens: 0,
      requestCount: 1,
      source: "provider",
      totalCostUsd: 0.001125,
      totalTokens: 1000,
      unitCost: {
        inputUsd: 0.000675,
        outputUsd: 0.00045,
        reasoningUsd: 0,
        requestUsd: 0,
        totalUsd: 0.001125,
      },
      weekKey: "2026-W21",
    });

    expect(loadUsageHistory().records[0]).toMatchObject({
      id: "usage-1",
      inputTokens: 900,
      model: "gpt-5.4-mini",
      provider: "openai",
      totalCostUsd: 0.001125,
      totalTokens: 1000,
    });
  });

  it("keeps usage history isolated by account namespace", () => {
    setStorageNamespace("usage-user-a");
    appendUsageHistoryRecord({
      completionTokens: 50,
      costSource: "free",
      createdAt: "2026-05-19T14:30:00.000Z",
      dateKey: "2026-05-19",
      dayKey: "2026-05-19",
      id: "usage-user-a-record",
      inputTokens: 450,
      model: "openrouter/free",
      monthKey: "2026-05",
      outputTokens: 50,
      provider: "openrouter",
      providerLabel: "OpenRouter",
      reasoningTokens: 0,
      requestCount: 1,
      source: "provider",
      totalCostUsd: 0,
      totalTokens: 500,
      weekKey: "2026-W21",
    });

    setStorageNamespace("usage-user-b");
    expect(loadUsageHistory().records).toEqual([]);

    setStorageNamespace("usage-user-a");
    expect(loadUsageHistory().records.map((record) => record.id)).toEqual(["usage-user-a-record"]);

    clearUsageHistory();
    expect(loadUsageHistory().records).toEqual([]);
  });

  it("keeps provider and subscription routing settings isolated by account namespace", () => {
    setStorageNamespace("user-a");
    saveProviderSettings({
      ...defaultProviderSettings,
      model: "cx/gpt-5.5",
      provider: "9router",
      providerModels: {
        ...defaultProviderSettings.providerModels,
        "9router": "cx/gpt-5.5",
      },
    });

    setStorageNamespace("user-b");
    const secondAccountSettings = loadProviderSettings();

    expect(secondAccountSettings.provider).toBe(defaultProviderSettings.provider);
    expect(secondAccountSettings.model).toBe(defaultProviderSettings.model);

    setStorageNamespace("user-a");
    const firstAccountSettings = loadProviderSettings();

    expect(firstAccountSettings.provider).toBe("9router");
    expect(firstAccountSettings.model).toBe("cx/gpt-5.5");
  });

  it("does not persist empty draft chats into chat history", () => {
    const emptyDraft = createEmptyChat("Research");
    const durableChat: ChatSummary = {
      id: "chat-with-content",
      messages: [
        {
          content: "Keep this.",
          createdAt: "2026-05-15T12:00:00.000Z",
          id: "message-keep",
          role: "user",
        },
      ],
      project: "Research",
      title: "Research notes",
      updatedAt: "2026-05-15T12:00:00.000Z",
    };

    saveChats([emptyDraft, durableChat]);

    expect(loadChats().map((chat) => chat.id)).toEqual(["chat-with-content"]);
  });

  it("persists unsent composer drafts on empty chats", () => {
    const draftChat: ChatSummary = {
      ...createEmptyChat("Drafted project"),
      composerDraft: {
        attachments: [],
        content: "Keep this half-written prompt.",
      },
      id: "chat-draft",
      updatedAt: "2026-05-18T12:00:00.000Z",
    };

    saveChats([draftChat]);

    const loadedChat = loadChats()[0];

    expect(loadedChat).toMatchObject({
      composerDraft: {
        attachments: [],
        content: "Keep this half-written prompt.",
      },
      id: "chat-draft",
      messages: [],
      project: "Drafted project",
    });
  });
});
