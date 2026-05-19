import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AppearanceMode } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

const appearanceOptions: Array<{ icon: LucideIcon; label: string; value: AppearanceMode }> = [
  { icon: Monitor, label: "System", value: "system" },
  { icon: Moon, label: "Dark", value: "dark" },
  { icon: Sun, label: "Light", value: "light" },
];

interface AppearanceSettingsPageProps {
  appearanceMode: AppearanceMode;
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  showHeading?: boolean;
}

export function AppearanceSettingsPage({ appearanceMode, onAppearanceModeChange, showHeading = true }: AppearanceSettingsPageProps) {
  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="Choose how GilbertCodex follows your display." icon={Monitor} title="Appearance" /> : null}
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Monitor size={19} aria-hidden="true" />
            <div>
              <h2>Theme</h2>
              <p>Match the system theme or pin the app to a mode.</p>
            </div>
          </div>
          <div className="theme-mode-control" role="radiogroup" aria-label="Theme mode">
            {appearanceOptions.map((option) => {
              const Icon = option.icon;
              const selected = option.value === appearanceMode;

              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  data-selected={selected}
                  onClick={() => onAppearanceModeChange(option.value)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </article>
      </div>
    </>
  );
}
