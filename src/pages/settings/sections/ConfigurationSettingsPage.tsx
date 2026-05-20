import { AlertTriangle, CheckCircle2, Code2, ExternalLink, FileCog, RotateCcw } from "lucide-react";
import type { UserConfigInfo, WorkspaceDependencyDiagnostic } from "../../../app/tauriClient";
import type { ProviderSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface ConfigurationSettingsPageProps {
  configInfo: UserConfigInfo | null;
  configStatus: SettingsStatusMessage | null;
  dependencyBusy: "diagnose" | "reinstall" | null;
  dependencyDiagnostic: WorkspaceDependencyDiagnostic | null;
  dependencyStatus: SettingsStatusMessage | null;
  onDiagnoseDependencies: () => void;
  onOpenConfig: () => void;
  onReinstallDependencies: () => void;
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  settings: ProviderSettings;
}

export function ConfigurationSettingsPage({
  configInfo,
  configStatus,
  dependencyBusy,
  dependencyDiagnostic,
  dependencyStatus,
  onDiagnoseDependencies,
  onOpenConfig,
  onReinstallDependencies,
  onSettingsPatch,
  settings,
}: ConfigurationSettingsPageProps) {
  return (
    <>
      <SettingsSectionHeading detail="Config file health and bundled workspace tools." icon={FileCog} title="Configuration" />
      <div className="settings-section-grid">
        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <AlertTriangle size={19} aria-hidden="true" />
            <div>
              <h2>Custom config.toml settings</h2>
              <p>[features].codex_hooks is deprecated. Use [features].hooks instead.</p>
            </div>
          </div>
          <div className="settings-warning">
            <span>
              Enable hooks with <code>--enable hooks</code> or <code>[features].hooks</code> in config.toml.
            </span>
            <a href="https://developers.openai.com/codex/config-basic#feature-flags" rel="noreferrer" target="_blank">
              Learn more
            </a>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>User config</span>
              <strong>{configInfo?.path ?? "config.toml"}</strong>
              <button className="settings-ghost-button" type="button" onClick={onOpenConfig}>
                <ExternalLink size={16} aria-hidden="true" />
                Open config.toml
              </button>
            </div>
          </div>
          {configStatus ? (
            <div className="settings-status-banner" data-kind={configStatus.kind}>
              {configStatus.text}
            </div>
          ) : null}
        </article>

        <article className="settings-card settings-card-wide">
          <div className="settings-card-heading">
            <Code2 size={19} aria-hidden="true" />
            <div>
              <h2>Workspace Dependencies</h2>
              <p>Bundled Node.js and Python tools exposed to workspace tasks.</p>
            </div>
          </div>
          <div className="settings-row-list">
            <div className="settings-row">
              <span>Current version</span>
              <strong>{dependencyDiagnostic?.version ?? "Unknown"}</strong>
            </div>
            <div className="settings-row">
              <span>Codex dependencies</span>
              <strong>{settings.workspaceDependencies.enabled ? "Enabled" : "Disabled"}</strong>
              <button
                className="settings-switch"
                type="button"
                role="switch"
                aria-checked={settings.workspaceDependencies.enabled}
                data-on={settings.workspaceDependencies.enabled}
                onClick={() =>
                  onSettingsPatch({
                    workspaceDependencies: {
                      ...settings.workspaceDependencies,
                      enabled: !settings.workspaceDependencies.enabled,
                    },
                  })
                }
              >
                <span />
              </button>
            </div>
            <div className="settings-row">
              <span>Diagnose issues in Codex Workspace</span>
              <strong>Checks the current bundle and records diagnostic logs</strong>
              <button className="settings-ghost-button" type="button" disabled={dependencyBusy !== null} onClick={onDiagnoseDependencies}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {dependencyBusy === "diagnose" ? "Checking" : "Diagnose"}
              </button>
            </div>
            <div className="settings-row">
              <span>Reset and install Workspace</span>
              <strong>Verifies the host-managed bundle and reports repair state</strong>
              <button className="settings-ghost-button" type="button" disabled={dependencyBusy !== null} onClick={onReinstallDependencies}>
                <RotateCcw size={16} aria-hidden="true" />
                {dependencyBusy === "reinstall" ? "Checking" : "Reinstall"}
              </button>
            </div>
          </div>
          {dependencyStatus ? (
            <div className="settings-status-banner" data-kind={dependencyStatus.kind}>
              {dependencyStatus.text}
            </div>
          ) : null}
          {dependencyDiagnostic ? (
            <div className="settings-diagnostic">
              <code>Node: {dependencyDiagnostic.nodeVersion ?? "missing"}</code>
              <code>Python: {dependencyDiagnostic.pythonVersion ?? "missing"}</code>
              {dependencyDiagnostic.codexVersion ? <code>Codex: {dependencyDiagnostic.codexVersion}</code> : null}
            </div>
          ) : null}
        </article>
      </div>
    </>
  );
}
