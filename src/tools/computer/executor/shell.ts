import type { TerminalShellId } from "../../../types/terminal";

export function quoteShellArg(value: string, shell: TerminalShellId) {
  if (shell === "powershell") {
    return `'${value.replace(/'/g, "''")}'`;
  }

  if (shell === "cmd") {
    return `"${value.replace(/"/g, '\\"')}"`;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}
