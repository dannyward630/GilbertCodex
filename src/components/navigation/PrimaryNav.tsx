import type { LucideIcon } from "lucide-react";
import type { NavigationItem, PrimaryRoute } from "../../types/navigation";

interface PrimaryNavProps {
  activeRoute: PrimaryRoute;
  icons: Record<PrimaryRoute, LucideIcon>;
  items: NavigationItem[];
  onRouteChange: (route: PrimaryRoute) => void;
}

export function PrimaryNav({ activeRoute, icons, items, onRouteChange }: PrimaryNavProps) {
  return (
    <nav className="primary-nav" aria-label="Primary">
      {items.map((item) => {
        const Icon = icons[item.id];
        const isActive = item.id === activeRoute;

        return (
          <button
            key={item.id}
            className="nav-item"
            data-active={isActive}
            type="button"
            onClick={() => onRouteChange(item.id)}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
