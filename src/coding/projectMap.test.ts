import { describe, expect, it } from "vitest";
import { createProjectMapSnapshot, normalizeProjectMapSnapshot } from "./projectMap";

describe("project map", () => {
  it("infers lanes, imports, Tauri invokes, tool ids, tests, and changed nodes", () => {
    const snapshot = createProjectMapSnapshot({
      changedPaths: ["src/components/chat/ConversationHeader.tsx"],
      files: [
        {
          content: `import { invoke } from "@tauri-apps/api/core";\nimport { ConversationHeader } from "../components/chat/ConversationHeader";\nexport function ChatPage() { void invoke("agent_runs_list"); return null; }`,
          path: "src/pages/ChatPage.tsx",
        },
        {
          content: `export function ConversationHeader() { return null; }`,
          path: "src/components/chat/ConversationHeader.tsx",
        },
        {
          content: `export const terminalTool = { id: "terminal_run", title: "Run terminal" };`,
          path: "src/toolBridge/tools/terminal.ts",
        },
        {
          content: `use crate::state::AppState;`,
          path: "src-tauri/src/commands/agent_runs.rs",
        },
        {
          content: `describe("ConversationHeader", () => {});`,
          path: "src/components/chat/ConversationHeader.test.tsx",
        },
      ],
      roots: ["C:/repo"],
    });

    expect(snapshot.lanes.map((lane) => lane.id)).toEqual(expect.arrayContaining(["ui", "tools", "desktop", "tests"]));
    expect(snapshot.nodes.find((node) => node.path === "src/components/chat/ConversationHeader.tsx")).toMatchObject({ changed: true, lane: "ui" });
    expect(snapshot.nodes.find((node) => node.id === "command:agent_runs_list")).toMatchObject({ lane: "desktop", type: "command" });
    expect(snapshot.nodes.find((node) => node.id === "tool:terminal_run")).toMatchObject({ lane: "tools", type: "tool" });
    expect(snapshot.relations).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "imports" }),
      expect.objectContaining({ label: "invokes", to: "command:agent_runs_list" }),
      expect.objectContaining({ label: "defines", to: "tool:terminal_run" }),
    ]));
  });

  it("normalizes older or partial map snapshots before UI renders node cards", () => {
    const snapshot = normalizeProjectMapSnapshot({
      generatedAt: "2026-05-19T12:00:00.000Z",
      lanes: [{ id: "runtime", label: "Runtime" }],
      nodes: [{ id: "legacy-node", label: "Legacy runtime", path: "src/app/chatRuntime.ts" }],
      relations: [{ from: "legacy-node", to: "missing-tags" }],
      roots: ["C:/repo"],
    });

    expect(snapshot?.nodes[0]).toMatchObject({
      id: "legacy-node",
      lane: "runtime",
      tags: expect.any(Array),
      type: "service",
    });
    expect(snapshot?.lanes[0]?.nodeIds).toEqual(["legacy-node"]);
    expect(snapshot?.relations[0]).toMatchObject({ label: "relates" });
  });
});
