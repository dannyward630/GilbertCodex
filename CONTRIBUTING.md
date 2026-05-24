# Contributing to Gilbert Codex

Thanks for helping make Gilbert Codex better. This project is early, so the best contributions are focused, easy to review, and careful with local user data.

## Local Setup

Windows is the verified alpha platform. macOS and Linux are port-ready but still need contributors on those operating systems to test packaged builds and finish native QA. Read [docs/platform/README.md](docs/platform/README.md) before submitting platform-specific changes.

```bash
npm install
npm run dev
```

For the full desktop app:

```bash
npm run app:dev
```

On Windows PowerShell, `npm.cmd` can be used in place of `npm` if script execution policy blocks the shim.

## Checks

Run the full check before submitting changes:

```bash
npm run check
git diff --check
```

The full check expands to:

```bash
npm run build
npm run rust:fmt:check
npm run rust:check
```

## Branch Workflow

Use [Branching And Release Model](docs/BRANCHING.md) and [Contribution Process](docs/CONTRIBUTION_PROCESS.md) for contribution branches, triage, and review lanes.

- Base normal work on `develop`.
- Open feature, fix, docs, and chore pull requests into `develop`.
- Use `testing` only for QA batches promoted from `develop`.
- Merge into `main` only after the `testing` branch has been validated.
- Create `release/*` and `hotfix/*` branches only when the release or urgent fix exists.
- Fill out the pull request template and include commands run.
- Use [docs/ISSUES.md](docs/ISSUES.md) and the issue forms for bugs, alpha tester feedback, feature requests, and platform support reports.

## Project Standards

- Keep UI changes consistent with the existing shell, composer, dialogs, terminal, browser preview, settings, and Toolbox surfaces.
- Keep React code organized by product area: app, pages, components, services, tools, lib, styles, and types.
- Keep Rust host work behind narrow commands and typed modules under `src-tauri/src/commands` or `src-tauri/src/core`.
- Prefer clear file and function names over comments that restate the code.
- Use [Code Documentation Standards](docs/CODE_DOCUMENTATION.md) for public exports, Tauri commands, model/tool contracts, fallback behavior, and security-sensitive boundaries.
- Use short inline comments for non-obvious decisions; avoid long block comments that restate the code.
- Keep generated output, local logs, dependency folders, local databases, provider keys, and secrets out of commits.
- Use explicit confirmation UI for destructive or high-risk actions.
- Treat terminal, file write, and full-computer scope changes as security-sensitive.
- Keep large behavior changes split into reviewable pieces unless the behavior must land together.

## Pull Request Shape

Use a short title and include:

- What changed.
- Why it changed.
- How you tested it.
- Any product, security, or local-data tradeoffs.

If a change touches auth, local files, terminal commands, provider credentials, or tool execution, call that out in the PR description.

If a change claims macOS or Linux support, include the OS version, CPU architecture, packaging result, and the checklist items from [docs/platform/README.md](docs/platform/README.md) that were actually verified.

Maintainers should keep pull requests pointed at the right branch:

- Normal work targets `develop`.
- QA batch promotion targets `testing`.
- Release or hotfix work targets `main`.
