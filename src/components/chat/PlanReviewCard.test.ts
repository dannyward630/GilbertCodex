import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanReviewCard, truncatePreview } from "./PlanReviewCard";
import type { ChatMessage } from "../../types/chat";

describe("truncatePreview", () => {
  it("returns the full content when under the line limit", () => {
    const content = ["## Goal", "Do the thing.", "## Files", "- a.ts"].join("\n");
    expect(truncatePreview(content, 12)).toEqual({ preview: content, truncated: false });
  });

  it("truncates content over the line limit and flags it", () => {
    const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
    const { preview, truncated } = truncatePreview(lines.join("\n"), 12);
    expect(truncated).toBe(true);
    expect(preview.split("\n").length).toBe(12);
    expect(preview).toContain("line 1");
    expect(preview).not.toContain("line 13");
  });

  it("does not clip the inside of a fenced code block", () => {
    const content = [
      "## Goal",
      "Some prose",
      "Some more prose",
      "Some more prose",
      "Some more prose",
      "Some more prose",
      "Some more prose",
      "Some more prose",
      "Some more prose",
      "Some more prose",
      "Some more prose",
      "```ts",
      "function foo() {",
      "  return 42;",
      "}",
      "```",
      "## After",
    ].join("\n");

    const { preview, truncated } = truncatePreview(content, 12);

    expect(truncated).toBe(true);
    // The preview should extend past the fence's opening line until it
    // includes the closing ``` so the rendered markdown isn't broken.
    expect(preview).toContain("```ts");
    expect(preview.trimEnd().endsWith("```")).toBe(true);
  });

  it("handles empty content", () => {
    expect(truncatePreview("", 12)).toEqual({ preview: "", truncated: false });
  });
});

describe("PlanReviewCard", () => {
  it("does not render an empty drafting placeholder before plan content exists", () => {
    const message: ChatMessage = {
      content: "",
      createdAt: "2026-05-16T00:00:00.000Z",
      id: "message-1",
      isStreaming: true,
      mode: "plan",
      planning: {
        maxPasses: 1,
        passCount: 0,
        startedAt: "2026-05-16T00:00:00.000Z",
      },
      role: "assistant",
    };

    const html = renderToStaticMarkup(createElement(PlanReviewCard, {
      content: "",
      isStreaming: true,
      message,
    }));

    expect(html).toBe("");
  });

  it("renders plan mode as an inline response instead of the old card shell", () => {
    const message: ChatMessage = {
      approvals: [
        {
          args: { plan: "## Goal\nMake the plan readable.\n\n## Files to change\n- `src/App.tsx`" },
          createdAt: "2026-05-16T00:00:00.000Z",
          id: "approval-1",
          kind: "other",
          preview: "## Goal\nMake the plan readable.",
          risk: "medium",
          status: "pending",
          title: "Approve plan execution",
          tool: "planning_handoff",
        },
      ],
      content: "## Goal\nMake the plan readable.",
      createdAt: "2026-05-16T00:00:00.000Z",
      id: "message-1",
      mode: "plan",
      planning: {
        maxPasses: 1,
        passCount: 1,
        planContent: "## Goal\nMake the plan readable.\n\n## Files to change\n- `src/App.tsx`",
        startedAt: "2026-05-16T00:00:00.000Z",
      },
      role: "assistant",
    };

    const html = renderToStaticMarkup(createElement(PlanReviewCard, {
      content: message.content,
      message,
      onOpenFullPlan: () => undefined,
      onResolvePlanApproval: () => undefined,
    }));

    expect(html).toContain("plan-review-response");
    expect(html).not.toContain("plan-review-card");
    expect(html).toContain("Plan ready for review");
    expect(html).toContain("Accept &amp; start");
    expect(html).toContain("Files to change");
  });

  it("keeps an accepted saved plan reopenable after execution content replaces the message text", () => {
    const message: ChatMessage = {
      approvals: [
        {
          args: { plan: "## Goal\nKeep this plan around." },
          createdAt: "2026-05-16T00:00:00.000Z",
          id: "approval-1",
          kind: "other",
          preview: "## Goal\nKeep this plan around.",
          risk: "medium",
          status: "approved",
          title: "Approve plan execution",
          tool: "planning_handoff",
        },
      ],
      content: "Implemented the plan.",
      createdAt: "2026-05-16T00:00:00.000Z",
      id: "message-1",
      mode: "plan",
      planning: {
        maxPasses: 1,
        passCount: 1,
        planContent: "## Goal\nKeep this plan around.",
        startedAt: "2026-05-16T00:00:00.000Z",
      },
      role: "assistant",
    };

    const html = renderToStaticMarkup(createElement(PlanReviewCard, {
      content: message.content,
      message,
      onOpenFullPlan: () => undefined,
    }));

    expect(html).toContain("Plan accepted");
    expect(html).toContain("Keep this plan around.");
    expect(html).toContain("Open plan");
    expect(html).not.toContain("Implemented the plan.");
  });
});
