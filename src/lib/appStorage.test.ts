import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadChats, saveChats, setStorageNamespace } from "./appStorage";
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
});
