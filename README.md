# Gilbert Codex

Gilbert Codex is a GUI-first local desktop agent workspace for building, reviewing, and steering code from one focused surface. The app combines React, TypeScript, Tauri 2, and a Rust command layer so agent workflows can run close to the local workspace without requiring a hosted backend for the first public milestone.

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db)](https://tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Current Status

Gilbert Codex is in an early collaboration-ready desktop foundation phase. The app currently includes local account sign-in, a chat workspace, project-scoped local state, OpenRouter streaming, planning mode, web search, local computer file context, terminal sessions, browser preview, tool toggles, settings, and a Tauri command bridge.

The repository is kept open-source ready by default: dependencies, build output, local logs, generated targets, local databases, and secrets stay out of Git. Source files are grouped by product surface so contributors can find the UI, runtime clients, tools, types, and Rust commands without reverse-engineering the whole app.

## Product Shape

- Desktop shell: Tauri 2 window, custom chrome, local app metadata, and Rust commands.
- Local identity: local account creation and sign-in for namespaced chat, project, settings, and workspace state.
- Chat workspace: searchable history, pinned chats, project grouping, markdown rendering, image/file attachments, regeneration, stop, and local persistence.
- Model runtime: OpenRouter chat streaming, model context estimates, provider usage tracking, thinking controls, planning mode, and empty-response retry handling.
- Tools: web search, local file indexing, file read/write helpers, browser folder fallback, terminal sessions, browser preview, and Toolbox feature toggles.
- Review posture: destructive chat deletion confirmation, explicit local workspace permission modes, and visible activity/progress cards.
- Settings: OpenRouter key entry, connection validation, appearance mode, model, generation, thinking, and web-search controls.

## Repository Layout

```text
.
|-- public/                 Static app assets
|-- src/                    React frontend
|   |-- app/                App composition, auth, runtime helpers, Tauri clients
|   |-- components/         Reusable UI grouped by product area
|   |-- lib/                Storage, chat helpers, model metadata, context windows
|   |-- pages/              Top-level app surfaces
|   |-- services/           Provider, planning, usage, and web-search clients
|   |-- styles/             CSS split by surface
|   |-- tools/              Browser and local-computer tool executors
|   `-- types/              Shared TypeScript contracts
|-- src-tauri/              Tauri 2 and Rust host layer
|   |-- capabilities/       Window and runtime permissions
|   |-- icons/              App icon assets generated from the project logo
|   |-- src/commands/       Auth, app info, computer, terminal, and web commands
|   |-- src/core/           Rust provider, job, storage, and agent scaffolding
|   `-- tauri.conf.json     Desktop app configuration
|-- CONTRIBUTING.md         Local setup and contribution rules
|-- PROGRESS.md             Current phase history and roadmap
|-- SECURITY.md             Responsible disclosure and local-data notes
`-- README.md              Project overview
```

## Getting Started

Prerequisites:

- Node.js 18 or newer.
- Rust and Cargo.
- Microsoft WebView2 Runtime on Windows.

Install dependencies:

```powershell
npm.cmd install
```

Run the frontend preview:

```powershell
npm.cmd run dev
```

Run the full desktop app:

```powershell
npm.cmd run app:dev
```

Run the full repository check:

```powershell
npm.cmd run check
```

Individual checks:

```powershell
npm.cmd run build
npm.cmd run rust:fmt:check
npm.cmd run rust:check
```

## Local Data And Secrets

Gilbert Codex is local-first. OpenRouter keys are entered through Settings and treated as local user data, not repository configuration. Desktop local accounts are stored in the app data area; the browser preview uses localStorage as a development fallback. Do not commit real API keys, local databases, logs, terminal output, private workspace data, or build artifacts.

See [SECURITY.md](SECURITY.md) before sharing bug reports that include logs, screenshots, workspace paths, terminal output, or provider errors.

## Collaboration

Before opening a pull request, run:

```powershell
npm.cmd run check
git diff --check
```

Use [CONTRIBUTING.md](CONTRIBUTING.md) for coding and review standards, and [PROGRESS.md](PROGRESS.md) for the current roadmap.

## License

Gilbert Codex is released under the [MIT License](LICENSE).
