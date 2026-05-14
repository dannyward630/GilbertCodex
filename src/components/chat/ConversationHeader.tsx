import { useRef, useState } from "react";
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
  type LucideIcon,
} from "lucide-react";
import { IconButton } from "../common/IconButton";
import { useDismissableLayer } from "../../lib/useDismissableLayer";

interface ConversationHeaderProps {
  browserPreviewOpen: boolean;
  browserPreviewEnabled: boolean;
  inspectorAvailable: boolean;
  inspectorOpen: boolean;
  onAddAutomation: () => void;
  onArchive: () => void;
  onCopyDeeplink: () => void;
  onCopyMarkdown: () => void;
  onCopySessionId: () => void;
  onCopyWorkingDirectory: () => void;
  onForkLocal: () => void;
  onForkWorktree: () => void;
  onOpenNewWindow: () => void;
  onOpenSideChat: () => void;
  onRename: () => void;
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
  onAddAutomation,
  onArchive,
  onCopyDeeplink,
  onCopyMarkdown,
  onCopySessionId,
  onCopyWorkingDirectory,
  onForkLocal,
  onForkWorktree,
  onOpenNewWindow,
  onOpenSideChat,
  onRename,
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
      onSelect: onRename,
      shortcut: "Ctrl+Alt+R",
    },
    {
      icon: Archive,
      label: "Archive chat",
      onSelect: onArchive,
      shortcut: "Ctrl+Shift+A",
    },
    {
      icon: Copy,
      label: "Copy working directory",
      onSelect: onCopyWorkingDirectory,
      separatorBefore: true,
      shortcut: "Ctrl+Shift+C",
    },
    {
      icon: Copy,
      label: "Copy session ID",
      onSelect: onCopySessionId,
      shortcut: "Ctrl+Alt+C",
    },
    {
      icon: Copy,
      label: "Copy deeplink",
      onSelect: onCopyDeeplink,
      shortcut: "Ctrl+Alt+L",
    },
    {
      icon: Copy,
      label: "Copy as Markdown",
      onSelect: onCopyMarkdown,
    },
    {
      icon: MessageCirclePlus,
      label: "Open side chat",
      onSelect: onOpenSideChat,
      separatorBefore: true,
    },
    {
      icon: Laptop,
      label: "Fork into local",
      onSelect: onForkLocal,
    },
    {
      icon: GitFork,
      label: "Fork into new worktree",
      onSelect: onForkWorktree,
    },
    {
      icon: Clock3,
      label: "Add automation...",
      onSelect: onAddAutomation,
    },
    {
      icon: ExternalLink,
      label: "Open in new window",
      onSelect: onOpenNewWindow,
      separatorBefore: true,
    },
  ];

  useDismissableLayer({
    active: optionsOpen,
    onDismiss: () => setOptionsOpen(false),
    refs: [optionsRef],
  });

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
        <h1 key={title}>{title}</h1>
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
        {browserPreviewEnabled ? (
          <IconButton
            ariaLabel={browserPreviewOpen ? "Close browser preview" : "Open browser preview"}
            className="conversation-tool-desktop-only"
            icon={Globe2}
            pressed={browserPreviewOpen}
            onClick={onToggleBrowserPreview}
          />
        ) : null}
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
