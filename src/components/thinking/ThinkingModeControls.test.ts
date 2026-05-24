import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ThinkingModeControls } from "./ThinkingModeControls";

describe("ThinkingModeControls", () => {
  it("renders Codex-style reasoning effort choices", () => {
    const html = renderToStaticMarkup(createElement(ThinkingModeControls, {
      onChange: vi.fn(),
      settings: {
        effort: "medium",
        enabled: true,
      },
      variant: "panel",
    }));

    expect(html).toContain("Reasoning");
    expect(html).toContain("Medium reasoning");
    expect(html).toContain("Low");
    expect(html).toContain("Medium");
    expect(html).toContain("High");
    expect(html).toContain("Default Codex");
    expect(html).toContain("data-selected=\"true\"");
    expect(html).not.toContain("<strong>Thinking</strong>");
    expect(html).not.toContain("thinking-field-row");
  });

  it("keeps the effort selector visible when reasoning is off", () => {
    const html = renderToStaticMarkup(createElement(ThinkingModeControls, {
      onChange: vi.fn(),
      settings: {
        effort: "high",
        enabled: false,
      },
      variant: "panel",
    }));

    expect(html).toContain("Reasoning off");
    expect(html).toContain("Low");
    expect(html).toContain("Medium");
    expect(html).toContain("High");
    expect(html).toContain("aria-checked=\"false\"");
  });

  it("shows model capability blocks without enabling controls", () => {
    const html = renderToStaticMarkup(createElement(ThinkingModeControls, {
      disabledReason: "Not available for this model",
      onChange: vi.fn(),
      settings: {
        effort: "low",
        enabled: true,
      },
      variant: "panel",
    }));

    expect(html).toContain("Not available for this model");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("data-disabled=\"true\"");
  });
});
