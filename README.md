<p align="center">
  <img src="docs/assets/github/gilbert-codex-social-preview.png" alt="Gilbert Codex local-first desktop agent workspace" width="960">
</p>

<h1 align="center">Gilbert Codex</h1>

<p align="center">
  <strong>A local-first desktop AI agent workspace for coding, review, tools, research, image creation, and release work.</strong>
</p>

<p align="center">
  <a href="docs/releases/v0.5.5.md">v0.5.5 release notes</a>
  |
  <a href="https://github.com/UrbanWafflezz/GilbertCodex/releases/tag/v0.5.5">Windows alpha download</a>
  |
  <a href="docs/ROADMAP.md">Roadmap</a>
  |
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="docs/releases/v0.5.5.md"><img alt="Version 0.5.5" src="https://img.shields.io/badge/version-0.5.5-d8b36c"></a>
  <a href="https://tauri.app/"><img alt="Tauri 2" src="https://img.shields.io/badge/Tauri-2-24c8db"></a>
  <a href="https://react.dev/"><img alt="React 18" src="https://img.shields.io/badge/React-18-61dafb"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript 5" src="https://img.shields.io/badge/TypeScript-5-3178c6"></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/License-MIT-blue.svg"></a>
</p>

## v0.5.5 Public Alpha

Gilbert Codex v0.5.5 is a release-readiness update focused on making the app feel more complete without loosening its local-first boundaries. It keeps the big v0.5.0 foundation and adds stronger Apps and Plugins surfaces, Google/Gmail/Calendar setup through Settings, task automation, voice dictation, browser/terminal polish, deeper customization, and a cleaner runtime path for provider streaming, planning, approvals, and source-backed work.

This is still alpha software. Windows x64 is the verified packaged target. macOS support is in active development and should land soon; Linux remains source-first until native testing catches up. High-impact local actions, destructive operations, credential access, publishing, and outside-scope paths are still guarded by explicit review/permission flows.

The repository is kept open-source ready by default: dependencies, build output, local logs, generated targets, local databases, private local automation sources, and secrets stay out of Git.

## Highlights

| Area | What changed in v0.5.5 |
| --- | --- |
| Customization | Appearance, motion, layout, model, dictation, notification, terminal, web search, and project-open controls are more visible and easier to tune from Settings. |
| Apps and integrations | Gmail, Google Calendar, Google Tasks, GitHub, Discord, browser preview, plugins, and MCP-facing surfaces have stronger setup and management flows. |
| Voice | Offline Whisper dictation is wired into the composer, with browser fallback avoided when the desktop offline path is expected. Release builds prepare the verified model and Vulkan SDK. |
| Agent workspace | Queued sends, steering, planning/research, approval revisions, live tool progress, browser capture, project tasks, and terminal behavior are tighter across the main workspace. |
| Source context | DuckDuckGo/Brave-backed source cards, thinking/planning support, browser preview capture, and clearer fallback messaging are improved. |
| Repository hygiene | Private tool bridge and plugin bundles stay out of public Git, then the release workflow restores them from a private overlay before packaging. |

## Screenshots

<table>
  <tr>
    <td width="50%">
      <strong>Focused chat workspace</strong><br>
      <img src="docs/assets/readme/gilbert-codex-overview.png" alt="Gilbert Codex empty chat workspace with project sidebar and composer">
    </td>
    <td width="50%">
      <strong>Live progress, sources, and approvals</strong><br>
      <img src="docs/assets/readme/gilbert-codex-chat-progress.png" alt="Gilbert Codex chat thread showing live progress, sources, and review state">
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>General settings</strong><br>
      <img src="docs/assets/readme/gilbert-codex-settings.png" alt="Gilbert Codex settings page showing app metadata, model, permissions, and theme controls">
    </td>
    <td width="50%">
      <strong>Subscription model settings</strong><br>
      <img src="docs/assets/readme/gilbert-codex-provider-settings.png" alt="Gilbert Codex AI and Providers settings showing subscription model routes without a required local API key">
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Subscription setup</strong><br>
      <img src="docs/assets/readme/gilbert-codex-subscriptions.png" alt="Gilbert Codex subscription settings setup page">
    </td>
    <td width="50%">
      <strong>Project support</strong><br>
      <img src="docs/assets/readme/gilbert-codex-support.png" alt="Gilbert Codex voluntary project funding page">
    </td>
  </tr>
</table>

## Download

The v0.5.5 Windows public alpha is prepared for [GitHub Releases](https://github.com/UrbanWafflezz/GilbertCodex/releases/tag/v0.5.5).

Download the Windows x64 setup executable, run it, and configure provider keys, local endpoints, or subscription accounts in Settings. The customer installer uses Tauri's NSIS packaging, branded light/dark-safe setup artwork, a license page, Start menu metadata, and a WebView2 runtime check. This alpha is unsigned, so Windows SmartScreen may show an extra confirmation prompt.

macOS release artifacts are in development and should be out soon. Linux release artifacts are not official yet; source support exists, but native testing is still needed before the project promises a packaged Linux download.

See [v0.5.5 release notes](docs/releases/v0.5.5.md) for release-prep notes, setup notes, known limitations, and validation commands.

## Product Shape

- Desktop shell: Tauri 2 window, custom chrome, local app metadata, and Rust commands.
- Local users: local account creation and sign-in for namespaced chat, project, settings, and workspace state.
- Chat workspace: searchable history, pinned chats, generated chat titles, project grouping, markdown rendering, image/file attachments, regeneration, queued sends, targeted stop controls, bulk delete review, and local persistence.
- Model runtime: OpenRouter, OpenAI, Anthropic, Google Gemini, xAI, LM Studio, Ollama, Groq, Mistral, and DeepSeek chat streaming with live model catalogs where available, provider usage tracking, thinking controls, planning mode, and empty-response retry handling.
- Subscription routing: optional local subscription routing for Codex / ChatGPT, Claude Code, Gemini CLI / Cloud Code, GitHub Copilot, and other supported provider accounts, with account sign-in, sign-out, usage visibility, model catalogs, and clean OpenRouter fallback.
- Image generation: chat can attach generated image artifacts through subscription image routes, with composer controls, progress, image grids, lightbox preview, and downloads. Codex / ChatGPT-backed image generation is the first-class path in this release; broader provider coverage is still being tightened.
- Voice input: offline Whisper dictation for desktop builds, bundled model resources, and configurable dictation hotkeys/dictionary entries.
- Source context: DuckDuckGo/Brave-backed source cards, thinking/planning support, browser preview capture, and clearer fallback messaging.
- Review posture: destructive chat deletion confirmation, explicit local workspace permission modes, source-write guardrails, desktop notification permission checks, a configured Tauri CSP, least-privilege notification capabilities, and visible activity/progress cards.
- Settings: provider key/base URL entry, subscription account setup, subscription model catalogs without a required local API key, GitHub browser login, Google OAuth setup, Discord bridge setup/runtime controls, optional support links, connection validation, appearance mode, motion, voice dictation, model, generation, thinking, and workspace controls.

## Coming Next

The next roadmap is focused on making Gilbert faster, clearer, and more capable in real coding sessions. See the full [roadmap](docs/ROADMAP.md) for the active direction.

- Apps page: Gmail and MCP server connections now have real management surfaces. Skills remain the next catalog surface to finish.
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

GitHub browser login uses OAuth device flow. Create a GitHub OAuth App with device flow enabled, paste the public Client ID into Settings > GitHub, and sign in from there. No GitHub client secret belongs in the desktop app or release workflow. GitHub actions use the locally stored access token and should remain behind visible review or permission boundaries for high-impact actions.

Gmail and Google Calendar sign-in use Google OAuth for desktop apps. Each user adds their own Google Cloud desktop OAuth Client ID and Client secret in Settings > Google, then installs Gmail or Google Calendar from Apps and chooses a Google account in the browser. No shared Google OAuth client ID, Google access token, refresh token, or downloaded credential file belongs in the repository.

Release-only app configuration stays out of the public source tree. The GitHub `Release` workflow restores private app-only runtime files from a private release overlay before building the installer, including the private tool bridge and optional plugin bundles. App-user OAuth values, provider keys, local accounts, and support links are not required as release secrets; users configure those inside the installed app.

Discord bridge settings are local setup data for the desktop Discord runtime. Slash-command chat uses a signed local Interactions receiver and can start ngrok in the background to produce a public HTTPS endpoint. `/gilbert` continues the latest Discord-linked chat, while `/gilbertnewchat` intentionally starts a fresh chat. Incoming Discord webhooks are one-way posting URLs for app updates and chat follow-ups. Bot gateway chat is still future runtime work.

See [SECURITY.md](SECURITY.md) before sharing bug reports that include logs, screenshots, workspace paths, terminal output, provider errors, or local automation output.

## Integration Setup

- [Platform support and porting notes](docs/platform/README.md): Windows verification status, macOS/Linux partial support, and the native testing checklist.
- [Discord integration setup](docs/discord/README.md): Discord application setup, one-click ngrok-backed slash-command bridge setup, bot gateway notes, and incoming webhooks.
- [Gmail plugin setup](docs/gmail/README.md): Google OAuth desktop setup, user connection flow, requested scopes, and Gmail confirmation rules.
- [Google OAuth setup](docs/google/README.md): Bring-your-own Google OAuth client setup and production verification notes.
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
