#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env"

echo ""
echo "+--------------------------------------+"
echo "|          PAPERWEIGHT SETUP           |"
echo "|     Anchor your creative archive.    |"
echo "+--------------------------------------+"
echo ""

if [ -f "$ENV_FILE" ]; then
  echo "ERROR: .env already exists. Delete it first to re-run setup."
  exit 1
fi

clean_env_value() {
  local label="$1"
  local value="$2"
  case "$value" in
    *'#'*|*$'\r'*)
      echo "ERROR: $label cannot contain # or carriage returns."
      exit 1
      ;;
  esac
  printf '%s' "$value"
}

slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9 ]//g' \
    | tr ' ' '-' \
    | sed 's/-\+/-/g' \
    | sed 's/^-//;s/-$//'
}

resolve_path() {
  node -e "const path=require('path'); console.log(path.resolve(process.argv[1], process.argv[2]));" "$ROOT" "$1"
}

read -rp "Station name: " STATION_NAME
STATION_NAME="$(clean_env_value "Station name" "$STATION_NAME")"
if [ -z "$STATION_NAME" ]; then
  echo "ERROR: Station name is required."
  exit 1
fi

SLUG_AUTO="$(slugify "$STATION_NAME")"
if [ -z "$SLUG_AUTO" ]; then
  SLUG_AUTO="paperweight"
fi

echo ""
echo "Station slug (used in your public URL: https://<slug>.paperweighthq.com)"
read -rp "Slug [$SLUG_AUTO]: " SLUG_INPUT
STATION_SLUG="$(clean_env_value "Station slug" "${SLUG_INPUT:-$SLUG_AUTO}")"

echo ""
echo "Identity mode:"
echo "  1) Creator Brand  (station name, your name, description)"
echo "  2) Anonymous      (station name only)"
read -rp "Choose [1/2, default 2]: " IDENTITY_CHOICE
if [ "$IDENTITY_CHOICE" = "1" ]; then
  STATION_IDENTITY="creator"
  read -rp "Your name (optional): " CREATOR_NAME
  read -rp "Station description (optional): " CREATOR_DESC
  CREATOR_NAME="$(clean_env_value "Creator name" "$CREATOR_NAME")"
  CREATOR_DESC="$(clean_env_value "Station description" "$CREATOR_DESC")"
else
  STATION_IDENTITY="anonymous"
  CREATOR_NAME=""
  CREATOR_DESC=""
fi

echo ""
read -rp "Vault path [default: ./vault]: " VAULT_PATH
VAULT_PATH="$(clean_env_value "Vault path" "${VAULT_PATH:-./vault}")"

echo ""
echo "Vault mode:"
echo "  1) Hybrid   (folders first, metadata fallback) [recommended]"
echo "  2) Folder   (top-level vault folders define categories)"
echo "  3) Metadata (file metadata defines categories)"
read -rp "Choose [1/2/3, default 1]: " VAULT_MODE_CHOICE
case "$VAULT_MODE_CHOICE" in
  2) VAULT_MODE="folder" ;;
  3) VAULT_MODE="metadata" ;;
  *) VAULT_MODE="hybrid" ;;
esac

echo ""
echo "Cloudflare Tunnel (optional):"
echo "  Hides your IP address from listeners. Recommended for public stations."
echo "  Set up a free tunnel at: https://one.dash.cloudflare.com"
read -rp "Tunnel token (press Enter to skip): " CF_TUNNEL_TOKEN
CF_TUNNEL_TOKEN="$(clean_env_value "Tunnel token" "$CF_TUNNEL_TOKEN")"
TRUST_PROXY_VALUE=false
if [[ -n "$CF_TUNNEL_TOKEN" ]]; then
  TRUST_PROXY_VALUE=loopback
fi

echo ""
echo "Public URL (optional):"
echo "  Your station's actual reachable address once it's online — the tunnel,"
echo "  reverse-proxy, or public IP URL listeners will use. This is what"
echo "  https://${STATION_SLUG}.paperweighthq.com will redirect to. Do NOT enter"
echo "  that paperweighthq.com URL itself here — that causes a redirect loop."
echo "  Leave blank if you don't have one yet; you can set it later in .env."
read -rp "Public URL (press Enter to skip): " STATION_PUBLIC_URL
STATION_PUBLIC_URL="$(clean_env_value "Station public URL" "$STATION_PUBLIC_URL")"

DASHBOARD_TOKEN="$(node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))")"
DOWNLOAD_SIGNING_SECRET="$(node -e "const c=require('crypto');console.log(c.randomBytes(32).toString('hex'))")"

cat > "$ENV_FILE" <<EOF
# Paperweight configuration
STATION_NAME=$STATION_NAME
STATION_IDENTITY=$STATION_IDENTITY
CREATOR_NAME=$CREATOR_NAME
CREATOR_DESC=$CREATOR_DESC

HOST=127.0.0.1
PORT=3000
TRUST_PROXY=$TRUST_PROXY_VALUE

VAULT_PATH=$VAULT_PATH
VAULT_MODE=$VAULT_MODE

DASHBOARD_TOKEN=$DASHBOARD_TOKEN
DOWNLOAD_SIGNING_SECRET=$DOWNLOAD_SIGNING_SECRET
HTTPS=false

STATION_SLUG=$STATION_SLUG
STATION_PUBLIC_URL=$STATION_PUBLIC_URL
CLOUDFLARE_TUNNEL_TOKEN=$CF_TUNNEL_TOKEN

STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_SUBSCRIBER=
STRIPE_PRICE_PRO=
STRIPE_PRICE_ALL_ACCESS=

PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_PLAN_PRO=
PAYPAL_PLAN_ALL_ACCESS=
PAYPAL_WEBHOOK_ID=

DOWNLOAD_TOKEN_TTL_HOURS=48

DATA_PATH=./data
HLS_OUTPUT_PATH=./hls_output
LOG_PATH=./logs
EOF

mkdir -p "$ROOT/data" "$ROOT/logs" "$ROOT/hls_output/stream" "$ROOT/hls_output/previews"

VAULT_ABS="$(resolve_path "$VAULT_PATH")"
mkdir -p \
  "$VAULT_ABS/music" \
  "$VAULT_ABS/beats" \
  "$VAULT_ABS/podcasts" \
  "$VAULT_ABS/videos" \
  "$VAULT_ABS/drafts" \
  "$VAULT_ABS/live_sessions"

echo ""
echo "Setup complete."
echo ""
echo "  Station:         $STATION_NAME"
echo "  Identity:        $STATION_IDENTITY"
echo "  Vault:           $VAULT_ABS"
echo "  Vault mode:      $VAULT_MODE"
echo ""
if [[ -n "$STATION_PUBLIC_URL" ]]; then
  echo "  Station URL:     $STATION_PUBLIC_URL"
else
  echo "  Station URL:     (not set — set STATION_PUBLIC_URL in .env once you have a public address)"
fi
echo "  Dashboard token: $DASHBOARD_TOKEN"
echo "  Save this token. It is required for the creator dashboard."
echo ""
echo "Next steps:"
echo "  1. Add media files to $VAULT_ABS"
echo "  2. npm install"
echo "  3. npm run preflight"
echo "  4. npm start"
echo ""
