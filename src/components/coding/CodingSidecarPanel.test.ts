import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentRun } from "../../types/agentRun";
import type { ChatSummary } from "../../types/chat";
import type { LocalWorkspaceSettings } from "../../types/localWorkspace";
import { CodingSidecarPanel } from "./CodingSidecarPanel";

const chat: ChatSummary = {
  id: "chat-1",
  messages: [],
  project: "No project",
  title: "New chat",
  updatedAt: "2026-05-19T12:00:00.000Z",
};

const workspace: LocalWorkspaceSettings = {
  enabled: false,
  permissionMode: "default",
  roots: [],
  scope: "current-folder",
};

const baseProps = {
  agentRuns: [] as AgentRun[],
  chat,
  expanded: false,
  localWorkspace: workspace,
  onClose: () => undefined,
  onResizeKeyDown: () => undefined,
  onResizeStart: () => undefined,
  onSubmitPrompt: () => undefined,
  onToggleExpanded: () => undefined,
  previewWidth: 560,
  resizeMaxWidth: 900,
  resizeMinWidth: 420,
  root: "",
};

describe("CodingSidecarPanel", () => {
  it("opens to the codebase browser from the header flow", () => {
    const html = renderToStaticMarkup(createElement(CodingSidecarPanel, {
      ...baseProps,
      initialTab: "codebase",
    }));

    expect(html).toContain("Bridge-first coding");
    expect(html).toContain("Codebase");
    expect(html).toContain("Choose a local project folder");
    expect(html).not.toContain("Evidence");
    expect(html).not.toContain("Project map");
    expect(html).not.toContain("Tool health");
  });

  it("keeps the review empty state available for composer review flow", () => {
    const html = renderToStaticMarkup(createElement(CodingSidecarPanel, {
      ...baseProps,
      initialTab: "review",
    }));

    expect(html).toContain("No workspace selected");
    expect(html).toContain("Choose a local project folder");
  });

  it("keeps changed-file summaries out of the codebase browser", () => {
    const html = renderToStaticMarkup(createElement(CodingSidecarPanel, {
      ...baseProps,
      agentRuns: [{
        approvals: [],
        artifacts: [],
        chatId: "chat-1",
        coding: {
          events: [],
          review: {
            changedFiles: [{
              additions: 42,
              deletions: 8,
              path: "src/components/coding/CodingSidecarPanel.tsx",
              purpose: "User-facing React component",
              riskLevel: "low",
              status: "modified",
              tags: ["ui"],
            }],
            generatedAt: "2026-05-19T12:00:00.000Z",
            riskLevel: "low",
            sensitiveAreas: [],
            suggestedCommitMessage: "feat: revamp coding sidecar",
            suggestedPrSummary: "Revamps the coding sidecar.",
            testsRun: [],
            unverifiedAssumptions: [],
            version: 1,
          },
          request: {
            chatId: "chat-1",
            prompt: "inspect",
            workspaceRoots: ["C:/repo"],
          },
          startedAt: "2026-05-19T12:00:00.000Z",
          toolHealth: [],
          version: 1,
        },
        createdAt: "2026-05-19T12:00:00.000Z",
        events: [],
        id: "run-1",
        mode: "chat",
        prompt: "inspect",
        sources: [],
        status: "completed",
        steps: [],
        title: "Legacy run",
        toolCalls: [],
        updatedAt: "2026-05-19T12:00:00.000Z",
      }],
      initialTab: "codebase",
      localWorkspace: {
        ...workspace,
        enabled: true,
        roots: ["C:/repo"],
      },
      root: "C:/repo",
    }));

    expect(html).toContain("Codebase");
    expect(html).toContain("Files");
    expect(html).not.toContain("1 file worked on");
    expect(html).not.toContain("Changed</strong>");
    expect(html).not.toContain("src/components/coding/CodingSidecarPanel.tsx");
  });
});
