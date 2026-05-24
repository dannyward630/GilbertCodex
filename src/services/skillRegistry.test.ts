import { describe, expect, it } from "vitest";
import { findSkillPromptMatches, formatSkillsPromptSection, getInstalledSkillMentionOptions, loadSkillRegistry, parseSkillMarkdown } from "./skillRegistry";

describe("skillRegistry", () => {
  it("seeds trusted premade skills for composer mentions", () => {
    const registry = loadSkillRegistry();
    const mentions = getInstalledSkillMentionOptions().map((skill) => skill.mention);

    expect(registry.skills.some((skill) => skill.id === "coding-agent-workflow" && skill.enabled)).toBe(true);
    expect(mentions).toContain("$coding");
    expect(mentions).toContain("$review");
  });

  it("parses agent skill front matter", () => {
    expect(parseSkillMarkdown("---\nname: release-helper\ndescription: Prepare releases safely.\ntags: release, test\n---\nRun checks.")).toMatchObject({
      description: "Prepare releases safely.",
      name: "release-helper",
      tags: ["release", "test"],
    });
  });

  it("loads active instructions when a prompt invokes a skill trigger", () => {
    const matches = findSkillPromptMatches("Use $review on these changes before I ship.");
    const section = formatSkillsPromptSection("Use $review on these changes before I ship.");

    expect(matches[0]?.skill.id).toBe("code-review");
    expect(matches[0]?.reason).toBe("explicit");
    expect(section).toContain("Available enabled skills:");
    expect(section).toContain("## Code Review ($review)");
    expect(section).toContain("Match: explicit.");
  });
});
