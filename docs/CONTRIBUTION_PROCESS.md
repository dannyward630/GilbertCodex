# Contribution Process

This process keeps Gilbert Codex ready for a larger contributor group without making every change feel heavy.

## Intake

Use GitHub issue forms for new work:

- Bug reports must include reproduction steps, operating system, and sanitized evidence.
- Feature requests must describe user behavior and acceptance criteria.
- Platform support reports must include OS version, architecture, commands run, and remaining gaps.

Maintainers should convert broad requests into small issues before assigning them. Prefer one issue per user-visible behavior, platform fix, or documentation gap.

## Branch Lanes

- Contributor work starts from `develop`.
- QA batches move from `develop` to `testing`.
- Releases move from `testing` to `main`.
- Urgent production fixes start from `main` as `hotfix/<short-scope>` and are merged back into `develop`.

Temporary branch prefixes:

- `feature/*`
- `fix/*`
- `docs/*`
- `chore/*`
- `release/*`
- `hotfix/*`

## Pull Request Requirements

Every pull request should include:

- A short summary and reason for the change.
- The correct target branch.
- Commands that were run.
- Manual checks for UI, desktop shell, or platform-sensitive changes.
- Screenshots or recordings for visible UI changes.
- Explicit notes for auth, terminal, file write, provider key, local-data, GitHub, or tool-execution changes.

Normal pull requests target `develop`. Pull requests into `testing` should be promotion or QA fix pull requests. Pull requests into `main` should be release or hotfix pull requests.

## Review Lanes

Use these lanes when triaging:

- Product/UI: chat, composer, shell, settings, Toolbox, inspector, and visible workflow behavior.
- Runtime/tools: provider clients, web search, Git/GitHub, local files, terminal, browser preview, and tool prompts.
- Desktop host: Tauri commands, permissions, notifications, packaging, and native platform behavior.
- Documentation: README, setup docs, integration guides, release notes, and contribution docs.
- Security-sensitive: auth, local data, provider keys, filesystem writes, terminal execution, full-computer scope, and destructive actions.

Security-sensitive changes need a maintainer review even when the code change is small.

## Triage Labels

Use GitHub's default labels first:

- `bug`
- `documentation`
- `enhancement`
- `good first issue`
- `help wanted`
- `question`

Optional project labels to add later:

- `area:chat`
- `area:tools`
- `area:desktop`
- `area:github`
- `area:docs`
- `area:platform`
- `risk:security`
- `risk:local-data`
- `status:needs-repro`
- `status:ready-for-review`
- `status:blocked`

## Maintainer Weekly Flow

1. Triage new issues and assign labels.
2. Confirm pull requests target the right branch.
3. Review small, ready pull requests before broad or speculative work.
4. Merge passing contributor work into `develop`.
5. Promote a stable batch from `develop` into `testing`.
6. Run QA against `testing`.
7. Merge `testing` into `main` for release-ready work.
8. Delete merged temporary branches.

## GitHub Repository Settings

Recommended repository settings:

- Enable Issues.
- Enable Discussions later if support questions outgrow issues.
- Use squash merge as the default merge method for contributor pull requests.
- Automatically delete head branches after pull requests merge.
- Require branch protection or rulesets for `main`, `develop`, and `testing`.
- Require the `frontend-build` and `rust-host` CI checks before merging protected branches.

Rulesets are preferred once the repository has enough contributors because multiple rulesets can apply together and contributors can see active rules without admin access.
