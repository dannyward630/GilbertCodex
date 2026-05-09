export type TerminalShellId = "powershell" | "cmd";

export type TerminalOutputStream = "stderr" | "stdout" | "stdin" | "system";

export interface TerminalOutputChunk {
  id: string;
  stream: TerminalOutputStream;
  text: string;
  timestamp: number;
}

export interface TerminalCreateSessionRequest {
  shell?: TerminalShellId;
  workingDirectory?: string;
}

export interface TerminalCreateSessionResponse {
  initialOutput: TerminalOutputChunk[];
  sessionId: string;
  shell: TerminalShellId;
  startedAt: number;
  workingDirectory: string;
}

export interface TerminalDrainResponse {
  chunks: TerminalOutputChunk[];
  exitCode?: number | null;
}
