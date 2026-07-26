#!/usr/bin/env node
// Writes today's and tomorrow's calendar events to data/calendar.json using
// EventKit through bin/CalendarHelper.app (compiled Swift helper, auto-built
// from bin/calendar-helper.swift on first run). No Calendar.app launch, no deps.
//
// Why the helper app: on macOS 26 an EventKit request from osascript is
// attributed to Terminal, which declares no calendar usage description, so
// TCC auto-denies WITHOUT showing a prompt. The helper carries its own
// NSCalendarsFullAccessUsageDescription, so the first run prompts properly
// ("CalendarHelper would like full access..."). A denial is still recorded
// honestly as a setup state, never fabricated around.
import { execFile, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'data', 'calendar.json')
const APP = path.join(ROOT, 'bin', 'CalendarHelper.app')
const APPLET = path.join(APP, 'Contents', 'MacOS', 'applet')

const SETUP_NOTE = 'Calendar access not granted yet. Run: node bin/calendar.mjs in Terminal once and click '
  + '"Allow Full Access" on the CalendarHelper prompt. No prompt? System Settings > Privacy & Security > '
  + 'Calendars > CalendarHelper > Full Access, then run it again.'

function writeDoc(doc) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const tmp = OUT + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
  fs.renameSync(tmp, OUT)
  console.log('calendar:', doc.status + ',', doc.events.length, 'events')
}

// Build the helper bundle if it is missing (gitignored build product; the
// home laptop builds its own on first run and gets its own TCC prompt there).
if (!fs.existsSync(APPLET) || process.argv.includes('--rebuild')) {
  try {
    execFileSync('bash', [path.join(ROOT, 'bin', 'build-calendar-helper.sh')], { stdio: 'inherit', timeout: 60000 })
  } catch (e) {
    writeDoc({
      updatedAt: new Date().toISOString(),
      source: 'eventkit',
      status: 'error',
      events: [],
      setupNote: 'CalendarHelper.app failed to build (swiftc). Run: bash bin/build-calendar-helper.sh to see why.',
      detail: String(e?.message || '').slice(0, 300),
    })
    process.exit(1)
  }
}

// Timeout must outlast the helper's 120s first-grant prompt window, so the
// wrapper never kills it while a human is still reading the Allow dialog.
execFile(APPLET, [], { timeout: 130000 }, (err, stdout, stderr) => {
  let result = null
  try { result = JSON.parse(String(stdout).trim()) } catch { /* fall through to error doc */ }
  const now = new Date().toISOString()
  let doc
  if (err || !result || result.error) {
    doc = {
      updatedAt: now,
      source: 'eventkit',
      status: result?.error === 'denied' ? 'denied' : 'error',
      events: [],
      setupNote: SETUP_NOTE,
      detail: String(stderr || err?.message || result?.error || '').slice(0, 300),
    }
  } else {
    doc = { updatedAt: now, source: 'eventkit', status: 'ok', events: (result.events || []).slice(0, 40) }
  }
  writeDoc(doc)
})
