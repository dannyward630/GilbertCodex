# Contributing to Gilbert Codex

Thanks for helping make Gilbert Codex better. This project is early, so the best contributions are focused, easy to review, and careful with local user data.

## Local Setup

Windows is the verified alpha platform. macOS and Linux have partial source support and need contributors on those operating systems to test and finish the port. Read [docs/platform/README.md](docs/platform/README.md) before submitting platform-specific changes.

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

## Project Standards

- Keep UI changes consistent with the existing shell, composer, dialogs, terminal, browser preview, settings, and Toolbox surfaces.
- Keep React code organized by product area: app, pages, components, services, tools, lib, styles, and types.
- Keep Rust host work behind narrow commands and typed modules under `src-tauri/src/commands` or `src-tauri/src/core`.
- Prefer clear file and function names over comments that restate the code.
- Use short single-line comments only for non-obvious decisions; avoid block comments in source files.
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
