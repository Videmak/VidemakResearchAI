#!/usr/bin/env bash
# Creates .env from .env.example with fresh random secrets. Safe to run again: an existing .env
# is left alone.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then echo ".env already exists; nothing changed."; exit 0; fi
secret() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
umask 077
sed -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(secret 32)|" \
    -e "s|^JWT_SECRET=.*|JWT_SECRET=$(secret 48)|" \
    -e "s|^SETTINGS_KEY=.*|SETTINGS_KEY=$(secret 48)|" \
    .env.example > .env
echo "Wrote .env with new secrets. Set PUBLIC_URL and ADMIN_EMAILS, then: docker compose up -d"
