import { CheckCircle2, Copy, ExternalLink, GitBranch, Github, KeyRound, LogIn, ShieldCheck, Trash2, X } from "lucide-react";
import type { GithubConnectionState, GithubDeviceLoginSession, GithubRepository } from "../../../types/github";
import { SettingsSectionHeading } from "../components/SettingsSectionHeading";
import type { SettingsStatusMessage } from "../types";

interface GithubSettingsPageProps {
  accountDetail: string;
  fullAccessScopes: string[];
  githubBusy: boolean;
  githubConnection: GithubConnectionState;
  githubDeviceLogin: GithubDeviceLoginSession | null;
  githubDevicePolling: boolean;
  githubOauthClientId: string;
  githubRepos: GithubRepository[];
  githubRequestedScope: string;
  githubStatus: SettingsStatusMessage | null;
  hasFullGithubAccess: boolean;
  missingGithubScopes: string[];
  onCancelBrowserLogin: () => void;
  onCheckAccess: () => void;
  onCopyUserCode: () => void;
  onDisconnect: () => void;
  onStartBrowserLogin: () => void;
  onUpdateGithubOauthClientId: (clientId: string) => void;
}

export function GithubSettingsPage({
  accountDetail,
  fullAccessScopes,
  githubBusy,
  githubConnection,
  githubDeviceLogin,
  githubDevicePolling,
  githubOauthClientId,
  githubRepos,
  githubRequestedScope,
  githubStatus,
  hasFullGithubAccess,
  missingGithubScopes,
  onCancelBrowserLogin,
  onCheckAccess,
  onCopyUserCode,
  onDisconnect,
  onStartBrowserLogin,
  onUpdateGithubOauthClientId,
}: GithubSettingsPageProps) {
  return (
    <>
      <SettingsSectionHeading detail="Connected source control access, OAuth scopes, repository preview, and token health." icon={Github} title="GitHub" />

      <div className="github-settings-layout">
        <article className="settings-card github-account-card" data-connected={githubConnection.connected}>
          <div className="settings-card-heading github-card-heading">
            <Github size={19} aria-hidden="true" />
            <div>
              <h2>Connection</h2>
              <p>Authorize repositories, workflows, packages, gists, and pull requests from one desktop token.</p>
            </div>
          </div>

          <div className="github-account-hero">
            <span className="github-account-avatar-large" aria-hidden="true">
              {githubConnection.user?.avatarUrl ? <img alt="" src={githubConnection.user.avatarUrl} /> : <Github size={24} />}
            </span>
            <div className="github-account-copy">
              <span className="github-status-pill" data-connected={githubConnection.connected} data-full-access={hasFullGithubAccess}>
                {githubConnection.connected ? (hasFullGithubAccess ? "Full access" : "Reconnect needed") : "Not connected"}
              </span>
              <strong>{githubConnection.connected ? githubConnection.user?.login ?? "GitHub" : "Sign in with GitHub"}</strong>
              <small>{githubConnection.connected ? accountDetail : "Use your browser to authorize source-control access."}</small>
            </div>
          </div>

          {githubConnection.connected && !hasFullGithubAccess ? (
            <div className="github-upgrade-banner" data-kind="warning">
              <div>
                <strong>Reconnect to upgrade GitHub access</strong>
                <span>Current token is missing permissions required for full repository automation.</span>
              </div>
              <div className="github-missing-scopes" aria-label="Missing GitHub OAuth scopes">
                {missingGithubScopes.slice(0, 6).map((scope) => (
                  <code key={scope}>{scope}</code>
                ))}
                {missingGithubScopes.length > 6 ? <code>+{missingGithubScopes.length - 6}</code> : null}
              </div>
            </div>
          ) : null}

          {githubDeviceLogin ? (
            <div className="github-device-login-panel" aria-live="polite">
              <div>
                <span>Enter this code on GitHub</span>
                <strong>{githubDeviceLogin.userCode}</strong>
              </div>
              <div className="github-device-actions">
                <a className="settings-ghost-button" href={githubDeviceLogin.verificationUri} rel="noreferrer" target="_blank">
                  <ExternalLink size={16} aria-hidden="true" />
                  Open GitHub
                </a>
                <button className="settings-ghost-button" type="button" onClick={onCopyUserCode}>
                  <Copy size={16} aria-hidden="true" />
                  Copy code
                </button>
                <button className="settings-ghost-button" type="button" onClick={onCancelBrowserLogin}>
                  <X size={16} aria-hidden="true" />
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div className="settings-actions-row github-action-bar">
            <button className="settings-primary-button github-login-button" type="button" disabled={githubBusy || githubDevicePolling || !githubOauthClientId.trim()} onClick={onStartBrowserLogin}>
              <LogIn size={16} aria-hidden="true" />
              {githubDevicePolling ? "Waiting for GitHub" : githubConnection.connected ? "Reconnect GitHub" : "Continue with GitHub"}
            </button>
            <button className="settings-ghost-button" type="button" disabled={githubBusy || githubDevicePolling} onClick={onCheckAccess}>
              <CheckCircle2 size={16} aria-hidden="true" />
              Check access
            </button>
            <button className="settings-ghost-button" type="button" disabled={githubBusy || githubDevicePolling || !githubConnection.connected} onClick={onDisconnect}>
              <Trash2 size={16} aria-hidden="true" />
              Disconnect
            </button>
          </div>

          {githubStatus ? (
            <div className="github-status-banner" data-kind={githubStatus.kind}>
              {githubStatus.text}
            </div>
          ) : null}
        </article>

        <article className="settings-card github-oauth-card">
          <div className="settings-card-heading github-card-heading">
            <KeyRound size={19} aria-hidden="true" />
            <div>
              <h2>OAuth app</h2>
              <p>{githubConnection.connected ? (hasFullGithubAccess ? "Token has the requested scope set." : "Reconnect after changing scopes.") : "Saved locally for browser sign-in."}</p>
            </div>
          </div>

          <label className="settings-field">
            <span>Client ID</span>
            <input
              autoComplete="off"
              disabled={githubBusy || githubDevicePolling}
              placeholder="Paste GitHub Client ID"
              value={githubOauthClientId}
              onChange={(event) => onUpdateGithubOauthClientId(event.target.value)}
            />
          </label>

          <div className="github-scope-summary">
            <ShieldCheck size={16} aria-hidden="true" />
            <span>Requested scope</span>
            <code title={githubRequestedScope}>{githubRequestedScope}</code>
          </div>

          <div className="github-scope-cloud" aria-label="Requested GitHub OAuth scopes">
            {fullAccessScopes.map((scope) => (
              <code key={scope} data-missing={missingGithubScopes.includes(scope)}>
                {scope}
              </code>
            ))}
          </div>
        </article>

        <article className="settings-card settings-card-wide github-repositories-card">
          <div className="settings-card-heading github-card-heading">
            <GitBranch size={19} aria-hidden="true" />
            <div>
              <h2>Repositories</h2>
              <p>{githubRepos.length > 0 ? "Most recently updated repositories available to Gilbert." : "Connect or check access to load repository previews."}</p>
            </div>
          </div>

          {githubRepos.length > 0 ? (
            <div className="github-repo-grid" aria-label="GitHub repositories">
              {githubRepos.map((repo) => (
                <a href={repo.htmlUrl} key={repo.fullName} rel="noreferrer" target="_blank">
                  <GitBranch size={15} aria-hidden="true" />
                  <span>
                    <strong>{repo.fullName}</strong>
                    <small>
                      {repo.private ? "Private" : "Public"} - {repo.defaultBranch} - {formatRepositoryAccess(repo)}
                    </small>
                    {repo.description ? <em>{repo.description}</em> : null}
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="github-repo-empty">
              <Github size={18} aria-hidden="true" />
              <span>No repository preview loaded.</span>
            </div>
          )}
        </article>
      </div>
    </>
  );
}

function formatRepositoryAccess(repo: GithubRepository) {
  if (repo.permissions.admin) {
    return "Admin";
  }

  if (repo.permissions.push) {
    return "Write";
  }

  if (repo.permissions.pull) {
    return "Read";
  }

  return "Limited";
}
