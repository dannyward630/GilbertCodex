import type { TerminalShellId } from "../types/terminal";
import { getHostPlatform, type HostPlatform } from "./hostPlatform";
export { getHostPlatform };
export type { HostPlatform };

const WINDOWS_SHELLS: TerminalShellId[] = ["powershell", "cmd", "wsl"];
const MACOS_SHELLS: TerminalShellId[] = ["zsh", "bash", "sh"];
const LINUX_SHELLS: TerminalShellId[] = ["bash", "sh", "zsh"];
const ALL_SHELLS: TerminalShellId[] = ["powershell", "cmd", "bash", "zsh", "sh", "wsl"];

const SHELL_LABELS = {
  bash: "Bash",
  cmd: "Command Prompt",
  powershell: "PowerShell",
  sh: "sh",
  wsl: "WSL Bash",
  zsh: "Zsh",
} satisfies Record<TerminalShellId, string>;

const SHELL_PROMPTS = {
  bash: "$",
  cmd: "CMD>",
  powershell: "PS>",
  sh: "$",
  wsl: "$",
  zsh: "%",
} satisfies Record<TerminalShellId, string>;

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
  return shell === "bash" || shell === "zsh" || shell === "sh" || shell === "wsl";
}

export function terminalShellLabel(shell: TerminalShellId) {
  return SHELL_LABELS[shell];
}

export function terminalPrompt(shell: TerminalShellId, workingDirectory?: string) {
  const cwd = workingDirectory?.trim();

  if (cwd) {
    if (shell === "powershell") {
      return `PS ${cwd}>`;
    }

    if (shell === "cmd") {
      return `${cwd}>`;
    }

    return `${cwd} ${SHELL_PROMPTS[shell]}`;
  }

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
