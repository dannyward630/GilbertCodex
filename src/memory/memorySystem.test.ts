import { describe, expect, it } from "vitest";
import type { ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import {
  chatMemoryStorageKey,
  createDurableMemoryContext,
  createDurableMemoryScopeFromChat,
  loadDurableChatMemoryState,
  loadDurableProjectMemoryState,
  persistDurableMemoryFromChat,
  projectMemoryStorageKey,
} from ".";

const workspace: LocalWorkspaceSettings = {
  enabled: true,
  indexSummary: {
    builtAt: 1_779_000_000_000,
    entryCount: 42,
    ignoredEntries: 3,
    roots: [String.raw`C:\repo`],
    scannedDirectories: 9,
    skippedEntries: 1,
    truncated: false,
  },
  indexStatus: "idle",
  permissionMode: "full-access",
  roots: [String.raw`C:\repo`],
  scope: "selected-folder",
};

describe("durable memory system", () => {
  it("batches visible chat text and tool errors into scoped memory without hidden thinking", () => {
    const chat = createChat();
    const storage = createStorage();

    persistDurableMemoryFromChat({
      chat,
      now: "2026-05-16T15:05:00.000Z",
      storage,
      workspaceSettings: workspace,
    });

    const scope = createDurableMemoryScopeFromChat(chat, workspace);
    const chatMemory = loadDurableChatMemoryState(scope, storage);
    const projectMemory = loadDurableProjectMemoryState(scope, storage);

    expect(storage.raw.get(chatMemoryStorageKey(scope))).toContain("TOOL CALL");
    expect(storage.raw.get(projectMemoryStorageKey(scope))).toContain("src/memory/store.ts");
    expect(chatMemory.events.map((event) => event.kind)).toContain("tool-error");
    expect(chatMemory.records.some((record) => record.content.includes("Response thinking summary"))).toBe(false);
    expect(chatMemory.records.some((record) => record.content.includes("Visible reasoning"))).toBe(false);
    expect(projectMemory.fileMap.knownFiles.some((entry) => entry.path.includes("src/memory/store.ts"))).toBe(true);
    expect(projectMemory.fileMap.indexSummary?.entryCount).toBe(42);
  });

  it("retrieves old relevant project memory with local embeddings and relative ages", () => {
    const chat = createChat({
      assistantContent: "Two weeks ago we moved the memory search path into src/memory/context.ts and kept project maps in SQLite-backed storage.",
      assistantCreatedAt: "2026-05-02T15:00:00.000Z",
      updatedAt: "2026-05-02T15:00:00.000Z",
    });
    const storage = createStorage();

    persistDurableMemoryFromChat({
      chat,
      now: "2026-05-02T15:05:00.000Z",
      storage,
      workspaceSettings: workspace,
    });

    const scope = createDurableMemoryScopeFromChat(chat, workspace);
    const chatMemory = loadDurableChatMemoryState(scope, storage);
    const projectMemory = loadDurableProjectMemoryState(scope, storage);
    const context = createDurableMemoryContext(chatMemory, projectMemory, {
      now: "2026-05-16T15:05:00.000Z",
      prompt: "where did we put memory search and project maps",
    });

    expect(context).toContain("DURABLE MEMORY");
    expect(context).toContain("2 weeks ago");
    expect(context).toContain("src/memory/context.ts");
    expect(context).toContain("Project file map");
  });
});

function createChat(overrides: Partial<{ assistantContent: string; assistantCreatedAt: string; updatedAt: string }> = {}): ChatSummary {
  return {
    id: "chat-memory",
    messages: [
      {
        content: "Add persistent memory that remembers project files and what happened earlier.",
        createdAt: "2026-05-16T15:00:00.000Z",
        id: "message-user",
        role: "user",
      },
      {
        content: overrides.assistantContent ?? "I wired the memory store and will add retrieval context next.",
        createdAt: overrides.assistantCreatedAt ?? "2026-05-16T15:01:00.000Z",
        id: "message-assistant",
        role: "assistant",
        toolCalls: [
          {
            fileChanges: [
              {
                additions: 12,
                deletions: 1,
                kind: "update",
                path: String.raw`C:\repo\src\memory\store.ts`,
              },
            ],
            id: "tool-read",
            input: JSON.stringify({ path: "src/memory/store.ts" }),
            label: "Read workspace file",
            output: String.raw`Could not read C:\repo\src\memory\store.ts. Try src/memory/store.ts`,
            status: "error",
            toolId: "files_read",
          },
        ],
      },
    ],
    project: "Memory Project",
    title: "Memory build",
    updatedAt: overrides.updatedAt ?? "2026-05-16T15:04:00.000Z",
  };
}

function createStorage() {
  const raw = new Map<string, string>();
  return {
    raw,
    read: (key: string) => raw.get(key),
    write: (key: string, value: string) => {
      raw.set(key, value);
    },
  };
}
