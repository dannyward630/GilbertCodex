import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, PanelLeft } from "lucide-react";
import { closeWindow, maximizeWindow, minimizeWindow, startWindowDrag } from "../../app/windowClient";
import { IconButton } from "../common/IconButton";
import { WindowControls } from "./WindowControls";
import type { AppInfo } from "../../types/app";
import type { PrimaryRoute } from "../../types/navigation";

interface AppTopBarProps {
  activeRoute: PrimaryRoute;
  appInfo: AppInfo;
  onNewChat: () => void;
  onOpenSearch: () => void;
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
  onNewChat,
  onOpenSearch,
  onRouteChange,
  onShowAbout,
  onToggleSidebar,
  onToggleTerminal,
  sidebarOpen,
  terminalOpen,
}: AppTopBarProps) {
  const topbarRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);

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
        { label: "Terminal", shortcut: "Ctrl+`", checked: terminalOpen, onSelect: onToggleTerminal },
        { label: "Chat", checked: activeRoute === "chat", separatorBefore: true, onSelect: () => onRouteChange("chat") },
        { label: "Toolbox", checked: activeRoute === "toolbox", onSelect: () => onRouteChange("toolbox") },
        { label: "Workflows", checked: activeRoute === "workflows", onSelect: () => onRouteChange("workflows") },
        { label: "Settings", checked: activeRoute === "settings", onSelect: () => onRouteChange("settings") },
      ],
      window: [
        { label: "Minimize", onSelect: minimizeWindow },
        { label: "Maximize or restore", onSelect: maximizeWindow },
        { label: "Close window", danger: true, separatorBefore: true, onSelect: closeWindow },
      ],
      help: [
        { label: `About ${appInfo.name}`, onSelect: onShowAbout },
        { label: "Open settings", separatorBefore: true, onSelect: () => onRouteChange("settings") },
      ],
    }),
    [activeRoute, appInfo, onNewChat, onOpenSearch, onRouteChange, onShowAbout, onToggleSidebar, onToggleTerminal, sidebarOpen, terminalOpen],
  );

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!topbarRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenu]);

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
      } else if (key === "`") {
        event.preventDefault();
        onToggleTerminal();
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
                      data-checked={item.checked}
                      data-danger={item.danger}
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
      <WindowControls />
    </header>
  );
}
