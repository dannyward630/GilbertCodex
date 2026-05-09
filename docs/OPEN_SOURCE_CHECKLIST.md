# Open Source Readiness Checklist

Use this checklist before publishing, tagging a release, or inviting outside collaborators.

## Repository Hygiene

- Keep `node_modules/`, `dist/`, `src-tauri/target/`, coverage output, local logs, local databases, and generated runtime caches out of Git.
- Keep `.env`, provider keys, release signing keys, and packaging credentials out of Git.
- Run `git status --short --ignored=matching` and confirm ignored local artifacts are expected.
- Run `git diff --check` before committing.

## Validation

```powershell
npm.cmd run check
git diff --check
```

If a restricted shell blocks Vite config resolution on Windows, rerun `npm.cmd run build` from a normal terminal.

## Source Organization

- Frontend app composition belongs in `src/app`.
- Route-level views belong in `src/pages`.
- Reusable UI belongs in `src/components`, grouped by product area.
- Provider, planning, usage, and search clients belong in `src/services`.
- Browser and local-computer execution helpers belong in `src/tools`.
- Shared contracts belong in `src/types`.
- Rust commands belong in `src-tauri/src/commands`.
- Rust host scaffolding belongs in `src-tauri/src/core`.

## Comment Style

- Prefer clear names over explanatory comments.
- Use short single-line comments only where the code is not self-explanatory.
- Avoid block comments in source files.
- Do not leave TODO, FIXME, debug, or temporary investigation comments in committed code.

## Security Review

- Check that sample text, docs, fixtures, and screenshots do not contain real keys, private paths, customer data, or terminal output.
- Treat auth, terminal, file write, full-computer scope, provider key handling, and tool execution as security-sensitive review areas.
- Keep destructive actions behind explicit confirmation UI.
