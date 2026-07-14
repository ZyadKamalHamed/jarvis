#!/bin/bash
# Builds bin/CalendarHelper.app from bin/calendar-helper.jxa. Idempotent;
# calendar.mjs runs this automatically when the bundle is missing.
#
# The bundle exists purely for TCC: macOS 26 refuses to show the calendar
# permission prompt for scripts attributed to Terminal (no usage description
# in Terminal's Info.plist), so the request auto-fails silently. An applet
# with its own usage strings prompts properly, once, as "CalendarHelper".
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/bin/CalendarHelper.app"
SRC="$ROOT/bin/calendar-helper.jxa"
PLIST="$APP/Contents/Info.plist"
USAGE="JARVIS reads your calendar for today and tomorrow to plan the day. Read-only; nothing is ever created or changed."

rm -rf "$APP"
osacompile -l JavaScript -o "$APP" "$SRC"

/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string com.zyad.jarvis.calendarhelper" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier com.zyad.jarvis.calendarhelper" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :NSCalendarsUsageDescription string $USAGE" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :NSCalendarsFullAccessUsageDescription string $USAGE" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST" 2>/dev/null || true

# Ad-hoc signature keeps the TCC grant stable across launches on this machine.
codesign --force -s - "$APP" 2>/dev/null || true

echo "built: $APP"
