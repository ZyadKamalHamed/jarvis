#!/bin/bash
# JARVIS backup: tarball of everything git deliberately ignores but life
# depends on (runtime data, drafts, .env). data/ never enters git history,
# which means without this script it exists in exactly one place.
#
#   bash bin/backup.sh          -> ~/Backups/jarvis/jarvis-data-<stamp>.tgz
#   JARVIS_BACKUP_DIR=... bash bin/backup.sh   -> custom destination
#
# Keeps the newest 14 archives, drops the rest. The nightly evolve agent
# runs this first, before touching anything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${JARVIS_BACKUP_DIR:-$HOME/Backups/jarvis}"
mkdir -p "$DEST"

STAMP="$(date +%Y-%m-%d-%H%M%S)"
ARCHIVE="$DEST/jarvis-data-$STAMP.tgz"

INCLUDE=()
for p in data drafts .env; do
  [ -e "$ROOT/$p" ] && INCLUDE+=("$p")
done
if [ ${#INCLUDE[@]} -eq 0 ]; then
  echo "nothing to back up (no data/, drafts/ or .env)" >&2
  exit 1
fi

tar -czf "$ARCHIVE" -C "$ROOT" "${INCLUDE[@]}"

# Rotate: newest 14 stay.
ls -t "$DEST"/jarvis-data-*.tgz 2>/dev/null | tail -n +15 | while read -r old; do
  rm -f "$old"
done

echo "backup written: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1 | tr -d ' '))"
