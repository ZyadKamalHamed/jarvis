#!/bin/bash
# Builds bin/CalendarHelper.app from bin/calendar-helper.swift. Idempotent;
# calendar.mjs runs this automatically when the bundle is missing.
#
# The bundle exists purely for TCC: macOS 26 refuses to show the calendar
# permission prompt for scripts attributed to Terminal (no usage description
# in Terminal's Info.plist), so the request auto-fails silently. A compiled
# app with its own usage strings prompts properly, once, as "CalendarHelper".
# The helper was JXA until 26 Jul 2026; its bridged completion-handler call
# returned an instant denial without ever reaching tccd, so it was rewritten
# in Swift (needs the Xcode Command Line Tools, present on both machines).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/bin/CalendarHelper.app"
SRC="$ROOT/bin/calendar-helper.swift"
PLIST="$APP/Contents/Info.plist"
USAGE="JARVIS reads your calendar for today and tomorrow to plan the day. Read-only; nothing is ever created or changed."

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"

# Executable stays named "applet" so calendar.mjs needs no change.
swiftc -O -swift-version 5 -o "$APP/Contents/MacOS/applet" "$SRC"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.zyad.jarvis.calendarhelper</string>
  <key>CFBundleName</key>
  <string>CalendarHelper</string>
  <key>CFBundleExecutable</key>
  <string>applet</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSCalendarsUsageDescription</key>
  <string>$USAGE</string>
  <key>NSCalendarsFullAccessUsageDescription</key>
  <string>$USAGE</string>
</dict>
</plist>
PLIST_EOF

# Ad-hoc signature keeps the TCC grant stable across launches on this machine.
codesign --force -s - "$APP" 2>/dev/null || true

echo "built: $APP"
