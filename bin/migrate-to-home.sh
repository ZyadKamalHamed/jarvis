#!/usr/bin/env bash
# Bundle everything git deliberately does not carry, for moving JARVIS to
# the home laptop: runtime data, drafts, secrets, tokens, audio assets.
# Output lands in ~/ and can be sent over Taildrop:
#   tailscale file cp ~/jarvis-move-<date>.tgz <home-laptop>:
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=~/jarvis-move-$(date +%Y%m%d).tgz
tar -czf "$OUT" \
  data \
  drafts \
  .env \
  .cache/msal_cache.json \
  public/assets/boot.mp3 \
  public/assets/music \
  2>/dev/null || true

echo "Bundle: $OUT"
tar -tzf "$OUT" | head -20
echo "..."
echo
echo "On the home laptop, after git clone:"
echo "  cd ~/Coding/JARVIS && tar -xzf ~/Downloads/$(basename "$OUT")"
echo "Then: python3 -m venv .venv-jarvis && .venv-jarvis/bin/pip install msal"
