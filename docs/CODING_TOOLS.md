# Coding Tools

Gilbert Codex now has a broader coding tool pack layered on top of local workspace access. These tools are still bounded by selected roots, Toolbox toggles, and permission mode.

## Safety And Files

- `delete_file`: deletes one file only. It refuses folders and requires `confirm_delete=true`.
- `check_duplicate_file`: checks whether one path or a `files_json` batch would collide with existing files.
- `prevent_duplicate_file_create`: returns safe unique path suggestions before a create batch.
- File creation defaults to `overwrite=false`. Use `duplicate_strategy=increment` for safe auto-renaming or `duplicate_strategy=skip` to skip existing files.

## PDF And Inline Editing

- `create_chat_pdf`: creates a PDF from chat text, Markdown, notes, or a supplied transcript.
- `inline_edit`: alias for precise edit behavior with `old_text/new_text`, line ranges, or character ranges.

## Edit Syntax

Use `view_code` before edits when exact placement matters. `edit_file` and `inline_edit` accept these precise forms:

- Exact text: `path`, `old_text`, `new_text`, optional `occurrence`, `replace_all`, and `expected_replacements`.
- Line range: `path`, `start_line`, `end_line`, and `content`. Line numbers are 1-based. Add `expected_text` when the selected lines should match known current text before writing.
- Line insert: `path`, `insert_at_line`, and `content`. `insert_at_line` may be one past the final loaded line to append.
- Character range: `path`, `start_char`, `end_char`, and `content`. Character indexes are 0-based and `end_char` is exclusive. Add `expected_text` when the selected characters should match known current text before writing.

Out-of-range line and character coordinates are rejected so stale edits do not silently move to the wrong place.

Tool results are not clipped by the local tool executor. `read_file`, `view_code`, and `edit_file` load text files up to the desktop runtime safety limit, currently 16 MB, and terminal streaming no longer stops a command because of the old 192 KB live-output cap.

Terminal is for tests, builds, package installs, formatters, command output, project setup checks, and dev servers. Direct source/text writes through shell here-strings, `Set-Content`, `Out-File`, `Tee-Object`, `[IO.File]::WriteAllText`, or redirection are rejected when structured edit tools are enabled. Use `view_code` plus `edit_file`, `write_file`, or `create_files` for source edits so quoting mistakes and stale generated text do not become code.

Edit and write results can include quality warnings for suspicious content, including common CSS typos and 4-digit hex colors. Four-digit CSS hex is valid `#RGBA` alpha shorthand, not a 6-digit opaque color shortcut, so values such as `#fafa` are flagged for review.

## Web And Color Accuracy

- `web_search`: use before answering or coding from current facts, official docs, changelogs, API behavior, package behavior, error messages, brand colors, or external design-system tokens.
- `lookup_color`: uses the CSS Color Module Level 4 named-color database plus the MIT `color-name-list` package for a 30k+ extended color database. It returns HEX, RGB, HSL, aliases, special keywords, exact matches, fuzzy name matches, and nearest named colors.

`lookup_color` is for standardized CSS color names such as `rebeccapurple`, `dodgerblue`, `gray`, and `grey`, plus broad human color names such as `Eigengrau` or nearest matches for arbitrary hex values. For company palettes or app-specific design tokens, use `web_search` against the official source first.

Before adding or changing an AI model ID, use `web_search` for official provider docs and prefer live provider `/models` data when available. OpenRouter model selection now loads its catalog from `https://openrouter.ai/api/v1/models` so model names, context windows, supported parameters, and expired endpoints are not guessed from stale memory.

## Local Git Source Control

Local Git tools run real `git` commands in the selected workspace clone through the same desktop command layer that powers terminal execution. Use these when the user means the current local project, local uncommitted changes, local branches, commits, or pushing the current checkout.

- `git_status`: shows branch, upstream, staged, unstaged, and untracked state.
- `git_diff`: shows `git diff --stat --patch`; use `staged=true` for staged changes or `stat=true` for summary only.
- `git_log`: shows recent commits with `limit`.
- `git_stage`: stages `paths`, `paths_json`, or `all=true`.
- `git_unstage`: unstages `paths`, `paths_json`, or `all=true`.
- `git_commit`: commits staged changes with `message`.
- `git_push`: pushes to `remote` and optional `branch`; supports `set_upstream=true` and `force_with_lease=true`.
- `git_pull`: pulls from `remote` and optional `branch`; supports `rebase=true`.
- `git_fetch`: fetches from `remote`, with `prune=true` by default.
- `git_branch`: lists branches, creates `new_branch` from optional `base`, or deletes `delete_branch`.
- `git_checkout`: switches branches using `git switch`; use `create=true` to create and switch.

Mutating local Git tools are approval-gated in Ask First and Gilbert Review modes, and run without approval prompts in Auto Full mode. Prefer `git_status` and `git_diff` before staging, committing, or pushing.

## GitHub Source Control

GitHub tools run through the desktop Tauri command layer and the connected account in Settings. Users connect with GitHub OAuth device-flow browser login. The tools do not require `git`, GitHub CLI, or a local clone. Browser login requests a full-access OAuth scope bundle by default: `repo`, `workflow`, `delete_repo`, `admin:repo_hook`, `admin:org`, `admin:public_key`, `admin:org_hook`, `gist`, `notifications`, `user`, `project`, package scopes, `admin:gpg_key`, `codespace`, `read:audit_log`, and `security_events`. A signed-in account can still only do what GitHub itself allows for that user, organization, SSO policy, and repository.

Setup guide: [GitHub integration setup](github/README.md).

- `github_status`: checks whether a GitHub account is connected.
- `github_list_repositories`: lists accessible repositories with visibility, default branch, URL, and permissions.
- `github_get_repository`: reads one repository's metadata.
- `github_list_branches`: lists branch names and head SHAs.
- `github_list_tree`: pulls a branch tree from GitHub for remote file discovery.
- `github_read_file`: reads a text file from a repository branch.
- `github_search_code`: searches code through GitHub's API, optionally scoped to one repository.
- `github_create_branch`: creates a branch from the default or named base branch.
- `github_commit_files`: pushes one or more file changes as a real Git commit by creating a Git tree, commit, and branch ref update through GitHub's API.
- `github_create_pull_request`: opens a draft pull request from a head branch to a base branch.
- `github_generate_release_notes`: asks GitHub to generate Markdown release notes for a tag without saving a release.
- `github_create_release`: creates a GitHub release. The tool defaults to draft releases unless `draft=false` is explicitly requested.
- `github_list_releases`: lists releases for a repository, including draft releases when the connected account has access.
- `github_list_workflows`: lists GitHub Actions workflows for a repository.
- `github_dispatch_workflow`: triggers a workflow_dispatch workflow for a selected ref and optional JSON inputs.
- `github_list_workflow_runs`: lists recent runs for a selected workflow.

Mutating GitHub tools are routed through the same approval path as local edits and terminal actions when workspace permission mode requires review. In Auto Full mode, they run without approval prompts inside the enabled workspace/tool boundaries.

## Vectors

- `vector_embed_text`: creates the same style of local hashed embedding summary used by the file index.
- `vector_search`: runs semantic workspace search through the local vector file index.
- `search_files`: searches the local index with hybrid scoring across file names, paths, text previews, and vectors. Results include match kind, matched terms, line hints when a preview line matched, and snippet text.
- `recall_context`: searches loaded `GILBERT.md` project memory files and the same hybrid code index together. Use it for fast codebase orientation, remembered project rules, architecture notes, and finding the right files before editing.

The search path is intentionally both keyword and semantic. This follows the same retrieval pattern used by hosted file-search systems: keyword/name matching catches exact code symbols and filenames, while vector scoring catches nearby concepts when the wording differs.

## Coding Helpers

- `run_tests`: infers a test command from `package.json`, Cargo, or Gradle, or runs an explicit command.
- `typescript_check`: infers TypeScript checking from `package.json` or `tsconfig.json`.
- `create_sql_schema`: creates a SQL schema file.
- `create_sql_migration`: creates a timestamped SQL migration file.
- `create_react_native_screen`: creates a React Native screen component.
- `react_native_setup_check`: reports React Native or Expo signals from `package.json`.
- `create_unit_test`: creates a starter unit-test file.
- `create_api_route`: creates a Next.js or Express-style API route.
- `codebase_health_scan`: summarizes root project signals and recommended checks.
- `dependency_audit`: summarizes dependencies and scripts from `package.json`.

The extra tools are intentionally small and composable. The model should use them before reaching for raw terminal commands when a structured file, check, or report is enough.
