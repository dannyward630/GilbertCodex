import { useEffect, useRef, useState } from "react";
import {
  Archive,
  Clock3,
  Copy,
  ExternalLink,
  GitFork,
  Globe2,
  Laptop,
  MessageCirclePlus,
  MoreHorizontal,
  PanelRight,
  Pencil,
  Pin,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { IconButton } from "../common/IconButton";

interface ConversationHeaderProps {
  browserPreviewOpen: boolean;
  browserPreviewEnabled: boolean;
  inspectorAvailable: boolean;
  inspectorOpen: boolean;
  onToggleBrowserPreview: () => void;
  onToggleInspector: () => void;
  onTogglePin: () => void;
  onToggleTerminal: () => void;
  pinned: boolean;
  terminalEnabled: boolean;
  terminalOpen: boolean;
  title: string;
}

interface ConversationMenuItem {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onSelect?: () => void;
  separatorBefore?: boolean;
  shortcut?: string;
}

export function ConversationHeader({
  browserPreviewOpen,
  browserPreviewEnabled,
  inspectorAvailable,
  inspectorOpen,
  onToggleBrowserPreview,
  onToggleInspector,
  onTogglePin,
  onToggleTerminal,
  pinned,
  terminalEnabled,
  terminalOpen,
  title,
}: ConversationHeaderProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const menuItems: ConversationMenuItem[] = [
    {
      icon: Pin,
      label: pinned ? "Unpin chat" : "Pin chat",
      onSelect: onTogglePin,
      shortcut: "Ctrl+Alt+P",
    },
    {
      icon: Pencil,
      label: "Rename chat",
      shortcut: "Ctrl+Alt+R",
    },
    {
      icon: Archive,
      label: "Archive chat",
      shortcut: "Ctrl+Shift+A",
    },
    {
      icon: Copy,
      label: "Copy working directory",
      separatorBefore: true,
      shortcut: "Ctrl+Shift+C",
    },
    {
      icon: Copy,
      label: "Copy session ID",
      shortcut: "Ctrl+Alt+C",
    },
    {
      icon: Copy,
      label: "Copy deeplink",
      shortcut: "Ctrl+Alt+L",
    },
    {
      icon: Copy,
      label: "Copy as Markdown",
    },
    {
      icon: MessageCirclePlus,
      label: "Open side chat",
      separatorBefore: true,
    },
    {
      disabled: true,
      icon: Laptop,
      label: "Fork into local",
    },
    {
      disabled: true,
      icon: GitFork,
      label: "Fork into new worktree",
    },
    {
      disabled: true,
      icon: Clock3,
      label: "Add automation...",
    },
    {
      icon: ExternalLink,
      label: "Open in new window",
      separatorBefore: true,
    },
  ];

  useEffect(() => {
    if (!optionsOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (optionsRef.current?.contains(event.target as Node)) {
        return;
      }

      setOptionsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOptionsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [optionsOpen]);

  function handleMenuItemSelect(item: ConversationMenuItem) {
    if (item.disabled) {
      return;
    }

    item.onSelect?.();
    setOptionsOpen(false);
  }

  return (
    <header className="conversation-header">
      <div className="conversation-title">
        <h1>{title}</h1>
        <div className="conversation-menu-anchor" data-open={optionsOpen} ref={optionsRef}>
          <button
            className="conversation-options-button"
            type="button"
            aria-label="Conversation options"
            aria-haspopup="menu"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((open) => !open)}
          >
            <MoreHorizontal size={20} aria-hidden="true" />
          </button>
          {optionsOpen ? (
            <div className="conversation-options-menu" role="menu" aria-label="Conversation options">
              {menuItems.map((item) => {
                const MenuIcon = item.icon;

                return (
                  <button
                    key={item.label}
                    className="conversation-options-menu-item"
                    data-separator-before={item.separatorBefore}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => handleMenuItemSelect(item)}
                  >
                    <MenuIcon size={20} aria-hidden="true" />
                    <span className="conversation-options-label">{item.label}</span>
                    {item.shortcut ? <span className="conversation-options-shortcut">{item.shortcut}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
      <div className="conversation-tools">
        <IconButton ariaLabel={pinned ? "Unpin chat" : "Pin chat"} icon={Pin} pressed={pinned} onClick={onTogglePin} />
        <IconButton
          ariaLabel={!terminalEnabled ? "Terminal disabled in Toolbox" : terminalOpen ? "Close terminal" : "Open terminal"}
          disabled={!terminalEnabled}
          icon={TerminalSquare}
          pressed={terminalOpen}
          onClick={onToggleTerminal}
        />
        <IconButton
          ariaLabel={!browserPreviewEnabled ? "Browser Preview disabled in Toolbox" : browserPreviewOpen ? "Close browser preview" : "Open browser preview"}
          className="conversation-tool-desktop-only"
          disabled={!browserPreviewEnabled}
          icon={Globe2}
          pressed={browserPreviewOpen}
          onClick={onToggleBrowserPreview}
        />
        <IconButton
          ariaLabel={!inspectorAvailable ? "No conversation details yet" : inspectorOpen ? "Collapse inspector" : "Open inspector"}
          className="conversation-tool-desktop-only"
          disabled={!inspectorAvailable}
          icon={PanelRight}
          pressed={inspectorOpen}
          onClick={onToggleInspector}
        />
      </div>
    </header>
  );
}
