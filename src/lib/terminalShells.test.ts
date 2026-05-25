import { afterEach, describe, expect, it, vi } from "vitest";
import { getAvailableTerminalShells, getDefaultTerminalShell, terminalScriptExtension } from "./terminalShells";

function stubNavigatorPlatform(platform: string, userAgent = platform) {
  vi.stubGlobal("navigator", {
    platform,
    userAgent,
  });
}

describe("terminal shell platform support", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses native shell defaults and menu choices on each desktop platform", () => {
    stubNavigatorPlatform("MacIntel", "Mac OS X");
    expect(getDefaultTerminalShell()).toBe("zsh");
    expect(getAvailableTerminalShells()).toEqual(["zsh", "bash", "sh"]);

    stubNavigatorPlatform("Linux x86_64");
    expect(getDefaultTerminalShell()).toBe("bash");
    expect(getAvailableTerminalShells()).toEqual(["bash", "sh", "zsh"]);

    stubNavigatorPlatform("Win32");
    expect(getDefaultTerminalShell()).toBe("powershell");
    expect(getAvailableTerminalShells()).toEqual(["powershell", "cmd", "wsl"]);
  });

  it("keeps shell script extensions platform-appropriate", () => {
    expect(terminalScriptExtension("powershell")).toBe("ps1");
    expect(terminalScriptExtension("cmd")).toBe("cmd");
    expect(terminalScriptExtension("zsh")).toBe("sh");
    expect(terminalScriptExtension("bash")).toBe("sh");
    expect(terminalScriptExtension("sh")).toBe("sh");
  });
});
