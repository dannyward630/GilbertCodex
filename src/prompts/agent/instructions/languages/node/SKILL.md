---
name: node-project
description: Use when the workspace is a Node.js, npm, Yarn, pnpm, Bun, React, Next.js, Vite, Express, or Tauri project, or when the user asks to build, scaffold, run, install, test, or ship a Node-based app.
---

# Node / npm Project Recipe

## Detect first
- Use attached workspace context when it includes `package.json`, lockfiles, scripts, or framework clues. If those details are missing, ask for them instead of inventing them.
- Pick the package manager from lockfiles (highest precedence first): `pnpm-lock.yaml` -> pnpm, `yarn.lock` -> yarn, `bun.lockb` / `bun.lock` -> bun, `package-lock.json` -> npm. If `packageManager` is set in `package.json`, that wins.
- A `workspaces` field or `pnpm-workspace.yaml` means a monorepo. Run package-level commands with `cwd` set to the specific package folder, not the repo root.

## Bootstrap a new project
- Use attached terminal tools when they are available. If terminal access is not attached, provide the exact starter command only when the user is asking for guidance, and do not claim it was run.
- Common starters include `npm create vite@latest . -- --template react`, `npx create-next-app@latest`, and `npx create-expo-app`.
- Install once with the detected manager: `npm install`, `pnpm install`, `yarn install`, or `bun install`. Add packages with `npm install <pkg>` and dev deps with `--save-dev` so the file diff is clear in review.
- Verification requires attached tool output or user-provided command output.

## Run the right thing
- Prefer existing `npm run` scripts over reinventing commands. Common names: `dev`, `build`, `start`, `test`, `typecheck`, `lint`, `format`, `preview`.
- `npm run` puts `node_modules/.bin` on PATH, so package-local CLIs work without `npx`. Set `cwd` to the package folder so script paths resolve correctly.
- For one-shots, `npx <cli>` works without polluting deps; pass `--yes` in scripts so it does not prompt.

## Windows shell pitfalls
- PowerShell 5.1 has no `&&`. Chain with `;` plus `if ($?) { ... }`, or run each step separately.
- PowerShell parses `@`, `-`, and unquoted arguments aggressively. Use `--%` to stop further parsing when passing flags like `--format=%H` to git.
- Cross-env vars: use `set NODE_ENV=production && ...` in cmd, `$env:NODE_ENV = "production"; ...` in PowerShell, or add the `cross-env` package for portable scripts.
- Long-path support is off by default on Windows. If installs fail with `ENAMETOOLONG`, enable `core.longpaths` (git) or `LongPathsEnabled` (registry) instead of trying to flatten paths.
- Line endings: respect the project's `.gitattributes` and existing files. Do not normalize CRLF/LF as a side effect of an edit.

## Verify before saying it works
- Type and build first: `npm run typecheck`, `npm run build`, or whatever the project exposes. Tests next: `npm test`, `npm run test`, or `npm run test -- --run` for Vitest.
- Do not claim a dev server or preview is running unless the conversation already includes that output. Common dev ports are Vite/SvelteKit 5173, Next/React 3000, Astro 4321, Angular 4200, Storybook 6006, and Expo 8081.
