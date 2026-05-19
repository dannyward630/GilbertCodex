<p align="center">
  <img src="docs/assets/readme/gilbert-codex-readme-logo.svg" alt="Gilbert Codex" width="760">
</p>

# Gilbert Codex

Gilbert Codex is a GUI-first local desktop agent workspace for building, reviewing, researching, and shipping code from one focused surface. It combines React, TypeScript, Tauri 2, and a Rust command layer so local workspace features can run without requiring a hosted backend for the public alpha.

[![Version](https://img.shields.io/badge/version-0.3.5-d8b36c)](docs/releases/v0.3.5.md)
[![Tauri 2](https://img.shields.io/badge/Tauri-2-24c8db)](https://tauri.app/)
[![React 18](https://img.shields.io/badge/React-18-61dafb)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Preview

![Gilbert Codex animated desktop preview](docs/assets/readme/gilbert-codex-readme-demo.gif)

| Focused chat workspace | Local app settings |
| --- | --- |
| ![Gilbert Codex empty chat workspace with project sidebar and composer](docs/assets/readme/gilbert-codex-overview.png) | ![Gilbert Codex settings page showing app metadata, model, and permissions](docs/assets/readme/gilbert-codex-settings.png) |

## Current Status

Gilbert Codex v0.3.5 is the next major public alpha update. The app now includes local account sign-in, a chat workspace, project-scoped state, multi-provider model streaming, planning mode, thinking controls, source-backed context, Discord slash-command bridge setup/runtime, GitHub account setup, settings, desktop notifications, and a Tauri command layer.

This is still alpha software. Provider behavior varies by model, and some edge cases are still being tightened as real users test the app. High-impact local actions, destructive operations, credential access, publishing, and outside-scope paths remain gated by explicit permission and review behavior.

Platform status: Windows x64 is the verified alpha target. macOS and Linux have partial source support, but they still need contributors on those operating systems to run the app, package it, and finish native port issues. See [Platform Support And Porting Notes](docs/platform/README.md).

The repository is kept open-source ready by default: dependencies, build output, local logs, generated targets, local databases, private local automation sources, and secrets stay out of Git. Source files are grouped by product surface so contributors can find the UI, provider clients, settings, types, and Rust commands without reverse-engineering the whole app.

## Download

The v0.3.5 Windows public alpha is prepared for [GitHub Releases](https://github.com/UrbanWafflezz/GilbertCodex/releases/tag/v0.3.5).

Download the Windows x64 setup executable, run it, and configure provider keys or local endpoints in Settings. The customer installer uses Tauri's NSIS packaging, branded light/dark-safe setup artwork, a license page, Start menu metadata, and a WebView2 runtime check. This alpha is unsigned, so Windows SmartScreen may show an extra confirmation prompt.

macOS and Linux release artifacts are not official yet. The repo has partial source support for both platforms, and contributors with those operating systems are needed to test and complete the port.

See [v0.3.5 release notes](docs/releases/v0.3.5.md) for release-prep notes, setup notes, known limitations, and validation commands.

## Product Shape

- Desktop shell: Tauri 2 window, custom chrome, local app metadata, and Rust commands.
- Local identity: local account creation and sign-in for namespaced chat, project, settings, and workspace state.
- Chat workspace: searchable history, pinned chats, generated chat titles, project grouping, markdown rendering, image/file attachments, regeneration, targeted stop controls, and local persistence.
- Model runtime: OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, LM Studio, Ollama, Groq, Mistral, and DeepSeek chat streaming with live model catalogs where available, provider usage tracking, thinking controls, planning mode, and empty-response retry handling.
- Source context: DuckDuckGo/Brave-backed source cards, thinking/planning support, and clearer fallback messaging.
- Review posture: destructive chat deletion confirmation, explicit local workspace permission modes, source-write guardrails, desktop notification permission checks, a configured Tauri CSP, least-privilege notification capabilities, and visible activity/progress cards.
- Settings: provider key/base URL entry, GitHub browser login, Discord bridge setup/runtime controls, connection validation, appearance mode, model, generation, thinking, and workspace controls.

## Coming Next

The next roadmap is focused on making Gilbert faster, clearer, and more capable in real coding sessions. See the full [roadmap](docs/ROADMAP.md) for the active direction.

- Activity and inspector polish: grouped runs, easier progress scanning, cleaner source cards, and less protocol-facing noise.
- Source-control workflow: richer review cards, GitHub issue/PR/release helpers, workflow visibility, and contributor-friendly starter issues.
- Research upgrades: stronger source quality, thinking/planning context, and better citation surfaces.
- Model and provider UX: provider profiles, model capability badges, context-window hints, local/cloud filters, and task-focused presets for coding, planning, research, review, and multimodal work.
- Voice and multimodal creation: voice-first chat, image generation/editing, image-to-code flows, video job tracking, thumbnails, and saved media artifacts.
- Release maturity: signed updater work, clearer installer diagnostics, macOS/Linux packaging help, and better public alpha validation notes.

## Repository Layout

```text
.
|-- .github/               Issue forms, PR template, CODEOWNERS, CI, and Dependabot
|-- public/                 Static app assets
|-- docs/                   Project docs, release notes, and publishing checklists
|   |-- INSTALLER.md        Windows customer installer build and release checklist
|   |-- platform/           Platform support matrix and macOS/Linux port checklist
|   `-- ROADMAP.md          Upcoming product and contributor roadmap
|-- src/                    React frontend
|   |-- app/                App composition, auth, runtime helpers, Tauri clients
|   |-- components/         Reusable UI grouped by product area
|   |-- lib/                Storage, chat helpers, model metadata, context windows
|   |-- pages/              Top-level app surfaces
|   |-- localWorkspace/     Host-provided workspace context helpers
|   |-- services/           Provider, planning, usage, and web-search clients
|   |-- styles/             CSS split by surface
|   `-- types/              Shared TypeScript contracts
|-- src-tauri/              Tauri 2 and Rust host layer
|   |-- capabilities/       Window and runtime permissions
|   |-- icons/              App icon assets generated from the project logo
|   |-- windows/            Branded NSIS installer artwork
|   |-- src/commands/       Auth, app info, browser, Discord, GitHub, terminal, web, and workspace commands
|   |-- src/core/           Rust storage, secure-storage, and filesystem helpers
|   `-- tauri.conf.json     Desktop app configuration
|-- CONTRIBUTING.md         Local setup and contribution rules
|-- PROGRESS.md             Current phase history and roadmap
|-- SECURITY.md             Responsible disclosure and local-data notes
`-- README.md              Project overview
```

## Getting Started

For platform-specific status and porting work, start with [docs/platform/README.md](docs/platform/README.md). Windows is verified; macOS and Linux are partial until tested on real machines.

Prerequisites:

- Node.js 18 or newer.
- Rust and Cargo.
- Microsoft WebView2 Runtime on Windows.
- WebKitGTK runtime/development packages on Linux when running or building the Tauri desktop shell.

Install dependencies:

```bash
npm install
```

Run the frontend preview:

```bash
npm run dev
```

Run the full desktop app:

```bash
npm run app:dev
```

Run the full repository check:

```bash
npm run check
```

Optional production dependency audit:

```bash
npm run audit:prod
```

Individual checks:

```bash
npm run build
npm run rust:fmt:check
npm run rust:check
```

On Windows PowerShell, `npm.cmd` is also supported if local script execution policy blocks the `npm` shim.

Build the Windows customer installer:

```powershell
npm.cmd run app:installer
```

See [Windows Installer](docs/INSTALLER.md) for what is bundled, what stays local, and the release checklist.

## Local Data And Secrets

Gilbert Codex is local-first. Provider keys and local endpoint URLs are entered through Settings and treated as local user data, not repository configuration. Desktop local accounts are stored in the local Gilbert Database, and the browser preview uses localStorage as a development fallback. Do not commit real API keys, local databases, logs, terminal output, private workspace data, or build artifacts.

GitHub browser login uses OAuth device flow. For local development, create a GitHub OAuth App with device flow enabled, copy `.env.example` to `.env`, set `VITE_GITHUB_OAUTH_CLIENT_ID` to the public client ID, and sign in from Settings. No client secret belongs in the desktop app. GitHub actions use the locally stored access token and should remain behind visible review or permission boundaries for high-impact actions.

Discord bridge settings are local setup data for the desktop Discord runtime. Slash-command chat uses a signed local Interactions receiver and can start ngrok in the background to produce a public HTTPS endpoint. `/gilbert` continues the latest Discord-linked chat, while `/gilbertnewchat` intentionally starts a fresh chat. Incoming Discord webhooks are one-way posting URLs for app updates and chat follow-ups. Bot gateway chat is still future runtime work.

See [SECURITY.md](SECURITY.md) before sharing bug reports that include logs, screenshots, workspace paths, terminal output, provider errors, or local automation output.

## Integration Setup

- [Platform support and porting notes](docs/platform/README.md): Windows verification status, macOS/Linux partial support, and the native testing checklist.
- [Discord integration setup](docs/discord/README.md): Discord application setup, one-click ngrok-backed slash-command bridge setup, bot gateway notes, and incoming webhooks.
- [GitHub integration setup](docs/github/README.md): GitHub OAuth App device-flow setup, requested scopes, Settings sign-in, repository actions, and webhook troubleshooting.

## Collaboration

Before opening a pull request, run:

```bash
npm run check
npm run audit:prod
git diff --check
```

Use [CONTRIBUTING.md](CONTRIBUTING.md) for coding and review standards, [docs/CODE_DOCUMENTATION.md](docs/CODE_DOCUMENTATION.md) for source comment expectations, and [PROGRESS.md](PROGRESS.md) for the current roadmap.

Branch and contribution flow:

- Normal contributor work targets `develop`.
- QA batches promote from `develop` to `testing`.
- Release-ready work promotes from `testing` to `main`.
- The detailed workflow lives in [docs/BRANCHING.md](docs/BRANCHING.md) and [docs/CONTRIBUTION_PROCESS.md](docs/CONTRIBUTION_PROCESS.md).

## License

Gilbert Codex is released under the [MIT License](LICENSE).
