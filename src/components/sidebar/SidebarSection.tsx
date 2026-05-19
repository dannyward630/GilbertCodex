import { ChevronRight, MoreHorizontal } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { useDismissableLayer } from "../../lib/useDismissableLayer";

export type SidebarItemActivity = "queued" | "waiting" | "working";

interface SidebarMenuItem {
  danger?: boolean;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

interface SidebarItem {
  active?: boolean;
  activity?: SidebarItemActivity;
  activityLabel?: string;
  children?: SidebarItem[];
  expanded?: boolean;
  icon?: LucideIcon;
  id: string;
  label: string;
  menuItems?: SidebarMenuItem[];
  meta?: string;
  onQuickAction?: (id: string) => void;
  onSelect?: (id: string) => void;
  quickActionIcon?: LucideIcon;
  quickActionLabel?: string;
}

interface SidebarSectionProps {
  actionIcon?: LucideIcon;
  actionLabel?: string;
  emptyMessage?: string;
  items: SidebarItem[];
  onAction?: () => void;
  onSecondaryAction?: () => void;
  secondaryActionLabel?: string;
  secondaryIcon?: LucideIcon;
  title: string;
}

export const SidebarSection = memo(function SidebarSection({
  actionIcon: ActionIcon,
  actionLabel,
  emptyMessage,
  items,
  onAction,
  onSecondaryAction,
  secondaryActionLabel,
  secondaryIcon: SecondaryIcon,
  title,
}: SidebarSectionProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const dismissableRefs = useMemo(() => [sectionRef], []);
  const dismissMenu = useCallback(() => setOpenMenuId(null), []);
  const sectionTitleId = useMemo(() => `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-section`, [title]);

  useDismissableLayer({
    active: openMenuId !== null,
    onDismiss: dismissMenu,
    refs: dismissableRefs,
  });

  function renderItem(item: SidebarItem, depth = 0) {
    const Icon = item.icon;
    const QuickActionIcon = item.quickActionIcon;
    const childItems = item.children ?? [];
    const hasChildren = childItems.length > 0;
    const hasMenu = Boolean(item.menuItems?.length);
    const hasQuickAction = Boolean(QuickActionIcon && item.onQuickAction);
    const menuOpen = openMenuId === item.id;
    const activityLabel = item.activityLabel ?? (item.activity ? formatActivityLabel(item.activity) : undefined);

    return (
      <div key={item.id} className="sidebar-list-group" data-depth={depth}>
        <div className="sidebar-list-row" data-active={item.active} data-activity={item.activity} data-depth={depth} data-has-menu={hasMenu} data-menu-open={menuOpen}>
          <button
            className="sidebar-list-item"
            type="button"
            aria-label={activityLabel ? `${item.label}, ${activityLabel}` : undefined}
            aria-expanded={hasChildren ? item.expanded : undefined}
            onClick={() => item.onSelect?.(item.id)}
          >
            <span className="sidebar-list-label">
              {hasChildren ? (
                <ChevronRight className="sidebar-disclosure-icon" data-open={item.expanded} size={14} aria-hidden="true" />
              ) : null}
              {Icon ? <Icon size={16} aria-hidden="true" /> : null}
              {item.activity ? (
                <span className="sidebar-activity-dot" data-activity={item.activity} title={activityLabel} aria-hidden="true" />
              ) : null}
              <span>{item.label}</span>
            </span>
            {item.meta ? <span className="sidebar-meta">{item.meta}</span> : null}
          </button>
          {hasQuickAction || hasMenu ? (
            <div className="sidebar-row-actions">
              {hasQuickAction && QuickActionIcon ? (
                <button
                  className="sidebar-item-quick-action"
                  type="button"
                  aria-label={item.quickActionLabel ?? item.label}
                  onClick={(event) => {
                    event.stopPropagation();
                    item.onQuickAction?.(item.id);
                  }}
                >
                  <QuickActionIcon size={15} aria-hidden="true" />
                </button>
              ) : null}
              {hasMenu ? (
                <div className="sidebar-item-menu-wrap">
                  <button
                    className="sidebar-item-menu-button"
                    type="button"
                    aria-label={`${item.label} options`}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={(event) => {
                      event.stopPropagation();
                      setOpenMenuId((currentId) => (currentId === item.id ? null : item.id));
                    }}
                  >
                    <MoreHorizontal size={15} aria-hidden="true" />
                  </button>
                  {menuOpen ? (
                    <div
                      className="sidebar-item-menu"
                      role="menu"
                      aria-label={`${item.label} options`}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      {item.menuItems?.map((menuItem) => {
                        const MenuIcon = menuItem.icon;

                        return (
                          <button
                            key={menuItem.label}
                            type="button"
                            role="menuitem"
                            data-danger={menuItem.danger}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenMenuId(null);
                              menuItem.onSelect();
                            }}
                          >
                            <MenuIcon size={14} aria-hidden="true" />
                            <span>{menuItem.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        {hasChildren && item.expanded ? <div className="sidebar-sublist">{childItems.map((child) => renderItem(child, depth + 1))}</div> : null}
      </div>
    );
  }

  return (
    <section ref={sectionRef} className="sidebar-section" aria-labelledby={sectionTitleId}>
      <div className="sidebar-section-header">
        <h2 id={sectionTitleId}>{title}</h2>
        <div className="section-actions">
          {ActionIcon && onAction ? (
            <button type="button" aria-label={actionLabel ?? title} onClick={onAction}>
              <ActionIcon size={15} aria-hidden="true" />
            </button>
          ) : null}
          {SecondaryIcon && onSecondaryAction ? (
            <button type="button" aria-label={secondaryActionLabel ?? title} onClick={onSecondaryAction}>
              <SecondaryIcon size={15} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="sidebar-list">
        {items.length > 0 ? items.map((item) => renderItem(item)) : emptyMessage ? <p className="sidebar-empty-state">{emptyMessage}</p> : null}
      </div>
    </section>
  );
});

function formatActivityLabel(activity: SidebarItemActivity) {
  if (activity === "waiting") {
    return "Needs review";
  }

  if (activity === "queued") {
    return "Queued";
  }

  return "Working";
}
