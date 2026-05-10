# GitHub Integration Setup

This guide explains how to connect GitHub to Gilbert Codex for repository browsing, code search, branch reads, API-backed commits, and draft pull requests.

Last verified: May 10, 2026.

## What Gilbert Uses

Gilbert Codex uses a GitHub OAuth App with device-flow browser login. The desktop app stores the resulting GitHub access token locally and sends GitHub operations through the Tauri command layer.

The integration does not require:

- GitHub CLI.
- A local Git clone.
- A GitHub client secret in the desktop app.

The integration does require:

- A public GitHub OAuth App client ID.
- Device flow enabled on that OAuth App.
- A GitHub account that already has permission to the repositories it will operate on.

## Official Links

- Create a GitHub OAuth App: https://docs.github.com/en/developers/apps/creating-an-oauth-app
- Authorizing OAuth Apps and device flow: https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps
- OAuth App scopes: https://docs.github.com/en/developers/apps/scopes-for-oauth-apps
- GitHub webhooks: https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks
- Webhook events and payloads: https://docs.github.com/en/webhooks/webhook-events-and-payloads
- GitHub REST API docs: https://docs.github.com/en/rest
- GitHub Developer settings: https://github.com/settings/developers

## Step 1: Create The OAuth App

1. Sign in to GitHub.

2. Open Developer settings:
   https://github.com/settings/developers

3. Click OAuth Apps.

4. Click New OAuth App.

   If this is your first app, the button may say Register a new application.

5. Fill in:

   - Application name: `Gilbert Codex Local`
   - Homepage URL: your repository URL or project page
   - Application description: optional, public-facing text
   - Authorization callback URL: `http://localhost`

   Gilbert uses device flow, so the callback URL is not used for the normal desktop sign-in. GitHub still requires a value.

6. Enable Device Flow.

7. Click Register application.

8. Copy the Client ID.

Do not copy or commit the client secret. Gilbert Codex does not need it for device-flow login.

## Step 2: Add The Client ID To Local Development

1. In the repository root, create a local `.env` from `.env.example`.

   ```powershell
   Copy-Item .env.example .env
   ```

2. Set the public client ID:

   ```text
   VITE_GITHUB_OAUTH_CLIENT_ID=your_client_id_here
   ```

3. Keep `.env` out of Git. It should remain local.

4. Restart the Vite or Tauri dev server after changing `.env`.

## Step 3: Connect From Gilbert Codex

1. Start the desktop app:

   ```powershell
   npm.cmd run app:dev
   ```

2. Open Settings > GitHub.

3. Confirm the Client ID field is filled.

4. Click Continue with GitHub.

5. Gilbert opens GitHub's device login page or shows a code.

6. In the browser, authorize the app.

7. Return to Gilbert Codex.

8. Wait for the connection status to show the GitHub username.

9. Click Check access.

10. Confirm repository previews load.

## Step 4: Understand The Requested Scopes

Gilbert currently requests a broad scope set so its GitHub tools can support source-control workflows, workflow files, packages, gists, organization metadata, repository hooks, security events, and repository-admin operations when the signed-in user is already allowed to do those things.

Current requested scopes:

```text
repo workflow delete_repo admin:repo_hook admin:org admin:public_key admin:org_hook gist notifications user project write:packages read:packages delete:packages admin:gpg_key codespace read:audit_log security_events
```

Important details:

- Scopes do not grant access beyond the signed-in user's GitHub permissions.
- Users can reduce granted scopes during authorization.
- Settings > GitHub shows missing scopes and asks the user to reconnect if the token is too limited.
- The `repo` scope includes access to private repositories the user can access.
- The `workflow` scope is required for creating or updating GitHub Actions workflow files.
- `admin:repo_hook` and related hook scopes support webhook automation.
- `delete_repo` is powerful and should only be authorized on accounts where repository deletion capability is acceptable.

## Step 5: Use GitHub Tools In Chat

After connecting, ask Gilbert to use GitHub. Examples:

```text
List my repositories.
```

```text
Read README.md from UrbanWafflezz/GilbertCodex on main.
```

```text
Search UrbanWafflezz/GilbertCodex for github_create_pull_request.
```

```text
Create a branch, update docs, and open a draft PR.
```

Mutating operations such as commits and pull requests go through the app's tool approval path when permission mode requires review.

## Supported GitHub Tool Surface

- `github_status`: check connection state.
- `github_list_repositories`: list accessible repositories.
- `github_get_repository`: read repository metadata.
- `github_list_branches`: list branch names and SHAs.
- `github_list_tree`: list files from a branch tree.
- `github_read_file`: read text files from a branch.
- `github_search_code`: search code through GitHub's API.
- `github_create_branch`: create a branch from an existing branch.
- `github_commit_files`: commit one or more files through GitHub's API.
- `github_create_pull_request`: open a draft or ready pull request.

See the broader tool contract in:
../CODING_TOOLS.md

## Repository Webhooks

Use this section when you want GitHub events to call an external service. For Discord channel notifications, see:
../discord/README.md

1. Open the GitHub repository.

2. Go to Settings > Webhooks.

3. Click Add webhook.

4. Enter the Payload URL.

5. Set Content type to `application/json`.

6. Add a high-entropy Secret.

7. Choose only the events the receiver needs.

8. Keep Active checked.

9. Click Add webhook.

10. Open Recent Deliveries to inspect the ping delivery and later deliveries.

GitHub says repository webhooks require repository owner or admin access. Use organization or GitHub App webhooks only when the integration needs broader coverage.

## Security Notes

- Do not commit `.env`.
- Do not commit GitHub OAuth client secrets.
- Do not paste access tokens into issues, docs, examples, or screenshots.
- Use a dedicated OAuth App for local Gilbert development.
- Revoke the OAuth token from GitHub account settings if a machine is lost or shared.
- Reconnect in Settings > GitHub after changing scopes or replacing the OAuth App.
- Move stored access tokens to OS-backed secure storage before a production release.

## Troubleshooting

| Problem | Likely Cause | Fix |
| --- | --- | --- |
| Continue with GitHub is disabled | Client ID is empty | Add `VITE_GITHUB_OAUTH_CLIENT_ID` to `.env`, restart the app, or paste the client ID in Settings > GitHub |
| Device login fails immediately | Device flow is not enabled on the OAuth App | Open the OAuth App settings and enable Device Flow |
| GitHub connects but repositories do not load | Token scopes are reduced, SSO is required, or the account lacks repo access | Click Check access, authorize SSO if needed, or reconnect with full scopes |
| Settings says reconnect needed | Token is missing scopes Gilbert expects | Click Continue with GitHub again and approve the requested scopes |
| GitHub API returns 404 for a private repo | The signed-in account cannot access it or SSO is not authorized | Verify access in GitHub's web UI, then reconnect if needed |
| Workflow file commits fail | Missing `workflow` scope | Reconnect GitHub and approve the workflow scope |
| Webhook creation fails | Missing repo admin permission or wrong hook scope | Use an admin account or reconnect with hook-capable scopes |

## Maintainer Checklist

- Keep `.env.example` limited to public client IDs and non-secret setup values.
- Keep requested scopes in `src/app/githubClient.ts`, Settings UI copy, and this document aligned.
- Keep GitHub token storage notes in `SECURITY.md` current.
- Prefer draft PR creation until richer review cards and diffs are available in the UI.
