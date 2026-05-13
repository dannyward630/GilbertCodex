# Platform Support And Porting Notes

This document tracks what is known about running Gilbert Codex on Windows, macOS, and Linux.

Last updated: May 13, 2026.

## Current Support State

| Platform | Status | Notes |
| --- | --- | --- |
| Windows x64 | Verified alpha | The current public release and local verification were done on Windows with a Tauri NSIS customer installer and the v0.3.0 modular tool-runtime update. |
| macOS | Partial source support | Tauri, terminal shell selection, npm scripts, ngrok path handling, and docs have been adjusted for macOS, but the desktop app still needs someone on macOS to run, package, and finish any native issues. |
| Linux | Partial source support | Tauri, terminal shell selection, npm scripts, ngrok path handling, and docs have been adjusted for Linux, but the desktop app still needs someone on Linux to run, package, and finish any native issues. |

The macOS and Linux port is intentionally marked partial. The codebase should no longer be Windows-locked, but native desktop behavior needs real OS coverage before the project should promise official support.

## What Has Been Ported

- Windows installer configuration now includes branded NSIS artwork, installer/uninstaller icons, WebView2 runtime checks, install-scope selection, Start menu grouping, license metadata, and downgrade blocking.
- Tauri build hooks use cross-platform `npm run ...` commands instead of Windows-only `npm.cmd`.
- Tauri bundle targets are configured broadly so host-platform packages can be produced by each OS.
- The desktop terminal supports PowerShell/cmd on Windows and Bash/Zsh/sh on macOS and Linux.
- Local tool command inference chooses platform-appropriate package manager, Gradle, TypeScript, and custom-tool commands.
- The v0.3.0 tool executor is split into platform-neutral parser, registry, policy, terminal, workspace, file-mutation, Git, GitHub, MCP, browser, weather, and web-search modules.
- The workflow layer is source-portable TypeScript and uses `xstate`, but native terminal, browser preview, file picker, and packaging behavior still need OS-specific verification.
- Custom reusable tools can use `.ps1`, `.cmd`, or `.sh` scripts depending on the selected shell.
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
- `npm run app:dev`
- `npm run check`
- `npm run app:build`
- First launch, local account creation, sign-in, and local app storage.
- File picker, selected workspace roots, file indexing, read/write/delete safeguards, and full-computer scope behavior.
- Terminal startup and command execution for Bash, Zsh, and sh.
- GitHub device-flow login, token persistence, repository reads, branch creation, API commits, and pull request creation.
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
npm run app:dev
npm run check
npm run app:build
```

Potential follow-up work:

- Confirm whether custom window chrome feels native enough on macOS.
- Add signing/notarization before any public macOS release.
- Verify whether `zsh`, `bash`, and `sh` shells should all remain visible in the terminal selector.
- Validate app data paths, file picker permissions, notifications, and security prompts.

## Linux Notes

Expected baseline:

- Node.js 18 or newer.
- Rust and Cargo.
- Tauri 2 Linux system dependencies, including WebKitGTK and appindicator/tray-related packages where required by the target distribution.

Useful commands:

```bash
npm install
npm run app:dev
npm run check
npm run app:build
```

Potential follow-up work:

- Document exact package install commands for Ubuntu/Debian, Fedora, and Arch after real testing.
- Verify Wayland and X11 behavior.
- Validate WebKitGTK version requirements and packaging output.
- Confirm file picker behavior, notifications, shell execution, and browser preview behavior across common desktops.

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
