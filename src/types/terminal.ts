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

export interface TerminalRunCommandRequest {
  command: string;
  shell?: TerminalShellId;
  timeoutMs?: number;
  workingDirectory?: string;
}

export interface TerminalCreateSessionResponse {
  initialOutput: TerminalOutputChunk[];
  sessionId: string;
  shell: TerminalShellId;
  startedAt: number;
  workingDirectory: string;
}

export interface TerminalRunCommandResponse {
  durationMs: number;
  exitCode?: number | null;
  outputTruncated: boolean;
  sessionId?: string;
  shell: TerminalShellId;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  workingDirectory: string;
}

export interface TerminalDrainResponse {
  activeCommand?: string | null;
  chunks: TerminalOutputChunk[];
  commandRunning?: boolean;
  exitCode?: number | null;
  lastCommandCompleted?: boolean;
  lastCommandExitCode?: number | null;
}
