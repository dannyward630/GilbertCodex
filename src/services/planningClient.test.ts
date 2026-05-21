import { describe, expect, it } from "vitest";
import { createPlanningProgress, filterPlanningInputQuestions, PLAN_DRAFT_MAX_TOKENS } from "./planningClient";

describe("createPlanningProgress", () => {
  it("returns the four canonical phases", () => {
    const progress = createPlanningProgress("input");
    expect(progress.map((item) => item.id)).toEqual(["plan-context", "plan-input", "plan-research", "plan-write"]);
  });

  it("marks research as active during the researching phase", () => {
    const progress = createPlanningProgress("researching");
    const research = progress.find((item) => item.id === "plan-research");
    expect(research?.status).toBe("active");
  });

  it("threads research evidence into the detail string", () => {
    const progress = createPlanningProgress("researching", { filesRead: 7, searches: 3 });
    const research = progress.find((item) => item.id === "plan-research");
    expect(research?.detail).toContain("7 files read");
    expect(research?.detail).toContain("3 searches");
  });

  it("uses past-tense detail once research is finished", () => {
    const progress = createPlanningProgress("drafting", { filesRead: 5, searches: 1 });
    const research = progress.find((item) => item.id === "plan-research");
    expect(research?.status).toBe("complete");
    expect(research?.detail).toContain("Inspected 5 files read");
  });

  it("falls back to a generic detail when no evidence is provided", () => {
    const progress = createPlanningProgress("researching");
    const research = progress.find((item) => item.id === "plan-research");
    expect(research?.detail).toBe("Looking through the workspace");
  });
});

describe("PLAN_DRAFT_MAX_TOKENS", () => {
  it("is far larger than typical chat token caps so long plans aren't truncated", () => {
    // The chat-mode default is in the 2-4K range. The bug we're fixing was a
    // 3K plan on a large codebase. We want the floor to be comfortably bigger.
    expect(PLAN_DRAFT_MAX_TOKENS).toBeGreaterThanOrEqual(12000);
  });
});

describe("filterPlanningInputQuestions", () => {
  it("drops generic codebase inventory questions that should be answered by research", () => {
    const questions = filterPlanningInputQuestions([
      {
        id: "purpose",
        question: "What is this project's main purpose or core functionality?",
        required: true,
      },
      {
        id: "components",
        question: "What UI components or pages currently exist?",
        required: true,
      },
      {
        id: "flows",
        question: "What key features or user flows are planned?",
        required: true,
      },
    ]);

    expect(questions).toEqual([]);
  });

  it("keeps questions that materially affect implementation choices", () => {
    const questions = filterPlanningInputQuestions([
      {
        id: "target",
        options: [
          { id: "desktop", label: "Desktop only" },
          { id: "mobile", label: "Desktop and mobile" },
        ],
        question: "Should this redesign prioritize desktop only or keep the mobile layout equally polished?",
        required: true,
      },
    ]);

    expect(questions).toHaveLength(1);
    expect(questions[0]?.id).toBe("target");
  });
});
