import { RotateCcw, Settings2, Sparkles, Wrench } from "lucide-react";
import { localPermissionModeLabel, localWorkspaceScopeLabel } from "../../../localWorkspace/files";
import type { AppInfo } from "../../../types/app";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import type { ProviderSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";

interface GeneralSettingsPageProps {
  activeProviderLabel: string;
  appInfo: AppInfo;
  showHeading?: boolean;
  localWorkspace: LocalWorkspaceSettings;
  onResetSettings: () => void;
  settings: ProviderSettings;
}

export function GeneralSettingsPage({ activeProviderLabel, appInfo, localWorkspace, onResetSettings, settings, showHeading = true }: GeneralSettingsPageProps) {
  return (
    <>
      {showHeading ? <SettingsSectionHeading detail="App defaults, current runtime, and quick reset controls." icon={Settings2} title="General" /> : null}
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Settings2 size={19} aria-hidden="true" />
            <div>
              <h2>App</h2>
              <p>Current GilbertCodex desktop workspace.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Name</span>
              <strong>{appInfo.name}</strong>
            </div>
            <div className="settings-row">
              <span>Version</span>
              <strong>{appInfo.version}</strong>
            </div>
            <div className="settings-row">
              <span>Runtime</span>
              <strong>{appInfo.runtime}</strong>
            </div>
            <div className="settings-row">
              <span>Phase</span>
              <strong>{appInfo.phase}</strong>
            </div>
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Sparkles size={19} aria-hidden="true" />
            <div>
              <h2>Current model</h2>
              <p>{activeProviderLabel}</p>
            </div>
          </div>
          <div className="settings-stack">
            <strong className="settings-large-value">{settings.model}</strong>
            <span className="settings-subtle-text">
              {settings.thinking.enabled ? "Thinking enabled" : "Thinking off"} - {settings.webSearch.enabled ? "Web on" : "Web off"} - {settings.tools.imageGeneration ? "Images on" : "Images off"}
            </span>
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Wrench size={19} aria-hidden="true" />
            <div>
              <h2>Permissions</h2>
              <p>{localWorkspace.enabled ? `${localWorkspaceScopeLabel(localWorkspace.scope)} - ${localPermissionModeLabel(localWorkspace.permissionMode)}` : "Local tools off"}</p>
            </div>
          </div>
          <button className="settings-ghost-button settings-full-width-button" type="button" onClick={onResetSettings}>
            <RotateCcw size={16} aria-hidden="true" />
            Reset provider settings
          </button>
        </article>
      </div>
    </>
  );
}
