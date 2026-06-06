#!/usr/bin/env bash
# Paperweight installer for macOS (Apple Silicon or Intel).
#
# Installs via Homebrew: Node.js LTS and FFmpeg/ffprobe. PM2 and cloudflared
# are OPTIONAL and only installed when requested:
#   bash scripts/install-macos.sh                 # Node + FFmpeg
#   bash scripts/install-macos.sh --pm2           # also install PM2 (run-on-login)
#   bash scripts/install-macos.sh --cloudflared   # also install a public tunnel
#
# After this finishes, run: bash scripts/setup.sh
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

INSTALL_PM2="${INSTALL_PM2:-0}"
INSTALL_CLOUDFLARED="${INSTALL_CLOUDFLARED:-0}"
for arg in "$@"; do
  case "$arg" in
    --pm2)         INSTALL_PM2=1 ;;
    --cloudflared) INSTALL_CLOUDFLARED=1 ;;
  esac
done

echo ""
echo "+--------------------------------------+"
echo "|   PAPERWEIGHT INSTALLER (macOS)      |"
echo "+--------------------------------------+"
echo ""

if [ "$(uname -s)" != "Darwin" ]; then
  echo "  ERROR: this installer is for macOS. On Linux/Pi use scripts/install.sh."
  exit 1
fi

# ── Homebrew ──────────────────────────────────────────────────────────────────
echo "── Homebrew ─────────────────────────"
if command -v brew &>/dev/null; then
  echo "  ✓ Homebrew already installed"
else
  echo "  Installing Homebrew (you may be prompted for your password)…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Make brew available in this session on Apple Silicon and Intel.
  if [ -x /opt/homebrew/bin/brew ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [ -x /usr/local/bin/brew ]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  echo "  ✓ Homebrew installed"
fi

# ── Node.js LTS ───────────────────────────────────────────────────────────────
echo "── Node.js ──────────────────────────"
if command -v node &>/dev/null; then
  echo "  ✓ Node.js $(node --version) already installed"
else
  brew install node
  echo "  ✓ Node.js $(node --version) installed"
fi

# ── FFmpeg ────────────────────────────────────────────────────────────────────
echo "── FFmpeg ───────────────────────────"
if command -v ffmpeg &>/dev/null && command -v ffprobe &>/dev/null; then
  echo "  ✓ FFmpeg/ffprobe already installed"
else
  brew install ffmpeg
  echo "  ✓ FFmpeg installed"
fi

# ── PM2 (optional) ────────────────────────────────────────────────────────────
echo "── PM2 (optional) ───────────────────"
if [ "$INSTALL_PM2" != "1" ]; then
  echo "  - Skipped. Use 'npm start' to run, or re-run with --pm2 for run-on-login."
elif command -v pm2 &>/dev/null; then
  echo "  ✓ PM2 already installed"
else
  npm install -g pm2
  echo "  ✓ PM2 installed (see SETUP_MACOS.md for launch-on-login)"
fi

# ── cloudflared (optional) ────────────────────────────────────────────────────
echo "── cloudflared (optional) ───────────"
if [ "$INSTALL_CLOUDFLARED" != "1" ]; then
  echo "  - Skipped. Re-run with --cloudflared to expose the station publicly via a tunnel."
elif command -v cloudflared &>/dev/null; then
  echo "  ✓ cloudflared already installed"
else
  brew install cloudflared
  echo "  ✓ cloudflared installed"
fi

# ── npm packages ──────────────────────────────────────────────────────────────
echo "── npm packages ─────────────────────"
cd "$ROOT"
npm install
echo "  ✓ npm packages installed"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "  ✓ Installation complete."
echo ""
echo "  Next step: bash scripts/setup.sh"
echo ""
