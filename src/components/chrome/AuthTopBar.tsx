import { useMemo, useRef, useState } from "react";
import { closeWindow, maximizeWindow, minimizeWindow } from "../../app/windowClient";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import { runTopBarEditCommand } from "./topBarEditCommands";
import { TopBarMenus, type TopBarMenuAction, type TopBarMenuDefinition } from "./TopBarMenus";
import { handleTopBarDoubleClick, handleTopBarMouseDown } from "./topBarWindowInteractions";
import { WindowControls } from "./WindowControls";

type AuthMenuId = "file" | "edit" | "view" | "window" | "help";
type AuthMode = "create" | "login";

interface AuthTopBarProps {
  activeMode: AuthMode;
  hasAccounts: boolean;
  onModeChange: (mode: AuthMode) => void;
}

const menuDefinitions: TopBarMenuDefinition<AuthMenuId>[] = [
  { id: "file", label: "File" },
  { id: "edit", label: "Edit" },
  { id: "view", label: "View" },
  { id: "window", label: "Window" },
  { id: "help", label: "Help" },
];

export function AuthTopBar({ activeMode, hasAccounts, onModeChange }: AuthTopBarProps) {
  const topbarRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<AuthMenuId | null>(null);

  const menus = useMemo<Record<AuthMenuId, TopBarMenuAction[]>>(
    () => ({
      file: [
        { checked: activeMode === "create", label: "Create account", onSelect: () => onModeChange("create") },
        { checked: activeMode === "login", disabled: !hasAccounts, label: "Sign in", onSelect: () => onModeChange("login") },
        { danger: true, label: "Exit", separatorBefore: true, shortcut: "Alt+F4", onSelect: closeWindow },
      ],
      edit: [
        { label: "Undo", shortcut: "Ctrl+Z", onSelect: () => runTopBarEditCommand("undo") },
        { label: "Cut", shortcut: "Ctrl+X", separatorBefore: true, onSelect: () => runTopBarEditCommand("cut") },
        { label: "Copy", shortcut: "Ctrl+C", onSelect: () => runTopBarEditCommand("copy") },
        { label: "Paste", shortcut: "Ctrl+V", onSelect: () => runTopBarEditCommand("paste") },
        { label: "Select all", shortcut: "Ctrl+A", separatorBefore: true, onSelect: () => runTopBarEditCommand("selectAll") },
      ],
      view: [
        { checked: activeMode === "create", label: "Create account", onSelect: () => onModeChange("create") },
        { checked: activeMode === "login", disabled: !hasAccounts, label: "Sign in", onSelect: () => onModeChange("login") },
      ],
      window: [
        { label: "Minimize", onSelect: minimizeWindow },
        { label: "Maximize or restore", onSelect: maximizeWindow },
        { danger: true, label: "Close window", separatorBefore: true, onSelect: closeWindow },
      ],
      help: [{ label: "About Gilbert Codex", onSelect: () => undefined }],
    }),
    [activeMode, hasAccounts, onModeChange],
  );

  useDismissableLayer({
    active: openMenu !== null,
    keyboardTarget: "window",
    onDismiss: () => setOpenMenu(null),
    refs: [topbarRef],
  });

  return (
    <header ref={topbarRef} className="app-topbar auth-topbar" data-tauri-drag-region onDoubleClick={handleTopBarDoubleClick} onMouseDown={handleTopBarMouseDown}>
      <div className="topbar-left">
        <TopBarMenus ariaLabel="Application menu" className="auth-topbar-menus" definitions={menuDefinitions} menus={menus} openMenu={openMenu} onOpenMenuChange={setOpenMenu} />
      </div>
      <div className="topbar-center">
        <img className="topbar-logo auth-topbar-logo" src="/gilbert-codex-logo.svg" alt="" aria-hidden="true" draggable={false} />
        <span>Gilbert Codex</span>
      </div>
      <WindowControls />
    </header>
  );
}
