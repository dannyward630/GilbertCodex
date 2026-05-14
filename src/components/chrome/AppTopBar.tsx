import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, PanelLeft } from "lucide-react";
import { closeWindow, maximizeWindow, minimizeWindow, startWindowDrag } from "../../app/windowClient";
import { IconButton } from "../common/IconButton";
import { AppUpdateIndicator, useAppUpdateController } from "./AppUpdateIndicator";
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
type EditCommand = "undo" | "cut" | "copy" | "paste" | "selectAll";

interface MenuDefinition {
  id: MenuId;
  label: string;
}

interface MenuAction {
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onSelect: () => void | Promise<void>;
  separatorBefore?: boolean;
  shortcut?: string;
}

const menuDefinitions: MenuDefinition[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
];

function runEditCommand(command: EditCommand) {
  const activeElement = document.activeElement;

  if (command === "selectAll") {
    if (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement) {
      activeElement.select();
      return;
    }

    document.execCommand("selectAll");
    return;
  }

  if (command === "paste") {
    void pasteIntoActiveElement();
    return;
  }

  document.execCommand(command);
}

async function pasteIntoActiveElement() {
  const activeElement = document.activeElement;

  if (!(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement)) {
    document.execCommand("paste");
    return;
  }

  try {
    const clipboardText = await navigator.clipboard.readText();
    const start = activeElement.selectionStart ?? activeElement.value.length;
    const end = activeElement.selectionEnd ?? activeElement.value.length;
    activeElement.setRangeText(clipboardText, start, end, "end");
    activeElement.dispatchEvent(new Event("input", { bubbles: true }));
  } catch {
    document.execCommand("paste");
  }
}

export function AppTopBar({
  activeRoute,
  appInfo,
  appearanceMode,
  desktopRuntime,
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

  const menus = useMemo<Record<MenuId, MenuAction[]>>(
    () => ({
      file: [
        { label: "New chat", shortcut: "Ctrl+N", onSelect: onNewChat },
        { label: "Search chats", shortcut: "Ctrl+K", onSelect: onOpenSearch },
        { label: "Settings", shortcut: "Ctrl+,", separatorBefore: true, onSelect: () => onRouteChange("settings") },
        { label: "Exit", shortcut: "Alt+F4", danger: true, separatorBefore: true, onSelect: closeWindow },
      ],
      edit: [
        { label: "Undo", shortcut: "Ctrl+Z", onSelect: () => runEditCommand("undo") },
        { label: "Cut", shortcut: "Ctrl+X", separatorBefore: true, onSelect: () => runEditCommand("cut") },
        { label: "Copy", shortcut: "Ctrl+C", onSelect: () => runEditCommand("copy") },
        { label: "Paste", shortcut: "Ctrl+V", onSelect: () => runEditCommand("paste") },
        { label: "Select all", shortcut: "Ctrl+A", separatorBefore: true, onSelect: () => runEditCommand("selectAll") },
      ],
      view: [
        { label: "Show sidebar", shortcut: "Ctrl+B", checked: sidebarOpen, onSelect: onToggleSidebar },
        { label: "Chat", checked: activeRoute === "chat", separatorBefore: true, onSelect: () => onRouteChange("chat") },
        { label: "Radar", checked: activeRoute === "radar", onSelect: () => onRouteChange("radar") },
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
      } else if (key === ",") {
        event.preventDefault();
        onRouteChange("settings");
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onNewChat, onOpenSearch, onRouteChange, onToggleSidebar, onToggleTerminal]);

  function isInteractiveTarget(target: HTMLElement) {
    return Boolean(target.closest("button, input, textarea, select, a, [role='menu'], [data-topbar-interactive='true']"));
  }

  function handleMouseDown(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;

    if (isInteractiveTarget(target)) {
      return;
    }

    void startWindowDrag();
  }

  function handleDoubleClick(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement;

    if (isInteractiveTarget(target)) {
      return;
    }

    void maximizeWindow();
  }

  function handleMenuButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, menuId: MenuId) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpenMenu(menuId);
    }
  }

  function selectMenuAction(action: MenuAction) {
    if (action.disabled) {
      return;
    }

    setOpenMenu(null);
    void action.onSelect();
  }

  return (
    <header ref={topbarRef} className="app-topbar" data-tauri-drag-region onDoubleClick={handleDoubleClick} onMouseDown={handleMouseDown}>
      <div className="topbar-left">
        <IconButton ariaLabel="Toggle sidebar" icon={PanelLeft} pressed={sidebarOpen} onClick={onToggleSidebar} />
        <IconButton ariaLabel="Back" icon={ArrowLeft} disabled />
        <IconButton ariaLabel="Forward" icon={ArrowRight} disabled />
        <nav className="topbar-menus" aria-label="Application menu" data-topbar-interactive="true">
          {menuDefinitions.map((menu) => (
            <div key={menu.id} className="topbar-menu" onMouseEnter={() => openMenu && setOpenMenu(menu.id)}>
              <button
                className="topbar-menu-button"
                type="button"
                aria-haspopup="menu"
                aria-expanded={openMenu === menu.id}
                data-active={openMenu === menu.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setOpenMenu((currentMenu) => (currentMenu === menu.id ? null : menu.id))}
                onKeyDown={(event) => handleMenuButtonKeyDown(event, menu.id)}
              >
                {menu.label}
              </button>
              {openMenu === menu.id ? (
                <div className="topbar-menu-panel" role="menu" aria-label={`${menu.label} menu`}>
                  {menus[menu.id].map((item) => (
                    <button
                      key={item.label}
                      className="topbar-menu-item"
                      type="button"
                      role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                      aria-checked={item.checked ?? undefined}
                      disabled={item.disabled}
                      data-checked={item.checked}
                      data-danger={item.danger}
                      data-disabled={item.disabled}
                      data-separator-before={item.separatorBefore}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectMenuAction(item)}
                    >
                      <span className="menu-check" aria-hidden="true">
                        {item.checked ? <Check size={13} /> : null}
                      </span>
                      <span className="menu-item-label">{item.label}</span>
                      {item.shortcut ? <span className="menu-shortcut">{item.shortcut}</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </nav>
      </div>
      <div className="topbar-center">
        <img className="topbar-logo" src="/gilbert-codex-logo.svg" alt="" aria-hidden="true" draggable={false} />
        <span>{appInfo.name}</span>
      </div>
      <WeatherTopBarIndicator onOpenRadar={() => onRouteChange("radar")} />
      <div className="topbar-right" data-topbar-interactive="true">
        <AppUpdateIndicator controller={updateController} />
        <WindowControls />
      </div>
    </header>
  );
}
