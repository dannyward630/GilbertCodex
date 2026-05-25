import { describe, expect, it } from "vitest";
import { formatHostPlatformLabel, formatShortcutForPlatform, normalizeHostPlatform } from "./hostPlatform";

describe("host platform helpers", () => {
  it("normalizes desktop platform names from common browser and runtime values", () => {
    expect(normalizeHostPlatform("Windows")).toBe("windows");
    expect(normalizeHostPlatform("Win32")).toBe("windows");
    expect(normalizeHostPlatform("macOS arm64")).toBe("macos");
    expect(normalizeHostPlatform("Darwin")).toBe("macos");
    expect(normalizeHostPlatform("Linux x86_64")).toBe("linux");
    expect(normalizeHostPlatform("X11; Linux x86_64")).toBe("linux");
    expect(normalizeHostPlatform("")).toBe("unknown");
  });

  it("keeps Linux shortcuts aligned with Windows and converts only macOS shortcuts", () => {
    expect(formatShortcutForPlatform("Ctrl+K", "linux")).toBe("Ctrl+K");
    expect(formatShortcutForPlatform("Alt+F4", "linux")).toBe("Alt+F4");
    expect(formatShortcutForPlatform("Win+Shift+S", "linux")).toBe("Win+Shift+S");

    expect(formatShortcutForPlatform("Ctrl+K", "windows")).toBe("Ctrl+K");
    expect(formatShortcutForPlatform("Alt+F4", "windows")).toBe("Alt+F4");
    expect(formatShortcutForPlatform("Win+Shift+S", "windows")).toBe("Win+Shift+S");

    expect(formatShortcutForPlatform("Ctrl+K", "macos")).toBe("Command+K");
    expect(formatShortcutForPlatform("Alt+F4", "macos")).toBe("Option+F4");
    expect(formatShortcutForPlatform("Win+Shift+S", "macos")).toBe("Command+Shift+S");
  });

  it("formats labels consistently for support and settings UI", () => {
    expect(formatHostPlatformLabel("linux", "x64")).toBe("Linux x64");
    expect(formatHostPlatformLabel("macos", "arm64")).toBe("macOS arm64");
    expect(formatHostPlatformLabel("windows")).toBe("Windows");
    expect(formatHostPlatformLabel("unknown")).toBe("Unknown platform");
  });
});
