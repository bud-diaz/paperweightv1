#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_CLOUDFLARED="${PAPERWEIGHT_INSTALL_CLOUDFLARED:-false}"

echo ""
echo "Paperweight Linux / Raspberry Pi installer"
echo "Supported: Debian, Ubuntu, Raspberry Pi OS 64-bit"
echo ""

if ! command -v apt >/dev/null 2>&1; then
  echo "ERROR: This installer expects apt. Use SETUP_LINUX_PI.md for manual steps on other distributions."
  exit 1
fi

echo "-- System packages"
sudo apt update
sudo apt install -y curl ca-certificates gnupg

echo "-- Node.js"
if command -v node >/dev/null 2>&1; then
  echo "OK   Node.js $(node --version) already installed"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
  echo "OK   Node.js $(node --version) installed"
fi

echo "-- FFmpeg"
if command -v ffmpeg >/dev/null 2>&1 && command -v ffprobe >/dev/null 2>&1; then
  echo "OK   FFmpeg and ffprobe already installed"
else
  sudo apt install -y ffmpeg
  echo "OK   FFmpeg and ffprobe installed"
fi

echo "-- PM2"
if command -v pm2 >/dev/null 2>&1; then
  echo "OK   PM2 already installed"
else
  sudo npm install -g pm2
  echo "OK   PM2 installed"
fi

if [ "$INSTALL_CLOUDFLARED" = "true" ]; then
  echo "-- cloudflared"
  if command -v cloudflared >/dev/null 2>&1; then
    echo "OK   cloudflared already installed"
  else
    curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list >/dev/null
    sudo apt update
    sudo apt install -y cloudflared
    echo "OK   cloudflared installed"
  fi
else
  echo "SKIP cloudflared (set PAPERWEIGHT_INSTALL_CLOUDFLARED=true to install it)"
fi

echo "-- npm packages"
cd "$ROOT"
npm install
echo "OK   npm packages installed"

echo "-- HLS output tmpfs"
HLS_PATH="$ROOT/hls_output"
mkdir -p "$HLS_PATH"
if grep -q "$HLS_PATH" /etc/fstab 2>/dev/null; then
  echo "OK   tmpfs already configured"
else
  echo "tmpfs $HLS_PATH tmpfs defaults,noatime,size=100m 0 0" | sudo tee -a /etc/fstab >/dev/null
  sudo mount -a
  echo "OK   hls_output mounted as tmpfs"
fi

echo ""
echo "Installation complete."
echo "Next step: bash scripts/setup.sh"
echo ""
