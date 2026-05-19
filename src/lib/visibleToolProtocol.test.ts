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
});
