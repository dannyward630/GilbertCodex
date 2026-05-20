import type { TerminalShellId } from "./terminal";

export type ProjectRunActionKind = "dev-server" | "setup" | "test" | "build" | "custom";
export type ProjectRunActionSource = "detected" | "ai" | "user";
export type ProjectRunStatus = "running" | "reused" | "complete" | "error";

export interface ProjectRunAction {
  background: boolean;
  command: string;
  cwd?: string;
  id: string;
  kind: ProjectRunActionKind;
  label: string;
  previewUrl?: string;
  shell?: TerminalShellId;
  source: ProjectRunActionSource;
  updatedAt: string;
}

export interface ProjectRunLastRun {
  actionId: string;
  previewUrl?: string;
  ranAt: string;
  sessionId?: string;
  status: ProjectRunStatus;
}

export interface ProjectRunConfig {
  actions: ProjectRunAction[];
  lastRun?: ProjectRunLastRun;
  selectedActionId?: string;
  version: 1;
}
