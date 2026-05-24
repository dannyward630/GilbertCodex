import { describe, expect, it } from "vitest";
import { getGitStatusIssue } from "./gitStatusUi";

describe("Git status UI issues", () => {
  it("describes missing status for a selected root as pending, not unavailable", () => {
    const issue = getGitStatusIssue(null, String.raw`C:\Users\Kobe Work\Documents\GilbertCodex`);

    expect(issue.title).toBe("Checking Git status");
    expect(issue.detail).toContain("checking local Git status");
    expect(issue.hint).not.toContain("Open this again");
  });

  it("still asks for a workspace before a root is selected", () => {
    expect(getGitStatusIssue(null, "").title).toBe("Choose a workspace");
  });
});
