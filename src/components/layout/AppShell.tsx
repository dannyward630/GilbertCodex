import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { AppTopBar } from "../chrome/AppTopBar";
import { ShellSidebar } from "./ShellSidebar";
import { SearchDialog } from "../search/SearchDialog";
import { useAnimatedPresence } from "../../lib/useAnimatedPresence";
import type { AppInfo } from "../../types/app";
import type { AuthUser } from "../../types/auth";
import type { ChatSummary } from "../../types/chat";
import type { PrimaryRoute } from "../../types/navigation";
import type { CreateProjectOptions, ProjectSummary } from "../../types/project";
import type { AppearanceMode } from "../../types/settings";
import type { TerminalAttachedSession } from "../../types/terminal";
import type { SettingsSectionId } from "../../pages/settings/types";

const TerminalPanel = lazy(() => import("../terminal/TerminalPanel").then((module) => ({ default: module.TerminalPanel })));

interface AppShellProps {
  activeRoute: PrimaryRoute;
  activeSettingsSection: SettingsSectionId;
  appInfo: AppInfo;
  appearanceMode: AppearanceMode;
  authUser: AuthUser;
  chats: ChatSummary[];
  children: ReactNode;
  desktopRuntime: boolean;
  locationServicesEnabled: boolean;
  activeChatId: string;
  onCreateProject: (options?: CreateProjectOptions) => void | string | null | Promise<string | null | void>;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
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
  appearanceMode,
  authUser,
  chats,
  children,
  desktopRuntime,
  locationServicesEnabled,
  onAppearanceModeChange,
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
  const sidebarPresence = useAnimatedPresence(sidebarOpen, 360);
  const sidebarState = sidebarOpen ? "open" : sidebarPresence.exiting ? "closing" : "closed";
  const [terminalMounted, setTerminalMounted] = useState(terminalOpen);
  const rootStyle = {
    "--terminal-height": `${terminalHeight}px`,
  } as CSSProperties;

  useEffect(() => {
    if (terminalOpen) {
      setTerminalMounted(true);
    }
  }, [terminalOpen]);

  const closeSidebarOnSmallScreens = useCallback(() => {
    if (typeof window === "undefined" || !sidebarOpen) {
      return;
    }

    if (window.matchMedia("(max-width: 820px)").matches) {
      onToggleSidebar();
    }
  }, [onToggleSidebar, sidebarOpen]);
  const handleSidebarCreateProject = useCallback(
    async (options?: CreateProjectOptions) => {
      const createdProjectName = await onCreateProject(options);
      closeSidebarOnSmallScreens();
      return createdProjectName;
    },
    [closeSidebarOnSmallScreens, onCreateProject],
  );
  const handleSidebarDeleteChat = useCallback(
    (chatId: string) => {
      onDeleteChat(chatId);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onDeleteChat],
  );
  const handleSidebarDeleteProject = useCallback(
    (projectName: string) => {
      onDeleteProject(projectName);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onDeleteProject],
  );
  const handleSidebarNewChat = useCallback(
    (project?: string) => {
      onNewChat(project);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onNewChat],
  );
  const handleSidebarOpenBulkDeleteChats = useCallback(() => {
    onOpenBulkDeleteChats();
    closeSidebarOnSmallScreens();
  }, [closeSidebarOnSmallScreens, onOpenBulkDeleteChats]);
  const handleSidebarOpenSearch = useCallback(() => {
    onOpenSearch();
    closeSidebarOnSmallScreens();
  }, [closeSidebarOnSmallScreens, onOpenSearch]);
  const handleSidebarRouteChange = useCallback(
    (route: PrimaryRoute) => {
      onRouteChange(route);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onRouteChange],
  );
  const handleSidebarSelectChat = useCallback(
    (chatId: string) => {
      onSelectChat(chatId);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onSelectChat],
  );
  const handleSidebarSettingsSectionChange = useCallback(
    (section: SettingsSectionId) => {
      onSettingsSectionChange(section);
      closeSidebarOnSmallScreens();
    },
    [closeSidebarOnSmallScreens, onSettingsSectionChange],
  );

  return (
    <div className="desktop-root" data-runtime={desktopRuntime ? "desktop" : "web"} data-terminal-open={terminalOpen} style={rootStyle}>
      <AppTopBar
        activeRoute={activeRoute}
        appInfo={appInfo}
        appearanceMode={appearanceMode}
        desktopRuntime={desktopRuntime}
        locationServicesEnabled={locationServicesEnabled}
        sidebarOpen={sidebarOpen}
        terminalOpen={terminalOpen}
        onAppearanceModeChange={onAppearanceModeChange}
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
      <div className="workspace-shell" data-sidebar-open={sidebarOpen} data-sidebar-state={sidebarState}>
        <div className="sidebar-stage" data-sidebar-state={sidebarState}>
          {sidebarPresence.mounted ? (
            <ShellSidebar
              activeChatId={activeChatId}
              activeRoute={activeRoute}
              activeSettingsSection={activeSettingsSection}
              authUser={authUser}
              chats={chats}
              locationServicesEnabled={locationServicesEnabled}
              open={sidebarOpen && !sidebarPresence.exiting}
              projects={projects}
              onCreateProject={handleSidebarCreateProject}
              onDeleteChat={handleSidebarDeleteChat}
              onDeleteProject={handleSidebarDeleteProject}
              onNewChat={handleSidebarNewChat}
              onOpenBulkDeleteChats={handleSidebarOpenBulkDeleteChats}
              onOpenSearch={handleSidebarOpenSearch}
              onLogout={onLogout}
              onRouteChange={handleSidebarRouteChange}
              onSelectChat={handleSidebarSelectChat}
              onSettingsSectionChange={handleSidebarSettingsSectionChange}
              onTogglePin={onTogglePin}
            />
          ) : null}
        </div>
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
      {terminalMounted ? (
        <Suspense fallback={null}>
          <TerminalPanel
            attachedSession={terminalAttachedSession}
            desktopRuntime={desktopRuntime}
            height={terminalHeight}
            open={terminalOpen}
            workingDirectory={terminalWorkingDirectory}
            onClose={onCloseTerminal}
            onHeightChange={onTerminalHeightChange}
          />
        </Suspense>
      ) : null}
      <SearchDialog chats={chats} open={searchOpen} onClose={onCloseSearch} onSelectChat={onSelectChat} />
    </div>
  );
}
