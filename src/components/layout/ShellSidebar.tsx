import { useEffect, useMemo, useState } from "react";
import { Clock3, Folder, FolderOpen, FolderPlus, MessageSquarePlus, Pin, Search, Settings, Trash2, Wrench } from "lucide-react";
import { DEFAULT_PROJECT, formatChatAge, sortChatsByUpdatedAt } from "../../lib/chatUtils";
import { SidebarSection } from "../sidebar/SidebarSection";
import type { ChatSummary } from "../../types/chat";
import type { PrimaryRoute } from "../../types/navigation";
import type { ProjectSummary } from "../../types/project";

interface ShellSidebarProps {
  activeChatId: string;
  activeRoute: PrimaryRoute;
  chats: ChatSummary[];
  onCreateProject: () => void;
  onDeleteChat: (chatId: string) => void;
  onNewChat: (project?: string) => void;
  onOpenSearch: () => void;
  onRouteChange: (route: PrimaryRoute) => void;
  onSelectChat: (chatId: string) => void;
  onSelectProject: (project: string) => void;
  onTogglePin: (chatId: string) => void;
  open: boolean;
  projects: ProjectSummary[];
}

export function ShellSidebar({
  activeChatId,
  activeRoute,
  chats,
  onCreateProject,
  onDeleteChat,
  onNewChat,
  onOpenSearch,
  onRouteChange,
  onSelectChat,
  onSelectProject,
  onTogglePin,
  open,
  projects,
}: ShellSidebarProps) {
  const visibleChats = useMemo(() => sortChatsByUpdatedAt(chats.filter((chat) => !chat.archived)), [chats]);
  const activeChat = visibleChats.find((chat) => chat.id === activeChatId);
  const pinnedChats = visibleChats.filter((chat) => chat.pinned);
  const recentChats = visibleChats.filter((chat) => chat.project === DEFAULT_PROJECT && !chat.pinned);
  const projectList = projects.filter((project) => project.name !== DEFAULT_PROJECT);
  const initialExpandedProject = activeChat?.project ?? projects[0]?.name;
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => new Set(initialExpandedProject ? [initialExpandedProject] : []));
  const chatsByProject = useMemo(() => {
    const groupedChats = new Map<string, ChatSummary[]>();

    for (const chat of visibleChats) {
      const projectKey = chat.project.toLowerCase();
      groupedChats.set(projectKey, [...(groupedChats.get(projectKey) ?? []), chat]);
    }

    return groupedChats;
  }, [visibleChats]);

  useEffect(() => {
    if (!activeChat?.project) {
      return;
    }

    setExpandedProjects((currentProjects) => {
      if (currentProjects.has(activeChat.project)) {
        return currentProjects;
      }

      const nextProjects = new Set(currentProjects);
      nextProjects.add(activeChat.project);
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

  function handleToggleProject(projectName: string) {
    if (!chatsByProject.get(projectName.toLowerCase())?.length) {
      onSelectProject(projectName);
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
            active: chat.id === activeChatId && activeRoute === "chat",
            icon: Pin,
            id: chat.id,
            label: chat.title,
            menuItems: chatOptions(chat),
            meta: formatChatAge(chat.updatedAt),
            onSelect: onSelectChat,
          }))}
        />
        <SidebarSection
          title="Projects"
          actionIcon={FolderPlus}
          actionLabel="New project"
          onAction={onCreateProject}
          items={projectList.map((project) => {
            const projectChats = chatsByProject.get(project.name.toLowerCase()) ?? [];
            const expanded = expandedProjects.has(project.name);

            return {
              active: activeChat?.project === project.name && activeRoute === "chat",
              children: projectChats.map((chat) => ({
                active: chat.id === activeChatId && activeRoute === "chat",
                id: chat.id,
                label: chat.title,
                menuItems: chatOptions(chat),
                meta: formatChatAge(chat.updatedAt),
                onSelect: onSelectChat,
              })),
              expanded,
              icon: expanded ? FolderOpen : Folder,
              id: project.name,
              label: project.name,
              meta: formatProjectChatCount(projectChats.length),
              onQuickAction: handleNewProjectChat,
              onSelect: handleToggleProject,
              quickActionIcon: MessageSquarePlus,
              quickActionLabel: `New chat in ${project.name}`,
            };
          })}
        />
        <SidebarSection
          title="Recent chats"
          items={recentChats.map((chat) => ({
            active: chat.id === activeChatId && activeRoute === "chat",
            id: chat.id,
            label: chat.title,
            menuItems: chatOptions(chat),
            meta: formatChatAge(chat.updatedAt),
            onSelect: onSelectChat,
          }))}
        />
      </div>

      <button className="sidebar-settings" data-active={activeRoute === "settings"} type="button" onClick={() => onRouteChange("settings")}>
        <Settings size={17} aria-hidden="true" />
        <span>Settings</span>
      </button>
    </aside>
  );
}

function formatProjectChatCount(chatCount: number) {
  return chatCount === 1 ? "1 chat" : `${chatCount} chats`;
}
