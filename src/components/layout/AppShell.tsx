import type { CSSProperties, ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { AppTopBar } from "../chrome/AppTopBar";
import { ShellSidebar } from "./ShellSidebar";
import { SearchDialog } from "../search/SearchDialog";
import { TerminalPanel } from "../terminal/TerminalPanel";
import type { AppInfo } from "../../types/app";
import type { AuthUser } from "../../types/auth";
import type { ChatSummary } from "../../types/chat";
import type { PrimaryRoute } from "../../types/navigation";
import type { ProjectSummary } from "../../types/project";
import type { TerminalAttachedSession } from "../../types/terminal";
import type { SettingsSectionId } from "../../pages/settings/types";

interface AppShellProps {
  activeRoute: PrimaryRoute;
  activeSettingsSection: SettingsSectionId;
  appInfo: AppInfo;
  authUser: AuthUser;
  chats: ChatSummary[];
  children: ReactNode;
  desktopRuntime: boolean;
  activeChatId: string;
  onCreateProject: () => void | string | null | Promise<string | null | void>;
  onCloseSearch: () => void;
  onDeleteChat: (chatId: string) => void;
  onDeleteProject: (projectName: string) => void;
  onNewChat: (project?: string) => void;
  onOpenBulkDeleteChats: () => void;
  onOpenSearch: () => void;
  onLogout: () => void;
  onRouteChange: (route: PrimaryRoute) => void;
  onShowAbout: () => void;
  onCloseTerminal: () => void;
  onTerminalHeightChange: (height: number) => void;
  onSelectChat: (chatId: string) => void;
  onSelectProject: (project: string) => void;
  onSettingsSectionChange: (section: SettingsSectionId) => void;
  onToggleTerminal: () => void;
  onTogglePin: (chatId: string) => void;
  onToggleSidebar: () => void;
  projects: ProjectSummary[];
  searchOpen: boolean;
  sidebarOpen: boolean;
  terminalHeight: number;
  terminalAttachedSession?: TerminalAttachedSession | null;
  terminalOpen: boolean;
  terminalWorkingDirectory?: string;
}

export function AppShell({
  activeChatId,
  activeRoute,
  activeSettingsSection,
  appInfo,
  authUser,
  chats,
  children,
  desktopRuntime,
  onCreateProject,
  onCloseSearch,
  onDeleteChat,
  onDeleteProject,
  onNewChat,
  onOpenBulkDeleteChats,
  onOpenSearch,
  onLogout,
  onRouteChange,
  onShowAbout,
  onCloseTerminal,
  onTerminalHeightChange,
  onSelectChat,
  onSelectProject,
  onSettingsSectionChange,
  onToggleTerminal,
  onTogglePin,
  onToggleSidebar,
  projects,
  searchOpen,
  sidebarOpen,
  terminalHeight,
  terminalAttachedSession,
  terminalOpen,
  terminalWorkingDirectory,
}: AppShellProps) {
  const rootStyle = {
    "--terminal-height": `${terminalHeight}px`,
  } as CSSProperties;

  function closeSidebarOnSmallScreens() {
    if (typeof window === "undefined" || !sidebarOpen) {
      return;
    }

    if (window.matchMedia("(max-width: 820px)").matches) {
      onToggleSidebar();
    }
  }

  return (
    <div className="desktop-root" data-runtime={desktopRuntime ? "desktop" : "web"} data-terminal-open={terminalOpen} style={rootStyle}>
      <AppTopBar
        activeRoute={activeRoute}
        appInfo={appInfo}
        desktopRuntime={desktopRuntime}
        sidebarOpen={sidebarOpen}
        terminalOpen={terminalOpen}
        onNewChat={onNewChat}
        onOpenSearch={onOpenSearch}
        onRouteChange={onRouteChange}
        onShowAbout={onShowAbout}
        onToggleTerminal={onToggleTerminal}
        onToggleSidebar={onToggleSidebar}
      />
      <button
        className="mobile-sidebar-toggle"
        type="button"
        aria-label={sidebarOpen ? "Close sidebar" : "Open sidebar"}
        aria-expanded={sidebarOpen}
        data-open={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <PanelLeft size={18} aria-hidden="true" />
      </button>
      <div className="workspace-shell" data-sidebar-open={sidebarOpen}>
        <ShellSidebar
          activeChatId={activeChatId}
          activeRoute={activeRoute}
          activeSettingsSection={activeSettingsSection}
          authUser={authUser}
          chats={chats}
          open={sidebarOpen}
          projects={projects}
          onCreateProject={async () => {
            const createdProjectName = await onCreateProject();
            closeSidebarOnSmallScreens();
            return createdProjectName;
          }}
          onDeleteChat={(chatId) => {
            onDeleteChat(chatId);
            closeSidebarOnSmallScreens();
          }}
          onDeleteProject={(projectName) => {
            onDeleteProject(projectName);
            closeSidebarOnSmallScreens();
          }}
          onNewChat={(project) => {
            onNewChat(project);
            closeSidebarOnSmallScreens();
          }}
          onOpenBulkDeleteChats={() => {
            onOpenBulkDeleteChats();
            closeSidebarOnSmallScreens();
          }}
          onOpenSearch={() => {
            onOpenSearch();
            closeSidebarOnSmallScreens();
          }}
          onLogout={onLogout}
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
          onSettingsSectionChange={(section) => {
            onSettingsSectionChange(section);
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
      <TerminalPanel
        attachedSession={terminalAttachedSession}
        desktopRuntime={desktopRuntime}
        height={terminalHeight}
        open={terminalOpen}
        workingDirectory={terminalWorkingDirectory}
        onClose={onCloseTerminal}
        onHeightChange={onTerminalHeightChange}
      />
      <SearchDialog chats={chats} open={searchOpen} onClose={onCloseSearch} onSelectChat={onSelectChat} />
    </div>
  );
}
