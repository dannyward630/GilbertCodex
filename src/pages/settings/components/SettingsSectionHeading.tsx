import type { LucideIcon } from "lucide-react";

interface SettingsSectionHeadingProps {
  detail: string;
  icon: LucideIcon;
  title: string;
}

export function SettingsSectionHeading({ detail, icon: Icon, title }: SettingsSectionHeadingProps) {
  return (
    <header className="settings-section-heading">
      <div className="settings-section-icon" aria-hidden="true">
        <Icon size={20} />
      </div>
      <div>
        <h1 id="settings-section-title">{title}</h1>
        <p>{detail}</p>
      </div>
    </header>
  );
}
