import { describe, expect, it } from "vitest";
import { createMessageContextSurface } from "./contextWindow";

describe("provider context surface", () => {
  it("does not replay huge saved tool output into later provider requests", () => {
    const hugeOutput = "x".repeat(1_000_000);
    const surface = createMessageContextSurface({
      content: "",
      toolCalls: [
        {
          id: "tool-1",
          input: JSON.stringify({ path: "src/app/App.tsx" }),
          label: "Read workspace file",
          output: hugeOutput,
          status: "complete",
        },
      ],
    });

    expect(surface.length).toBeLessThan(40_000);
    expect(surface).toContain("Tool output truncated for provider context recovery");
    expect(surface).not.toContain("x".repeat(100_000));
  });
});
