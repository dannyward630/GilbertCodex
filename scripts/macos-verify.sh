#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Gilbert Codex macOS verification =="
echo "Host: $(sw_vers -productName) $(sw_vers -productVersion) ($(uname -m))"

npm install
npm run build
npm run rust:fmt:check
npm run rust:check
npm run app:build:macos

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

echo "Launch the app bundle and verify auth, chat, settings, terminal, browser preview, notifications, provider setup, GitHub, Discord/ngrok, and weather."
