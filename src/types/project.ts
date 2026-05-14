import type { LocalWorkspaceSettings } from "./localWorkspace";

export interface ProjectSummary {
  createdAt: string;
  id: string;
  localWorkspace?: LocalWorkspaceSettings;
  name: string;
  updatedAt: string;
}

export interface CreateProjectOptions {
  bindToActiveChat?: boolean;
}
