#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo ""
echo "Paperweight macOS installer"
echo ""

if ! command -v brew >/dev/null 2>&1; then
  echo "ERROR: Homebrew is required for the macOS installer."
  echo "Install it from https://brew.sh, then rerun this script."
  exit 1
fi

echo "-- Node.js"
if command -v node >/dev/null 2>&1; then
  echo "OK   Node.js $(node --version) already installed"
else
  brew install node
  echo "OK   Node.js $(node --version) installed"
fi

echo "-- FFmpeg"
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  echo "OK   FFmpeg and ffprobe already installed"
else
  brew install ffmpeg
  echo "OK   FFmpeg and ffprobe installed"
fi

echo "-- PM2"
if command -v pm2 >/dev/null 2>&1; then
  echo "OK   PM2 already installed"
else
  npm install -g pm2
  echo "OK   PM2 installed"
fi

echo "-- npm packages"
cd "$ROOT"
npm install
echo "OK   npm packages installed"

echo ""
echo "Installation complete."
echo "Next step: bash scripts/setup.sh"
echo ""
