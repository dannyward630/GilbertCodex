import { ArrowLeft } from "lucide-react";
import { memo, useMemo } from "react";
import { SidebarSection } from "../../components/sidebar/SidebarSection";
import type { PrimaryRoute } from "../../types/navigation";
import { resolveSettingsNavSection, SETTINGS_NAV_ITEMS } from "./settingsNavigation";
import type { SettingsSectionId } from "./types";

interface SettingsSideMenuProps {
  activeSection: SettingsSectionId;
  locationServicesEnabled: boolean;
  onRouteChange: (route: PrimaryRoute) => void;
  onSectionChange: (section: SettingsSectionId) => void;
  open: boolean;
}

export const SettingsSideMenu = memo(function SettingsSideMenu({ activeSection, locationServicesEnabled, onRouteChange, onSectionChange, open }: SettingsSideMenuProps) {
  const activeNavSection = resolveSettingsNavSection(activeSection);
  const navItems = useMemo(() => SETTINGS_NAV_ITEMS, [locationServicesEnabled]);
  const sidebarItems = useMemo(
    () =>
      navItems.map((item) => ({
        active: activeNavSection === item.id,
        icon: item.icon,
        id: item.id,
        label: item.label,
        meta: item.meta,
        onSelect: (sectionId: string) => onSectionChange(sectionId as SettingsSectionId),
      })),
    [activeNavSection, navItems, onSectionChange],
  );

  return (
    <aside className="shell-sidebar shell-sidebar-settings" data-open={open}>
      <div className="sidebar-primary-actions">
        <button className="sidebar-action" type="button" onClick={() => onRouteChange("chat")}>
          <ArrowLeft size={17} aria-hidden="true" />
          <span>Back to app</span>
        </button>
      </div>

      <div className="sidebar-scroll">
        <SidebarSection
          title="Settings"
          items={sidebarItems}
        />
      </div>
    </aside>
  );
});
