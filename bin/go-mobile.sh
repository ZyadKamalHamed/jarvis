#!/usr/bin/env bash
# Expose JARVIS to Zyad's own tailnet (never the public internet).
# Run on whichever machine hosts the server. Idempotent.
set -euo pipefail

TS="tailscale"
command -v "$TS" >/dev/null 2>&1 || TS="/Applications/Tailscale.app/Contents/MacOS/Tailscale"

if ! "$TS" status >/dev/null 2>&1; then
  echo "Tailscale daemon not running. Starting the app..."
  open -a Tailscale || { echo "Install Tailscale first: https://tailscale.com/download"; exit 1; }
  for i in $(seq 1 30); do "$TS" status >/dev/null 2>&1 && break; sleep 1; done
fi

"$TS" status >/dev/null 2>&1 || { echo "Tailscale still not up. Open the app and log in, then rerun."; exit 1; }

# serve = tailnet only. NEVER use 'tailscale funnel' for JARVIS: the HUD
# carries career and personal data and has no auth layer of its own.
"$TS" serve --bg --https=8443 4777

HOST=$("$TS" status --json | python3 -c "import json,sys; print(json.load(sys.stdin)['Self']['DNSName'].rstrip('.'))")
echo
echo "JARVIS is on your tailnet: https://${HOST}:8443"
echo "On the phone: install Tailscale, sign in to the same account, open that"
echo "URL in Safari, then Share > Add to Home Screen."
"$TS" serve status
