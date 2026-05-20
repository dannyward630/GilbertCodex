import { describe, expect, it } from "vitest";
import { matchesHotkey } from "./hotkeys";

function keyEvent(init: Partial<KeyboardEvent> & Pick<KeyboardEvent, "key">) {
  const code = init.key === " " ? "Space" : init.code ?? "";

  return {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
    code,
    key: init.key,
  } as KeyboardEvent;
}

describe("hotkey matching", () => {
  it("matches Ctrl as a modifier-only hold hotkey on keydown", () => {
    expect(matchesHotkey(keyEvent({ ctrlKey: true, key: "Control" }), "Ctrl")).toBe(true);
  });

  it("matches Ctrl as a modifier-only hold hotkey on keyup", () => {
    expect(matchesHotkey(keyEvent({ ctrlKey: false, key: "Control" }), "Ctrl")).toBe(true);
  });

  it("matches Ctrl+Space combinations without confusing them for Ctrl-only", () => {
    const event = keyEvent({ code: "Space", ctrlKey: true, key: " " });

    expect(matchesHotkey(event, "Ctrl+Space")).toBe(true);
    expect(matchesHotkey(event, "Ctrl")).toBe(false);
  });

  it("normalizes common platform key aliases", () => {
    expect(matchesHotkey(keyEvent({ metaKey: true, key: "p" }), "Command+P")).toBe(true);
    expect(matchesHotkey(keyEvent({ altKey: true, key: "Escape" }), "Option+Esc")).toBe(true);
  });
});
