import { useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft } from "lucide-react";
import { closeWindow, maximizeWindow, minimizeWindow } from "../../app/windowClient";
import { IconButton } from "../common/IconButton";
import { AppUpdateIndicator, useAppUpdateController } from "./AppUpdateIndicator";
import { runTopBarEditCommand } from "./topBarEditCommands";
import { TopBarMenus, type TopBarMenuAction, type TopBarMenuDefinition } from "./TopBarMenus";
import { handleTopBarDoubleClick, handleTopBarMouseDown } from "./topBarWindowInteractions";
import { WeatherTopBarIndicator } from "./WeatherTopBarIndicator";
import { WindowControls } from "./WindowControls";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import type { AppInfo } from "../../types/app";
import type { PrimaryRoute } from "../../types/navigation";
import type { AppearanceMode } from "../../types/settings";

interface AppTopBarProps {
  activeRoute: PrimaryRoute;
  appInfo: AppInfo;
  appearanceMode: AppearanceMode;
  desktopRuntime: boolean;
  locationServicesEnabled: boolean;
  onNewChat: () => void;
  onOpenSearch: () => void;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onRouteChange: (route: PrimaryRoute) => void;
  onShowAbout: () => void;
  onToggleSidebar: () => void;
  onToggleTerminal: () => void;
  sidebarOpen: boolean;
  terminalOpen: boolean;
}

type MenuId = "file" | "edit" | "view" | "window" | "help";

const menuDefinitions: TopBarMenuDefinition<MenuId>[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
];

export function AppTopBar({
  activeRoute,
  appInfo,
  appearanceMode,
  desktopRuntime,
  locationServicesEnabled,
  onNewChat,
  onOpenSearch,
  onAppearanceModeChange,
  onRouteChange,
  onShowAbout,
  onToggleSidebar,
  onToggleTerminal,
  sidebarOpen,
  terminalOpen,
}: AppTopBarProps) {
  const topbarRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const updateController = useAppUpdateController(desktopRuntime);

  const menus = useMemo<Record<MenuId, TopBarMenuAction[]>>(
    () => ({
      file: [
        { label: "New chat", shortcut: "Ctrl+N", onSelect: onNewChat },
        { label: "Search chats", shortcut: "Ctrl+K", onSelect: onOpenSearch },
        { label: "Settings", shortcut: "Ctrl+,", separatorBefore: true, onSelect: () => onRouteChange("settings") },
        { label: "Exit", shortcut: "Alt+F4", danger: true, separatorBefore: true, onSelect: closeWindow },
      ],
      edit: [
        { label: "Undo", shortcut: "Ctrl+Z", onSelect: () => runTopBarEditCommand("undo") },
        { label: "Cut", shortcut: "Ctrl+X", separatorBefore: true, onSelect: () => runTopBarEditCommand("cut") },
        { label: "Copy", shortcut: "Ctrl+C", onSelect: () => runTopBarEditCommand("copy") },
        { label: "Paste", shortcut: "Ctrl+V", onSelect: () => runTopBarEditCommand("paste") },
        { label: "Select all", shortcut: "Ctrl+A", separatorBefore: true, onSelect: () => runTopBarEditCommand("selectAll") },
      ],
      view: [
        { label: "Show sidebar", shortcut: "Ctrl+B", checked: sidebarOpen, onSelect: onToggleSidebar },
        { label: "Terminal", shortcut: "Ctrl+`", checked: terminalOpen, disabled: !desktopRuntime, onSelect: onToggleTerminal },
        { label: "Chat", checked: activeRoute === "chat", separatorBefore: true, onSelect: () => onRouteChange("chat") },
        { label: "Apps", checked: activeRoute === "apps", onSelect: () => onRouteChange("apps") },
        ...(locationServicesEnabled ? [{ label: "Radar", checked: activeRoute === "radar", onSelect: () => onRouteChange("radar") }] : []),
        { label: "Settings", checked: activeRoute === "settings", onSelect: () => onRouteChange("settings") },
        { label: "System theme", checked: appearanceMode === "system", separatorBefore: true, onSelect: () => onAppearanceModeChange("system") },
        { label: "Dark theme", checked: appearanceMode === "dark", onSelect: () => onAppearanceModeChange("dark") },
        { label: "Light theme", checked: appearanceMode === "light", onSelect: () => onAppearanceModeChange("light") },
      ],
      window: [
        { label: "Minimize", onSelect: minimizeWindow },
        { label: "Maximize or restore", onSelect: maximizeWindow },
        { label: "Close window", danger: true, separatorBefore: true, onSelect: closeWindow },
      ],
      help: [
        {
          disabled: !desktopRuntime || updateController.busy,
          label: "Check for updates",
          onSelect: updateController.checkNow,
        },
        { label: `About ${appInfo.name}`, onSelect: onShowAbout },
        { label: "Open settings", separatorBefore: true, onSelect: () => onRouteChange("settings") },
      ],
    }),
    [
      activeRoute,
      appInfo,
      appearanceMode,
      desktopRuntime,
      onAppearanceModeChange,
      onNewChat,
      onOpenSearch,
      onRouteChange,
      onShowAbout,
      onToggleSidebar,
      onToggleTerminal,
      locationServicesEnabled,
      sidebarOpen,
      terminalOpen,
      updateController.busy,
      updateController.checkNow,
    ],
  );

  useDismissableLayer({
    active: openMenu !== null,
    keyboardTarget: "window",
    onDismiss: () => setOpenMenu(null),
    refs: [topbarRef],
  });

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const usesCommandKey = event.ctrlKey || event.metaKey;
      const target = event.target instanceof HTMLElement ? event.target : null;

      if (!usesCommandKey || target?.closest("[role='dialog']")) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === "n") {
        event.preventDefault();
        onNewChat();
      } else if (key === "k") {
        event.preventDefault();
        onOpenSearch();
      } else if (key === "b") {
        event.preventDefault();
        onToggleSidebar();
      } else if (desktopRuntime && (event.code === "Backquote" || event.key === "`")) {
        event.preventDefault();
        onToggleTerminal();
      } else if (key === ",") {
        event.preventDefault();
        onRouteChange("settings");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [desktopRuntime, onNewChat, onOpenSearch, onRouteChange, onToggleSidebar, onToggleTerminal]);

  return (
    <header ref={topbarRef} className="app-topbar" data-tauri-drag-region onDoubleClick={handleTopBarDoubleClick} onMouseDown={handleTopBarMouseDown}>
      <div className="topbar-left">
        <IconButton ariaLabel="Toggle sidebar" icon={PanelLeft} pressed={sidebarOpen} onClick={onToggleSidebar} />
        <TopBarMenus ariaLabel="Application menu" definitions={menuDefinitions} menus={menus} openMenu={openMenu} onOpenMenuChange={setOpenMenu} />
      </div>
      <div className="topbar-center">
        <img className="topbar-logo" src="/gilbert-codex-logo.svg" alt="" aria-hidden="true" draggable={false} />
        <span>{appInfo.name}</span>
      </div>
      {locationServicesEnabled ? <WeatherTopBarIndicator onOpenRadar={() => onRouteChange("radar")} /> : null}
      <div className="topbar-right" data-topbar-interactive="true">
        <AppUpdateIndicator controller={updateController} />
        <WindowControls />
      </div>
    </header>
  );
}
