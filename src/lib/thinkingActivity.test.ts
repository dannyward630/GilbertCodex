import { describe, expect, it } from "vitest";
import { createActivityThinkingNotes } from "./thinkingActivity";

describe("thinking summaries", () => {
  it("keeps a detailed high-level trail without dumping raw reasoning", () => {
    const notes = createActivityThinkingNotes(
      [
        "I need to understand where response thinking is rendered.",
        "The relevant component is src/components/chat/ChatThread.tsx and state flows through responseThinking.",
        "One option is a full card, but a quieter disclosure is better for the chat surface.",
        "I found the panel starts expanded during streaming.",
        "We should make the summary collapse when content starts.",
        "I will update src/styles/chat.css to remove the glow treatment.",
        "I am checking the typecheck output now.",
        "Running npm typecheck confirms the JSX is valid.",
      ].join("\n\n"),
      { maxItems: 9 },
    );

    expect(notes).toEqual([
      "Scope: Need to understand where response thinking is rendered.",
      "Context: The relevant component is src/components/chat/ChatThread.tsx and state flows through responseThinking.",
      "Weighing: One option is a full card, but a quieter disclosure is better for the chat surface.",
      "Found: Panel starts expanded during streaming.",
      "Next: Should make the summary collapse when content starts.",
      "Preparing file changes in `src/styles/chat.css`.",
      "Checking: Typecheck output now.",
      "Checking: npm typecheck confirms the JSX is valid.",
    ]);
  });

  it("preserves the opening context and latest details when there are many notes", () => {
    const notes = createActivityThinkingNotes(
      [
        "The user asked for a calmer thinking design.",
        "The response meta surface owns the visible thinking row.",
        "I am comparing compact and expanded options.",
        "I found the old pulse animation is unnecessary.",
        "I should simplify the toggle shape.",
        "I should add note labels.",
        "I should improve text wrapping.",
        "I am checking the final diff.",
        "Running typecheck should catch hook errors.",
        "The result should keep the response readable.",
      ].join("\n\n"),
      { maxItems: 6 },
    );

    expect(notes).toHaveLength(6);
    expect(notes[0]).toMatch(/^Scope:/);
    expect(notes[1]).toMatch(/^Context:/);
    expect(notes[notes.length - 1]).toContain("response readable.");
  });
});
