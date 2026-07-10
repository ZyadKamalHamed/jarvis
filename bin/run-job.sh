#!/bin/bash
# Runs a JARVIS job spec through headless claude. launchd calls this on the
# schedule (deploy/com.zyad.jarvis.daily.plist and .evolve.plist); it also
# works by hand: bash bin/run-job.sh jobs/jarvis-daily-run.md
#
# launchd gives scripts a bare environment, so PATH is set explicitly and
# billing-hostile env vars are stripped (subscription auth only).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN

LOGDIR="$ROOT/data/joblogs"
mkdir -p "$LOGDIR"

JOB="${1:-}"

# --selftest proves the launchd environment end to end (PATH, auth, cwd)
# without running a real job. Used once at registration; harmless anytime.
if [ "$JOB" = "--selftest" ]; then
  LOG="$LOGDIR/selftest.log"
  {
    echo "=== selftest $(date '+%Y-%m-%d %H:%M:%S') cwd=$(pwd) claude=$(command -v claude || echo MISSING)"
    claude -p "Reply with exactly: JARVIS-LAUNCHD-OK" --output-format json 2>&1
    echo ""
    echo "=== selftest exit=$?"
  } >> "$LOG" 2>&1
  exit 0
fi

if [ ! -f "$JOB" ]; then
  echo "job file not found: $JOB" >&2
  exit 1
fi

NAME="$(basename "$JOB" .md)"
LOG="$LOGDIR/$NAME-$(date +%Y-%m-%d).log"

echo "=== $NAME start $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
claude -p "Read $JOB and follow it exactly. Your working directory is $ROOT." \
  --output-format json >> "$LOG" 2>&1 &
PID=$!

# Watchdog: a wedged run must not linger past 40 minutes.
SECS=0
while kill -0 "$PID" 2>/dev/null && [ "$SECS" -lt 2400 ]; do
  sleep 10
  SECS=$((SECS + 10))
done
if kill -0 "$PID" 2>/dev/null; then
  kill -9 "$PID" 2>/dev/null
  echo "=== $NAME KILLED by watchdog after ${SECS}s" >> "$LOG"
fi
wait "$PID" 2>/dev/null
CODE=$?
echo "" >> "$LOG"
echo "=== $NAME exit=$CODE $(date '+%Y-%m-%d %H:%M:%S')" >> "$LOG"
exit "$CODE"
