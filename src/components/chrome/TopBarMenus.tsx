import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check } from "lucide-react";

export interface TopBarMenuDefinition<MenuId extends string> {
  id: MenuId;
  label: string;
}

export interface TopBarMenuAction {
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  label: string;
  onPreload?: () => void;
  onSelect: () => void | Promise<void>;
  separatorBefore?: boolean;
  shortcut?: string;
}

interface TopBarMenusProps<MenuId extends string> {
  ariaLabel: string;
  className?: string;
  definitions: TopBarMenuDefinition<MenuId>[];
  menus: Record<MenuId, TopBarMenuAction[]>;
  onOpenMenuChange: (menuId: MenuId | null | ((currentMenu: MenuId | null) => MenuId | null)) => void;
  openMenu: MenuId | null;
}

export function TopBarMenus<MenuId extends string>({
  ariaLabel,
  className,
  definitions,
  menus,
  onOpenMenuChange,
  openMenu,
}: TopBarMenusProps<MenuId>) {
  function handleMenuButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, menuId: MenuId) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenMenuChange(menuId);
    }
  }

  function selectMenuAction(action: TopBarMenuAction) {
    if (action.disabled) {
      return;
    }

    onOpenMenuChange(null);
    void action.onSelect();
  }

  return (
    <nav className={className ? `topbar-menus ${className}` : "topbar-menus"} aria-label={ariaLabel} data-topbar-interactive="true">
      {definitions.map((menu) => (
        <div key={menu.id} className="topbar-menu" onMouseEnter={() => openMenu && onOpenMenuChange(menu.id)}>
          <button
            className="topbar-menu-button"
            type="button"
            aria-haspopup="menu"
            aria-expanded={openMenu === menu.id}
            data-active={openMenu === menu.id}
            data-latency-label={`topbar-menu:${menu.id}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onOpenMenuChange((currentMenu) => (currentMenu === menu.id ? null : menu.id))}
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
                  data-latency-label={`topbar:${menu.id}:${item.label}`}
                  onFocus={item.onPreload}
                  onMouseEnter={item.onPreload}
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
  );
}
