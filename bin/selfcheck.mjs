#!/usr/bin/env node
// JARVIS regression gate. Run before committing any change: node bin/selfcheck.mjs
//
// Boots a throwaway server instance from the code on disk (port 4779, never
// the live 4777), then verifies the contract that matters:
//   1. every data/*.json parses
//   2. /api/data (full) serves all modules
//   3. /api/data?work=1 contains ZERO career traces (stealth is load-bearing)
//   4. /api/feedback accepts a post
//   5. mode.json is byte-identical afterwards (checks must not mutate state)
// Exit 0 = safe to commit. Exit 1 = revert or fix, do not ship.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PORT = 4779
const BASE = `http://127.0.0.1:${PORT}`

// Words that must never appear in a work-mode payload, case-insensitive.
// Deliberately strict: a false positive costs a minute, a leak costs a job.
const BANNED = [
  'career', 'jobhunt', 'job hunt', 'job application', 'application', 'interview',
  'recruiter', 'leetcode', 'codesignal', 'dsa', 'aios', 'resume', 'cover letter',
  'salary review', 'garvan', 'seek.com', 'jobs surfaced', 'apps sent',
  'hirevue', 'greenhouse', 'magtanong', 'sonder', 'deloitte', 'commbank',
  'amberjack', 'gradconnection', 'avature', 'assessments.amazon',
]

const failures = []
const note = m => console.log('  ' + m)
const fail = m => { failures.push(m); console.log('  FAIL ' + m) }

function checkDataFiles() {
  const dir = path.join(ROOT, 'data')
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    } catch (e) {
      fail(`data/${f} does not parse: ${e.message}`)
    }
  }
  note('data files parse')
}

function checkWorkMemory() {
  // The work-mode memory file feeds the head agent's system prompt on a
  // screen that may be visible at the office. Same bar as the payload.
  const f = path.join(ROOT, 'data', 'agent-memory-work.md')
  if (!fs.existsSync(f)) { note('no work-mode memory file yet'); return }
  const text = fs.readFileSync(f, 'utf8').toLowerCase()
  for (const term of BANNED) {
    if (text.includes(term)) fail(`agent-memory-work.md leaks banned term: "${term}"`)
  }
  note('work-mode memory file is clean')
}

function checkGuides() {
  // Walkthrough guides render on the HUD, voice lines included, so any guide
  // not flagged career must pass the same banned-terms bar as the payload.
  // Structure is checked too: a step without body or voice renders broken.
  const dir = path.join(ROOT, 'guides')
  if (!fs.existsSync(dir)) { note('no guides directory yet'); return }
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    let g
    try {
      g = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
    } catch (e) {
      fail(`guides/${f} does not parse: ${e.message}`)
      continue
    }
    if (!g.title || !g.todoId || !Array.isArray(g.steps) || !g.steps.length) {
      fail(`guides/${f} missing title/todoId/steps`)
      continue
    }
    for (const [i, s] of g.steps.entries()) {
      if (!s.title || !s.body || !s.voice) fail(`guides/${f} step ${i + 1} missing title/body/voice`)
    }
    if (!g.career) {
      // The career flag key itself contains a banned term; the server strips
      // it before serving, so scan everything except that one key.
      const { career, ...scannable } = g
      const blob = JSON.stringify(scannable).toLowerCase()
      for (const term of BANNED) {
        if (blob.includes(term)) fail(`guides/${f} is work-visible but leaks banned term: "${term}"`)
      }
    }
  }
  note('guide files parse, steps complete, work-visible ones clean')
}

async function waitForServer(child) {
  for (let i = 0; i < 40; i++) {
    if (child.exitCode !== null) throw new Error('server exited ' + child.exitCode)
    try {
      const r = await fetch(BASE + '/api/data')
      if (r.ok) return
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('server did not come up on ' + PORT)
}

async function main() {
  console.log('JARVIS selfcheck')
  checkDataFiles()
  checkWorkMemory()
  checkGuides()

  const modeFile = path.join(ROOT, 'data', 'mode.json')
  const modeBefore = fs.existsSync(modeFile) ? fs.readFileSync(modeFile, 'utf8') : null

  const child = spawn('node', [path.join(ROOT, 'server.mjs')], {
    env: { ...process.env, JARVIS_PORT: String(PORT) },
    stdio: 'ignore',
  })
  try {
    await waitForServer(child)
    note('server boots')

    const full = await (await fetch(BASE + '/api/data')).json()
    for (const key of ['briefing', 'uni', 'study', 'fitness', 'work', 'emails', 'system']) {
      if (!(key in full)) fail(`full payload missing module: ${key}`)
    }
    note('full payload has all modules')

    const work = await (await fetch(BASE + '/api/data?work=1')).json()
    if (work.mode !== 'work') fail('?work=1 did not force work mode')
    if ('career' in work && work.career !== undefined) fail('career module present in work mode')
    const blob = JSON.stringify(work).toLowerCase()
    for (const term of BANNED) {
      if (blob.includes(term)) fail(`work-mode payload leaks banned term: "${term}"`)
    }
    if ((work.emails?.accounts || []).some(a => a.jobhunt)) fail('jobhunt account present in work mode')
    if (work.wins != null) fail('wins (impact log) present in work mode')
    if ((work.metrics || []).some(m => m.pipelines && 'career' in m.pipelines)) fail('career pipeline in work-mode metrics')
    if ((work.proposals || []).some(p => p.career)) fail('career proposal present in work mode')
    note('work-mode payload is clean (' + BANNED.length + ' banned terms checked)')

    // The action surfaces must be dead in work mode: no tab may ever open
    // and no draft may ever render on a screen that might be visible at work.
    const openRes = await fetch(BASE + '/api/open?work=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
    if (openRes.status !== 403) fail('/api/open not blocked in work mode (got ' + openRes.status + ')')
    const draftRes = await fetch(BASE + '/api/draft?work=1&file=probe.md')
    if (draftRes.status !== 403) fail('/api/draft not blocked in work mode (got ' + draftRes.status + ')')
    const docRes = await fetch(BASE + '/api/doc?work=1&file=HANDOVER.md')
    if (docRes.status !== 403) fail('/api/doc not blocked in work mode (got ' + docRes.status + ')')
    if ((work.todos || []).some(t => t.career)) fail('career todo present in work mode')
    if ('inbox' in work && work.inbox !== undefined) fail('capture inbox present in work mode')
    if ('calendar' in work && work.calendar !== undefined) fail('calendar present in work mode')
    if ('dailyJob' in work && work.dailyJob !== undefined) fail('dailyJob status present in work mode')
    const aiosWork = await fetch(BASE + '/aios/?work=1')
    if (aiosWork.status !== 404) fail('/aios visible in work mode (got ' + aiosWork.status + ')')
    if (fs.existsSync(path.join(os.homedir(), 'Coding/AIOS/dashboard/index.html'))) {
      const aiosFull = await fetch(BASE + '/aios/')
      if (aiosFull.status !== 200) fail('/aios not served in full mode (got ' + aiosFull.status + ')')
    }
    const convoRes = await (await fetch(BASE + '/api/conversations?work=1')).json()
    if ((convoRes.entries || []).some(e => e.mode !== 'work')) fail('full-mode conversation served in work mode')
    const convoBlob = JSON.stringify(convoRes).toLowerCase()
    for (const term of BANNED) {
      if (convoBlob.includes(term)) fail(`work-mode conversation log leaks banned term: "${term}"`)
    }
    note('work mode: /api/open and /api/draft blocked, conversation log filtered')

    const fb = await fetch(BASE + '/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'selfcheck probe', selfcheck: true }),
    })
    if (!fb.ok) fail('/api/feedback returned ' + fb.status)
    else note('/api/feedback accepts posts')

    const runWork = await fetch(BASE + '/api/run-briefing?work=1', { method: 'POST' })
    if (runWork.status !== 403) fail('/api/run-briefing not blocked in work mode (got ' + runWork.status + ')')
    // Probe the full-mode path WITHOUT spawning a real run: hold the job
    // lock ourselves and expect the already-running answer.
    const lockDir = path.join(ROOT, 'data', 'joblogs', '.lock-jarvis-daily-run')
    const lockWasOurs = !fs.existsSync(lockDir)
    if (lockWasOurs) fs.mkdirSync(lockDir, { recursive: true })
    try {
      const runBusy = await fetch(BASE + '/api/run-briefing', { method: 'POST' })
      if (runBusy.status !== 409) fail('/api/run-briefing ignored the job lock (got ' + runBusy.status + ')')
      else note('/api/run-briefing: 403 in work mode, honours the job lock')
    } finally {
      if (lockWasOurs) fs.rmdirSync(lockDir)
    }

    // /api/dismiss must answer 404 for an unknown id in BOTH modes. That is
    // what makes a real career section's work-mode 404 indistinguishable from
    // a bad id, so the endpoint cannot be turned into a probe that confirms a
    // career section exists. An unknown id returns before any write, so this
    // does not mutate dismissed.json.
    for (const q of ['', '?work=1']) {
      const r = await fetch(BASE + '/api/dismiss' + q, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'selfcheck-no-such-section' }),
      })
      if (r.status !== 404) fail('/api/dismiss unknown id not 404 in ' + (q ? 'work' : 'full') + ' mode (got ' + r.status + ')')
    }
    note('/api/dismiss: unknown id answers 404 in both modes (no probe oracle)')

    // /api/guide mirrors the dismiss contract: career guides answer 404 in
    // work mode, identical to a missing guide, so the endpoint cannot confirm
    // one exists. Malformed ids die before touching the filesystem.
    for (const q of ['', '?work=1']) {
      const r = await fetch(BASE + '/api/guide' + (q ? q + '&' : '?') + 'id=selfcheck-no-such-guide')
      if (r.status !== 404) fail('/api/guide unknown id not 404 in ' + (q ? 'work' : 'full') + ' mode (got ' + r.status + ')')
    }
    const trav = await fetch(BASE + '/api/guide?id=..%2Fdata%2Fmode')
    if (trav.status !== 400) fail('/api/guide traversal id not rejected (got ' + trav.status + ')')
    const guidesDir = path.join(ROOT, 'guides')
    const probeGuide = path.join(guidesDir, 'selfcheck-career-probe.json')
    fs.mkdirSync(guidesDir, { recursive: true })
    fs.writeFileSync(probeGuide, JSON.stringify({
      title: 'probe', todoId: 'selfcheck-none', career: true,
      steps: [{ title: 't', body: 'b', voice: 'v' }],
    }))
    try {
      const gWork = await fetch(BASE + '/api/guide?work=1&id=selfcheck-career-probe')
      if (gWork.status !== 404) fail('career guide visible in work mode (got ' + gWork.status + ')')
      const gFull = await fetch(BASE + '/api/guide?id=selfcheck-career-probe')
      if (gFull.status !== 200) fail('career guide not served in full mode (got ' + gFull.status + ')')
    } finally {
      fs.unlinkSync(probeGuide)
    }
    const careerSlugs = fs.existsSync(guidesDir)
      ? fs.readdirSync(guidesDir).filter(f => f.endsWith('.json')).filter(f => {
          try { return !!JSON.parse(fs.readFileSync(path.join(guidesDir, f), 'utf8')).career } catch { return false }
        }).map(f => f.slice(0, -5))
      : []
    if ((work.todos || []).some(t => t.guide && careerSlugs.includes(t.guide))) {
      fail('career guide annotated on a work-mode todo')
    }
    // And the wire itself: every guide that serves in work mode must be clean
    // end to end, exactly as the office screen would receive it.
    for (const f of fs.readdirSync(guidesDir).filter(f => f.endsWith('.json'))) {
      const slug = f.slice(0, -5)
      if (careerSlugs.includes(slug)) continue
      const served = (await (await fetch(BASE + '/api/guide?work=1&id=' + slug)).text()).toLowerCase()
      for (const term of BANNED) {
        if (served.includes(term)) fail(`work-mode /api/guide ${slug} response leaks banned term: "${term}"`)
      }
    }
    note('/api/guide: 404s match, traversal dies, career guides invisible at work, served payloads clean')

    const badHealth = await fetch(BASE + '/api/health?token=wrong-token-probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    if (![403, 503].includes(badHealth.status)) fail('/api/health accepted a bad token (got ' + badHealth.status + ')')
    else note('/api/health rejects bad tokens (' + badHealth.status + ')')

    const cap = await fetch(BASE + '/api/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'selfcheck probe', selfcheck: true }),
    })
    if (!cap.ok) fail('/api/capture returned ' + cap.status)
    else {
      const fullAfter = await (await fetch(BASE + '/api/data')).json()
      if ((fullAfter.inbox || []).some(i => i.selfcheck)) fail('selfcheck capture probe leaked into the inbox payload')
      else note('/api/capture accepts posts, probes filtered from the payload')
    }

    const oversize = await fetch(BASE + '/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(70000), selfcheck: true }),
    }).catch(() => null)
    if (!oversize || oversize.status !== 413) fail('oversize body not rejected with 413 (got ' + (oversize?.status ?? 'connection error') + ')')
    const sniff = await fetch(BASE + '/api/data')
    if (sniff.headers.get('x-content-type-options') !== 'nosniff') fail('nosniff header missing')
    note('hardening: oversize body 413, nosniff header set')

    const manifest = await fetch(BASE + '/manifest.webmanifest')
    if (!manifest.ok) fail('manifest.webmanifest not served (got ' + manifest.status + ')')
    const swSrc = await (await fetch(BASE + '/sw.js')).text()
    if (!swSrc.includes("startsWith('/api/')")) fail('service worker lost the never-cache-/api rule')
    note('PWA: manifest served, service worker keeps /api uncached')

    const modeAfter = fs.existsSync(modeFile) ? fs.readFileSync(modeFile, 'utf8') : null
    if (modeBefore !== modeAfter) fail('selfcheck mutated data/mode.json')
    else note('mode.json untouched')
  } catch (e) {
    fail(e.message)
  } finally {
    child.kill()
  }

  if (failures.length) {
    console.log(`\nSELFCHECK FAILED (${failures.length}). Do not commit. Revert if this was an automated change.`)
    process.exit(1)
  }
  console.log('\nSELFCHECK PASSED. Safe to commit.')
}

main()
