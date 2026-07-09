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
