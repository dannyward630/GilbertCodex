import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { deriveTocEntries, PlanReviewPanel } from "./PlanReviewPanel";
import type { ChatMessage } from "../../types/chat";

describe("deriveTocEntries", () => {
  it("extracts H2 and H3 headings in order", () => {
    const entries = deriveTocEntries(
      [
        "## Goal",
        "Some text",
        "## Files to change",
        "- a.ts",
        "## Step-by-step plan",
        "",
        "### Step 1",
        "do thing",
        "### Step 2",
        "do other thing",
        "## Risks and edge cases",
      ].join("\n"),
    );

    expect(entries.map((entry) => entry.label)).toEqual([
      "Goal",
      "Files to change",
      "Step-by-step plan",
      "Step 1",
      "Step 2",
      "Risks and edge cases",
    ]);
  });

  it("assigns level 2 to ## and level 3 to ###", () => {
    const entries = deriveTocEntries("## A\n### B\n## C");
    expect(entries.map((entry) => entry.level)).toEqual([2, 3, 2]);
  });

  it("produces slug ids and dedupes duplicates", () => {
    const entries = deriveTocEntries("## Risks\n## Risks\n## Risks");
    expect(entries.map((entry) => entry.id)).toEqual(["risks", "risks-1", "risks-2"]);
  });

  it("ignores headings inside fenced code blocks", () => {
    const entries = deriveTocEntries(
      [
        "## Real Heading",
        "```",
        "## Inside Code",
        "### Also Inside",
        "```",
        "## After Fence",
      ].join("\n"),
    );

    expect(entries.map((entry) => entry.label)).toEqual(["Real Heading", "After Fence"]);
  });

  it("ignores H1 and lower", () => {
    const entries = deriveTocEntries("# Title\n## Goal\n#### Too deep");
    expect(entries.map((entry) => entry.label)).toEqual(["Goal"]);
  });

  it("handles empty content gracefully", () => {
    expect(deriveTocEntries("")).toEqual([]);
    expect(deriveTocEntries("\n\n\n")).toEqual([]);
  });
});

describe("PlanReviewPanel", () => {
  it("renders an expand control when expansion is wired", () => {
    const message: ChatMessage = {
      content: "## Goal\nMake the plan readable.",
      createdAt: "2026-05-14T00:00:00.000Z",
      id: "message-1",
      mode: "plan",
      role: "assistant",
    };

    const html = renderToStaticMarkup(createElement(PlanReviewPanel, {
      message,
      onToggleExpanded: () => undefined,
    }));

    expect(html).toContain("Expand plan review");
  });

  it("renders a restore control when already expanded", () => {
    const message: ChatMessage = {
      content: "## Goal\nMake the plan readable.",
      createdAt: "2026-05-14T00:00:00.000Z",
      id: "message-1",
      mode: "plan",
      role: "assistant",
    };

    const html = renderToStaticMarkup(createElement(PlanReviewPanel, {
      expanded: true,
      message,
      onToggleExpanded: () => undefined,
    }));

    expect(html).toContain("Restore plan review");
  });

  it("uses saved plan content when the message content has moved on to execution output", () => {
    const message: ChatMessage = {
      content: "Implemented the approved plan.",
      createdAt: "2026-05-14T00:00:00.000Z",
      id: "message-1",
      mode: "plan",
      planning: {
        maxPasses: 1,
        passCount: 1,
        planContent: "## Goal\nKeep the original plan available.",
        startedAt: "2026-05-14T00:00:00.000Z",
      },
      role: "assistant",
    };

    const html = renderToStaticMarkup(createElement(PlanReviewPanel, {
      message,
    }));

    expect(html).toContain("Keep the original plan available.");
    expect(html).not.toContain("Implemented the approved plan.");
  });
});
