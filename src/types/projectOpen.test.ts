import { describe, expect, it } from "vitest";
import { getProjectOpenTarget, getProjectOpenTargetsForPlatform, getRecommendedProjectOpenTarget } from "./projectOpen";

describe("project open targets", () => {
  it("keeps Linux project-open options free of Windows-only targets", () => {
    const ids = getProjectOpenTargetsForPlatform("linux").map((target) => target.id);

    expect(ids).toContain("terminal");
    expect(ids).toContain("file-manager");
    expect(ids).not.toContain("git-bash");
    expect(ids).not.toContain("visual-studio");
    expect(ids).not.toContain("wsl");
  });

  it("keeps Linux file and terminal labels platform-native", () => {
    expect(getProjectOpenTarget("file-manager", "linux")).toMatchObject({
      detail: "Show this project folder in your file manager.",
      label: "File manager",
      shortLabel: "Files",
    });
    expect(getProjectOpenTarget("terminal", "linux")).toMatchObject({
      detail: "Open this project folder in your terminal.",
      downloadUrl: undefined,
      label: "Terminal",
    });
  });

  it("keeps macOS native labels while excluding Windows-only targets", () => {
    const ids = getProjectOpenTargetsForPlatform("macos").map((target) => target.id);

    expect(ids).not.toContain("git-bash");
    expect(ids).not.toContain("visual-studio");
    expect(ids).not.toContain("wsl");
    expect(getProjectOpenTarget("file-manager", "macos").label).toBe("Finder");
    expect(getProjectOpenTarget("terminal", "macos").downloadUrl).toBeUndefined();
  });

  it("only recommends Visual Studio and WSL on Windows", () => {
    expect(
      getRecommendedProjectOpenTarget({
        platform: "linux",
        projectName: "dotnet service",
        projectRoot: "/home/kobe/service.sln",
      }).id,
    ).toBe("vscode");

    expect(
      getRecommendedProjectOpenTarget({
        platform: "macos",
        projectName: "wsl workspace",
        projectRoot: "/Users/kobe/workspace",
      }).id,
    ).toBe("vscode");

    expect(
      getRecommendedProjectOpenTarget({
        platform: "windows",
        projectName: "dotnet service",
        projectRoot: "C:\\Users\\Kobe\\service.sln",
      }).id,
    ).toBe("visual-studio");
  });
});
