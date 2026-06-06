#!/usr/bin/env bash
# Paperweight installer for Debian/Ubuntu/Raspberry Pi OS (apt-based, 64-bit).
#
# Installs: Node.js LTS, FFmpeg/ffprobe, PM2, and tmpfs-backed HLS output
# (which protects an SD card from constant segment writes on a Pi).
#
# cloudflared is OPTIONAL — a Cloudflare Tunnel only matters if you want to
# expose the station publicly without opening a port. Opt in with either:
#   INSTALL_CLOUDFLARED=1 bash scripts/install.sh
#   bash scripts/install.sh --cloudflared
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

INSTALL_CLOUDFLARED="${INSTALL_CLOUDFLARED:-0}"
for arg in "$@"; do
  case "$arg" in
    --cloudflared) INSTALL_CLOUDFLARED=1 ;;
    --no-cloudflared) INSTALL_CLOUDFLARED=0 ;;
  esac
done

echo ""
echo "╔══════════════════════════════════════╗"
echo "║      PAPERWEIGHT INSTALLER           ║"
echo "╚══════════════════════════════════════╝"
echo ""

if ! command -v apt &>/dev/null; then
  echo "  ERROR: this installer targets apt-based systems (Debian/Ubuntu/Raspberry Pi OS)."
  echo "         On macOS use scripts/install-macos.sh; on Windows use scripts/install.ps1."
  exit 1
fi

# ── Node.js ───────────────────────────────────────────────────────────────────
echo "── Node.js ──────────────────────────"
if command -v node &>/dev/null; then
  echo "  ✓ Node.js $(node --version) already installed"
else
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt install -y nodejs
  echo "  ✓ Node.js $(node --version) installed"
fi

# ── FFmpeg ────────────────────────────────────────────────────────────────────
echo "── FFmpeg ───────────────────────────"
if command -v ffmpeg &>/dev/null; then
  echo "  ✓ FFmpeg already installed"
else
  sudo apt install -y ffmpeg
  echo "  ✓ FFmpeg installed"
fi

# ── PM2 ───────────────────────────────────────────────────────────────────────
echo "── PM2 ──────────────────────────────"
if command -v pm2 &>/dev/null; then
  echo "  ✓ PM2 already installed"
else
  sudo npm install -g pm2
  echo "  ✓ PM2 installed"
fi

# ── cloudflared (optional) ────────────────────────────────────────────────────
echo "── cloudflared (optional) ───────────"
if [ "$INSTALL_CLOUDFLARED" != "1" ]; then
  echo "  - Skipped. Paperweight runs fine on your LAN without it."
  echo "    Re-run with --cloudflared to expose the station publicly via a tunnel."
elif command -v cloudflared &>/dev/null; then
  echo "  ✓ cloudflared already installed"
else
  curl -L https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
  echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' | sudo tee /etc/apt/sources.list.d/cloudflared.list > /dev/null
  sudo apt update && sudo apt install -y cloudflared
  echo "  ✓ cloudflared installed"
fi

# ── npm packages ──────────────────────────────────────────────────────────────
echo "── npm packages ─────────────────────"
cd "$ROOT"
npm install
echo "  ✓ npm packages installed"

# ── HLS output (tmpfs — protects SD card) ────────────────────────────────────
echo "── HLS output (tmpfs) ───────────────"
HLS_PATH="$ROOT/hls_output"
mkdir -p "$HLS_PATH"
if grep -q "$HLS_PATH" /etc/fstab 2>/dev/null; then
  echo "  ✓ tmpfs already configured"
else
  echo "tmpfs $HLS_PATH tmpfs defaults,noatime,size=100m 0 0" | sudo tee -a /etc/fstab > /dev/null
  sudo mount -a
  echo "  ✓ hls_output mounted as tmpfs (SD card protected)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ Installation complete."
echo ""
echo "  Next step: bash scripts/setup.sh"
echo ""
