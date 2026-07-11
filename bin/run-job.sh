#!/bin/bash
# Runs a JARVIS job spec through headless claude. launchd calls this on the
# schedule (deploy/com.zyad.jarvis.daily.plist and .evolve.plist); it also
# works by hand: bash bin/run-job.sh jobs/jarvis-daily-run.md
#
# Modes:
#   run-job.sh <job.md>    run one job (lock-guarded, waits for network)
#   run-job.sh --catchup   run whatever today still owes: the daily job if no
#                          briefing has been generated today and it is past
#                          7:30, the evolve job if it has not run and it is
#                          past 21:30. The catchup LaunchAgent calls this
#                          every 30 minutes, so a morning spent asleep or
#                          offline costs at most half an hour once the Mac is
#                          awake and connected. (11 Jul lesson: launchd fired
#                          the missed 7:30 on wake, but the wifi was not
#                          connected and nothing ever retried.)
#   run-job.sh --selftest  prove the launchd environment (PATH, auth, cwd)
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

stamp() { date '+%Y-%m-%d %H:%M:%S'; }

# Anthropic's API is the one dependency every job has; wait for it rather
# than failing into the void when the job fires seconds after a wake.
wait_for_network() {
  local deadline=$(( $(date +%s) + ${1:-600} ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -s -o /dev/null --max-time 5 https://api.anthropic.com/ 2>/dev/null; then
      return 0
    fi
    sleep 15
  done
  return 1
}

sydney_date_of() { # ISO timestamp -> YYYY-MM-DD in Sydney, empty on garbage
  node -e "try{const d=new Date(process.argv[1]);if(isNaN(d))throw 0;console.log(d.toLocaleDateString('en-CA',{timeZone:'Australia/Sydney'}))}catch{}" "$1" 2>/dev/null
}

run_job() {
  local JOB="$1"
  if [ ! -f "$JOB" ]; then
    echo "job file not found: $JOB" >&2
    return 1
  fi
  local NAME LOG LOCK
  NAME="$(basename "$JOB" .md)"
  LOG="$LOGDIR/$NAME-$(date +%Y-%m-%d).log"
  LOCK="$LOGDIR/.lock-$NAME"

  # One instance per job: the scheduled firing and a catchup sweep must not
  # run the same job twice. A lock older than 75 minutes is a crashed run.
  if ! mkdir "$LOCK" 2>/dev/null; then
    if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +75 2>/dev/null)" ]; then
      rmdir "$LOCK" 2>/dev/null
      mkdir "$LOCK" 2>/dev/null || { echo "=== $NAME skipped $(stamp): lock contention" >> "$LOG"; return 0; }
    else
      echo "=== $NAME skipped $(stamp): another instance is running" >> "$LOG"
      return 0
    fi
  fi
  trap 'rmdir "'"$LOCK"'" 2>/dev/null' EXIT

  echo "=== $NAME start $(stamp)" >> "$LOG"
  if ! wait_for_network 600; then
    echo "=== $NAME aborted $(stamp): no network after 10 minutes; the catchup agent will retry" >> "$LOG"
    rmdir "$LOCK" 2>/dev/null
    trap - EXIT
    return 75
  fi

  claude -p "Read $JOB and follow it exactly. Your working directory is $ROOT." \
    --output-format json >> "$LOG" 2>&1 &
  local PID=$!

  # Watchdog: a wedged run must not linger past 40 minutes.
  local SECS=0
  while kill -0 "$PID" 2>/dev/null && [ "$SECS" -lt 2400 ]; do
    sleep 10
    SECS=$((SECS + 10))
  done
  if kill -0 "$PID" 2>/dev/null; then
    kill -9 "$PID" 2>/dev/null
    echo "=== $NAME KILLED by watchdog after ${SECS}s" >> "$LOG"
  fi
  wait "$PID" 2>/dev/null
  local CODE=$?
  echo "" >> "$LOG"
  echo "=== $NAME exit=$CODE $(stamp)" >> "$LOG"
  rmdir "$LOCK" 2>/dev/null
  trap - EXIT
  return "$CODE"
}

MODE="${1:-}"

if [ "$MODE" = "--selftest" ]; then
  LOG="$LOGDIR/selftest.log"
  {
    echo "=== selftest $(stamp) cwd=$(pwd) claude=$(command -v claude || echo MISSING)"
    claude -p "Reply with exactly: JARVIS-LAUNCHD-OK" --output-format json 2>&1
    echo ""
    echo "=== selftest exit=$?"
  } >> "$LOG" 2>&1
  exit 0
fi

if [ "$MODE" = "--catchup" ]; then
  NOW_MIN=$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))
  TODAY="$(date +%Y-%m-%d)"

  BRIEFED_AT="$(node -e "try{console.log(require('$ROOT/data/briefing.json').generatedAt||'')}catch{}" 2>/dev/null)"
  BRIEFED_DAY="$(sydney_date_of "${BRIEFED_AT:-invalid}")"
  if [ "$NOW_MIN" -ge 450 ] && [ "$BRIEFED_DAY" != "$TODAY" ]; then
    echo "catchup $(stamp): briefing is from '$BRIEFED_DAY', owing today's daily run" >> "$LOGDIR/catchup.log"
    run_job "$ROOT/jobs/jarvis-daily-run.md"
  fi

  EVOLVED_AT="$(node -e "try{console.log(require('$ROOT/data/evolution.json').lastRun||'')}catch{}" 2>/dev/null)"
  EVOLVED_DAY="$(sydney_date_of "${EVOLVED_AT:-invalid}")"
  if [ "$NOW_MIN" -ge 1290 ] && [ "$EVOLVED_DAY" != "$TODAY" ]; then
    echo "catchup $(stamp): evolve last ran '$EVOLVED_DAY', owing tonight's run" >> "$LOGDIR/catchup.log"
    run_job "$ROOT/jobs/jarvis-evolve.md"
  fi
  exit 0
fi

run_job "$MODE"
exit $?
