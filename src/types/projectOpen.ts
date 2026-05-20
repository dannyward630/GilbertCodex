import { normalizeHostPlatform, type HostPlatform } from "../lib/hostPlatform";

export type ProjectOpenTargetId =
  | "android-studio"
  | "claude-code"
  | "cursor"
  | "file-manager"
  | "git-bash"
  | "intellij-idea"
  | "pycharm"
  | "terminal"
  | "visual-studio"
  | "vscode"
  | "webstorm"
  | "windsurf"
  | "wsl";

export interface ProjectOpenTarget {
  brandColor: string;
  detail: string;
  downloadUrl?: string;
  id: ProjectOpenTargetId;
  label: string;
  shortLabel: string;
}

export const DEFAULT_PROJECT_OPEN_TARGET_ID: ProjectOpenTargetId = "vscode";

export const PROJECT_OPEN_TARGETS: ProjectOpenTarget[] = [
  {
    brandColor: "#007ACC",
    detail: "Launch this folder in Visual Studio Code.",
    downloadUrl: "https://code.visualstudio.com/Download",
    id: "vscode",
    label: "VS Code",
    shortLabel: "Code",
  },
  {
    brandColor: "currentColor",
    detail: "Show this project folder in File Explorer.",
    id: "file-manager",
    label: "File Explorer",
    shortLabel: "Explorer",
  },
  {
    brandColor: "currentColor",
    detail: "Open this project folder in a terminal.",
    downloadUrl: "https://learn.microsoft.com/windows/terminal/install",
    id: "terminal",
    label: "Terminal",
    shortLabel: "Terminal",
  },
  {
    brandColor: "#80B83D",
    detail: "Open Git Bash in this project folder.",
    downloadUrl: "https://git-scm.com/download/win",
    id: "git-bash",
    label: "Git Bash",
    shortLabel: "Git Bash",
  },
  {
    brandColor: "#0078D3",
    detail: "Open WSL in this project folder.",
    downloadUrl: "https://learn.microsoft.com/windows/wsl/install",
    id: "wsl",
    label: "WSL",
    shortLabel: "WSL",
  },
  {
    brandColor: "#3DDC84",
    detail: "Open this project in Android Studio.",
    downloadUrl: "https://developer.android.com/studio",
    id: "android-studio",
    label: "Android Studio",
    shortLabel: "Android",
  },
  {
    brandColor: "currentColor",
    detail: "Launch this folder in Cursor.",
    downloadUrl: "https://cursor.com/download",
    id: "cursor",
    label: "Cursor",
    shortLabel: "Cursor",
  },
  {
    brandColor: "#D97757",
    detail: "Open a terminal running Claude Code in this folder.",
    downloadUrl: "https://code.claude.com/docs/en/installation",
    id: "claude-code",
    label: "Claude Code",
    shortLabel: "Claude",
  },
  {
    brandColor: "#42E8E0",
    detail: "Launch this folder in Windsurf.",
    downloadUrl: "https://windsurf.com/windsurf/download",
    id: "windsurf",
    label: "Windsurf",
    shortLabel: "Windsurf",
  },
  {
    brandColor: "#F97A12",
    detail: "Open this project in IntelliJ IDEA.",
    downloadUrl: "https://www.jetbrains.com/idea/download/",
    id: "intellij-idea",
    label: "IntelliJ IDEA",
    shortLabel: "IDEA",
  },
  {
    brandColor: "#07C3F2",
    detail: "Open this project in WebStorm.",
    downloadUrl: "https://www.jetbrains.com/webstorm/download/",
    id: "webstorm",
    label: "WebStorm",
    shortLabel: "WebStorm",
  },
  {
    brandColor: "#21D789",
    detail: "Open this project in PyCharm.",
    downloadUrl: "https://www.jetbrains.com/pycharm/download/",
    id: "pycharm",
    label: "PyCharm",
    shortLabel: "PyCharm",
  },
  {
    brandColor: "#A855F7",
    detail: "Open this folder in Visual Studio.",
    downloadUrl: "https://visualstudio.microsoft.com/downloads/",
    id: "visual-studio",
    label: "Visual Studio",
    shortLabel: "VS",
  },
];

export function getProjectOpenTarget(targetId: ProjectOpenTargetId, platform?: HostPlatform | string | null) {
  const targets = platform == null ? PROJECT_OPEN_TARGETS : getProjectOpenTargetsForPlatform(platform);

  return targets.find((target) => target.id === targetId) ?? targets[0] ?? PROJECT_OPEN_TARGETS[0];
}

export function getProjectOpenTargetsForPlatform(platform?: HostPlatform | string | null) {
  const normalizedPlatform = normalizeHostPlatform(platform);

  return PROJECT_OPEN_TARGETS.filter((target) => {
    if (normalizedPlatform === "macos") {
      return target.id !== "git-bash" && target.id !== "visual-studio" && target.id !== "wsl";
    }

    if (normalizedPlatform === "linux") {
      return target.id !== "visual-studio" && target.id !== "wsl";
    }

    return true;
  }).map((target) => getPlatformAdjustedProjectOpenTarget(target, normalizedPlatform));
}

export function getRecommendedProjectOpenTarget({
  platform,
  projectName,
  projectRoot,
}: {
  platform?: HostPlatform | string | null;
  projectName?: string | null;
  projectRoot?: string | null;
} = {}) {
  const normalizedPlatform = normalizeHostPlatform(platform);
  const haystack = `${projectName ?? ""} ${projectRoot ?? ""}`.toLowerCase();

  if (normalizedPlatform === "windows" && /\\\\wsl(?:\$|\.localhost)|\bwsl\b/.test(haystack)) {
    return getProjectOpenTarget("wsl", normalizedPlatform);
  }

  if (/\b(android|gradle|kotlin|compose)\b|androidstudioprojects|studioprojects/.test(haystack)) {
    return getProjectOpenTarget("android-studio", normalizedPlatform);
  }

  if (normalizedPlatform === "windows" && /\b(visual studio|dotnet|\.net|csharp|c#|sln|csproj)\b/.test(haystack)) {
    return getProjectOpenTarget("visual-studio", normalizedPlatform);
  }

  if (/\b(python|pycharm|django|flask|fastapi|jupyter)\b/.test(haystack)) {
    return getProjectOpenTarget("pycharm", normalizedPlatform);
  }

  if (/\b(webstorm)\b/.test(haystack)) {
    return getProjectOpenTarget("webstorm", normalizedPlatform);
  }

  return getProjectOpenTarget(DEFAULT_PROJECT_OPEN_TARGET_ID, normalizedPlatform);
}

function getPlatformAdjustedProjectOpenTarget(target: ProjectOpenTarget, platform: HostPlatform): ProjectOpenTarget {
  if (target.id === "file-manager") {
    if (platform === "macos") {
      return {
        ...target,
        detail: "Show this project folder in Finder.",
        label: "Finder",
        shortLabel: "Finder",
      };
    }

    if (platform === "linux") {
      return {
        ...target,
        detail: "Show this project folder in your file manager.",
        label: "File manager",
        shortLabel: "Files",
      };
    }
  }

  if (target.id === "terminal" && platform === "macos") {
    return {
      ...target,
      detail: "Open this project folder in Terminal.",
      downloadUrl: undefined,
    };
  }

  return target;
}
