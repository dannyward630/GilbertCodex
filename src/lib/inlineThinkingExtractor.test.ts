import { describe, expect, it } from "vitest";
import { extractInlineThinking } from "./inlineThinkingExtractor";

describe("extractInlineThinking", () => {
  it("extracts a closed <think> block from content", () => {
    const result = extractInlineThinking("Hello <think>secret plan</think> world.");

    expect(result.content).toBe("Hello  world.");
    expect(result.reasoning).toBe("secret plan");
    expect(result.pendingPrefix).toBe("");
  });

  it("extracts each tag variant: think, thinking, thought, reasoning, analysis, scratchpad", () => {
    expect(extractInlineThinking("a<think>1</think>b").reasoning).toBe("1");
    expect(extractInlineThinking("a<thinking>2</thinking>b").reasoning).toBe("2");
    expect(extractInlineThinking("a<thought>3</thought>b").reasoning).toBe("3");
    expect(extractInlineThinking("a<reasoning>4</reasoning>b").reasoning).toBe("4");
    expect(extractInlineThinking("a<analysis>5</analysis>b").reasoning).toBe("5");
    expect(extractInlineThinking("a<scratchpad>6</scratchpad>b").reasoning).toBe("6");
  });

  it("handles an unclosed open tag by routing everything after it to reasoning", () => {
    const result = extractInlineThinking("public text <think>mid-stream private...");

    expect(result.content).toBe("public text ");
    expect(result.reasoning).toBe("mid-stream private...");
    expect(result.pendingPrefix).toBe("");
  });

  it("buffers a streaming tail prefix `<` so it never leaks", () => {
    const result = extractInlineThinking("Answering...<");

    expect(result.content).toBe("Answering...");
    expect(result.pendingPrefix).toBe("<");
  });

  it("buffers a streaming tail prefix `<thi` because it is a prefix of <think>", () => {
    const result = extractInlineThinking("Answering...<thi");

    expect(result.content).toBe("Answering...");
    expect(result.pendingPrefix).toBe("<thi");
  });

  it("buffers `<reasonin` (prefix of <reasoning>)", () => {
    const result = extractInlineThinking("ok<reasonin");

    expect(result.content).toBe("ok");
    expect(result.pendingPrefix).toBe("<reasonin");
  });

  it("buffers `<analysi` (prefix of <analysis>)", () => {
    const result = extractInlineThinking("ok<analysi");

    expect(result.content).toBe("ok");
    expect(result.pendingPrefix).toBe("<analysi");
  });

  it("does NOT buffer a tail that cannot be a thinking tag (e.g. <table)", () => {
    const result = extractInlineThinking("data<table");

    expect(result.content).toBe("data<table");
    expect(result.pendingPrefix).toBe("");
  });

  it("does NOT buffer a tail that has already passed a non-letter (e.g. `<table>` complete)", () => {
    const result = extractInlineThinking("<table>Row</table>");

    expect(result.content).toBe("<table>Row</table>");
    expect(result.pendingPrefix).toBe("");
  });

  it("releases pending prefix back into visible content on final flush", () => {
    const result = extractInlineThinking("Answering...<thi", { final: true });

    expect(result.content).toBe("Answering...<thi");
    expect(result.pendingPrefix).toBe("");
  });

  it("handles empty input", () => {
    const result = extractInlineThinking("");

    expect(result.content).toBe("");
    expect(result.reasoning).toBe("");
    expect(result.pendingPrefix).toBe("");
  });

  it("handles multiple closed blocks and concatenates reasoning", () => {
    const result = extractInlineThinking("a<think>one</think> b <thinking>two</thinking> c");

    expect(result.content).toBe("a b  c");
    expect(result.reasoning).toBe("onetwo");
  });

  it("strips stray closing tags with no matching open", () => {
    const result = extractInlineThinking("oops</think> remainder");

    expect(result.content).toBe("oops remainder");
    expect(result.reasoning).toBe("");
  });

  it("simulates a streaming sequence: prefix → full open → close, with no public leak", () => {
    // Mirrors modelProviderClient.flushSnapshot: the raw `buffer` keeps
    // accumulating every emitted token (it is NEVER trimmed by the caller),
    // and each flush re-extracts visible content from the whole buffer. The
    // pendingPrefix concept is informational — the displayed text is just
    // `content`.
    let buffer = "";
    const visibleFrames: string[] = [];

    const tokens = ["<", "t", "h", "i", "n", "k", ">", "private", "</think>", "ok"];
    for (const token of tokens) {
      buffer += token;
      const { content } = extractInlineThinking(buffer);
      visibleFrames.push(content);
    }

    // None of the streaming frames should ever contain `<`, `<t`, `<thi`, etc.
    for (const frame of visibleFrames) {
      expect(frame).not.toMatch(/</);
    }

    // Once the close arrives, the BLOCK pattern strips the entire
    // `<think>private</think>` and the trailing `ok` is the only visible text.
    expect(visibleFrames[visibleFrames.length - 1]).toBe("ok");
  });

  it("simulates a streaming sequence that turns out NOT to be a thinking tag", () => {
    let buffer = "";
    let lastContent = "";

    const tokens = ["<", "t", "a", "b", "l", "e", ">", "row", "</table>"];
    for (const token of tokens) {
      buffer += token;
      const { content } = extractInlineThinking(buffer);
      lastContent = content;
    }

    // Once enough characters arrive to disambiguate (`<ta`), the buffered
    // prefix releases back into visible content. The final string preserves
    // the full `<table>row</table>`.
    expect(lastContent).toBe("<table>row</table>");
  });
});
