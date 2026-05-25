# GitHub Plugin

Last updated: May 25, 2026 for the v0.8.2 build.

GitHub is a first-party Gilbert Codex plugin for source-control and repository workflows. It reuses the existing Settings > GitHub connection: users install the plugin from Apps, and if GitHub is already connected, the tools are ready immediately. If GitHub is not connected, the install flow sends the user to the existing GitHub settings page for browser sign-in.

Platform note: GitHub actions use the same app command layer on Windows, macOS, and Linux. Windows is verified alpha; macOS and Linux still need packaged-app launch testing for browser handoff, token persistence, local Git helper discovery, and release workflow actions.

## Product Scope

- Check connected GitHub account state without exposing tokens.
- Inspect local working trees through the local Git tools before commits, pushes, and reviews.
- List repositories and read repository stats including stars, forks, open issues, default branch, visibility, language, and URLs.
- List branches, tags, releases, file trees, and remote files.
- Search code and run local vector-ranked semantic discovery over repository metadata and code-search candidates.
- Create remote branches, commit files through GitHub's Git database API, create draft pull requests, and generate release notes.
- Search, list, read, list completed, create, update, complete/close, reopen, mark duplicate, label, assign, lock, pin, transfer, milestone, and comment on issues.
- List, read, update, create, review, request reviewers, inspect files/commits/reviews, update branches, check merge state, and merge pull requests.
- Search repositories and users, list commits, compare refs, list contributors/stargazers/forks, create forks, star/unstar, and watch/unwatch repositories.
- List workflows, list workflow runs, inspect a run, list jobs and artifacts, approve runs, dispatch workflow_dispatch workflows, rerun runs, cancel and force-cancel runs, and review pending deployments.
- Read code scanning, secret scanning, Dependabot alerts, and GitHub notifications, plus mark notification threads/all notifications read.
- Use advanced GitHub REST API tools for resources not covered by a specific tool.

## User Connection Flow

1. Open Apps.
2. Choose GitHub.
3. Click Install GitHub.
4. If GitHub is already connected in Settings > GitHub, the plugin is ready.
5. If GitHub is not connected, Gilbert opens the GitHub settings page so the user can continue with browser/device-flow sign-in.

The user does not paste a GitHub client secret. The desktop OAuth device flow uses the public client ID configured by the build or saved in Settings > GitHub.

## Developer Setup

- Create a GitHub OAuth App with Device Flow enabled.
- Put the public Client ID in `VITE_GITHUB_OAUTH_CLIENT_ID` for local development or paste it in Settings > GitHub.
- Do not commit GitHub tokens, OAuth client secrets, personal access tokens, device codes, or copied authorization output.
- Keep requested scopes aligned with `src/app/githubClient.ts`, `docs/github/README.md`, and this plugin manifest.

Current requested scopes:

- `repo`
- `workflow`
- `delete_repo`
- `admin:repo_hook`
- `admin:org`
- `admin:public_key`
- `admin:org_hook`
- `gist`
- `notifications`
- `user`
- `project`
- `write:packages`
- `read:packages`
- `delete:packages`
- `admin:gpg_key`
- `codespace`
- `read:audit_log`
- `security_events`

## Implementation Notes

- `.codex-plugin/plugin.json` is the user-visible plugin manifest.
- `.app.json` declares the Gilbert GitHub connector boundary, public client ID env key, device-flow sign-in, scopes, and safety contract.
- `.mcp.json` stays empty because GitHub runs through Gilbert Codex's local tool bridge, not a separate MCP server.
- `skills/github/SKILL.md` is the model-facing workflow rulebook.
- `src-tauri/src/commands/github.rs` owns token storage, OAuth device flow, REST normalization, and generic GitHub API calls.
- `src/app/githubClient.ts` owns the frontend command wrapper.
- `src/toolBridge/tools/git/` exposes local Git and GitHub tools to the AI runtime.

## Tool Surface

- Local Git: `git_status`, `git_diff`, `git_stage`, `git_commit`, `git_branch`, `git_push`, `git_pull`, `git_init`
- Account and repositories: `github_account`, `github_list_repositories`, `github_get_repository`
- Branches, tags, files, and search: `github_list_branches`, `github_list_tags`, `github_list_tree`, `github_read_file`, `github_search_code`, `github_semantic_search`, `github_create_branch`, `github_commit_files`
- Issues: search/list/get/comment/create/update/close/reopen/duplicate, comment edit/delete, labels, assignees, lock/unlock, pin/unpin, transfer, and milestones
- Pull requests: list/get/create/update, files, commits, reviews, create review, reviewers, update branch, merge check, and merge
- Repository extras: search repos/users, commits, compare, contributors, stargazers, forks, star/unstar, watch/unwatch
- Releases: `github_generate_release_notes`, `github_list_releases`, `github_create_release`
- Actions: workflows, runs, jobs, artifacts, approve, dispatch, rerun, cancel, force-cancel, pending deployments
- Security and notifications: code scanning, secret scanning, Dependabot alerts, notifications, mark notification read
- Advanced REST: `github_api_read`, `github_api_write`, `github_api_delete`

## Safety Rules

- Read actions can run after GitHub connection when they match the user's current request.
- Local working-tree reviews should call `git_status` before `git_diff`.
- Mutating GitHub tools are approval-gated and support dry-run previews where practical.
- Destructive or high-impact actions such as merge, release creation, workflow cancellation, API delete, and repository-level API changes require explicit approval.
- Never expose tokens, OAuth device codes after authorization, or raw private repository content beyond what the user asked to inspect.
- Prefer the specific GitHub tool before generic API tools.
- Use `github_semantic_search` for fuzzy repository/code discovery; it uses local deterministic embeddings and does not send content to a separate embedding provider.
