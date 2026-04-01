#!/usr/bin/env bash
set -euo pipefail

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║   EventHive Tool — Self-Hosted Setup         ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Pre-flight checks ────────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "❌  Docker not found. Install from https://docs.docker.com/get-docker/"
  exit 1
fi
if ! docker compose version &>/dev/null; then
  echo "❌  Docker Compose V2 not found. Update Docker Desktop or install the plugin."
  exit 1
fi

# ── .env setup ───────────────────────────────────────────────────────────────
ENV_FILE="$(dirname "$0")/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "📋  Creating .env from .env.example ..."
  cp "$(dirname "$0")/.env.example" "$ENV_FILE"

  # Generate a random SESSION_SECRET
  SECRET=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  sed -i.bak "s/change-me-to-a-long-random-string/$SECRET/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  echo "   SESSION_SECRET generated ✔"

  # Optional password prompt
  read -rp "   Set a login password? (leave blank for open access): " PASSWORD
  if [ -n "$PASSWORD" ]; then
    cd "$(dirname "$0")"
    npm install --silent
    HASH=$(npm run hash-password "$PASSWORD" --silent 2>/dev/null | tail -1)
    sed -i.bak "s|PASSWORD_HASH=|PASSWORD_HASH=$HASH|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
    echo "   Password hash set ✔"
    cd - >/dev/null
  else
    echo "   Running in open-access mode (no password)."
  fi
else
  echo "ℹ️   .env already exists, skipping generation."
fi

# ── Build & start ─────────────────────────────────────────────────────────────
echo ""
echo "🐳  Building and starting containers ..."
docker compose -f "$(dirname "$0")/docker-compose.yml" up -d --build

echo ""
echo "✅  Done! Your tool is running at:"
PORT=$(grep '^PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 || echo "3000")
echo "   http://localhost:${PORT:-3000}"
echo ""
echo "   To stop:    docker compose -f self-hosted/docker-compose.yml down"
echo "   To view logs: docker compose -f self-hosted/docker-compose.yml logs -f app"
echo ""
