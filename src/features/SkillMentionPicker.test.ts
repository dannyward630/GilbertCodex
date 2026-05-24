import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getSkillMentionMatches } from "./plugins/pluginCatalog";
import { SkillMentionPicker } from "./plugins/SkillMentionPicker";

describe("skill mention picker", () => {
  it("shows installed skills from the active skill registry", () => {
    expect(getSkillMentionMatches("").map((skill) => skill.mention)).toContain("$coding");

    const html = renderToStaticMarkup(createElement(SkillMentionPicker, {
      activeIndex: 0,
      onActiveIndexChange: vi.fn(),
      onSelect: vi.fn(),
      query: "",
      trigger: "@",
    }));

    expect(html).toContain("Coding Agent Workflow");
    expect(html).toContain("$coding");
    expect(html).toContain("<button");
  });
});
