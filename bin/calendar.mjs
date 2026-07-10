#!/usr/bin/env node
// Writes today's and tomorrow's calendar events to data/calendar.json using
// EventKit through osascript JXA. No Calendar.app launch, no dependencies.
// First ever run triggers one macOS permission prompt; a denial is recorded
// honestly as a setup state, never fabricated around.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'data', 'calendar.json')

const JXA = `
ObjC.import('EventKit')
function run() {
  const store = $.EKEventStore.alloc.init
  const status = $.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent)
  if (status === 0) {
    let done = false
    let granted = false
    const cb = function (g, err) { granted = g; done = true }
    try {
      store.requestFullAccessToEventsWithCompletion(cb)
    } catch (e) {
      try { store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, cb) } catch (e2) { return JSON.stringify({ error: 'request-failed' }) }
    }
    const deadline = Date.now() + 20000
    while (!done && Date.now() < deadline) {
      $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.2))
    }
    if (!granted) return JSON.stringify({ error: 'denied' })
  } else if (status !== 3) {
    return JSON.stringify({ error: 'denied' })
  }
  const calNow = $.NSCalendar.currentCalendar
  const startOfDay = calNow.startOfDayForDate($.NSDate.date)
  const end = startOfDay.dateByAddingTimeInterval(2 * 86400)
  const pred = store.predicateForEventsWithStartDateEndDateCalendars(startOfDay, end, $())
  const events = store.eventsMatchingPredicate(pred)
  const fmt = $.NSISO8601DateFormatter.alloc.init
  const out = []
  for (let i = 0; i < events.count; i++) {
    const ev = events.objectAtIndex(i)
    out.push({
      title: ObjC.unwrap(ev.title) || '',
      start: ObjC.unwrap(fmt.stringFromDate(ev.startDate)),
      end: ObjC.unwrap(fmt.stringFromDate(ev.endDate)),
      allDay: !!ev.allDay,
      calendar: ObjC.unwrap(ev.calendar.title) || '',
      location: ObjC.unwrap(ev.location) || '',
    })
  }
  return JSON.stringify({ events: out })
}
`

execFile('osascript', ['-l', 'JavaScript', '-e', JXA], { timeout: 30000 }, (err, stdout, stderr) => {
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
      setupNote: 'Calendar access not granted yet. Run: node bin/calendar.mjs in Terminal once and click Allow on the popup. It retries itself every half hour after that.',
      detail: String(stderr || err?.message || result?.error || '').slice(0, 300),
    }
  } else {
    doc = { updatedAt: now, source: 'eventkit', status: 'ok', events: (result.events || []).slice(0, 40) }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const tmp = OUT + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
  fs.renameSync(tmp, OUT)
  console.log('calendar:', doc.status + ',', doc.events.length, 'events')
})
