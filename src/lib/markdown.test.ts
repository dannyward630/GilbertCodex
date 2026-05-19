import { describe, expect, it } from "vitest";
import { normalizeMarkdownForDisplay, unwrapWholeMessageTextFence } from "./markdown";

describe("unwrapWholeMessageTextFence", () => {
  it("unwraps a whole-message markdown fence so prose renders as Markdown", () => {
    expect(unwrapWholeMessageTextFence("```markdown\n## Fixed\n- Normal answers render normally.\n```")).toBe("## Fixed\n- Normal answers render normally.");
  });

  it("unwraps whole-message prose fences even when mislabeled as code or json", () => {
    expect(unwrapWholeMessageTextFence("```json\n## Summary\n- Normal answers should not render as code.\n```")).toBe("## Summary\n- Normal answers should not render as code.");
    expect(unwrapWholeMessageTextFence("```ts\nHere is the answer in normal prose.\n\n- First point\n- Second point\n```")).toBe(
      "Here is the answer in normal prose.\n\n- First point\n- Second point",
    );
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

  it("keeps valid JSON examples fenced", () => {
    const content = "```json\n{\"title\":\"Review API Errors\",\"ok\":true}\n```";

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

  it("repairs a two-backtick typo so following prose does not stay inside the code block", () => {
    const content = [
      "The main issue right now",
      "",
      "```ts",
      "const runtime = {} as WorkspaceRuntimeDeps;",
      "``",
      "",
      "That means many extracted functions are currently being called with an empty object.",
      "",
      "## Biggest risks",
      "",
      "1. The empty runtime object will cause runtime failures.",
    ].join("\n");

    expect(normalizeMarkdownForDisplay(content)).toBe([
      "The main issue right now",
      "",
      "```ts",
      "const runtime = {} as WorkspaceRuntimeDeps;",
      "```",
      "",
      "That means many extracted functions are currently being called with an empty object.",
      "",
      "## Biggest risks",
      "",
      "1. The empty runtime object will cause runtime failures.",
    ].join("\n"));
  });

  it("closes an unclosed code fence before obvious prose continuation", () => {
    const content = [
      "```ts",
      "const answer = 42;",
      "",
      "That means the rest of the response should render as prose.",
      "",
      "- Verification passed",
    ].join("\n");

    expect(normalizeMarkdownForDisplay(content)).toBe([
      "```ts",
      "const answer = 42;",
      "",
      "```",
      "That means the rest of the response should render as prose.",
      "",
      "- Verification passed",
    ].join("\n"));
  });

  it("preserves terminal and diff fences", () => {
    const terminal = "```powershell\nPS C:\\repo> npm.cmd run build\nExit code: 0\n```";
    const diff = "```diff\ndiff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n```";

    expect(normalizeMarkdownForDisplay(terminal)).toBe(terminal);
    expect(normalizeMarkdownForDisplay(diff)).toBe(diff);
  });

  it("does not aggressively repair fences while streaming", () => {
    const content = [
      "```ts",
      "const answer = 42;",
      "",
      "That means the model may still be streaming.",
    ].join("\n");

    expect(normalizeMarkdownForDisplay(content, { final: false })).toBe(content);
  });
});
