import type { ReactNode } from "react";
import { AppTopBar } from "../chrome/AppTopBar";
import { ShellSidebar } from "./ShellSidebar";
import { SearchDialog } from "../search/SearchDialog";
import type { AppInfo } from "../../types/app";
import type { ChatSummary } from "../../types/chat";
import type { PrimaryRoute } from "../../types/navigation";
import type { ProjectSummary } from "../../types/project";

interface AppShellProps {
  activeRoute: PrimaryRoute;
  appInfo: AppInfo;
  chats: ChatSummary[];
  children: ReactNode;
  activeChatId: string;
  onCreateProject: () => void;
  onCloseSearch: () => void;
  onDeleteChat: (chatId: string) => void;
  onNewChat: (project?: string) => void;
  onOpenSearch: () => void;
  onRouteChange: (route: PrimaryRoute) => void;
  onShowAbout: () => void;
  onSelectChat: (chatId: string) => void;
  onSelectProject: (project: string) => void;
  onTogglePin: (chatId: string) => void;
  onToggleSidebar: () => void;
  projects: ProjectSummary[];
  searchOpen: boolean;
  sidebarOpen: boolean;
}

export function AppShell({
  activeChatId,
  activeRoute,
  appInfo,
  chats,
  children,
  onCreateProject,
  onCloseSearch,
  onDeleteChat,
  onNewChat,
  onOpenSearch,
  onRouteChange,
  onShowAbout,
  onSelectChat,
  onSelectProject,
  onTogglePin,
  onToggleSidebar,
  projects,
  searchOpen,
  sidebarOpen,
}: AppShellProps) {
  function closeSidebarOnSmallScreens() {
    if (typeof window === "undefined" || !sidebarOpen) {
      return;
    }

    if (window.matchMedia("(max-width: 820px)").matches) {
      onToggleSidebar();
    }
  }

  return (
    <div className="desktop-root">
      <AppTopBar
        activeRoute={activeRoute}
        appInfo={appInfo}
        sidebarOpen={sidebarOpen}
        onNewChat={onNewChat}
        onOpenSearch={onOpenSearch}
        onRouteChange={onRouteChange}
        onShowAbout={onShowAbout}
        onToggleSidebar={onToggleSidebar}
      />
      <div className="workspace-shell" data-sidebar-open={sidebarOpen}>
        <ShellSidebar
          activeChatId={activeChatId}
          activeRoute={activeRoute}
          chats={chats}
          open={sidebarOpen}
          projects={projects}
          onCreateProject={() => {
            onCreateProject();
            closeSidebarOnSmallScreens();
          }}
          onDeleteChat={(chatId) => {
            onDeleteChat(chatId);
            closeSidebarOnSmallScreens();
          }}
          onNewChat={(project) => {
            onNewChat(project);
            closeSidebarOnSmallScreens();
          }}
          onOpenSearch={() => {
            onOpenSearch();
            closeSidebarOnSmallScreens();
          }}
          onRouteChange={(route) => {
            onRouteChange(route);
            closeSidebarOnSmallScreens();
          }}
          onSelectChat={(chatId) => {
            onSelectChat(chatId);
            closeSidebarOnSmallScreens();
          }}
          onSelectProject={(project) => {
            onSelectProject(project);
            closeSidebarOnSmallScreens();
          }}
          onTogglePin={onTogglePin}
        />
        <button
          className="sidebar-mobile-backdrop"
          type="button"
          aria-hidden={!sidebarOpen}
          aria-label="Close sidebar"
          data-open={sidebarOpen}
          tabIndex={sidebarOpen ? 0 : -1}
          onClick={() => {
            if (sidebarOpen) {
              onToggleSidebar();
            }
          }}
        />
        <main className="app-main">{children}</main>
      </div>
      <SearchDialog chats={chats} open={searchOpen} onClose={onCloseSearch} onSelectChat={onSelectChat} />
    </div>
  );
}
