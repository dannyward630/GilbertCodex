import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  GitFork,
  Globe2,
  Laptop,
  MessageCirclePlus,
  MoreHorizontal,
  Pencil,
  Play,
  SquareTerminal,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { IconButton } from "../common/IconButton";
import { ProjectOpenIcon } from "../project/ProjectOpenIcon";
import { useDismissableLayer } from "../../lib/useDismissableLayer";
import { formatShortcutForPlatform, getHostPlatform, isMacHostPlatform } from "../../lib/hostPlatform";
import { getProjectOpenTargetsForPlatform, type ProjectOpenTarget, type ProjectOpenTargetId } from "../../types/projectOpen";

interface ConversationHeaderProps {
  active: boolean;
  browserPreviewOpen: boolean;
  browserPreviewEnabled: boolean;
  codingSidecarOpen: boolean;
  onAddAutomation: () => void;
  onArchive: () => void;
  onCopyDeeplink: () => void;
  onCopyMarkdown: () => void;
  onCopySessionId: () => void;
  onCopyWorkingDirectory: () => void;
  onForkLocal: () => void;
  onForkWorktree: () => void;
  onOpenNewWindow: () => void;
  onOpenProjectTool: (target: ProjectOpenTargetId) => void | Promise<void>;
  onOpenProjectRun: () => void;
  onOpenSideChat: () => void;
  onRename: () => void;
  onToggleCodingSidecar: () => void;
  onToggleBrowserPreview: () => void;
  onToggleTerminal: () => void;
  projectOpenEnabled: boolean;
  projectOpenVisible: boolean;
  recommendedProjectOpenTarget: ProjectOpenTarget;
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

interface WorkspaceToolMenuItem {
  active?: boolean;
  detail: string;
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

export function ConversationHeader({
  active,
  browserPreviewOpen,
  browserPreviewEnabled,
  codingSidecarOpen,
  onAddAutomation,
  onArchive,
  onCopyDeeplink,
  onCopyMarkdown,
  onCopySessionId,
  onCopyWorkingDirectory,
  onForkLocal,
  onForkWorktree,
  onOpenNewWindow,
  onOpenProjectTool,
  onOpenProjectRun,
  onOpenSideChat,
  onRename,
  onToggleCodingSidecar,
  onToggleBrowserPreview,
  onToggleTerminal,
  projectOpenEnabled,
  projectOpenVisible,
  recommendedProjectOpenTarget,
  terminalEnabled,
  terminalOpen,
  title,
}: ConversationHeaderProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [projectOpenMenuOpen, setProjectOpenMenuOpen] = useState(false);
  const [workspaceToolsOpen, setWorkspaceToolsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);
  const projectOpenRef = useRef<HTMLDivElement>(null);
  const workspaceToolsRef = useRef<HTMLDivElement>(null);
  const hostPlatform = getHostPlatform();
  const isMac = isMacHostPlatform(hostPlatform);
  const shortcut = (value: string) => formatShortcutForPlatform(value, hostPlatform);
  const projectOpenTargets = [
    recommendedProjectOpenTarget,
    ...getProjectOpenTargetsForPlatform(hostPlatform).filter((target) => target.id !== recommendedProjectOpenTarget.id),
  ];
  const menuItems: ConversationMenuItem[] = [
    {
      icon: Pencil,
      label: "Rename chat",
      onSelect: onRename,
      shortcut: shortcut("Ctrl+Alt+R"),
    },
    {
      icon: Archive,
      label: "Archive chat",
      onSelect: onArchive,
      shortcut: shortcut("Ctrl+Shift+A"),
    },
    {
      icon: Copy,
      label: "Copy working directory",
      onSelect: onCopyWorkingDirectory,
      separatorBefore: true,
      shortcut: shortcut("Ctrl+Shift+C"),
    },
    {
      icon: Copy,
      label: "Copy session ID",
      onSelect: onCopySessionId,
      shortcut: shortcut("Ctrl+Alt+C"),
    },
    {
      icon: Copy,
      label: "Copy deeplink",
      onSelect: onCopyDeeplink,
      shortcut: shortcut("Ctrl+Alt+L"),
    },
    {
      icon: Copy,
      label: "Copy as Markdown",
      onSelect: onCopyMarkdown,
      shortcut: shortcut("Ctrl+Alt+M"),
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
      label: "Create task from this chat",
      onSelect: onAddAutomation,
    },
    {
      icon: ExternalLink,
      label: "Open in new window",
      onSelect: onOpenNewWindow,
      separatorBefore: true,
    },
  ];
  const workspaceToolItems: WorkspaceToolMenuItem[] = [
    {
      active: terminalOpen,
      detail: "Integrated command output and local project sessions.",
      disabled: !terminalEnabled,
      icon: SquareTerminal,
      label: terminalOpen ? "Hide terminal" : "Open terminal",
      onSelect: onToggleTerminal,
    },
    {
      active: browserPreviewOpen,
      detail: "Preview local pages and inspect browser console output.",
      disabled: !browserPreviewEnabled,
      icon: Globe2,
      label: browserPreviewOpen ? "Close browser" : "Open browser",
      onSelect: onToggleBrowserPreview,
    },
    ...(projectOpenVisible
      ? [
          {
            active: codingSidecarOpen,
            detail: "Project map, evidence, tool health, and review panels.",
            icon: Workflow,
            label: codingSidecarOpen ? "Close Bridge-first coding" : "Bridge-first coding",
            onSelect: onToggleCodingSidecar,
          },
        ]
      : []),
  ];
  const workspaceToolActive = workspaceToolItems.some((item) => item.active);

  useDismissableLayer({
    active: optionsOpen,
    onDismiss: () => setOptionsOpen(false),
    refs: [optionsRef],
  });

  useDismissableLayer({
    active: projectOpenMenuOpen,
    onDismiss: () => setProjectOpenMenuOpen(false),
    refs: [projectOpenRef],
  });

  useDismissableLayer({
    active: workspaceToolsOpen,
    onDismiss: () => setWorkspaceToolsOpen(false),
    refs: [workspaceToolsRef],
  });

  useEffect(() => {
    if (!projectOpenVisible && projectOpenMenuOpen) {
      setProjectOpenMenuOpen(false);
    }
  }, [projectOpenMenuOpen, projectOpenVisible]);

  function handleMenuItemSelect(item: ConversationMenuItem) {
    if (item.disabled) {
      return;
    }

    item.onSelect?.();
    setOptionsOpen(false);
  }

  function handleProjectToolSelect(target: ProjectOpenTargetId) {
    if (!projectOpenEnabled) {
      return;
    }

    void onOpenProjectTool(target);
    setProjectOpenMenuOpen(false);
  }

  function handleProjectOpenMenuToggle() {
    setProjectOpenMenuOpen((open) => !open);
  }

  function handleWorkspaceToolSelect(item: WorkspaceToolMenuItem) {
    if (item.disabled) {
      return;
    }

    item.onSelect();
    setWorkspaceToolsOpen(false);
  }

  useEffect(() => {
    if (!active) {
      return;
    }

    function handleShortcut(event: KeyboardEvent) {
      if (event.defaultPrevented || isEditableShortcutTarget(event.target)) {
        return;
      }

      const shortcuts: Array<{ alt?: boolean; key: string; onSelect: () => void; shift?: boolean }> = [
        { alt: true, key: "r", onSelect: onRename },
        { key: "a", onSelect: onArchive, shift: true },
        { key: "c", onSelect: onCopyWorkingDirectory, shift: true },
        { alt: true, key: "c", onSelect: onCopySessionId },
        { alt: true, key: "l", onSelect: onCopyDeeplink },
        { alt: true, key: "m", onSelect: onCopyMarkdown },
      ];
      const match = shortcuts.find((candidate) => matchesHeaderShortcut(event, candidate, isMac));

      if (!match) {
        return;
      }

      event.preventDefault();
      match.onSelect();
      setOptionsOpen(false);
      setProjectOpenMenuOpen(false);
      setWorkspaceToolsOpen(false);
    }

    window.addEventListener("keydown", handleShortcut);

    return () => window.removeEventListener("keydown", handleShortcut);
  }, [active, isMac, onArchive, onCopyDeeplink, onCopySessionId, onCopyWorkingDirectory, onRename]);

  return (
    <header className="conversation-header">
      <div className="conversation-title">
        <div className="conversation-title-copy">
          <h1 key={title}>{title}</h1>
        </div>
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
      <div className="conversation-tools" aria-label="Conversation tools">
        <div className="conversation-action-group conversation-action-group-primary">
          {projectOpenVisible ? (
            <>
              <IconButton className="conversation-tool-run" ariaLabel="Run project" icon={Play} onClick={onOpenProjectRun} />
              <div className="project-open-control" data-open={projectOpenMenuOpen} ref={projectOpenRef}>
                <button
                  className="project-open-main"
                  type="button"
                  aria-label={`Open project in ${recommendedProjectOpenTarget.label}`}
                  title={
                    projectOpenEnabled
                      ? `Open project in ${recommendedProjectOpenTarget.label}`
                      : "Choose a project folder to open it in an editor"
                  }
                  disabled={!projectOpenEnabled}
                  onClick={() => handleProjectToolSelect(recommendedProjectOpenTarget.id)}
                >
                  <ProjectOpenIcon color={recommendedProjectOpenTarget.brandColor} size={18} target={recommendedProjectOpenTarget.id} />
                </button>
                <button
                  className="project-open-menu-button"
                  type="button"
                  aria-label="Choose project app"
                  aria-haspopup="menu"
                  aria-expanded={projectOpenMenuOpen}
                  title="Choose project app"
                  disabled={!projectOpenEnabled}
                  onClick={handleProjectOpenMenuToggle}
                >
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
                {projectOpenMenuOpen ? (
                  <div className="project-open-menu" role="menu" aria-label="Open project in app">
                    {projectOpenTargets.map((target) => {
                      const recommended = target.id === recommendedProjectOpenTarget.id;

                      return (
                        <button
                          key={target.id}
                          className="project-open-menu-item"
                          data-recommended={recommended}
                          type="button"
                          role="menuitem"
                          title={`Open project in ${target.label}`}
                          onClick={() => handleProjectToolSelect(target.id)}
                        >
                          <ProjectOpenIcon color={target.brandColor} size={22} target={target.id} />
                          <span className="project-open-menu-copy">
                            <strong>
                              {target.label}
                              {recommended ? <em>Recommended</em> : null}
                            </strong>
                            <small>{target.detail}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          <div className="workspace-tools-control" data-open={workspaceToolsOpen} ref={workspaceToolsRef}>
            <button
              className="workspace-tools-trigger"
              type="button"
              aria-label="Open workspace tools"
              aria-haspopup="menu"
              aria-expanded={workspaceToolsOpen}
              data-active={workspaceToolActive}
              title="Workspace tools"
              onClick={() => setWorkspaceToolsOpen((open) => !open)}
            >
              <ChevronDown size={17} aria-hidden="true" />
            </button>
            {workspaceToolsOpen ? (
              <div className="workspace-tools-menu" role="menu" aria-label="Workspace tools">
                {workspaceToolItems.map((item) => {
                  const ToolIcon = item.icon;

                  return (
                    <button
                      key={item.label}
                      className="workspace-tools-menu-item"
                      data-active={item.active}
                      type="button"
                      role="menuitem"
                      aria-pressed={item.active}
                      disabled={item.disabled}
                      onClick={() => handleWorkspaceToolSelect(item)}
                    >
                      <ToolIcon size={20} aria-hidden="true" />
                      <span className="workspace-tools-menu-copy">
                        <strong>{item.label}</strong>
                        <small>{item.disabled ? "Unavailable in this mode." : item.detail}</small>
                      </span>
                      <span className="workspace-tools-status" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}

function matchesHeaderShortcut(
  event: KeyboardEvent,
  shortcut: { alt?: boolean; key: string; shift?: boolean },
  isMac: boolean,
) {
  const primaryPressed = isMac ? event.metaKey : event.ctrlKey;

  return (
    primaryPressed &&
    event.altKey === Boolean(shortcut.alt) &&
    event.shiftKey === Boolean(shortcut.shift) &&
    event.key.toLowerCase() === shortcut.key.toLowerCase()
  );
}

function isEditableShortcutTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();

  return tagName === "input" || tagName === "textarea" || tagName === "select";
}
