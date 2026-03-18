#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"
ENV_EXAMPLE="$ROOT/.env.example"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║         PAPERWEIGHT SETUP            ║"
echo "║     Anchor your creative archive.    ║"
echo "╚══════════════════════════════════════╝"
echo ""

if [ -f "$ENV_FILE" ]; then
  echo "⚠  .env already exists. Delete it first to re-run setup."
  exit 1
fi

# --- Station Name ---
read -rp "Station name: " STATION_NAME
if [ -z "$STATION_NAME" ]; then
  echo "Station name is required."
  exit 1
fi

# --- Station Slug ---
SLUG_AUTO=$(echo "$STATION_NAME" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9 ]//g' | tr ' ' '-' | sed 's/-\+/-/g' | sed 's/^-//;s/-$//')
echo ""
echo "Station slug (used in your public URL: https://<slug>.paperweighthq.com)"
read -rp "Slug [$SLUG_AUTO]: " SLUG_INPUT
STATION_SLUG="${SLUG_INPUT:-$SLUG_AUTO}"
STATION_PUBLIC_URL="https://${STATION_SLUG}.paperweighthq.com"

# --- Identity Mode ---
echo ""
echo "Identity mode:"
echo "  1) Creator Brand  (station name, your name, description, logo)"
echo "  2) Anonymous      (station name only)"
read -rp "Choose [1/2, default 2]: " IDENTITY_CHOICE
if [ "$IDENTITY_CHOICE" = "1" ]; then
  STATION_IDENTITY="creator"
  read -rp "Your name (optional): " CREATOR_NAME
  read -rp "Station description (optional): " CREATOR_DESC
else
  STATION_IDENTITY="anonymous"
  CREATOR_NAME=""
  CREATOR_DESC=""
fi

# --- Vault Path ---
echo ""
read -rp "Vault path [default: ./vault]: " VAULT_PATH
VAULT_PATH="${VAULT_PATH:-./vault}"

# --- Vault Mode ---
echo ""
echo "Vault mode:"
echo "  1) Hybrid   (folders = collections, metadata = sub-groups) [recommended]"
echo "  2) Folder   (mirrors your existing folder structure)"
echo "  3) Metadata (auto-organizes by file type)"
read -rp "Choose [1/2/3, default 1]: " VAULT_MODE_CHOICE
case "$VAULT_MODE_CHOICE" in
  2) VAULT_MODE="folder" ;;
  3) VAULT_MODE="metadata" ;;
  *) VAULT_MODE="hybrid" ;;
esac

# --- Cloudflare Tunnel Token (optional) ---
echo ""
echo "Cloudflare Tunnel (optional):"
echo "  Hides your IP address from listeners — recommended for public stations."
echo "  Set up a free tunnel at: https://one.dash.cloudflare.com → Networks → Tunnels"
echo "  After creating a tunnel, paste the token here."
read -rp "Tunnel token (press Enter to skip): " CF_TUNNEL_TOKEN

# --- Generate Dashboard Token ---
DASHBOARD_TOKEN=$(node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))")

# --- Write .env ---
cp "$ENV_EXAMPLE" "$ENV_FILE"

sed -i "s|^STATION_NAME=.*|STATION_NAME=$STATION_NAME|" "$ENV_FILE"
sed -i "s|^STATION_IDENTITY=.*|STATION_IDENTITY=$STATION_IDENTITY|" "$ENV_FILE"
sed -i "s|^CREATOR_NAME=.*|CREATOR_NAME=$CREATOR_NAME|" "$ENV_FILE"
sed -i "s|^CREATOR_DESC=.*|CREATOR_DESC=$CREATOR_DESC|" "$ENV_FILE"
sed -i "s|^VAULT_PATH=.*|VAULT_PATH=$VAULT_PATH|" "$ENV_FILE"
sed -i "s|^VAULT_MODE=.*|VAULT_MODE=$VAULT_MODE|" "$ENV_FILE"
sed -i "s|^DASHBOARD_TOKEN=.*|DASHBOARD_TOKEN=$DASHBOARD_TOKEN|" "$ENV_FILE"
sed -i "s|^STATION_SLUG=.*|STATION_SLUG=$STATION_SLUG|" "$ENV_FILE"
sed -i "s|^STATION_PUBLIC_URL=.*|STATION_PUBLIC_URL=$STATION_PUBLIC_URL|" "$ENV_FILE"
sed -i "s|^CLOUDFLARE_TUNNEL_TOKEN=.*|CLOUDFLARE_TUNNEL_TOKEN=$CF_TUNNEL_TOKEN|" "$ENV_FILE"

# --- Create required directories ---
mkdir -p "$ROOT/data" "$ROOT/logs" "$ROOT/hls_output/stream" "$ROOT/hls_output/previews"

VAULT_ABS="$(cd "$ROOT" && realpath -m "$VAULT_PATH")"
mkdir -p \
  "$VAULT_ABS/music" \
  "$VAULT_ABS/beats" \
  "$VAULT_ABS/podcasts" \
  "$VAULT_ABS/videos" \
  "$VAULT_ABS/drafts" \
  "$VAULT_ABS/live_sessions"

echo ""
echo "✓ Setup complete."
echo ""
echo "  Station:         $STATION_NAME"
echo "  Identity:        $STATION_IDENTITY"
echo "  Vault:           $VAULT_ABS"
echo "  Vault mode:      $VAULT_MODE"
echo ""
echo "  Station URL:     $STATION_PUBLIC_URL"
echo "  Dashboard token: $DASHBOARD_TOKEN"
echo "  (Save this — you'll need it to access the dashboard from another device)"
echo ""
echo "Next steps:"
echo "  1. Add media files to $VAULT_ABS"
echo "  2. npm install"
echo "  3. npm start   (or: pm2 start ecosystem.config.js)"
echo ""
