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

The GitHub `Release` workflow builds the Windows NSIS installer with the same updater config, reads the release body from `docs/releases/<tag>.md` when that file exists, computes a SHA-256 checksum, and uploads the installer, `.sha256` file, `.sig` file, and `latest.json` feed to GitHub Releases. Push a `v*` tag or dispatch the workflow manually with the release version to start that updater release path. Add these repository secrets before publishing an auto-update release:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` when the key is password-protected
- `GILBERT_PRIVATE_RELEASE_OVERLAY_REPOSITORY`
- `GILBERT_PRIVATE_RELEASE_OVERLAY_TOKEN`
- `GILBERT_PRIVATE_RELEASE_OVERLAY_REF` when the private overlay should build from a branch or tag other than `main`
- `GOOGLE_OAUTH_CLIENT_SECRET`

The private release overlay is a private repository that is checked out only inside GitHub Actions. It lets the public repository stay clean while the release runner restores app-only files before packaging. The overlay can contain:

```text
src/toolBridge/
plugins/
.agents/plugins/
```

`src/toolBridge/index.ts` is required for release builds. `plugins/` and `.agents/plugins/` are optional, but if they exist in the private overlay they are copied into the build workspace before the installer is compiled. These files remain absent from the public GitHub tree.

Add these repository variables or secrets before publishing a release build that needs built-in app-facing configuration:

- `VITE_GITHUB_OAUTH_CLIENT_ID`
- `VITE_GOOGLE_OAUTH_CLIENT_ID`
- `VITE_SUPPORT_CASHAPP_URL`
- `VITE_SUPPORT_PAYPAL_URL`
- `VITE_SUPPORT_STRIPE_MONTHLY_URL`
- `VITE_SUPPORT_STRIPE_ONE_TIME_URL`

The `VITE_*` values are baked into the packaged frontend and can be inspected by app users, so only put public OAuth client IDs or public hosted funding URLs there. Keep private values in non-`VITE_` GitHub Secrets such as `GOOGLE_OAUTH_CLIENT_SECRET` and the Tauri signing key.

## What The Installer Includes

- The compiled Gilbert Codex desktop executable.
- The built React frontend from `dist`.
- Bundled Rust-side runtime dependencies, including SQLite through `rusqlite`'s bundled feature.
- App icons, Windows shortcut metadata, publisher metadata, homepage metadata, and the MIT license page.
- A WebView2 runtime check. If WebView2 is missing or older than the configured minimum, the installer downloads and runs Microsoft's bootstrapper silently.
- A selectable install scope so the user can install for the current account or system-wide.

## What Stays Local

Provider API keys, GitHub tokens, Discord settings, local accounts, logs, local databases, workspace files, local scan artifacts, release signing credentials, updater private keys, and private release overlay repository credentials are not bundled into public installers. Those are created or connected by the user after installation or used only by GitHub Actions during packaging.

## Light And Dark Mode

The installer artwork uses a split light/dark visual treatment so the setup flow looks intentional on either Windows theme. Inside the app, Gilbert Codex defaults to the system theme and can be pinned to Light or Dark from Settings > Appearance.

## Release Checklist

Before publishing an installer:

1. Bump `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and `src-tauri/tauri.conf.json` to the release version.
2. Run `npm.cmd run check`.
3. Run `npm.cmd run audit:prod`.
4. Run `npm.cmd run app:release`, or run the GitHub `Release` workflow for the tagged version.
5. Confirm GitHub Releases includes the setup executable, matching `.sha256`, matching `.sig`, and `latest.json`.
6. Confirm the SHA-256 in `docs/releases/<tag>.md` matches the uploaded `.sha256` file.
7. Launch the packaged app from a real install on Windows.
8. Use the in-app update checker against the published release feed.
9. Update `docs/releases/<tag>.md` with file name, size, checksum, signing status, updater feed status, validation status, and known limits before pushing the release tag.

The Windows installer is still unsigned unless a release build is produced with a valid code-signing configuration. Unsigned builds can trigger SmartScreen warnings.
