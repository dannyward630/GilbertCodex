import { describe, expect, it } from "vitest";
import { normalizeMarkdownForDisplay, unwrapWholeMessageTextFence } from "./markdown";

describe("unwrapWholeMessageTextFence", () => {
  it("unwraps a whole-message markdown fence so prose renders as Markdown", () => {
    expect(unwrapWholeMessageTextFence("```markdown\n## Fixed\n- Normal answers render normally.\n```")).toBe("## Fixed\n- Normal answers render normally.");
  });

  it("unwraps unlabeled whole-message prose fences", () => {
    expect(unwrapWholeMessageTextFence("```\nHere is the answer in normal prose.\n\n- First point\n- Second point\n```")).toBe(
      "Here is the answer in normal prose.\n\n- First point\n- Second point",
    );
  });

  it("keeps real language code fences intact", () => {
    const content = "```ts\nconst answer = 42;\n```";

    expect(unwrapWholeMessageTextFence(content)).toBe(content);
  });

  it("keeps unlabeled code-looking fences intact", () => {
    const content = "```\nconst answer = 42;\nreturn answer;\n```";

    expect(unwrapWholeMessageTextFence(content)).toBe(content);
  });
});

describe("normalizeMarkdownForDisplay", () => {
  it("normalizes tables after unwrapping whole-message markdown fences", () => {
    expect(normalizeMarkdownForDisplay("```markdown\n| A | B |\n| - |\n| 1 | 2 |\n```")).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });
});
