#!/usr/bin/env bash
# Pull the latest JARVIS, gate it, restart the service. For the always-on
# machine; safe to run any time (aborts before restart if selfcheck fails).
set -euo pipefail
cd "$(dirname "$0")/.."

git pull --ff-only
node bin/selfcheck.mjs

if launchctl print "gui/$(id -u)/com.zyad.jarvis" >/dev/null 2>&1; then
  launchctl kickstart -k "gui/$(id -u)/com.zyad.jarvis"
  echo "service restarted"
else
  lsof -ti tcp:4777 | xargs kill 2>/dev/null || true
  (nohup node server.mjs > .cache/server.log 2>&1 &)
  echo "server restarted (no LaunchAgent installed; see docs/GO-MOBILE.md)"
fi
