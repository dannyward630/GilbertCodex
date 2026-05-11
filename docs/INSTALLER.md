# Windows Installer

Gilbert Codex ships as a Tauri NSIS setup executable for Windows x64. The installer is meant for customer-style distribution: it installs the desktop app, creates shortcuts, checks the required WebView2 runtime, and uses branded light/dark-safe installer artwork.

## Build The Installer

Run this from the repo root on Windows:

```powershell
npm.cmd run app:installer
```

The script regenerates the NSIS bitmap artwork, builds the React frontend, compiles the Tauri host, and writes the setup executable under:

```text
src-tauri\target\release\bundle\nsis\
```

Use `npm.cmd run app:build` when you only need the normal Tauri bundle without regenerating installer artwork.

## Build An Auto-Update Release

Automatic updates require a signed updater bundle and a `latest.json` release asset. The normal local installer script intentionally does not create those artifacts because Tauri requires the private updater signing key at build time.

For a release-capable local build, set the updater signing key in the current PowerShell session and run:

```powershell
$keyPath = "C:\Users\you\.tauri\gilbert-codex.key"
$env:TAURI_SIGNING_PRIVATE_KEY=$keyPath
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
npm.cmd run app:release
```

The release build merges `src-tauri/tauri.updater.conf.json`, which enables Tauri updater artifacts without forcing every local installer build to have signing secrets.

The GitHub `Release` workflow builds the Windows NSIS installer with the same updater config and uploads the installer, `.sig` file, and `latest.json` feed to GitHub Releases. Add these repository secrets before publishing an auto-update release:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the key is password-protected

## What The Installer Includes

- The compiled Gilbert Codex desktop executable.
- The built React frontend from `dist`.
- Bundled Rust-side runtime dependencies, including SQLite through `rusqlite`'s bundled feature.
- App icons, Windows shortcut metadata, publisher metadata, homepage metadata, and the MIT license page.
- A WebView2 runtime check. If WebView2 is missing or older than the configured minimum, the installer downloads and runs Microsoft's bootstrapper silently.
- A selectable install scope so the user can install for the current account or system-wide.

## What Stays Local

Provider API keys, GitHub tokens, Discord settings, local accounts, logs, local databases, workspace files, release signing credentials, and updater private keys are not bundled into public installers. Those are created or connected by the user after installation.

## Light And Dark Mode

The installer artwork uses a split light/dark visual treatment so the setup flow looks intentional on either Windows theme. Inside the app, Gilbert Codex defaults to the system theme and can be pinned to Light or Dark from Settings > Appearance.

## Release Checklist

Before publishing an installer:

1. Bump `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` to the release version.
2. Run `npm.cmd run check`.
3. Run `npm.cmd run audit:prod`.
4. Run `npm.cmd run app:release`, or run the GitHub `Release` workflow for the tagged version.
5. Confirm GitHub Releases includes the setup executable, matching `.sig`, and `latest.json`.
6. Compute SHA-256 for the generated setup executable.
7. Launch the packaged app from a real install on Windows.
8. Use the in-app update checker against the published release feed.
9. Update release notes with file name, size, checksum, signing status, updater feed status, and known limits.

The Windows installer is still unsigned unless a release build is produced with a valid code-signing configuration. Unsigned builds can trigger SmartScreen warnings.
