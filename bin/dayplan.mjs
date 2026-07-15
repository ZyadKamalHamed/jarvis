#!/usr/bin/env node
// The day board: one prioritised list for the whole day, data/daytasks.json.
// This file is BOTH the sanctioned CLI (used by the morning agent and the
// head agent; agents never write the file directly) AND the library the
// server imports for its endpoints, so ordering and carry semantics live in
// exactly one place. Zero dependencies, atomic writes, honest errors.
//
//   node bin/dayplan.mjs show
//   node bin/dayplan.mjs plan --file <path>      (or JSON on stdin)
//   node bin/dayplan.mjs add "title" [--est 25] [--kind uni] [--career]
//                        [--detail "..."] [--url https://...] [--overflow]
//   node bin/dayplan.mjs done <id> | undone <id> | remove <id>
//   node bin/dayplan.mjs move <id> up|down|top|bottom
//   node bin/dayplan.mjs carry
//
// Board shape: { date, updatedAt, capacityMin?, tasks: [...] }. Array order
// is the priority order among open tasks; overflow tasks render under the
// IF TIME REMAINS divider; done rows keep their slot but render last.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const FILE = path.join(ROOT, 'data', 'daytasks.json')

export const DAY_KINDS = ['uni', 'study', 'career', 'fitness', 'personal', 'ops']
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function localDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
}

export function readBoard(file = FILE) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function writeBoard(board, file = FILE) {
  board.updatedAt = new Date().toISOString()
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2) + '\n')
  fs.renameSync(tmp, file)
}

// Validation is strict on purpose: the writers are agents, and a malformed
// board would fail silently on the HUD. Returns an array of error strings.
export function validateBoard(board, { date } = {}) {
  const errs = []
  if (!board || typeof board !== 'object' || Array.isArray(board)) return ['board must be a JSON object']
  if (!/^\d{4}-\d{2}-\d{2}$/.test(board.date || '')) errs.push('date must be YYYY-MM-DD')
  else if (date && board.date !== date) errs.push(`date is ${board.date}, expected ${date} (pass --date to override)`)
  if (board.capacityMin !== undefined && !(Number.isInteger(board.capacityMin) && board.capacityMin >= 0 && board.capacityMin <= 1440)) {
    errs.push('capacityMin must be an integer 0..1440')
  }
  if (!Array.isArray(board.tasks)) errs.push('tasks must be an array')
  else {
    if (board.tasks.length > 40) errs.push('more than 40 tasks is a wish list, not a day plan')
    const seen = new Set()
    board.tasks.forEach((t, i) => {
      const at = `tasks[${i}]`
      if (!t || typeof t !== 'object') return errs.push(`${at} must be an object`)
      if (!ID_RE.test(t.id || '')) errs.push(`${at}.id must be a lowercase slug`)
      else if (seen.has(t.id)) errs.push(`${at}.id "${t.id}" is duplicated`)
      seen.add(t.id)
      if (typeof t.title !== 'string' || !t.title.trim() || t.title.length > 140) errs.push(`${at}.title must be 1..140 chars`)
      if (t.detail !== undefined && (typeof t.detail !== 'string' || t.detail.length > 300)) errs.push(`${at}.detail must be a string under 300 chars`)
      if (t.kind !== undefined && !DAY_KINDS.includes(t.kind)) errs.push(`${at}.kind must be one of ${DAY_KINDS.join('|')}`)
      if (t.est !== undefined && !(Number.isInteger(t.est) && t.est >= 0 && t.est <= 480)) errs.push(`${at}.est must be minutes, integer 0..480`)
      if (t.url !== undefined && !/^https?:\/\//.test(t.url)) errs.push(`${at}.url must be http(s)`)
      for (const k of ['career', 'overflow', 'done']) {
        if (t[k] !== undefined && typeof t[k] !== 'boolean') errs.push(`${at}.${k} must be boolean`)
      }
      if (t.carried !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(t.carried)) errs.push(`${at}.carried must be YYYY-MM-DD`)
    })
  }
  if (JSON.stringify(board).includes('—')) errs.push('em dashes are banned everywhere, including here')
  return errs
}

// Roll a stale board into a new day: open tasks keep their order and gain
// carried (first plan date preserved), done ones drop off with the old day.
export function carryForward(board, today = localDate()) {
  return {
    date: today,
    tasks: (board?.tasks || []).filter(t => !t.done).map(t => ({ ...t, carried: t.carried || board.date })),
  }
}

export function makeId(title, existing = []) {
  const base = String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task'
  let id = base
  for (let n = 2; existing.includes(id); n++) id = `${base}-${n}`
  return id
}

// Insert a new open task at the end of the main zone: after the last task
// that is not overflow, so it lands above the IF TIME REMAINS divider.
export function insertMain(board, task) {
  let at = 0
  board.tasks.forEach((t, i) => { if (!t.overflow) at = i + 1 })
  board.tasks.splice(at, 0, task)
}

// Reorder an open task. dir is up|down|top|bottom. The neighbour is found
// among open tasks VISIBLE to the caller (work mode passes t => !t.career),
// so an office reorder always visibly moves; invisible rows keep their
// relative slots. Crossing a zone edge flips overflow instead of moving:
// up from the first overflow task promotes it to the end of the main list,
// down from the last main task demotes it to the top of overflow.
export function moveVisible(board, id, dir, visible = () => true) {
  const tasks = board.tasks
  const t = tasks.find(x => x.id === id)
  if (!t) return { ok: false, error: 'unknown task' }
  if (t.done) return { ok: false, error: 'task is done; untick it first' }
  if (!['up', 'down', 'top', 'bottom'].includes(dir)) return { ok: false, error: 'dir must be up|down|top|bottom' }
  const zoneOf = x => (x.overflow ? 1 : 0)
  const peers = tasks.filter(x => !x.done && visible(x) && zoneOf(x) === zoneOf(t))
  const zi = peers.indexOf(t)
  const pull = () => tasks.splice(tasks.indexOf(t), 1)
  const insertBefore = ref => tasks.splice(tasks.indexOf(ref), 0, t)
  const insertAfter = ref => tasks.splice(tasks.indexOf(ref) + 1, 0, t)
  if (dir === 'top') {
    if (zi === 0) return { ok: true, changed: false }
    const first = peers[0]; pull(); insertBefore(first)
  } else if (dir === 'bottom') {
    if (zi === peers.length - 1) return { ok: true, changed: false }
    const last = peers[peers.length - 1]; pull(); insertAfter(last)
  } else if (dir === 'up') {
    if (zi > 0) { const ref = peers[zi - 1]; pull(); insertBefore(ref) }
    else if (zoneOf(t)) { // first overflow row: promote to end of main
      pull(); t.overflow = false
      let at = 0
      tasks.forEach((x, i) => { if (!x.done && !x.overflow) at = i + 1 })
      tasks.splice(at, 0, t)
    } else return { ok: true, changed: false }
  } else { // down
    if (zi < peers.length - 1) { const ref = peers[zi + 1]; pull(); insertAfter(ref) }
    else if (!zoneOf(t)) { // last main row: demote to top of overflow
      pull(); t.overflow = true
      const firstOver = tasks.find(x => !x.done && x.overflow)
      if (firstOver) insertBefore(firstOver)
      else tasks.push(t)
    } else return { ok: true, changed: false }
  }
  return { ok: true, changed: true }
}

// ---------- CLI ----------

function fail(code, msg) {
  console.error('dayplan: ' + msg)
  process.exit(code)
}

function flagValue(argv, name) {
  const i = argv.indexOf(name)
  if (i < 0) return undefined
  const v = argv[i + 1]
  argv.splice(i, 2)
  return v
}

function flagBool(argv, name) {
  const i = argv.indexOf(name)
  if (i < 0) return false
  argv.splice(i, 1)
  return true
}

async function readStdin() {
  let buf = ''
  for await (const chunk of process.stdin) buf += chunk
  return buf
}

function loadToday({ carryStale = false } = {}) {
  const today = localDate()
  let board = readBoard()
  if (!board) return { today, board: null }
  if (board.date !== today) {
    if (!carryStale) return { today, board: null, stale: board }
    board = carryForward(board, today)
  }
  return { today, board }
}

async function main() {
  const argv = process.argv.slice(2)
  const cmd = argv.shift()
  const today = localDate()

  if (cmd === 'show') {
    const board = readBoard()
    if (!board) fail(3, 'no board file yet')
    if (board.date !== today) console.error(`dayplan: note, board is stale (${board.date}); carry rolls it into today`)
    console.log(JSON.stringify(board, null, 2))
    return
  }

  if (cmd === 'plan') {
    const file = flagValue(argv, '--file')
    const dateOverride = flagValue(argv, '--date')
    const fresh = flagBool(argv, '--fresh')
    let raw
    try {
      raw = file ? fs.readFileSync(file, 'utf8') : await readStdin()
    } catch (e) {
      fail(3, 'could not read plan input: ' + e.message)
    }
    if (!raw.trim()) fail(1, 'plan needs JSON via --file <path> or stdin')
    let board
    try {
      board = JSON.parse(raw)
    } catch (e) {
      fail(2, 'plan input is not valid JSON: ' + e.message)
    }
    const errs = validateBoard(board, { date: dateOverride ? undefined : today })
    if (errs.length) fail(2, 'invalid board:\n  ' + errs.join('\n  '))
    // A replan never unticks the day: done states of matching ids survive
    // unless --fresh explicitly starts over.
    const existing = readBoard()
    if (!fresh && existing?.date === board.date) {
      for (const t of board.tasks) {
        const old = existing.tasks?.find(o => o.id === t.id)
        if (old?.done && !t.done) { t.done = true; t.doneAt = old.doneAt || null }
      }
    }
    writeBoard(board)
    const open = board.tasks.filter(t => !t.done)
    console.log(`dayplan: planned ${board.date}, ${open.length} open of ${board.tasks.length} task(s)`)
    return
  }

  if (cmd === 'carry') {
    const board = readBoard()
    if (!board) fail(3, 'no board file to carry')
    if (board.date === today) { console.log('dayplan: board is already today\'s; nothing to carry'); return }
    const next = carryForward(board, today)
    writeBoard(next)
    console.log(`dayplan: carried ${next.tasks.length} open task(s) from ${board.date} into ${today}`)
    return
  }

  if (cmd === 'add') {
    const title = argv.filter(a => !a.startsWith('--'))[0]
    if (!title || !title.trim() || title.length > 140) fail(1, 'add needs a title of 1..140 chars')
    const est = flagValue(argv, '--est')
    const kind = flagValue(argv, '--kind')
    const detail = flagValue(argv, '--detail')
    const url = flagValue(argv, '--url')
    const career = flagBool(argv, '--career')
    const overflow = flagBool(argv, '--overflow')
    let { board, stale } = loadToday()
    if (!board) board = stale ? carryForward(stale, today) : { date: today, tasks: [] }
    const task = {
      id: makeId(title, board.tasks.map(t => t.id)),
      title: title.trim(),
      ...(detail ? { detail } : {}),
      kind: kind || 'personal',
      ...(est !== undefined ? { est: Number(est) } : {}),
      career,
      overflow,
      ...(url ? { url } : {}),
      done: false,
      doneAt: null,
    }
    const probe = { date: board.date, tasks: [...board.tasks, task] }
    const errs = validateBoard(probe, { date: today })
    if (errs.length) fail(2, 'invalid task:\n  ' + errs.join('\n  '))
    if (overflow) board.tasks.push(task)
    else insertMain(board, task)
    writeBoard(board)
    console.log(`dayplan: added "${task.title}" (${task.id}${task.est ? ', ' + task.est + 'm' : ''})${overflow ? ' to overflow' : ''}`)
    return
  }

  if (cmd === 'done' || cmd === 'undone') {
    const id = argv[0]
    const { board } = loadToday()
    if (!board) fail(3, 'no board for today')
    const t = board.tasks.find(x => x.id === id)
    if (!t) fail(2, `no task "${id}" on today's board`)
    t.done = cmd === 'done'
    t.doneAt = t.done ? new Date().toISOString() : null
    writeBoard(board)
    console.log(`dayplan: "${t.title}" ${t.done ? 'ticked off' : 'back on the list'}`)
    return
  }

  if (cmd === 'remove') {
    const id = argv[0]
    const { board } = loadToday()
    if (!board) fail(3, 'no board for today')
    const i = board.tasks.findIndex(x => x.id === id)
    if (i < 0) fail(2, `no task "${id}" on today's board`)
    const [gone] = board.tasks.splice(i, 1)
    writeBoard(board)
    console.log(`dayplan: removed "${gone.title}"`)
    return
  }

  if (cmd === 'move') {
    const [id, dir] = argv
    const { board } = loadToday()
    if (!board) fail(3, 'no board for today')
    const r = moveVisible(board, id, dir)
    if (!r.ok) fail(2, r.error)
    writeBoard(board)
    console.log(r.changed ? `dayplan: moved ${id} ${dir}` : `dayplan: ${id} is already at the ${dir === 'down' || dir === 'bottom' ? 'bottom' : 'top'}`)
    return
  }

  fail(1, 'usage: dayplan.mjs show | plan | add | done | undone | remove | move | carry (see file header)')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => fail(3, e.message))
}
