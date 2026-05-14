import {
  createTerminalSession,
  drainTerminalSession,
  isTauriDesktopRuntime,
  runTerminalCommand,
  writeTerminalSession,
} from "../../../app/tauriClient";
import { registerBackgroundTerminalSession } from "../../../lib/terminalSessions";
import type {
  TerminalCreateSessionRequest,
  TerminalCreateSessionResponse,
  TerminalDrainResponse,
  TerminalRunCommandRequest,
  TerminalRunCommandResponse,
  TerminalShellId,
} from "../../../types/terminal";

export interface TerminalBackgroundSessionRegistration {
  browserPreviewUrl?: string;
  command: string;
  outputPreview?: string;
  sessionId: string;
  shell?: TerminalShellId;
  startedAt?: number;
  workingDirectory?: string;
}

export interface TerminalBackend {
  createSession: (request: TerminalCreateSessionRequest) => Promise<TerminalCreateSessionResponse>;
  drainSession: (sessionId: string) => Promise<TerminalDrainResponse>;
  isAvailable: () => boolean;
  registerBackgroundSession: (session: TerminalBackgroundSessionRegistration) => void;
  runCommand: (request: TerminalRunCommandRequest) => Promise<TerminalRunCommandResponse>;
  writeSession: (sessionId: string, input: string) => Promise<void>;
}

export const defaultTerminalBackend: TerminalBackend = {
  createSession: (request) => createTerminalSession(request),
  drainSession: (sessionId) => drainTerminalSession(sessionId),
  isAvailable: () => isTauriDesktopRuntime(),
  registerBackgroundSession: (session) => registerBackgroundTerminalSession(session),
  runCommand: (request) => runTerminalCommand(request),
  writeSession: (sessionId, input) => writeTerminalSession(sessionId, input),
};
