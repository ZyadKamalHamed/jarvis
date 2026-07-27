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

// The last good read, if it is recent enough to still describe today and
// tomorrow. Twelve hours keeps a real revocation from hiding behind stale data.
function readExistingOk() {
  try {
    const doc = JSON.parse(fs.readFileSync(OUT, 'utf8'))
    if (doc.status !== 'ok' || !Array.isArray(doc.events)) return null
    if (Date.now() - new Date(doc.updatedAt).getTime() > 12 * 3600000) return null
    return doc
  } catch {
    return null
  }
}

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
    // A denial here does not mean the grant is gone. TCC attributes the helper
    // to whichever process tree spawned it, so the long-running server reads
    // fine while a scheduled job or an agent shell is denied outright. Writing
    // this result would clobber a good read with an empty one and turn the
    // pipeline amber for the day, so a recent ok doc wins and we leave it be.
    const kept = readExistingOk()
    if (kept) {
      console.log('calendar: denied in this process context, kept the ok read from ' + kept.updatedAt
        + ' (' + kept.events.length + ' events)')
      return
    }
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
