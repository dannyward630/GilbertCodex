import { createId, isNoProjectName, normalizeProjectName } from "../lib/chatUtils";
import type { ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProjectSummary } from "../types/project";

export function mergeProjectsWithChats(projects: ProjectSummary[], chats: ChatSummary[]) {
  const projectMap = new Map(
    projects.flatMap((project) => {
      const name = normalizeProjectName(project.name);

      return isNoProjectName(name) ? [] : [[name.toLowerCase(), { ...project, name }] as const];
    }),
  );

  for (const chat of chats) {
    const projectName = normalizeProjectName(chat.project);

    if (isNoProjectName(projectName) || projectMap.has(projectName.toLowerCase())) {
      continue;
    }

    projectMap.set(projectName.toLowerCase(), {
      createdAt: chat.updatedAt,
      id: createId("project"),
      name: projectName,
      updatedAt: chat.updatedAt,
    });
  }

  return sortProjectsByUpdatedAt([...projectMap.values()]);
}

export function sortProjectsByUpdatedAt(projects: ProjectSummary[]) {
  return [...projects].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function sameLocalWorkspaceSettings(left: LocalWorkspaceSettings, right: LocalWorkspaceSettings) {
  return (
    left.enabled === right.enabled &&
    left.permissionMode === right.permissionMode &&
    left.scope === right.scope &&
    left.roots.length === right.roots.length &&
    left.roots.every((root, index) => root === right.roots[index])
  );
}

export function samePathSet(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  const normalizedLeft = left.map(normalizePathKey).sort();
  const normalizedRight = right.map(normalizePathKey).sort();

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function normalizePathKey(path: string) {
  return path.trim().replace(/[\\/]+$/, "").toLowerCase();
}
