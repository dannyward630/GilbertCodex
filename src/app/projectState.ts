import { createId } from "../lib/chatUtils";
import type { ChatSummary } from "../types/chat";
import type { LocalWorkspaceSettings } from "../types/localWorkspace";
import type { ProjectSummary } from "../types/project";

export function mergeProjectsWithChats(projects: ProjectSummary[], chats: ChatSummary[]) {
  const projectMap = new Map(projects.map((project) => [project.name.toLowerCase(), project]));

  for (const chat of chats) {
    if (projectMap.has(chat.project.toLowerCase())) {
      continue;
    }

    projectMap.set(chat.project.toLowerCase(), {
      createdAt: chat.updatedAt,
      id: createId("project"),
      name: chat.project,
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
