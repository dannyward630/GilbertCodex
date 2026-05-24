#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "== Gilbert Codex Linux verification =="
echo "Host: $(uname -srm)"
if command -v lsb_release >/dev/null 2>&1; then
  lsb_release -a || true
else
  cat /etc/os-release || true
fi

npm install
npm run build
npm run rust:fmt:check
npm run rust:check
npm run app:build:linux

DEB_PATH="$(find src-tauri/target/release/bundle/deb -maxdepth 1 -name '*.deb' -print -quit 2>/dev/null || true)"
APPIMAGE_PATH="$(find src-tauri/target/release/bundle/appimage -maxdepth 1 -name '*.AppImage' -print -quit 2>/dev/null || true)"

if [[ -z "${DEB_PATH}" ]]; then
  echo "No .deb bundle was produced." >&2
  exit 1
fi

if [[ -z "${APPIMAGE_PATH}" ]]; then
  echo "No .AppImage bundle was produced." >&2
  exit 1
fi

echo "Debian bundle: ${DEB_PATH}"
echo "AppImage bundle: ${APPIMAGE_PATH}"

if command -v dpkg-deb >/dev/null 2>&1; then
  dpkg-deb --info "${DEB_PATH}" || true
fi

echo "Launch the packaged app and verify auth, chat, settings, terminal, browser preview, notifications, provider setup, GitHub, Discord/ngrok, and weather on X11 and Wayland where available."
