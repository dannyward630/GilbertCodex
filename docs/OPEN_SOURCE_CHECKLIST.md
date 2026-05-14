# Open Source Readiness Checklist

Use this checklist before publishing, tagging a release, or inviting outside collaborators.

## Repository Hygiene

- Keep `node_modules/`, `dist/`, `src-tauri/target/`, coverage output, local logs, local databases, generated runtime caches, and local scan artifacts out of Git.
- Keep `.env`, provider keys, release signing keys, and packaging credentials out of Git.
- Run `git status --short --ignored=matching` and confirm ignored local artifacts are expected.
- Run `git diff --check` before committing.

## Contribution Infrastructure

- Keep `.github/ISSUE_TEMPLATE/` forms current for bugs, feature requests, and platform support.
- Keep `.github/PULL_REQUEST_TEMPLATE.md` aligned with the active review process.
- Keep `.github/CODEOWNERS` aligned with maintainer ownership and security-sensitive paths.
- Keep `.github/workflows/ci.yml` passing on `main`, `develop`, and `testing`.
- Keep `.github/dependabot.yml` targeting `develop` so dependency updates follow normal review.
- Protect `main`, `develop`, and `testing` with branch protection or rulesets before inviting outside contributors.

## Validation

```bash
npm run check
git diff --check
```

If a restricted shell blocks Vite config resolution on Windows, rerun `npm.cmd run build` from a normal terminal.

## Platform Support

- Treat Windows x64 as the currently verified alpha target.
- Treat macOS and Linux as partial source support until someone on those operating systems completes the native checklist in [platform/README.md](platform/README.md).
- Do not publish macOS or Linux release artifacts as official unless the packaged app has been launched and tested on that OS.
- When accepting platform fixes, require the OS version, architecture, command output, and remaining limitations in the pull request notes.

## Source Organization

- Frontend app composition belongs in `src/app`.
- Route-level views belong in `src/pages`.
- Reusable UI belongs in `src/components`, grouped by product area.
- Provider, planning, usage, and search clients belong in `src/services`.
- Model-callable local tools are disabled in this reset build; new tool-runtime work should add fresh implementation docs before reintroducing execution helpers.
- Shared contracts belong in `src/types`.
- Rust commands belong in `src-tauri/src/commands`.
- Rust host scaffolding belongs in `src-tauri/src/core`.

## Comment Style

- Prefer clear names over explanatory comments.
- Follow [Code Documentation Standards](CODE_DOCUMENTATION.md) for exported contracts, Tauri commands, model/tool boundaries, and security-sensitive fallback behavior.
- Use TSDoc/JSDoc or Rust doc comments where a public contract would otherwise require reading several files.
- Use short inline comments only where the implementation decision is not self-explanatory.
- Do not leave TODO, FIXME, debug, or temporary investigation comments in committed code.

## Security Review

- Check that sample text, docs, fixtures, screenshots, and generated scan reports do not contain real keys, private paths, customer data, or terminal output.
- Treat auth, terminal, file write, full-computer scope, provider key handling, and tool execution as security-sensitive review areas.
- Keep destructive actions behind explicit confirmation UI.
