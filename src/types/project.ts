import type { LocalWorkspaceSettings } from "./localWorkspace";
import type { ProjectRunConfig } from "./projectRun";

export interface ProjectSummary {
  createdAt: string;
  id: string;
  localWorkspace?: LocalWorkspaceSettings;
  name: string;
  runConfig?: ProjectRunConfig;
  updatedAt: string;
}

export interface CreateProjectOptions {
  bindToActiveChat?: boolean;
}
