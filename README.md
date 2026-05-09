# Gilbert Codex

Gilbert Codex is a GUI-first local desktop agent workspace for building, reviewing, and steering code from one focused surface. The project combines a React interface, a Tauri 2 shell, and a small Rust command layer so the product can grow into a local-first coding assistant without dragging server infrastructure into the first milestone.

[![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db)](https://tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Current Status

Phase 1 is a working desktop-app foundation. It includes the app shell, chat workspace, local project and chat state, OpenRouter chat streaming, reasoning controls, file and image attachments, settings, dialogs, a right-side activity rail, and a browser preview panel.

The repo is intentionally lean: generated folders, local logs, dependencies, and build outputs stay out of Git. The source tree is organized around product surfaces rather than framework trivia, which keeps future contributors from needing a map and a lantern just to find the chat composer.

## Product Shape

- Desktop shell: Tauri 2 window, custom chrome, local runtime metadata, and a Rust command bridge.
- Main workspace: left navigation, searchable chat history, project grouping, pinned chats, and route-level workspace pages.
- Chat surface: streaming assistant messages, markdown rendering, image/file attachments, model switching, and thinking controls.
- Review posture: visible review-mode controls, destructive chat deletion confirmation, and local-first state persistence.
- Companion panels: reasoning/activity rail and embedded browser preview with resize and expand controls.
- Settings: local OpenRouter key entry, connection validation, appearance mode, model, generation, and thinking controls.

## Repository Layout

```text
.
|-- src/                    React frontend
|   |-- app/                App composition and Tauri client helpers
|   |-- components/         Reusable UI grouped by product area
|   |-- lib/                Local storage, models, clipboard, and chat helpers
|   |-- pages/              Top-level route surfaces
|   |-- services/           Provider clients
|   |-- styles/             Global styles split by surface
|   `-- types/              Shared TypeScript contracts
|-- src-tauri/              Tauri 2 and Rust host layer
|   |-- capabilities/       Window and runtime permissions
|   |-- src/                Rust commands, core modules, and app bootstrap
|   `-- tauri.conf.json     Desktop app configuration
|-- CONTRIBUTING.md         Local setup and contribution rules
|-- PROGRESS.md             Phase history, completed UI, and roadmap
|-- SECURITY.md             Responsible disclosure and secret-handling notes
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

Build the frontend:

```powershell
npm.cmd run build
```

Run Rust checks:

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
```

## OpenRouter Setup

Gilbert Codex currently uses OpenRouter from the desktop UI. Add your API key in Settings, test the connection there, and keep keys out of Git. The key is local user data, not repository configuration.

## Collaboration

Before opening a pull request, run:

```powershell
npm.cmd run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
```

Use [CONTRIBUTING.md](CONTRIBUTING.md) for local workflow and [PROGRESS.md](PROGRESS.md) for the phase roadmap.

## License

Gilbert Codex is released under the [MIT License](LICENSE).
