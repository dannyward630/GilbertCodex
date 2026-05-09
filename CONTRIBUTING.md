# Contributing to Gilbert Codex

Thanks for helping make Gilbert Codex better. This project is early, so the best contributions are small, focused, and easy to review.

## Local Setup

```powershell
npm.cmd install
npm.cmd run dev
```

For the full desktop app:

```powershell
npm.cmd run app:dev
```

## Checks

Run these before submitting changes:

```powershell
npm.cmd run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
```

## Project Standards

- Keep UI changes consistent with the existing shell, composer, dialogs, and settings surfaces.
- Prefer clear file and function names over comments that restate the code.
- Keep comments single-purpose and only add them where they explain a non-obvious decision.
- Keep generated output, local logs, dependency folders, and secrets out of commits.
- Use explicit confirmation UI for destructive or high-risk actions.
- Keep the React app organized by product area: app, pages, components, services, lib, styles, and types.
- Keep Rust host work behind narrow commands and typed modules.

## Pull Request Shape

Use a short title and include:

- What changed.
- Why it changed.
- How you tested it.
- Any product or security tradeoffs.

Large rewrites are harder to review in this phase. Split them unless the behavior truly needs to land together.
