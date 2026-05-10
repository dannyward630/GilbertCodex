import { useEffect, useMemo, useState } from "react";
import { Clock3, Folder, FolderOpen, FolderPlus, ListPlus, LogOut, MessageSquarePlus, Pin, Search, Settings, Trash2, UserRound, Wrench } from "lucide-react";
import { formatChatAge, isNoProjectName, normalizeProjectName, sortChatsByUpdatedAt } from "../../lib/chatUtils";
import { SettingsSideMenu } from "../../pages/settings/SettingsSideMenu";
import { SidebarSection } from "../sidebar/SidebarSection";
import type { AuthUser } from "../../types/auth";
import type { ChatMessage, ChatSummary } from "../../types/chat";
import type { PrimaryRoute } from "../../types/navigation";
import type { ProjectSummary } from "../../types/project";
import type { SettingsSectionId } from "../../pages/settings/types";
import type { SidebarItemActivity } from "../sidebar/SidebarSection";

interface ShellSidebarProps {
  activeChatId: string;
  activeRoute: PrimaryRoute;
  activeSettingsSection: SettingsSectionId;
  authUser: AuthUser;
  chats: ChatSummary[];
  onCreateProject: () => void | string | null | Promise<string | null | void>;
  onDeleteChat: (chatId: string) => void;
  onDeleteProject: (projectName: string) => void;
  onNewChat: (project?: string) => void;
  onOpenSearch: () => void;
  onLogout: () => void;
  onRouteChange: (route: PrimaryRoute) => void;
  onSelectChat: (chatId: string) => void;
  onSelectProject: (project: string) => void;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  onTogglePin: (chatId: string) => void;
  open: boolean;
  projects: ProjectSummary[];
}

export function ShellSidebar({
  activeChatId,
  activeRoute,
  activeSettingsSection,
  authUser,
  chats,
  onCreateProject,
  onDeleteChat,
  onDeleteProject,
  onNewChat,
  onOpenSearch,
  onLogout,
  onRouteChange,
  onSelectChat,
  onSelectProject,
  onSettingsSectionChange,
  onTogglePin,
  open,
  projects,
}: ShellSidebarProps) {
  const PROJECT_CHAT_PREVIEW_LIMIT = 6;
  const visibleChats = useMemo(() => sortChatsByUpdatedAt(chats.filter((chat) => !chat.archived)), [chats]);
  const activeChat = visibleChats.find((chat) => chat.id === activeChatId);
  const pinnedChats = visibleChats.filter((chat) => chat.pinned);
  const recentChats = visibleChats.filter((chat) => isNoProjectName(chat.project) && !chat.pinned);
  const chatsByProject = useMemo(() => {
    const groupedChats = new Map<string, ChatSummary[]>();

    for (const chat of visibleChats) {
      const projectKey = normalizeProjectName(chat.project).toLowerCase();
      groupedChats.set(projectKey, [...(groupedChats.get(projectKey) ?? []), chat]);
    }

    return groupedChats;
  }, [visibleChats]);
  const projectList = useMemo(
    () => sortProjectsForSidebar(projects.filter((project) => !isNoProjectName(project.name))),
    [projects],
  );
  const initialExpandedProject = activeChat && !isNoProjectName(activeChat.project) ? normalizeProjectName(activeChat.project) : projectList[0]?.name;
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set(initialExpandedProject ? [initialExpandedProject] : []));
  const [projectChatLimits, setProjectChatLimits] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!activeChat?.project) {
      return;
    }

    setExpandedProjects((currentProjects) => {
      const activeProjectName = normalizeProjectName(activeChat.project);

      if (isNoProjectName(activeProjectName) || currentProjects.has(activeProjectName)) {
        return currentProjects;
      }

      const nextProjects = new Set(currentProjects);
      nextProjects.add(activeProjectName);
      return nextProjects;
    });
  }, [activeChat?.project, activeChatId]);

  const chatOptions = (chat: ChatSummary) => [
    {
      icon: Pin,
      label: chat.pinned ? "Unpin chat" : "Pin chat",
      onSelect: () => onTogglePin(chat.id),
    },
    {
      danger: true,
      icon: Trash2,
      label: "Delete chat",
      onSelect: () => onDeleteChat(chat.id),
    },
  ];

  const projectOptions = (projectName: string) => [
    {
      danger: true,
      icon: Trash2,
      label: "Delete project",
      onSelect: () => onDeleteProject(projectName),
    },
  ];

  if (activeRoute === "settings") {
    return (
      <SettingsSideMenu
        activeSection={activeSettingsSection}
        open={open}
        onRouteChange={onRouteChange}
        onSectionChange={onSettingsSectionChange}
      />
    );
  }

  function getProjectChatLimit(projectName: string) {
    return projectChatLimits[getProjectKey(projectName)] ?? PROJECT_CHAT_PREVIEW_LIMIT;
  }

  function handleToggleProject(projectName: string) {
    onSelectProject(projectName);

    if (!chatsByProject.get(projectName.toLowerCase())?.length) {
      return;
    }

    setExpandedProjects((currentProjects) => {
      const nextProjects = new Set(currentProjects);

      if (nextProjects.has(projectName)) {
        nextProjects.delete(projectName);
      } else {
        nextProjects.add(projectName);
      }

      return nextProjects;
    });
  }

  async function handleCreateProject() {
    const createdProjectName = await onCreateProject();

    if (typeof createdProjectName === "string" && createdProjectName.trim()) {
      onSelectProject(createdProjectName);
    }
  }

  function handleNewProjectChat(projectName: string) {
    setExpandedProjects((currentProjects) => {
      if (currentProjects.has(projectName)) {
        return currentProjects;
      }

      const nextProjects = new Set(currentProjects);
      nextProjects.add(projectName);
      return nextProjects;
    });
    onNewChat(projectName);
  }

  function handleLoadMoreProjectChats(projectName: string) {
    setProjectChatLimits((currentLimits) => {
      const projectKey = getProjectKey(projectName);
      const currentLimit = currentLimits[projectKey] ?? PROJECT_CHAT_PREVIEW_LIMIT;

      return {
        ...currentLimits,
        [projectKey]: currentLimit + PROJECT_CHAT_PREVIEW_LIMIT,
      };
    });
  }

  function createChatItem(chat: ChatSummary) {
    const activity = getChatActivity(chat);

    return {
      active: chat.id === activeChatId && activeRoute === "chat",
      activity,
      activityLabel: activity ? formatActivityLabel(activity) : undefined,
      id: chat.id,
      label: chat.title,
      menuItems: chatOptions(chat),
      meta: formatChatAge(chat.updatedAt),
      onSelect: onSelectChat,
    };
  }

  return (
    <aside className="shell-sidebar" data-open={open}>
      <div className="sidebar-primary-actions">
        <button className="sidebar-action" data-active={activeRoute === "chat"} type="button" onClick={() => onNewChat()}>
          <MessageSquarePlus size={17} aria-hidden="true" />
          <span>New chat</span>
        </button>
        <button className="sidebar-action" type="button" onClick={onOpenSearch}>
          <Search size={17} aria-hidden="true" />
          <span>Search</span>
        </button>
        <button className="sidebar-action" data-active={activeRoute === "toolbox"} type="button" onClick={() => onRouteChange("toolbox")}>
          <Wrench size={17} aria-hidden="true" />
          <span>Toolbox</span>
        </button>
        <button className="sidebar-action" data-active={activeRoute === "workflows"} type="button" onClick={() => onRouteChange("workflows")}>
          <Clock3 size={17} aria-hidden="true" />
          <span>Workflows</span>
        </button>
      </div>

      <div className="sidebar-scroll">
        <SidebarSection
          title="Pinned chats"
          items={pinnedChats.map((chat) => ({
            ...createChatItem(chat),
            icon: Pin,
          }))}
        />
        <SidebarSection
          title="Projects"
          actionIcon={FolderPlus}
          actionLabel="Add project folder"
          onAction={() => void handleCreateProject()}
          items={projectList.map((project) => {
            const projectChats = chatsByProject.get(project.name.toLowerCase()) ?? [];
            const expanded = expandedProjects.has(project.name);
            const visibleChatLimit = getProjectChatLimit(project.name);
            const visibleProjectChats = projectChats.slice(0, visibleChatLimit);
            const hiddenChatCount = Math.max(projectChats.length - visibleProjectChats.length, 0);
            const activity = getProjectActivity(projectChats);

            return {
              active: sameProjectName(activeChat?.project, project.name) && activeRoute === "chat",
              activity,
              activityLabel: activity ? `${formatActivityLabel(activity)} in ${project.name}` : undefined,
              children: [
                ...visibleProjectChats.map(createChatItem),
                ...(hiddenChatCount > 0
                  ? [
                      {
                        icon: ListPlus,
                        id: `${project.name}-load-more`,
                        label: "Load more",
                        meta: `${hiddenChatCount} more`,
                        onSelect: () => handleLoadMoreProjectChats(project.name),
                      },
                    ]
                  : []),
              ],
              expanded,
              icon: expanded ? FolderOpen : Folder,
              id: project.name,
              label: project.name,
              menuItems: projectOptions(project.name),
              onQuickAction: handleNewProjectChat,
              onSelect: handleToggleProject,
              quickActionIcon: MessageSquarePlus,
              quickActionLabel: `New chat in ${project.name}`,
            };
          })}
        />
        <SidebarSection
          title="Recent chats"
          items={recentChats.map(createChatItem)}
        />
      </div>

      <div className="sidebar-footer">
        <div className="sidebar-account">
          <div className="sidebar-account-avatar" aria-hidden="true">
            {getUserInitials(authUser)}
          </div>
          <div className="sidebar-account-copy">
            <strong>{authUser.displayName}</strong>
            <span>@{authUser.username} - local</span>
          </div>
          <button className="sidebar-account-signout" type="button" aria-label="Sign out" title="Sign out" onClick={onLogout}>
            <LogOut size={16} aria-hidden="true" />
          </button>
        </div>

        <button className="sidebar-settings" data-active={false} type="button" onClick={() => onRouteChange("settings")}>
          <Settings size={17} aria-hidden="true" />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  );
}

function getUserInitials(user: AuthUser) {
  const initials = user.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return initials || <UserRound size={16} aria-hidden="true" />;
}

function getProjectKey(projectName: string) {
  return projectName.toLowerCase();
}

function sortProjectsForSidebar(projects: ProjectSummary[]) {
  return [...projects].sort((left, right) => {
    const leftCreatedAt = parseProjectDate(left.createdAt);
    const rightCreatedAt = parseProjectDate(right.createdAt);

    if (leftCreatedAt !== rightCreatedAt) {
      return rightCreatedAt - leftCreatedAt;
    }

    return left.name.localeCompare(right.name);
  });
}

function parseProjectDate(value: string) {
  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getProjectActivity(projectChats: ChatSummary[]): SidebarItemActivity | undefined {
  return projectChats.reduce<SidebarItemActivity | undefined>((currentActivity, chat) => pickHigherActivity(currentActivity, getChatActivity(chat)), undefined);
}

function getChatActivity(chat: ChatSummary): SidebarItemActivity | undefined {
  return chat.messages.reduce<SidebarItemActivity | undefined>((currentActivity, message) => pickHigherActivity(currentActivity, getMessageActivity(message)), undefined);
}

function getMessageActivity(message: ChatMessage): SidebarItemActivity | undefined {
  const needsReview =
    message.agentRunStatus === "waiting_for_approval" ||
    message.approvals?.some((approval) => approval.status === "pending") ||
    message.toolCalls?.some((toolCall) => toolCall.status === "waiting_approval") ||
    hasPendingPlanningInput(message);

  if (needsReview) {
    return "waiting";
  }

  const isWorking =
    message.isStreaming ||
    message.progress?.some((progressItem) => progressItem.status === "active") ||
    message.toolCalls?.some((toolCall) => toolCall.status === "active") ||
    message.webSearch?.status === "active";

  if (isWorking) {
    return "working";
  }

  if (message.status === "queued") {
    return "queued";
  }

  return undefined;
}

function hasPendingPlanningInput(message: ChatMessage) {
  const planningRequests = message.planning?.inputRequests ?? (message.planning?.inputRequest ? [message.planning.inputRequest] : []);

  return planningRequests.some((request) => !request.answeredAt);
}

function pickHigherActivity(currentActivity: SidebarItemActivity | undefined, nextActivity: SidebarItemActivity | undefined) {
  if (!nextActivity) {
    return currentActivity;
  }

  if (!currentActivity || getActivityPriority(nextActivity) > getActivityPriority(currentActivity)) {
    return nextActivity;
  }

  return currentActivity;
}

function getActivityPriority(activity: SidebarItemActivity) {
  if (activity === "waiting") {
    return 3;
  }

  if (activity === "working") {
    return 2;
  }

  return 1;
}

function formatActivityLabel(activity: SidebarItemActivity) {
  if (activity === "waiting") {
    return "Needs review";
  }

  if (activity === "queued") {
    return "Queued";
  }

  return "Working";
}

function sameProjectName(left?: string | null, right?: string | null) {
  return normalizeProjectName(left).toLowerCase() === normalizeProjectName(right).toLowerCase();
}
