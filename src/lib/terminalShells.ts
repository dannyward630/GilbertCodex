import type { TerminalShellId } from "../types/terminal";

export type HostPlatform = "linux" | "macos" | "unknown" | "windows";

const WINDOWS_SHELLS: TerminalShellId[] = ["powershell", "cmd"];
const MACOS_SHELLS: TerminalShellId[] = ["zsh", "bash", "sh"];
const LINUX_SHELLS: TerminalShellId[] = ["bash", "sh", "zsh"];
const ALL_SHELLS: TerminalShellId[] = ["powershell", "cmd", "bash", "zsh", "sh"];

const SHELL_LABELS = {
  bash: "Bash",
  cmd: "cmd",
  powershell: "PowerShell",
  sh: "sh",
  zsh: "Zsh",
} satisfies Record<TerminalShellId, string>;

const SHELL_PROMPTS = {
  bash: "$",
  cmd: "CMD",
  powershell: "PS",
  sh: "sh",
  zsh: "zsh",
} satisfies Record<TerminalShellId, string>;

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function getHostPlatform(): HostPlatform {
  if (typeof navigator === "undefined") {
    return "unknown";
  }

  const platformSource = `${(navigator as NavigatorWithUserAgentData).userAgentData?.platform ?? navigator.platform ?? ""} ${navigator.userAgent ?? ""}`.toLowerCase();

  if (platformSource.includes("win")) {
    return "windows";
  }

  if (platformSource.includes("mac")) {
    return "macos";
  }

  if (platformSource.includes("linux") || platformSource.includes("x11")) {
    return "linux";
  }

  return "unknown";
}

export function getDefaultTerminalShell(): TerminalShellId {
  const platform = getHostPlatform();

  if (platform === "macos") {
    return "zsh";
  }

  if (platform === "linux") {
    return "bash";
  }

  return "powershell";
}

export function getAvailableTerminalShells(): TerminalShellId[] {
  const platform = getHostPlatform();

  if (platform === "macos") {
    return MACOS_SHELLS;
  }

  if (platform === "linux") {
    return LINUX_SHELLS;
  }

  return WINDOWS_SHELLS;
}

export function isTerminalShellId(value: unknown): value is TerminalShellId {
  return typeof value === "string" && ALL_SHELLS.includes(value as TerminalShellId);
}

export function isPosixTerminalShell(shell: TerminalShellId) {
  return shell === "bash" || shell === "zsh" || shell === "sh";
}

export function terminalShellLabel(shell: TerminalShellId) {
  return SHELL_LABELS[shell];
}

export function terminalPrompt(shell: TerminalShellId) {
  return SHELL_PROMPTS[shell];
}

export function terminalScriptExtension(shell: TerminalShellId) {
  if (shell === "cmd") {
    return "cmd";
  }

  if (shell === "powershell") {
    return "ps1";
  }

  return "sh";
}
