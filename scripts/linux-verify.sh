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
  echo "Install ngrok with Apt/Snap or set GILBERT_NGROK_PATH before completing Discord/ngrok verification." >&2
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
npm run app:build:linux

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  npm run app:release:linux
else
  echo "Skipping Linux updater release artifact build because TAURI_SIGNING_PRIVATE_KEY is unset."
fi

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

echo "Launch the packaged app and verify auth, chat, settings, terminal, browser preview, notifications, provider setup, GitHub/local Git, MCP stdio servers, Secret Service prompts, Discord/ngrok using ${NGROK_BIN}, Subscriptions/9Router install-start-sign-in-routing, and weather on X11 and Wayland where available."
