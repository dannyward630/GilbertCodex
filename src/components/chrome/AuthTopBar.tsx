import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react";
import { useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { closeWindow, maximizeWindow, minimizeWindow, startWindowDrag } from "../../app/windowClient";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import { WindowControls } from "./WindowControls";

type AuthMenuId = "file" | "edit" | "view" | "window" | "help";
type AuthMode = "create" | "login";
type EditCommand = "undo" | "cut" | "copy" | "paste" | "selectAll";

interface AuthTopBarProps {
  activeMode: AuthMode;
  hasAccounts: boolean;
  onModeChange: (mode: AuthMode) => void;
}

interface MenuDefinition {
  id: AuthMenuId;
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

export function AuthTopBar({ activeMode, hasAccounts, onModeChange }: AuthTopBarProps) {
  const topbarRef = useRef<HTMLElement>(null);
  const [openMenu, setOpenMenu] = useState<AuthMenuId | null>(null);

  const menus = useMemo<Record<AuthMenuId, MenuAction[]>>(
    () => ({
      file: [
        { checked: activeMode === "create", label: "Create account", onSelect: () => onModeChange("create") },
        { checked: activeMode === "login", disabled: !hasAccounts, label: "Sign in", onSelect: () => onModeChange("login") },
        { danger: true, label: "Exit", separatorBefore: true, shortcut: "Alt+F4", onSelect: closeWindow },
      ],
      edit: [
        { label: "Undo", shortcut: "Ctrl+Z", onSelect: () => runEditCommand("undo") },
        { label: "Cut", shortcut: "Ctrl+X", separatorBefore: true, onSelect: () => runEditCommand("cut") },
        { label: "Copy", shortcut: "Ctrl+C", onSelect: () => runEditCommand("copy") },
        { label: "Paste", shortcut: "Ctrl+V", onSelect: () => runEditCommand("paste") },
        { label: "Select all", shortcut: "Ctrl+A", separatorBefore: true, onSelect: () => runEditCommand("selectAll") },
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

  function handleMenuButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, menuId: AuthMenuId) {
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
    <header ref={topbarRef} className="app-topbar auth-topbar" data-tauri-drag-region onDoubleClick={handleDoubleClick} onMouseDown={handleMouseDown}>
      <div className="topbar-left">
        <nav className="topbar-menus auth-topbar-menus" aria-label="Application menu" data-topbar-interactive="true">
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
        <img className="topbar-logo auth-topbar-logo" src="/gilbert-codex-logo.svg" alt="" aria-hidden="true" draggable={false} />
        <span>Gilbert Codex</span>
      </div>
      <WindowControls />
    </header>
  );
}
