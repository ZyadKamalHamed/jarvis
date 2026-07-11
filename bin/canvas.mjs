#!/usr/bin/env node
// Pulls live assignment state from the UTS Canvas API and merges it into
// data/uni.json. Runs as its own process so CANVAS_TOKEN never enters an
// agent's context: the token is read here, used here, and never printed.
// Same pattern as bin/calendar.mjs.
//
//   node bin/canvas.mjs           dry run: merged JSON to stdout, no write
//   node bin/canvas.mjs --write   atomic write to data/uni.json
//
// Merge rules: Canvas owns titles, due dates and submitted-ness. The daily
// agent owns everything editorial (nextAction, flags, progressPct, semester,
// subjects, exams), so those survive a refetch untouched. Failures are
// honest: nothing is written unless the pull succeeded.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'data', 'uni.json')
const BASE = 'https://canvas.uts.edu.au/api/v1'
const WRITE = process.argv.includes('--write')

function fail(code, msg) {
  console.error('canvas: ' + msg)
  process.exit(code)
}

function readToken() {
  const envToken = process.env.CANVAS_TOKEN
  if (envToken) return envToken.trim()
  let raw
  try {
    raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
  } catch {
    fail(2, 'no .env file found and CANVAS_TOKEN not in the environment')
  }
  const line = raw.split('\n').find(l => /^\s*(export\s+)?CANVAS_TOKEN\s*=/.test(l))
  if (!line) fail(2, 'CANVAS_TOKEN not set in .env')
  return line.replace(/^\s*(export\s+)?CANVAS_TOKEN\s*=\s*/, '').replace(/^["']|["']\s*$/g, '').trim()
}

async function get(token, route) {
  const res = await fetch(BASE + route, {
    headers: { authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 401) fail(3, 'Canvas rejected the token (401); it may have expired. Generate a new one in Canvas > Account > Settings > New access token.')
  if (!res.ok) fail(4, `Canvas answered ${res.status} on ${route}`)
  return res.json()
}

const token = readToken()

const courses = (await get(token, '/courses?enrollment_state=active&per_page=30'))
  .filter(c => c.name && !c.access_restricted_by_date)
  .slice(0, 15)
if (!courses.length) fail(4, 'token accepted but no active courses returned')

const pulled = []
for (const course of courses) {
  const assignments = await get(token,
    `/courses/${course.id}/assignments?order_by=due_at&include[]=submission&per_page=50`)
  for (const a of assignments) {
    // Undated items are compliance-module noise (Consent Matters and kin),
    // and anything long past due is history, not a plan input.
    if (!a.due_at) continue
    if (new Date(a.due_at) < Date.now() - 21 * 86400000) continue
    const submitted = !!(a.submission && (a.submission.submitted_at || a.submission.workflow_state === 'graded'))
    pulled.push({
      canvasId: a.id,
      subject: course.course_code || course.name,
      title: a.name,
      due: a.due_at,
      submitted,
      points: a.points_possible ?? null,
    })
  }
}

let existing = {}
try { existing = JSON.parse(fs.readFileSync(OUT, 'utf8')) } catch { /* first run */ }
const prior = existing.assignments || []
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
// Curated rows often paraphrase the tail of a Canvas title ("...formal
// submission" vs "...(Trans)disciplinary insights"); a long shared prefix
// still identifies the same assignment.
const same = (a, b) => a === b || (Math.min(a.length, b.length) >= 24 && (a.startsWith(b.slice(0, 24)) && b.startsWith(a.slice(0, 24))))

const merged = pulled.map(p => {
  const old = prior.find(o => o.canvasId === p.canvasId) || prior.find(o => same(norm(o.title), norm(p.title)))
  return {
    id: old?.id || 'cv-' + p.canvasId,
    canvasId: p.canvasId,
    subject: old?.subject || p.subject,
    title: p.title,
    due: p.due || old?.due || null,
    progressPct: p.submitted ? 100 : old?.progressPct ?? null,
    status: p.submitted ? 'Submitted' : old?.status || 'Not started',
    source: 'canvas',
    nextAction: old?.nextAction || '',
    flags: old?.flags || [],
    points: p.points,
  }
})
// Anything Canvas no longer lists (past courses, hand-added rows) is kept
// rather than silently dropped; the agent decides when it leaves the file.
const keep = prior.filter(o => !merged.some(m => m.id === o.id || (o.canvasId && m.canvasId === o.canvasId)))

const doc = {
  ...existing,
  updatedAt: new Date().toISOString(),
  sourceNote: `live Canvas pull: ${courses.length} active course(s), ${merged.length} assignment(s)`,
  assignments: [...merged, ...keep].sort((a, b) => String(a.due || '9').localeCompare(String(b.due || '9'))),
}

if (WRITE) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const tmp = OUT + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + '\n')
  fs.renameSync(tmp, OUT)
  console.log(`canvas: ok, ${merged.length} assignments merged into data/uni.json (${keep.length} prior kept)`)
} else {
  console.log(JSON.stringify(doc, null, 2))
  console.error(`canvas: dry run ok, ${merged.length} assignments (use --write to save)`)
}
