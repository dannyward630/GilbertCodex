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
- Scaffold with the app's structured create_vite_project tool for Vite React projects when it is available. If the user explicitly wants an official starter, use `npm create vite@latest . -- --template react` from an already selected fresh project folder; pass a project name only when intentionally creating a child folder. For other stacks, use official starters such as `npx create-next-app@latest` or `npx create-expo-app`. Starter downloads can sit quiet on a cold npm cache, so run them noninteractively and allow about 300 seconds before deciding they failed.
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
- When the user asks to run or view the app, start dev servers yourself with `run_terminal`. `npm run dev`, `vite`, `next dev`, watchers, and hot-reloaders are managed as background terminal sessions; use the returned localhost URL with `open_browser_preview` for verification.
- Know the common dev ports and let `run_terminal` manage collisions: Vite/SvelteKit 5173, Next/React 3000, Astro 4321, Angular 4200, Storybook 6006, Expo 8081. If a preferred port is occupied, the terminal tool selects and passes the next free port. Do not guess uncommon localhost service ports such as 8787 unless the user explicitly asks for that port or a tracked dev-server session printed it.
