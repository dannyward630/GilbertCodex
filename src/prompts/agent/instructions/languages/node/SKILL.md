---
name: node-project
description: Use when the workspace is a Node.js, npm, Yarn, pnpm, Bun, React, Next.js, Vite, Express, or Tauri project, or when the user asks to build, scaffold, run, install, test, or ship a Node-based app.
---

# Node / npm Project Recipe

## Detect first
- Look for `package.json` at the root or in nested workspaces. Read `name`, `scripts`, and `engines.node` before assuming behavior.
- Pick the package manager from lockfiles (highest precedence first): `pnpm-lock.yaml` -> pnpm, `yarn.lock` -> yarn, `bun.lockb` / `bun.lock` -> bun, `package-lock.json` -> npm. If `packageManager` is set in `package.json`, that wins.
- A `workspaces` field or `pnpm-workspace.yaml` means a monorepo. Run package-level commands with `cwd` set to the specific package folder, not the repo root.

## Bootstrap a new project
- Scaffold with the official starter, not a hand-rolled one: `npm create vite@latest`, `npx create-next-app@latest`, `npx create-expo-app`, etc. Use the package manager already detected.
- Install once with the detected manager: `npm install`, `pnpm install`, `yarn install`, or `bun install`. Add packages with `npm install <pkg>` and dev deps with `--save-dev` so the file diff is clear in review.
- Verify the install: confirm `node_modules` exists and the first `npm run build` or `npm run typecheck` passes before adding more dependencies.

## Run the right thing
- Prefer existing `npm run` scripts over reinventing commands. Common names: `dev`, `build`, `start`, `test`, `typecheck`, `lint`, `format`, `preview`.
- `npm run` puts `node_modules/.bin` on PATH, so package-local CLIs work without `npx`. Set `cwd` to the package folder so script paths resolve correctly.
- For one-shots, `npx <cli>` works without polluting deps; pass `--yes` in scripts so it does not prompt.

## Windows shell pitfalls
- PowerShell 5.1 has no `&&`. Chain with `;` plus `if ($?) { ... }`, or run each step as its own tool call.
- PowerShell parses `@`, `-`, and unquoted arguments aggressively. Use `--%` to stop further parsing when passing flags like `--format=%H` to git.
- Cross-env vars: use `set NODE_ENV=production && ...` in cmd, `$env:NODE_ENV = "production"; ...` in PowerShell, or add the `cross-env` package for portable scripts.
- Long-path support is off by default on Windows. If installs fail with `ENAMETOOLONG`, enable `core.longpaths` (git) or `LongPathsEnabled` (registry) instead of trying to flatten paths.
- Line endings: respect the project's `.gitattributes` and existing files. Do not normalize CRLF/LF as a side effect of an edit.

## Verify before saying it works
- Type and build first: `npm run typecheck`, `npm run build`, or whatever the project exposes. Tests next: `npm test`, `npm run test`, or `npm run test -- --run` for Vitest.
- For dev servers, start with `run_terminal` background, then `open_browser_preview` on the printed localhost URL to confirm it renders. Read the terminal output for actual errors instead of trusting the exit code alone.
