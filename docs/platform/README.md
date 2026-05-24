# Platform Support And Porting Notes

This document tracks what is known about running Gilbert Codex on Windows, macOS, and Linux.

Last updated: May 24, 2026.

## Current Support State

| Platform | Status | Notes |
| --- | --- | --- |
| Windows x64 | Verified alpha | The current public release and local verification were done on Windows with a Tauri NSIS customer installer. |
| macOS arm64/x64 | Release workflow ready, pending native launch verification | Frontend platform detection, Mac shortcut labels, left-side traffic-light window controls, Keychain-backed secure storage, app/DMG build scripts, and GitHub Actions release jobs are in place. A maintainer still needs to run the packaged app and complete the native QA checklist before this becomes verified support. |
| Linux x64 | Release workflow ready, pending native launch verification | Tauri, terminal shell selection, npm scripts, Secret Service-backed secure storage, ngrok path handling, deb/AppImage packaging config, and GitHub Actions release jobs are in place. The desktop app still needs someone on Linux to run the package and finish native QA before this becomes verified support. |

The macOS and Linux port is intentionally marked launch-unverified. The codebase and release workflow should no longer be Windows-locked, but native desktop behavior needs real OS coverage before the project should promise fully verified support.

## What Has Been Ported

- Windows installer configuration now includes branded NSIS artwork, installer/uninstaller icons, WebView2 runtime checks, install-scope selection, Start menu grouping, license metadata, and downgrade blocking.
- Tauri build hooks use cross-platform `npm run ...` commands instead of Windows-only `npm.cmd`.
- Tauri bundle scripts are platform-specific: Windows uses NSIS, macOS uses the `app` and `dmg` targets with `src-tauri/tauri.macos.conf.json`, and Linux uses the `deb` and `appimage` targets with `src-tauri/tauri.linux.conf.json`.
- The GitHub `Release` workflow builds Windows first, then macOS Apple Silicon/Intel, then Linux x64 so updater metadata is merged without parallel upload races.
- Main and detached chat windows use Tauri window-state persistence so the next launch restores the user's last size, screen position, maximized state, and fullscreen state instead of forcing a fresh maximize.
- First-launch window defaults are centered, resizable, constrained to the working area, and sized to fit common laptop and snapped-window layouts.
- The desktop terminal host code supports PowerShell/cmd on Windows and Bash/Zsh/sh on macOS and Linux.
- macOS secure secrets use Keychain through the native `security` tool.
- Linux secure secrets use the freedesktop Secret Service path through `secret-tool`, so Debian/Ubuntu packages depend on `libsecret-tools`.
- The frontend renders Mac-appropriate shortcut labels and window controls when the host platform is macOS.
- Native terminal, browser preview, file picker, source context, and packaging behavior still need OS-specific verification.
- ngrok setup accepts a generic executable path instead of assuming `ngrok.exe`.
- Browser automation uses a platform-appropriate user agent.
- Setup docs now use cross-platform `npm` commands, with a Windows `npm.cmd` note where useful.

## Windows Packaging

Use this command on Windows to build the customer installer:

```powershell
npm.cmd run app:installer
```

See [Windows Installer](../INSTALLER.md) for the bundled dependency notes, release checklist, and signing status.

## What Still Needs Native Testers

Someone with access to macOS and Linux should verify:

- `npm install`
- `npm run dev`
- `npm run app:dev:macos`
- `npm run check`
- `npm run app:build:macos`
- `npm run app:release:macos`
- First launch, local account creation, sign-in, and local app storage.
- File picker, selected workspace roots, file indexing, read/write/delete safeguards, and full-computer scope behavior.
- Terminal execution, browser preview, local Git, GitHub, and source-context behavior.
- Terminal startup and command execution for Bash, Zsh, and sh.
- GitHub device-flow login, token persistence, repository reads, branch creation, API commits, pull request creation, release helpers, and workflow actions.
- Discord slash-command bridge startup, ngrok discovery, interaction validation, and response editing.
- Desktop notifications and permission prompts.
- Browser preview panel and local dev-server URL detection.
- Packaged app launch from the generated macOS or Linux artifact.

## macOS Notes

Expected baseline:

- Node.js 18 or newer.
- Rust and Cargo.
- Xcode Command Line Tools.
- Tauri 2 prerequisites for macOS from the official Tauri docs.

Useful commands:

```bash
npm install
npm run app:dev:macos
npm run check
npm run app:build:macos
./scripts/macos-verify.sh
```

Potential follow-up work:

- Confirm the custom traffic-light window chrome works correctly in dev and packaged app windows.
- Add Apple Developer signing and notarization before presenting macOS as a fully trusted public download.
- Verify whether `zsh`, `bash`, and `sh` shells should all remain visible in the terminal selector.
- Validate app data paths, Keychain prompts, file picker permissions, notifications, and security prompts.

## Linux Notes

Expected baseline:

- Node.js 18 or newer.
- Rust and Cargo.
- Tauri 2 Linux system dependencies, including WebKitGTK and appindicator/tray-related packages where required by the target distribution.
- `libsecret-tools` and a Secret Service provider such as GNOME Keyring or KWallet for MCP bearer tokens and other OS-backed secrets.

Useful commands:

```bash
npm install
npm run app:dev
npm run check
npm run app:build:linux
npm run app:release:linux
./scripts/linux-verify.sh
```

Potential follow-up work:

- Document exact package install commands for Ubuntu/Debian, Fedora, and Arch after real testing.
- Verify Wayland and X11 behavior.
- Validate WebKitGTK version requirements and packaging output.
- Confirm file picker behavior, notifications, shell execution, Secret Service prompts, MCP stdio servers, and browser preview behavior across common desktops.

## Port Completion Checklist

Before calling macOS or Linux officially supported:

- A maintainer or contributor runs the full checklist on the real OS.
- Any native runtime fixes are merged.
- Packaging artifacts are generated on that OS and launched outside the dev environment.
- Known limitations are recorded in release notes.
- Checksums are published for new release artifacts.
- The README download section is updated from partial source support to official support.

## Reporting Results

When testing macOS or Linux, include:

- OS name and version.
- CPU architecture.
- Node, npm, Rust, Cargo, and Tauri CLI versions.
- The exact command that failed.
- Relevant terminal output with secrets removed.
- Screenshots for UI, file picker, notification, or packaging issues.
