import { UserRoundCog } from "lucide-react";
import type { ProviderSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface PersonalizationSettingsPageProps {
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  settings: ProviderSettings;
  showHeading?: boolean;
}

export function PersonalizationSettingsPage({ onSettingsPatch, settings, showHeading = true }: PersonalizationSettingsPageProps) {
  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="User instructions and user-controlled app personalization." icon={UserRoundCog} title="Personalization" /> : null}
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <UserRoundCog size={19} aria-hidden="true" />
            <div>
              <h2>User instructions</h2>
              <p>Applied after the base assistant profile for every chat, planning run, and regeneration.</p>
            </div>
          </div>
          <label className="settings-field settings-field-tall">
            <span>Instructions</span>
            <textarea
              rows={9}
              placeholder="Example: Prefer concise answers. When editing code, explain only the important changes and tests."
              value={settings.userInstructions}
              onChange={(event) => onSettingsPatch({ userInstructions: event.target.value })}
            />
          </label>
        </article>
      </div>
    </>
  );
}
