#!/usr/bin/env bash
# Telegram ping without OpenClaw, for machines that do not run the gateway.
# Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env (create a NEW bot
# via @BotFather; reusing the OpenClaw bot token would fight its polling).
# Usage: bin/notify.sh "JARVIS briefing ready. <headline>"
set -euo pipefail
cd "$(dirname "$0")/.."

TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' .env | cut -d= -f2- || true)
CHAT=$(grep -E '^TELEGRAM_CHAT_ID=' .env | cut -d= -f2- || true)
[ -n "${TOKEN}" ] && [ -n "${CHAT}" ] || { echo "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing from .env"; exit 1; }

curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${CHAT}" \
  --data-urlencode "text=${1:-JARVIS ping}" >/dev/null
echo "sent"
