#!/bin/bash
# Prints the exact URL to paste into Health Auto Export's REST API automation.
# The token lives in .env and never enters git or the HUD payload.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN="$(grep '^JARVIS_HEALTH_TOKEN=' "$ROOT/.env" | head -1 | cut -d= -f2-)"
if [ -z "$TOKEN" ]; then
  echo "JARVIS_HEALTH_TOKEN missing from .env; add one: JARVIS_HEALTH_TOKEN=\$(openssl rand -hex 24)" >&2
  exit 1
fi
TS=/Applications/Tailscale.app/Contents/MacOS/Tailscale
HOST="$($TS status --json 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).Self.DNSName.replace(/\.\$/,''))}catch{process.exit(1)}})" 2>/dev/null || true)"
HOST="${HOST%.}"
[ -n "$HOST" ] || HOST="zyad-hamed.tailb73e19.ts.net"
echo "https://$HOST:8443/api/health?token=$TOKEN"
echo ""
echo "Health Auto Export app: Automations > new REST API automation, paste the URL,"
echo "method POST, format JSON, metrics: weight, dietary energy, protein, carbs, fat."
echo "Schedule it daily. The phone needs its Tailscale VPN on when it fires."
