import { describe, expect, it } from "vitest";
import { looksLikeVisibleToolProtocol, stripVisibleToolProtocol } from "./visibleToolProtocol";

describe("visible tool protocol guard", () => {
  it("strips a one-line unclosed DSML edit call before rendering", () => {
    const content = [
      `< | DSML | tool_calls> < | DSML | invoke name="files_edit"> < | DSML | parameter name="path" string="true">src/App.css</ | DSML | parameter>`,
      `.upload-overlay { position: fixed; inset: 0; }`,
    ].join("\n");

    expect(looksLikeVisibleToolProtocol(content)).toBe(true);
    expect(stripVisibleToolProtocol(content)).toBe("");
  });

  it("keeps safe prose before a leaked DSML block", () => {
    const content = [
      "I found the right file.",
      `< | DSML | tool_calls> < | DSML | invoke name="files_read">`,
    ].join("\n");

    expect(stripVisibleToolProtocol(content)).toBe("I found the right file.");
  });

  it("strips XML-style direct tool tags", () => {
    expect(stripVisibleToolProtocol(`<files_read_range><path>src/App.jsx</path></files_read_range>`)).toBe("");
  });

  it("strips bare provider tool_calls JSON while keeping prose before it", () => {
    const content = [
      "I need to read the file.",
      "",
      `{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"files_read","arguments":"{\\"path\\":\\"src/app/App.tsx\\"}"}}]}`,
    ].join("\n");

    expect(looksLikeVisibleToolProtocol(content)).toBe(true);
    expect(stripVisibleToolProtocol(content)).toBe("I need to read the file.");
  });

  it("strips fenced provider tool_calls JSON as a display fallback", () => {
    const content = [
      "I found the likely next action.",
      "```json",
      `{"tool_calls":[{"id":"call-1","type":"function","function":{"name":"files_read","arguments":"{\\"path\\":\\"src/app/App.tsx\\"}"}}]}`,
      "```",
      "Continuing with the answer.",
    ].join("\n");

    expect(stripVisibleToolProtocol(content)).toBe("I found the likely next action.\n\nContinuing with the answer.");
  });
});
