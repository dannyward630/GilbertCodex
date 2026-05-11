import { AlertTriangle, CheckCircle2, Code2, ExternalLink, FileCog, RotateCcw, Settings2, Wrench } from "lucide-react";
import type { UserConfigInfo, WorkspaceDependencyDiagnostic } from "../../../app/tauriClient";
import { localPermissionModeLabel, localWorkspaceScopeLabel } from "../../../tools/computer/files";
import type { LocalWorkspaceSettings } from "../../../types/localWorkspace";
import type { ProviderSettings } from "../../../types/settings";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface ConfigurationSettingsPageProps {
  configInfo: UserConfigInfo | null;
  configStatus: SettingsStatusMessage | null;
  dependencyBusy: "diagnose" | "reinstall" | null;
  dependencyDiagnostic: WorkspaceDependencyDiagnostic | null;
  dependencyStatus: SettingsStatusMessage | null;
  localWorkspace: LocalWorkspaceSettings;
  onDiagnoseDependencies: () => void;
  onOpenConfig: () => void;
  onReinstallDependencies: () => void;
  onSelectApprovalPolicy: (policy: "never" | "on-request" | "untrusted") => void;
  onSelectSandboxMode: (mode: "danger-full-access" | "read-only" | "workspace-write") => void;
  onSettingsPatch: (settings: Partial<ProviderSettings>) => void;
  settings: ProviderSettings;
}

export function ConfigurationSettingsPage({
  configInfo,
  configStatus,
  dependencyBusy,
  dependencyDiagnostic,
  dependencyStatus,
  localWorkspace,
  onDiagnoseDependencies,
  onOpenConfig,
  onReinstallDependencies,
  onSelectApprovalPolicy,
  onSelectSandboxMode,
  onSettingsPatch,
  settings,
}: ConfigurationSettingsPageProps) {
  const approvalPolicy = localWorkspace.permissionMode === "full-workspace" ? "never" : localWorkspace.permissionMode === "read-only" ? "untrusted" : "on-request";
  const sandboxMode = localWorkspace.permissionMode === "read-only" ? "read-only" : localWorkspace.scope === "full-computer" ? "danger-full-access" : "workspace-write";

  return (
    <>
      <SettingsSectionHeading detail="Configure approval policy, sandbox settings, config.toml, and bundled workspace tools." icon={FileCog} title="Configuration" />
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

        <article className="settings-card">
          <div className="settings-card-heading">
            <Settings2 size={19} aria-hidden="true" />
            <div>
              <h2>Approval policy</h2>
              <p>Choose whether Gilbert pauses before workspace actions.</p>
            </div>
          </div>
          <div className="settings-segmented-control" role="radiogroup" aria-label="Approval policy">
            {[
              { id: "never", label: "Auto approve" },
              { id: "on-request", label: "Ask first" },
              { id: "untrusted", label: "Read only" },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={approvalPolicy === option.id}
                data-selected={approvalPolicy === option.id}
                onClick={() => onSelectApprovalPolicy(option.id as "never" | "on-request" | "untrusted")}
              >
                {option.label}
              </button>
            ))}
          </div>
        </article>

        <article className="settings-card">
          <div className="settings-card-heading">
            <Wrench size={19} aria-hidden="true" />
            <div>
              <h2>Sandbox settings</h2>
              <p>Choose which local roots Gilbert can use.</p>
            </div>
          </div>
          <div className="settings-segmented-control" role="radiogroup" aria-label="Sandbox settings">
            {[
              { id: "read-only", label: "Read only" },
              { id: "workspace-write", label: "Workspace write" },
              { id: "danger-full-access", label: "Full access" },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={sandboxMode === option.id}
                data-selected={sandboxMode === option.id}
                onClick={() => onSelectSandboxMode(option.id as "danger-full-access" | "read-only" | "workspace-write")}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="settings-subtle-text">
            {localWorkspace.enabled ? `${localWorkspaceScopeLabel(localWorkspace.scope)} - ${localPermissionModeLabel(localWorkspace.permissionMode)}` : "Local tools disabled"}
          </span>
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
