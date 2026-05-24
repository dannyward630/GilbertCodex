---
name: github
description: Use when the user asks Gilbert Codex to inspect or operate GitHub repositories, local Git working trees, branches, commits, issues, pull requests, releases, Actions, tags, stats, code search, or advanced GitHub API resources.
---

# GitHub

Use the GitHub plugin for repository workflows that require local Git evidence, connected GitHub account data, or GitHub actions.

## Workflow

1. Check `github_account` before assuming GitHub is installed or connected.
2. For local working-tree questions, call `git_status` before `git_diff`.
3. For repository facts such as stars, forks, open issues, tags, branches, releases, default branch, visibility, or language, use `github_get_repository`, then the relevant list tool.
4. For fuzzy repository or code discovery, use `github_semantic_search` before deeper reads.
5. For code and file questions, search or list the tree before reading full files.
6. For issue work, read or list issues before creating, updating, closing, reopening, labeling, assigning, locking, pinning, transferring, milestone changes, or commenting.
7. For questions about issues completed, done, fixed, resolved, or closed as completed, call `github_list_completed_issues`. It uses `is:issue is:closed reason:completed` instead of the open-issues default.
8. To complete an issue, call `github_close_issue` with `stateReason: "completed"`. Use `not_planned` for won't-fix and `duplicate` for duplicates.
9. For pull request work, list or read pull requests before updating, reviewing, requesting reviewers, updating branches, checking merge state, or merging.
10. For Actions work, list workflows or runs before dispatching, inspecting jobs/artifacts, approving, rerunning, cancelling, force-cancelling, or reviewing pending deployments.
11. For repository health, use the security alert, notification, contributor, commit, compare, fork, star, and watch tools before falling back to generic REST.
12. Use specific tools first. Use `github_api_read`, `github_api_write`, and `github_api_delete` only for GitHub REST resources not covered by a specific tool.

## Tool Guide

- Use `github_account` for install and connection state.
- Use `git_status`, `git_diff`, `git_stage`, `git_commit`, `git_branch`, `git_push`, `git_pull`, and `git_init` for local working trees.
- Use `github_list_repositories`, `github_get_repository`, `github_search_repositories`, `github_list_contributors`, `github_list_stargazers`, `github_list_forks`, `github_create_fork`, `github_star_repository`, `github_unstar_repository`, `github_watch_repository`, and `github_unwatch_repository` for repo inventory, stats, discovery, forks, stars, and subscriptions.
- Use `github_list_branches`, `github_list_tags`, `github_list_tree`, `github_read_file`, `github_search_code`, and `github_semantic_search` for remote branch/file discovery.
- Use `github_create_branch`, `github_list_commits`, `github_get_commit`, `github_compare_refs`, and `github_commit_files` for remote branch and commit work.
- Use `github_search_issues`, `github_list_issues`, `github_list_completed_issues`, `github_get_issue`, `github_list_issue_comments`, `github_create_issue`, `github_update_issue`, `github_close_issue`, `github_reopen_issue`, `github_mark_issue_duplicate`, `github_comment_issue`, `github_update_issue_comment`, `github_delete_issue_comment`, issue labels, assignees, lock, pin, transfer, and milestone tools for issue workflows.
- Use `github_list_pull_requests`, `github_get_pull_request`, PR file/commit/review tools, reviewer tools, `github_update_pull_request`, `github_update_pull_request_branch`, `github_check_pull_request_merged`, and `github_merge_pull_request` for PR workflows.
- Use `github_generate_release_notes`, `github_list_releases`, and `github_create_release` for releases.
- Use `github_list_workflows`, `github_list_workflow_runs`, `github_get_workflow_run`, workflow run jobs/artifacts, approval, dispatch, rerun, cancel, force-cancel, and pending deployment review tools for Actions.
- Use `github_list_code_scanning_alerts`, `github_list_secret_scanning_alerts`, `github_list_dependabot_alerts`, `github_list_notifications`, and notification mutation tools for security and notification workflows.

## Setup

- If GitHub is not connected, tell the user to open Apps > GitHub > Install GitHub or Settings > GitHub.
- Installing GitHub opens the existing GitHub setup path when sign-in is still needed.
- GitHub browser sign-in uses OAuth device flow and a public Client ID; do not ask normal users for a GitHub client secret.

## Safety

- Mutating tools may execute only through the app approval path.
- Use dry runs for high-impact operations when the user asks for a preview or when the requested target is ambiguous.
- Do not push, merge, close issues, reopen issues, change labels/assignees, release, dispatch workflows, approve/rerun/cancel workflows, or call generic write/delete APIs unless the user clearly asked for that action.
- Do not mix local working-tree state with remote GitHub state without saying which one was checked.
- Do not expose tokens, private repo content, or raw API dumps beyond the user's requested scope.

## Response Style

- Separate local Git state from GitHub remote state.
- Include repo names, branch names, issue or PR numbers, run IDs, and URLs when a tool returns them.
- For issue and PR changes, state the exact action taken or awaiting approval.
- For Actions, include status, conclusion, branch, head SHA, run number, and URL when available.
- State when GitHub auth, scopes, SSO, or repository permission blocks the requested action.
