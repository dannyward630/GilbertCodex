#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Gilbert Codex macOS verification =="
echo "Host: $(sw_vers -productName) $(sw_vers -productVersion) ($(uname -m))"

require_command() {
  local name="$1"
  if ! command -v "$name" >/dev/null 2>&1; then
    echo "Missing required command: ${name}" >&2
    exit 1
  fi
}

require_node_20() {
  require_command node
  local major
  major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || true)"
  if [[ -z "$major" || "$major" -lt 20 ]]; then
    echo "Node.js 20 or newer is required for the packaged 9Router install/start path. Found: $(node --version 2>/dev/null || echo unavailable)" >&2
    exit 1
  fi
}

resolve_ngrok() {
  if [[ -n "${GILBERT_NGROK_PATH:-}" ]]; then
    if [[ -x "${GILBERT_NGROK_PATH}" ]]; then
      printf '%s\n' "${GILBERT_NGROK_PATH}"
      return 0
    fi
    echo "GILBERT_NGROK_PATH is set but is not executable: ${GILBERT_NGROK_PATH}" >&2
    return 1
  fi

  command -v ngrok
}

require_node_20
require_command npm
require_command git
NGROK_BIN="$(resolve_ngrok)" || {
  echo "Install ngrok with Homebrew or set GILBERT_NGROK_PATH before completing Discord/ngrok verification." >&2
  exit 1
}

echo "Node: $(node --version)"
echo "npm: $(npm --version)"
echo "Git: $(git --version)"
echo "ngrok: $("${NGROK_BIN}" version 2>/dev/null || "${NGROK_BIN}" --version 2>/dev/null || echo "${NGROK_BIN}")"

npm install
npm run build
npm run rust:fmt:check
npm run rust:check
cargo test --manifest-path src-tauri/Cargo.toml terminal
cargo test --manifest-path src-tauri/Cargo.toml ngrok
cargo test --manifest-path src-tauri/Cargo.toml nine_router
cargo test --manifest-path src-tauri/Cargo.toml native_path
cargo test --manifest-path src-tauri/Cargo.toml mcp
npm run app:build:macos

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  npm run app:release:macos
else
  echo "Skipping macOS updater release artifact build because TAURI_SIGNING_PRIVATE_KEY is unset."
fi

APP_PATH="$(find src-tauri/target/release/bundle/macos -maxdepth 2 -name '*.app' -print -quit)"
DMG_PATH="$(find src-tauri/target/release/bundle/dmg -maxdepth 1 -name '*.dmg' -print -quit)"

if [[ -z "${APP_PATH}" ]]; then
  echo "No .app bundle was produced." >&2
  exit 1
fi

if [[ -z "${DMG_PATH}" ]]; then
  echo "No .dmg bundle was produced." >&2
  exit 1
fi

echo "App bundle: ${APP_PATH}"
echo "DMG bundle: ${DMG_PATH}"

codesign -dvv --entitlements :- "${APP_PATH}" || true
spctl -a -vv "${APP_PATH}" || true
echo "If spctl rejects this local artifact, that is expected until Apple Developer signing and notarization are configured."

echo "Launch the app bundle and verify auth, chat, settings, terminal, browser preview, notifications, provider setup, GitHub/local Git, MCP stdio servers, Discord/ngrok using ${NGROK_BIN}, Subscriptions/9Router install-start-sign-in-routing, and weather."
