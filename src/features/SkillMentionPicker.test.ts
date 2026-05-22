import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { getSkillMentionMatches } from "./plugins/pluginCatalog";
import { SkillMentionPicker } from "./plugins/SkillMentionPicker";

describe("skill mention picker", () => {
  it("shows coming soon instead of catalog skills when no skills are installed", () => {
    expect(getSkillMentionMatches("")).toEqual([]);

    const html = renderToStaticMarkup(createElement(SkillMentionPicker, {
      activeIndex: 0,
      onActiveIndexChange: vi.fn(),
      onSelect: vi.fn(),
      query: "",
      trigger: "@",
    }));

    expect(html).toContain("Skills coming soon");
    expect(html).toContain("No installed skills yet");
    expect(html).not.toContain("<button");
  });
});
