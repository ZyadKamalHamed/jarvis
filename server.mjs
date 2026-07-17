#!/usr/bin/env node
// JARVIS local server. Zero dependencies. Node 18+.
// Serves the HUD, aggregates data files, streams updates, bridges to
// claude -p for questions and to ElevenLabs / macOS say for voice.

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BANNED } from './bin/banned-terms.mjs'
import { carryForward, moveVisible, makeId, insertMain } from './bin/dayplan.mjs'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(ROOT, 'data')
const PUBLIC = path.join(ROOT, 'public')
const CACHE = path.join(ROOT, '.cache', 'tts')
const AIOS_DATA = process.env.AIOS_DATA || path.join(os.homedir(), 'Coding/AIOS/data/aios-data.json')
const AIOS_DASH = process.env.AIOS_DASH || path.join(os.homedir(), 'Coding/AIOS/dashboard/index.html')
const PORT = Number(process.env.JARVIS_PORT || 4777)
const HOST = process.env.JARVIS_HOST || '127.0.0.1'

loadDotEnv()

// launchd starts the server with a bare PATH (/usr/bin:/bin); claude lives
// in ~/.local/bin and homebrew node in /opt/homebrew/bin. Extend once at
// boot so every spawn resolves exactly as it would from a login shell.
process.env.PATH = [
  path.join(os.homedir(), '.local/bin'),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  process.env.PATH || '/usr/bin:/bin',
].join(':')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aiff': 'audio/aiff',
  '.wav': 'audio/wav',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
}

function loadDotEnv() {
  const envPath = path.join(ROOT, '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(file, obj) {
  const tmp = file + '.tmp-' + process.pid
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2) + '\n')
  await fsp.rename(tmp, file)
}

// ---------- data aggregation ----------

const MODULE_FILES = ['briefing', 'uni', 'study', 'fitness', 'work', 'emails', 'system']

async function currentMode(url) {
  if (url && url.searchParams.get('work') === '1') return 'work'
  const m = await readJson(path.join(DATA, 'mode.json'), { mode: 'full' })
  return m.mode === 'work' ? 'work' : 'full'
}

async function readJsonl(file, limit) {
  try {
    const lines = (await fsp.readFile(file, 'utf8')).trim().split('\n').filter(Boolean)
    return { count: lines.length, entries: lines.slice(-limit).map(l => JSON.parse(l)) }
  } catch {
    return null
  }
}

// True when the string carries no banned-list term; the work-mode guard for
// free text that has to travel partially (system notes, day-board rows).
function scansClean(s) {
  return !BANNED.some(t => String(s || '').toLowerCase().includes(t))
}

// Work-mode visibility for one day-board task. The career flag is the primary
// filter, but quick-added tasks are Zyad's own free text and arrive unflagged
// by design (the add endpoint accepts no flags). LESSON 15 Jul: three career
// tasks typed into the add box walked straight through to the work payload,
// so every row's visible text must also scan clean. A dirty row vanishes
// whole; a task title cannot be degraded the way a pipeline note can.
function workVisibleDaytask(t) {
  return !t.career && scansClean([t.title, t.detail, t.url, t.draft, t.doc].join(' '))
}

function stripCareer(payload) {
  // Server-side stealth: no career data may leave the process in work mode.
  const out = { ...payload }
  delete out.career
  delete out.wins // the impact log is review ammunition, career by definition
  if (out.metrics) {
    out.metrics = out.metrics.map(m => {
      const pipelines = { ...(m.pipelines || {}) }
      delete pipelines.career
      // LESSON 15 Jul: the run note is agent-authored free text composed
      // with career context in scope (it named application targets). Like
      // the inbox it cannot be auto-classified, so it never travels; the
      // trend strip only needs the pipeline statuses anyway.
      const { note, ...rest } = m
      return { ...rest, pipelines }
    })
  }
  if (out.briefing) {
    // Module filter first, then a scansClean gate on every surviving
    // section. LESSON 16 Jul: the morning agent writes section bodies with
    // career context in scope and named application targets inside the
    // email section, which is module 'email' and sailed past the module
    // filter. A dirty section vanishes whole; absence is honest, a scrub
    // would advertise that something was hidden.
    const sections = (out.briefing.sections || [])
      .filter(s => s.module !== 'career' && scansClean(JSON.stringify(s)))
    const wh = out.briefing.workHeadline
    const wv = out.briefing.workVoiceScript
    out.briefing = {
      ...out.briefing,
      sections,
      headline: (wh && scansClean(wh) ? wh : null) || sections[0]?.title || 'Systems nominal.',
      voiceScript: (wv && scansClean(wv) ? wv : null) || sections.map(s => s.body).join(' '),
      audioFile: null,
    }
    delete out.briefing.workVoiceScript
    delete out.briefing.workHeadline
  }
  if (out.emails) {
    // The jobhunt account flag is data discipline, not enforcement, and the
    // 16 Jul sync wrote accounts unflagged: application threads walked
    // straight into the work payload. Serving-time gate: flagged accounts
    // vanish, survivors keep only threads that scan clean, and an account
    // whose own label or address scans dirty vanishes with them.
    out.emails = {
      ...out.emails,
      accounts: (out.emails.accounts || [])
        .filter(a => !a.jobhunt && scansClean(a.label) && scansClean(a.address))
        .map(a => ({ ...a, topThreads: (a.topThreads || []).filter(t => scansClean(JSON.stringify(t))) })),
    }
  }
  if (out.system) {
    // Career pipeline rows vanish; the survivors keep their notes ONLY when
    // the note scans clean, because the morning agent writes those notes with
    // career context in scope and has already leaked employer names into
    // work-visible rows once (15 Jul). A stripped note degrades to the bare
    // status on the HUD, which is honest and safe.
    out.system = {
      ...out.system,
      pipelines: (out.system.pipelines || [])
        .filter(p => p.id !== 'career' && !p.career)
        .map(p => (scansClean(p.note) ? p : { ...p, note: '' })),
    }
  }
  if (out.proposals) {
    // The flag key itself would leak the word "career" into the payload;
    // survivors are by definition not career items, so drop the field too.
    out.proposals = out.proposals.filter(p => !p.career).map(({ career, ...rest }) => rest)
  }
  if (out.evolution) {
    // Only the summary is contractually work-safe. The detail is agent
    // free text composed with career context in scope, and the evolve run
    // writes it AFTER its own selfcheck gate, so the server cannot trust
    // it. LESSON 17 Jul: the 16 Jul detail carried a banned term into the
    // overnight work payload. Detail never travels; a summary that scans
    // dirty degrades to a stock line rather than leaking.
    const { detail, ...rest } = out.evolution
    out.evolution = scansClean(rest.summary)
      ? rest
      : { ...rest, summary: 'One improvement landed overnight.' }
  }
  if (out.todos) {
    out.todos = out.todos.filter(t => !t.career).map(({ career, ...rest }) => rest)
  }
  if (out.daytasks) {
    out.daytasks = {
      ...out.daytasks,
      tasks: (out.daytasks.tasks || []).filter(workVisibleDaytask).map(({ career, ...rest }) => rest),
    }
  }
  if (out.study) {
    // Recall cards carry the same binding flag as day-board tasks (DSA and
    // interview decks are career material). Survivors shed the flag key and
    // the counts are recomputed so the chip stays honest at the office.
    const shed = arr => (arr || []).filter(e => !e.career).map(({ career, ...rest }) => rest)
    const queue = shed(out.study.queue)
    const est = queue.reduce((a, e) => a + (e.estMin || 2), 0)
    out.study = {
      ...out.study,
      queue,
      upcoming: shed(out.study.upcoming),
      stats: {
        ...(out.study.stats || {}),
        dueCount: queue.length,
        sessionMin: queue.length ? Math.min(20, Math.max(5, est)) : 0,
      },
    }
  }
  if (out.agents) {
    // agentsRoster already filters by mode; this repeats it at the chokepoint
    // so a future unmoded call cannot leak the deck.
    out.agents = out.agents
      .filter(a => !a.career)
      .map(({ career, workDescription, ...rest }) => ({ ...rest, description: workDescription || rest.description }))
  }
  // Captured thoughts are free text and cannot be auto-classified; the whole
  // inbox stays out of work mode (capturing still works there, write-only).
  delete out.inbox
  // Same logic for calendar events: an interview title cannot be told apart
  // from a dentist appointment automatically, so none of them travel.
  delete out.calendar
  // The manual briefing trigger is a full-mode surface; its status goes too.
  delete out.dailyJob
  return out
}

const GUIDES_DIR = path.join(ROOT, 'guides')
const AGENTS_DIR = path.join(ROOT, '.claude', 'agents')

// The agent deck roster. Subagents parse live from .claude/agents/*.md
// frontmatter so the deck never drifts from reality; the head agent and the
// launchd jobs are configured in code and plists, so their entries live here
// with honest strings. figure names map to hologram silhouettes in the HUD.
const BUILTIN_AGENTS = [
  {
    id: 'jarvis', name: 'J.A.R.V.I.S.', figure: 'butler',
    role: 'Head agent and voice of the house', model: 'subscription default',
    tools: ['Repo read/write', 'bin/ scripts', 'git', 'WebSearch', 'Subagent delegation', 'Session memory'],
    description: 'The one you talk to. Every ask from the prompt bar runs as a claude -p session with per-mode daily memory; he answers in persona and delegates specialist work to the others on this deck. In work mode he answers tool-less from the stripped snapshot and the work-safe memory file.',
  },
  {
    id: 'daily-run', name: 'Daily Run', figure: 'herald',
    role: 'The 7:30am briefing agent', model: 'subscription default',
    tools: ['Module refresh scripts', 'Repo writes', 'WebSearch', 'Draft writing', 'Tab opening (full mode)', 'Telegram ping'],
    description: 'Wakes before you do. Refreshes every module, checks that links answer, writes any drafts the day needs, composes the day plan and the briefing, renders the voice track and pings your phone when it is ready. launchd fires it at 7:30 each morning.',
  },
  {
    id: 'evolve', name: 'Evolve', figure: 'tinker',
    role: 'The 9:30pm self-improvement loop', model: 'subscription default',
    tools: ['Repo writes', 'git commit loop', 'bin/selfcheck.mjs', 'Nightly backups'],
    description: 'Reads the day\'s feedback and telemetry, makes one small verified improvement, passes selfcheck, commits, and reports through the While You Slept section. It may strengthen stealth, never relax it.',
  },
  {
    id: 'catchup', name: 'Catchup', figure: 'sprinter',
    role: 'The half-hourly safety net', model: 'none (shell script)',
    tools: ['launchd StartInterval', 'Per-job locks', 'Network wait'],
    description: 'A launchd sweeper, not a mind. Every thirty minutes it checks what the day still owes: no briefing after 7:30, no evolve run after 21:30, and starts the missing job. Offline mornings cost half an hour, not the day.',
  },
]

const AGENT_FIGURES = { scribe: 'scribe', researcher: 'researcher', coach: 'coach', 'career-analyst': 'analyst' }

function parseAgentFrontmatter(text) {
  // Minimal YAML-ish reader for the frontmatter shape these files use:
  // scalar "key: value" lines plus one "tools:" block of "- item" lines.
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return null
  const out = { tools: [] }
  let inTools = false
  for (const line of m[1].split('\n')) {
    const item = line.match(/^\s+-\s+(.+)$/)
    if (inTools && item) { out.tools.push(item[1].trim()); continue }
    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (!kv) continue
    inTools = kv[1] === 'tools'
    if (!inTools) out[kv[1]] = kv[2].trim()
  }
  return out.name ? out : null
}

async function agentsRoster(mode) {
  const roster = BUILTIN_AGENTS.map(a => ({ ...a }))
  try {
    for (const f of (await fsp.readdir(AGENTS_DIR)).sort()) {
      if (!f.endsWith('.md')) continue
      const fm = parseAgentFrontmatter(await fsp.readFile(path.join(AGENTS_DIR, f), 'utf8'))
      if (!fm) continue
      roster.push({
        id: fm.name,
        name: fm.name,
        figure: AGENT_FIGURES[fm.name] || 'spark',
        role: fm.role || 'Specialist subagent',
        model: fm.model || 'inherited',
        tools: fm.tools,
        description: fm.description || '',
        workDescription: fm.workDescription,
        career: fm.career === 'true',
      })
    }
  } catch { /* no agents dir is a valid state */ }
  if (mode !== 'work') return roster.map(({ workDescription, ...a }) => a)
  // Work mode: career agents vanish entirely; survivors swap in their
  // work-safe description and shed the flag keys (the key names themselves
  // are banned words, same reasoning as proposals).
  return roster
    .filter(a => !a.career)
    .map(({ career, workDescription, ...a }) => ({ ...a, description: workDescription || a.description }))
}

async function guidesIndex() {
  // Walkthrough guides live one JSON per file in guides/. The index maps each
  // to its operator todo so the HUD can show a start button on the board.
  try {
    const files = await fsp.readdir(GUIDES_DIR)
    const out = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const g = await readJson(path.join(GUIDES_DIR, f))
      if (g?.todoId && Array.isArray(g.steps) && g.steps.length) {
        out.push({ slug: f.slice(0, -5), todoId: g.todoId, career: !!g.career })
      }
    }
    return out
  } catch {
    return []
  }
}

async function aggregate(mode) {
  const payload = { generatedAt: new Date().toISOString(), mode }
  await Promise.all(
    MODULE_FILES.map(async name => {
      payload[name === 'emails' ? 'emails' : name] = await readJson(path.join(DATA, name + '.json'))
    })
  )
  if (payload.briefing?.sections) {
    const gone = await dismissedIds(payload.briefing.date)
    if (gone.length) {
      payload.briefing = {
        ...payload.briefing,
        sections: payload.briefing.sections.filter(s => !gone.includes(s.id)),
      }
    }
  }
  payload.career = await readJson(AIOS_DATA)
  payload.wins = await readJsonl(path.join(DATA, 'wins.jsonl'), 50)
  payload.metrics = (await readJsonl(path.join(DATA, 'metrics.jsonl'), 14))?.entries || null
  payload.evolution = await readJson(path.join(DATA, 'evolution.json'))
  payload.proposals = (await readJson(path.join(DATA, 'proposals.json'), [])) || []
  payload.todos = (await readJson(path.join(DATA, 'todos.json'), [])) || []
  // Annotate todos that have a guided walkthrough. Career-flagged guides
  // never annotate in work mode, so the button cannot appear there at all.
  const guides = await guidesIndex()
  for (const t of payload.todos) {
    const g = guides.find(g => g.todoId === t.id && !(mode === 'work' && g.career))
    if (g) t.guide = g.slug
  }
  // The day board lives and dies with its date: a stale or absent file means
  // no board at all, so yesterday's list never carries into a new morning.
  const day = await readJson(path.join(DATA, 'daytasks.json'))
  payload.daytasks = day?.date === localDate() && Array.isArray(day.tasks) ? day : null
  for (const t of payload.daytasks?.tasks || []) {
    const g = guides.find(g => g.todoId === t.id && !(mode === 'work' && g.career))
    if (g) t.guide = g.slug
  }
  payload.weather = await weatherPayload() // not career data; serves in both modes
  payload.calendar = await calendarPayload() // stripped whole in work mode
  const inbox = (await readJson(INBOX_FILE, [])) || []
  payload.inbox = inbox.filter(i => !i.done && !i.selfcheck).slice(-20)
  payload.dailyJob = { running: fs.existsSync(DAILY_LOCK) } // stripped in work mode
  payload.agents = await agentsRoster(mode) // already mode-filtered at source
  return mode === 'work' ? stripCareer(payload) : payload
}

// ---------- weather (Open-Meteo, Sydney, no key, lazily refreshed) ----------

const WEATHER_FILE = path.join(DATA, 'weather.json')
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=-33.87&longitude=151.21'
  + '&current=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m'
  + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
  + '&timezone=Australia%2FSydney&forecast_days=2'

const WMO = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'fog', 51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'freezing rain',
  71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
  80: 'showers', 81: 'showers', 82: 'heavy showers',
  85: 'snow showers', 86: 'snow showers', 95: 'thunderstorm', 96: 'thunderstorm', 99: 'thunderstorm',
}

let weatherFetching = false

async function refreshWeather() {
  if (weatherFetching) return
  weatherFetching = true
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const res = await fetch(WEATHER_URL, { signal: ctrl.signal })
    clearTimeout(t)
    if (!res.ok) throw new Error('open-meteo ' + res.status)
    const j = await res.json()
    const day = i => ({
      minC: j.daily?.temperature_2m_min?.[i] ?? null,
      maxC: j.daily?.temperature_2m_max?.[i] ?? null,
      rainPct: j.daily?.precipitation_probability_max?.[i] ?? null,
      label: WMO[j.daily?.weather_code?.[i]] || '',
    })
    await writeJsonAtomic(WEATHER_FILE, {
      updatedAt: new Date().toISOString(),
      source: 'open-meteo',
      city: 'Sydney',
      current: {
        tempC: j.current?.temperature_2m ?? null,
        feelsC: j.current?.apparent_temperature ?? null,
        label: WMO[j.current?.weather_code] || '',
        windKmh: j.current?.wind_speed_10m ?? null,
      },
      today: day(0),
      tomorrow: day(1),
    })
  } catch (e) {
    // No fabrication: a failed fetch leaves the old file (or nothing) as is.
    console.warn('weather refresh failed:', e.message)
  } finally {
    weatherFetching = false
  }
}

async function weatherPayload() {
  const w = await readJson(WEATHER_FILE)
  const age = w?.updatedAt ? Date.now() - new Date(w.updatedAt).getTime() : Infinity
  if (age > 30 * 60000) refreshWeather() // fire and forget; stale is served now, the write triggers SSE
  return w
}

// ---------- calendar (EventKit via bin/calendar.mjs, same lazy pattern) ----------

const CALENDAR_FILE = path.join(DATA, 'calendar.json')
let calendarSpawning = false

async function calendarPayload() {
  const c = await readJson(CALENDAR_FILE)
  const age = c?.updatedAt ? Date.now() - new Date(c.updatedAt).getTime() : Infinity
  if (age > 30 * 60000 && !calendarSpawning) {
    calendarSpawning = true
    const child = spawn('node', [path.join(ROOT, 'bin', 'calendar.mjs')], { stdio: 'ignore' })
    child.on('close', () => { calendarSpawning = false })
    child.on('error', () => { calendarSpawning = false })
  }
  return c
}

// ---------- SSE ----------

const sseClients = new Set()
let debounceTimer = null

function notifyClients() {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    for (const res of sseClients) res.write('data: update\n\n')
  }, 300)
}

function watchData() {
  try {
    fs.watch(DATA, { recursive: true }, notifyClients)
  } catch (e) {
    console.error('watch data/ failed:', e.message)
  }
  try {
    fs.watch(path.dirname(AIOS_DATA), (_e, f) => {
      if (f === path.basename(AIOS_DATA)) notifyClients()
    })
  } catch {
    console.warn('AIOS data not watchable at', AIOS_DATA)
  }
}

// ---------- ask JARVIS (claude -p head agent with session memory, serialised) ----------

const ASK_SESSION_FILE = path.join(DATA, 'ask-session.json')
const CONVO_FILE = path.join(DATA, 'conversations.jsonl')

function localDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
}

async function recordConversation(entry) {
  await fsp.appendFile(CONVO_FILE, JSON.stringify(entry) + '\n')
}

async function readConversations(mode, limit = 40) {
  const log = await readJsonl(CONVO_FILE, 500)
  if (!log) return []
  // Work mode may only ever see exchanges that happened in work mode; a
  // full-mode exchange can carry career content in either direction.
  // LESSON 14 Jul: the mode tag alone is not enough. Zyad can type career
  // words into a work-mode ask (the agent declines, but the question is
  // recorded verbatim), and the log would replay his own words at the
  // office. So work mode additionally drops any entry that scans dirty.
  const leaks = e => {
    const blob = JSON.stringify(e).toLowerCase()
    return BANNED.some(t => blob.includes(t))
  }
  const entries = mode === 'work'
    ? log.entries.filter(e => e.mode === 'work' && !leaks(e))
    : log.entries
  return entries.slice(-limit)
}

function trimmedSnapshot(payload) {
  // Every-turn context stays small; the agent has Read access for detail.
  const brief = payload.briefing || {}
  return {
    now: new Date().toISOString(),
    mode: payload.mode,
    headline: brief.headline,
    sections: (brief.sections || []).map(s => ({ module: s.module, title: s.title, priority: s.priority })),
    careerStats: payload.career?.stats || null,
    assignments: (payload.uni?.assignments || []).filter(a => a.status !== 'done').map(a => ({ title: a.title, due: a.due, progressPct: a.progressPct })),
    reviewsDue: payload.study?.queue?.length ?? null,
    // Today's recall load rides along so voice can name the topics and cue
    // the session. Built from the mode-filtered payload, so work mode
    // inherits the career strip automatically.
    recall: payload.study
      ? {
          due: (payload.study.queue || []).slice(0, 6).map(q => ({ id: q.id || q.noteId, title: q.title, estMin: q.estMin ?? null })),
          sessionMin: payload.study.stats?.sessionMin ?? 0,
          scheduledAhead: payload.study.stats?.scheduledAhead ?? 0,
        }
      : null,
    proposalsPending: (payload.proposals || []).filter(p => !p.status).map(p => p.title),
    weather: payload.weather ? { nowC: payload.weather.current?.tempC, today: payload.weather.today } : null,
    // The open day board rides along (ids included) so plan questions and
    // voice edits need no file reads. Built from the mode-filtered payload,
    // so work mode inherits the career strip automatically.
    dayBoard: payload.daytasks
      ? {
          capacityMin: payload.daytasks.capacityMin ?? null,
          open: (payload.daytasks.tasks || []).filter(t => !t.done)
            .map(t => ({ id: t.id, title: t.title, est: t.est ?? null, kind: t.kind, overflow: !!t.overflow })),
          doneCount: (payload.daytasks.tasks || []).filter(t => t.done).length,
        }
      : null,
  }
}

let askChain = Promise.resolve()
let reviewChain = Promise.resolve()
let checkChain = Promise.resolve()

// One-shot claude grader for /api/study-check. Same subscription-only spawn
// discipline as askClaude but stateless: no session, no tools, strict JSON
// out. Resolves null on any failure so the caller can fall back to the
// static checks; a broken grader must never block a recall session.
// Exercise file for a card id. Vault ids can carry subfolder slashes and
// spaces; both are flattened to underscores (bin/study-exgen.mjs writes
// with the identical transform, keep them in lockstep).
function exerciseFile(id) {
  return path.join(DATA, 'study-exercises', id.replace(/[\/ ]/g, '_') + '.json')
}

function gradeWithClaude(prompt) {
  return new Promise(resolve => {
    checkChain = checkChain.then(() => new Promise(done => {
      const finish = v => { resolve(v); done() }
      const args = ['-p', prompt, '--output-format', 'json',
        '--disallowedTools', 'Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite']
      const env = { ...process.env }
      delete env.ANTHROPIC_API_KEY
      delete env.ANTHROPIC_AUTH_TOKEN
      let out = ''
      let child
      try {
        child = spawn('claude', args, { cwd: ROOT, env, timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] })
      } catch { return finish(null) }
      child.stdout.on('data', d => { out += d })
      child.on('error', () => finish(null))
      child.on('close', () => {
        try {
          const result = String(JSON.parse(out).result || '')
          const m = result.match(/\{[\s\S]*\}/)
          const v = JSON.parse(m ? m[0] : result)
          if (typeof v.pass !== 'boolean') return finish(null)
          finish({ pass: v.pass, feedback: String(v.feedback || '').slice(0, 800) })
        } catch { finish(null) }
      })
    }))
  })
}

// onDelta, when given, switches claude to stream-json and receives text
// fragments as they are generated; the returned promise still resolves to
// the same {ok, answer, sessionId} shape either way.
function askClaude(question, mode, onDelta) {
  const streaming = typeof onDelta === 'function'
  const run = async () => {
    const started = Date.now()
    const snapshot = trimmedSnapshot(await aggregate(mode))
    let persona
    try {
      persona = await fsp.readFile(path.join(ROOT, 'jobs', 'ask-system.md'), 'utf8')
    } catch {
      persona =
        'You are JARVIS, Zyad\'s personal assistant: precise, dry-witted, briefly spoken, Australian English, no em dashes. ' +
        'Keep answers under 150 words unless asked for detail.'
    }
    // Long-term memory: distilled nightly by the evolve agent. Work mode
    // loads a separate career-free file; the full file never crosses over.
    const memFile = path.join(DATA, mode === 'work' ? 'agent-memory-work.md' : 'agent-memory.md')
    let memory = ''
    try {
      memory = (await fsp.readFile(memFile, 'utf8')).slice(0, 6144)
    } catch { /* no memory distilled yet */ }
    if (memory.trim()) {
      persona += '\n\nLONG-TERM MEMORY (distilled from prior days; treat as trusted context, verify specifics before acting on them):\n' + memory
    }
    persona +=
      '\n\nCURRENT SNAPSHOT (read data/*.json and ~/Coding/AIOS/data/aios-data.json for detail):\n' +
      JSON.stringify(snapshot) +
      (mode === 'work'
        ? '\n\nWORK MODE IS ACTIVE: never mention job applications, the job hunt, interviews, assessments, recruiters or career moves, no matter what is asked. Do not read career data files. Decline politely if pushed.'
        : '')
    // One rolling session per mode per day: the head agent remembers the
    // whole day's conversation, and work-mode exchanges never share a
    // context window with career-aware ones.
    const sess = (await readJson(ASK_SESSION_FILE, {})) || {}
    const today = localDate()
    if (sess.date !== today) {
      sess.date = today
      sess.full = null
      sess.work = null
    }
    const fresh = !sess[mode]
    const sid = fresh ? crypto.randomUUID() : sess[mode]
    const args = ['-p', question, '--append-system-prompt', persona]
    if (streaming) args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages')
    else args.push('--output-format', 'json')
    args.push(fresh ? '--session-id' : '--resume', sid)
    if (mode === 'work') {
      // Tools could read career files regardless of the stripped snapshot;
      // work mode gets a pure conversational agent instead.
      args.push('--disallowedTools', 'Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite')
    }
    // Subscription auth only: with ANTHROPIC_API_KEY set, claude -p silently
    // bills pay-as-you-go API rates instead of the Max plan.
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    const result = await new Promise(resolve => {
      // stdin closed at spawn: claude -p otherwise waits 3s for piped input
      // and logs "no stdin data received" noise that masks real errors.
      const child = spawn('claude', args, { cwd: ROOT, env, timeout: 300000, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      let lineBuf = ''
      let finalRes = null
      child.stdout.on('data', d => {
        if (!streaming) { out += d; return }
        lineBuf += d
        let nl
        while ((nl = lineBuf.indexOf('\n')) >= 0) {
          const line = lineBuf.slice(0, nl).trim()
          lineBuf = lineBuf.slice(nl + 1)
          if (!line) continue
          try {
            const ev = JSON.parse(line)
            if (ev.type === 'stream_event') {
              const delta = ev.event?.delta
              if (delta?.type === 'text_delta' && delta.text) onDelta(delta.text)
            } else if (ev.type === 'result') {
              // A failed result must carry a real error string; "undefined"
              // in the feedback log is undiagnosable.
              finalRes = ev.is_error
                ? { ok: false, error: String(ev.result || '').trim().slice(0, 400) || 'claude reported an error with no detail' }
                : { ok: true, answer: String(ev.result || '').trim(), sessionId: ev.session_id }
            }
          } catch { /* non-JSON noise on stdout; ignore */ }
        }
      })
      child.stderr.on('data', d => (err += d))
      child.on('error', e => resolve({ ok: false, error: e.message }))
      child.on('close', code => {
        if (streaming) {
          if (finalRes) return resolve(finalRes)
          return resolve({ ok: false, error: (err.trim() || 'stream ended without a result, exit ' + code).slice(0, 400) })
        }
        if (code !== 0) return resolve({ ok: false, error: (err || out).trim().slice(0, 400) || 'claude exited ' + code })
        try {
          const j = JSON.parse(out)
          if (j.is_error) return resolve({ ok: false, error: String(j.result || '').trim().slice(0, 400) || 'claude reported an error with no detail' })
          resolve({ ok: true, answer: String(j.result || '').trim(), sessionId: j.session_id })
        } catch {
          resolve({ ok: true, answer: out.trim() })
        }
      })
    })
    if (result.ok) {
      sess[mode] = result.sessionId || sid
      await writeJsonAtomic(ASK_SESSION_FILE, sess)
      recordConversation({
        at: new Date().toISOString(),
        mode,
        q: String(question).slice(0, 2000),
        a: result.answer.slice(0, 4000),
        ms: Date.now() - started,
      }).catch(() => {})
    } else if (!fresh) {
      // A dead session must not brick the ask bar; next call starts clean.
      sess[mode] = null
      await writeJsonAtomic(ASK_SESSION_FILE, sess).catch(() => {})
    }
    return result
  }
  askChain = askChain.then(run, run)
  return askChain
}

// Known ask-failure classes mapped to actionable HUD copy. Telemetry keeps
// the raw error (recordFeedback runs before this); only the text the client
// sees changes. All four classes were observed live on 15 Jul 2026.
function friendlyAskError(raw) {
  const s = String(raw || '')
  if (/oauth|authenticat/i.test(s)) return 'The reasoning core has been signed out, sir. Run claude in a Terminal on the server and log in, then ask again.'
  if (/(session|usage) limit/i.test(s)) return s + (/[.!?]$/.test(s) ? '' : '.') + ' Asks resume when the limit resets.'
  if (/spawn claude ENOENT/.test(s)) return 'The claude command is not on the server\'s PATH, so asks cannot start. Restart the server from a shell where claude runs.'
  if (/exit 143|SIGTERM/i.test(s)) return 'That ask ran past the five minute limit and was stopped, sir. A smaller question should get through.'
  return s
}

// ---------- TTS ----------

async function ttsElevenLabs(text) {
  const key = process.env.ELEVENLABS_API_KEY
  const voice = process.env.ELEVENLABS_VOICE_ID || 'onwK4e9ZLuTAKqWW03F9' // Daniel: composed British male
  const model = process.env.ELEVENLABS_MODEL_ID || 'eleven_flash_v2_5'
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify({ text, model_id: model }),
  })
  if (!res.ok) throw new Error('ElevenLabs ' + res.status + ': ' + (await res.text()).slice(0, 200))
  return { buf: Buffer.from(await res.arrayBuffer()), type: 'audio/mpeg', ext: '.mp3' }
}

function ttsSay(text) {
  return new Promise((resolve, reject) => {
    const tmpBase = path.join(os.tmpdir(), 'jarvis-say-' + crypto.randomUUID())
    const aiff = tmpBase + '.aiff'
    const m4a = tmpBase + '.m4a'
    const voice = process.env.SAY_VOICE || 'Daniel'
    const say = spawn('say', ['-v', voice, '-o', aiff, text])
    say.on('close', code => {
      if (code !== 0) return reject(new Error('say exited ' + code))
      const conv = spawn('afconvert', [aiff, m4a, '-d', 'aac', '-f', 'm4af'])
      conv.on('close', async code2 => {
        try {
          const src = code2 === 0 ? m4a : aiff
          const buf = await fsp.readFile(src)
          resolve({ buf, type: code2 === 0 ? 'audio/mp4' : 'audio/aiff', ext: code2 === 0 ? '.m4a' : '.aiff' })
        } catch (e) {
          reject(e)
        } finally {
          fsp.rm(aiff, { force: true })
          fsp.rm(m4a, { force: true })
        }
      })
    })
    say.on('error', reject)
  })
}

async function tts(text, pref) {
  await fsp.mkdir(CACHE, { recursive: true })
  // The client may ask for 'say' to spare ElevenLabs credits; 'el' without
  // a key quietly becomes 'say' so the voice never just goes missing.
  const engine = pref === 'say' || !process.env.ELEVENLABS_API_KEY ? 'say' : 'el'
  const hash = crypto.createHash('sha1').update(engine + '|' + text).digest('hex')
  for (const ext of ['.mp3', '.m4a', '.aiff']) {
    const hit = path.join(CACHE, hash + ext)
    if (fs.existsSync(hit)) {
      return { buf: await fsp.readFile(hit), type: MIME[ext], ext }
    }
  }
  let result
  if (engine === 'el') {
    try {
      result = await ttsElevenLabs(text)
    } catch (e) {
      console.error('ElevenLabs failed, falling back to say:', e.message)
      result = await ttsSay(text)
    }
  } else {
    result = await ttsSay(text)
  }
  await fsp.writeFile(path.join(CACHE, hash + result.ext), result.buf)
  return result
}

// ---------- check-ins ----------

async function checkin(body) {
  const entry = { ...body, at: new Date().toISOString() }
  await fsp.mkdir(path.join(DATA, 'manual'), { recursive: true })
  await fsp.appendFile(path.join(DATA, 'manual', 'log.jsonl'), JSON.stringify(entry) + '\n')
  if (body.type === 'weight' && typeof body.kg === 'number') {
    const file = path.join(DATA, 'fitness.json')
    const fit = await readJson(file, {})
    fit.weight = fit.weight || {}
    fit.weight.currentKg = body.kg
    fit.weight.series = [...(fit.weight.series || []), { date: entry.at.slice(0, 10), kg: body.kg }].slice(-90)
    fit.updatedAt = entry.at
    await writeJsonAtomic(file, fit)
  }
  return { ok: true }
}

// ---------- health ingest (Health Auto Export pushes to this) ----------

function tokenMatches(given, expected) {
  const h = s => crypto.createHash('sha256').update(String(s)).digest()
  return crypto.timingSafeEqual(h(given), h(expected))
}

async function ingestHealth(payload) {
  const metrics = payload?.data?.metrics
  if (!Array.isArray(metrics)) {
    const e = new Error('unrecognised payload (expecting the Health Auto Export REST format)')
    e.status = 400
    throw e
  }
  const byName = {}
  for (const m of metrics) {
    const pts = Array.isArray(m?.data) ? m.data.filter(p => typeof p?.qty === 'number') : []
    if (pts.length) byName[m.name] = { units: m.units || '', last: pts[pts.length - 1] }
  }
  const file = path.join(DATA, 'fitness.json')
  const fit = (await readJson(file, {})) || {}
  const applied = []
  const w = byName.weight_body_mass
  if (w) {
    let kg = w.last.qty
    if (/lb/i.test(w.units)) kg *= 0.45359237
    kg = Math.round(kg * 10) / 10
    fit.weight = fit.weight || {}
    fit.weight.currentKg = kg
    const date = String(w.last.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    const series = (fit.weight.series || []).filter(p => p.date !== date)
    series.push({ date, kg })
    series.sort((a, b) => (a.date < b.date ? -1 : 1))
    fit.weight.series = series.slice(-90)
    applied.push('weight')
  }
  fit.nutrition = fit.nutrition || {}
  const energy = byName.dietary_energy
  if (energy) {
    let kcal = energy.last.qty
    if (/kj/i.test(energy.units)) kcal /= 4.184
    fit.nutrition.todayKcal = Math.round(kcal)
    applied.push('energy')
  }
  const grams = { protein: 'proteinG', carbohydrates: 'carbsG', total_fat: 'fatG' }
  for (const [name, key] of Object.entries(grams)) {
    if (byName[name]) {
      fit.nutrition[key] = Math.round(byName[name].last.qty)
      applied.push(name)
    }
  }
  if (applied.length) {
    fit.source = 'health-auto-export'
    fit.updatedAt = new Date().toISOString()
    await writeJsonAtomic(file, fit)
  }
  return { applied }
}

// ---------- music playlist ----------

async function listMusic() {
  const tracks = []
  if (fs.existsSync(path.join(PUBLIC, 'assets', 'boot.mp3'))) {
    tracks.push({ file: '/assets/boot.mp3', name: 'Boot track' })
  }
  try {
    for (const f of (await fsp.readdir(path.join(PUBLIC, 'assets', 'music'))).sort()) {
      if (/\.(mp3|m4a|wav|aac|ogg)$/i.test(f)) {
        tracks.push({ file: '/assets/music/' + encodeURIComponent(f), name: f.replace(/\.[^.]+$/, '') })
      }
    }
  } catch { /* no music folder yet */ }
  return { tracks }
}

// ---------- manual briefing trigger ----------

// The lock bin/run-job.sh holds while the daily job runs; its existence is
// the "a run is in flight" signal for both the endpoint and the HUD button.
const DAILY_LOCK = path.join(DATA, 'joblogs', '.lock-jarvis-daily-run')

// ---------- briefing dismissals ----------

// Section ids cleared from today's feed. Keyed to the briefing's date so the
// list resets itself the moment a new briefing lands; ids can carry career
// words, which is fine because this file is never served, only consulted.
const DISMISSED_FILE = path.join(DATA, 'dismissed.json')

async function dismissedIds(briefDate) {
  const d = await readJson(DISMISSED_FILE, null)
  return d && d.date === briefDate && Array.isArray(d.ids) ? d.ids : []
}

// ---------- quick capture inbox ----------

const INBOX_FILE = path.join(DATA, 'inbox.json')

async function capture(body, mode) {
  const items = (await readJson(INBOX_FILE, [])) || []
  if (body.id !== undefined && body.done !== undefined) {
    const hit = items.find(i => i.id === body.id)
    if (!hit) return { status: 404, out: { error: 'unknown item' } }
    hit.done = !!body.done
    hit.doneAt = hit.done ? new Date().toISOString() : null
    await writeJsonAtomic(INBOX_FILE, items)
    return { status: 200, out: { ok: true } }
  }
  const text = String(body.text || '').trim().slice(0, 500)
  if (!text) return { status: 400, out: { error: 'text required' } }
  const item = {
    id: crypto.randomUUID().slice(0, 8),
    at: new Date().toISOString(),
    text,
    mode, // captures taken at work stay invisible there but keep provenance
    done: false,
  }
  if (body.selfcheck) item.selfcheck = true
  items.push(item)
  await writeJsonAtomic(INBOX_FILE, items.slice(-500))
  return { status: 200, out: { ok: true, id: item.id } }
}

// ---------- feedback (fuel for the nightly evolve run) ----------

async function recordFeedback(entry) {
  await fsp.appendFile(path.join(DATA, 'feedback.jsonl'), JSON.stringify(entry) + '\n')
}

// ---------- http ----------

function json(res, code, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    let data = ''
    let bytes = 0
    let dead = false
    req.on('data', c => {
      if (dead) return // keep draining so the 413 can still be delivered
      bytes += c.length
      if (bytes > maxBytes) {
        dead = true
        data = ''
        const e = new Error('body too large')
        e.status = 413
        return reject(e)
      }
      data += c
    })
    req.on('error', () => {
      const e = new Error('request aborted')
      e.status = 400
      reject(e)
    })
    req.on('end', () => {
      if (dead) return
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch {
        const e = new Error('invalid JSON body')
        e.status = 400
        reject(e)
      }
    })
  })
}

async function serveStatic(res, urlPath) {
  const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '')
  let file = path.join(PUBLIC, safe)
  if (!file.startsWith(PUBLIC)) return json(res, 403, { error: 'forbidden' })
  try {
    let stat = await fsp.stat(file)
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html')
      stat = await fsp.stat(file)
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-length': stat.size })
    fs.createReadStream(file).pipe(res)
  } catch {
    json(res, 404, { error: 'not found' })
  }
}

// Rolling-hour rate limit on the ask bar: the head agent is a real claude
// session per call, so a runaway client must not be able to drain the plan.
const askTimes = []

function askRateLimited() {
  const now = Date.now()
  while (askTimes.length && now - askTimes[0] > 3600000) askTimes.shift()
  if (askTimes.length >= 30) return true
  askTimes.push(now)
  return false
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  res.setHeader('x-content-type-options', 'nosniff')
  try {
    if (url.pathname === '/api/data' && req.method === 'GET') {
      return json(res, 200, await aggregate(await currentMode(url)))
    }
    if (url.pathname === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write('data: hello\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }
    if (url.pathname === '/api/mode' && req.method === 'POST') {
      const body = await readBody(req)
      const mode = body.mode === 'work' ? 'work' : 'full'
      await writeJsonAtomic(path.join(DATA, 'mode.json'), { mode })
      notifyClients()
      return json(res, 200, { ok: true, mode })
    }
    if (url.pathname === '/api/ask' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.question) return json(res, 400, { error: 'question required' })
      if (askRateLimited()) return json(res, 429, { error: 'Thirty asks in an hour, sir. The reasoning core needs a moment.' })
      const mode = await currentMode(url)
      const question = String(body.question).slice(0, 2000)
      if (body.stream) {
        // SSE over the POST response: delta events while claude writes,
        // one done event with the full result, then the stream closes.
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        const send = (ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`) } catch { /* client gone */ } }
        const result = await askClaude(question, mode, text => send('delta', { text }))
        if (!result.ok) {
          recordFeedback({
            at: new Date().toISOString(),
            type: 'ask-failure',
            text: `ask failed: ${result.error}`.slice(0, 500),
          }).catch(() => {})
          result.error = friendlyAskError(result.error)
        }
        send('done', result)
        return res.end()
      }
      const result = await askClaude(question, mode)
      if (!result.ok) {
        recordFeedback({
          at: new Date().toISOString(),
          type: 'ask-failure',
          text: `ask failed: ${result.error}`.slice(0, 500),
        }).catch(() => {})
        result.error = friendlyAskError(result.error)
      }
      return json(res, result.ok ? 200 : 502, result)
    }
    if (url.pathname === '/api/tts' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.text) return json(res, 400, { error: 'text required' })
      // 2400 chars comfortably covers a 120-second briefing read; anything
      // longer is a mistake that would burn ElevenLabs credit for nothing.
      const { buf, type } = await tts(String(body.text).slice(0, 2400), body.engine)
      res.writeHead(200, { 'content-type': type, 'content-length': buf.length })
      return res.end(buf)
    }
    if (url.pathname === '/api/checkin' && req.method === 'POST') {
      return json(res, 200, await checkin(await readBody(req)))
    }
    if (url.pathname === '/api/music' && req.method === 'GET') {
      return json(res, 200, await listMusic())
    }
    if (url.pathname === '/api/win' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.text) return json(res, 400, { error: 'text required' })
      await fsp.appendFile(
        path.join(DATA, 'wins.jsonl'),
        JSON.stringify({ at: new Date().toISOString(), text: String(body.text).slice(0, 500) }) + '\n'
      )
      const total = (await readJsonl(path.join(DATA, 'wins.jsonl'), 1))?.count || 1
      return json(res, 200, { ok: true, total })
    }
    if (url.pathname === '/api/conversations' && req.method === 'GET') {
      const mode = await currentMode(url)
      const limit = Math.min(200, Number(url.searchParams.get('limit')) || 40)
      return json(res, 200, { entries: await readConversations(mode, limit) })
    }
    if (url.pathname === '/api/open' && req.method === 'POST') {
      // Opens a tab on the machine running the server (the briefing's
      // "pull it up" mechanic). Hard-off in work mode: no career URL may
      // ever land on a screen that might be visible at the office.
      if ((await currentMode(url)) === 'work') return json(res, 403, { error: 'unavailable in work mode' })
      if (process.platform !== 'darwin') return json(res, 501, { error: 'open is macOS only' })
      const body = await readBody(req)
      const target = String(body.url || '')
      if (!/^https?:\/\//i.test(target)) return json(res, 400, { error: 'http(s) url required' })
      spawn('open', [target], { stdio: 'ignore' }).on('error', () => {})
      return json(res, 200, { ok: true })
    }
    if (url.pathname === '/api/proposal' && req.method === 'POST') {
      if ((await currentMode(url)) === 'work') return json(res, 403, { error: 'unavailable in work mode' })
      const body = await readBody(req)
      const file = path.join(DATA, 'proposals.json')
      const proposals = (await readJson(file, [])) || []
      const hit = proposals.find(p => p.id === body.id)
      if (!hit) return json(res, 404, { error: 'unknown proposal' })
      hit.status = body.decision === 'accept' ? 'accepted' : 'dismissed'
      hit.decidedAt = new Date().toISOString()
      await writeJsonAtomic(file, proposals)
      if (hit.status === 'accepted' && hit.routine) {
        const rfile = path.join(DATA, 'routines.json')
        const routines = (await readJson(rfile, [])) || []
        routines.push({ id: hit.id, title: hit.title, routine: hit.routine, career: !!hit.career, acceptedAt: hit.decidedAt })
        await writeJsonAtomic(rfile, routines)
      }
      notifyClients()
      return json(res, 200, { ok: true, status: hit.status })
    }
    if (url.pathname === '/api/todo' && req.method === 'POST') {
      const body = await readBody(req)
      const file = path.join(DATA, 'todos.json')
      const todos = (await readJson(file, [])) || []
      const hit = todos.find(t => t.id === body.id)
      if (!hit) return json(res, 404, { error: 'unknown todo' })
      if (hit.career && (await currentMode(url)) === 'work') return json(res, 403, { error: 'unavailable in work mode' })
      hit.done = !!body.done
      hit.doneAt = hit.done ? new Date().toISOString() : null
      await writeJsonAtomic(file, todos)
      notifyClients()
      return json(res, 200, { ok: true })
    }
    if (url.pathname === '/api/daytask' && req.method === 'POST') {
      // Tick a task on the day board, untick restores it. Career tasks answer
      // 404 in work mode, identical to a bad id: a 403 would confirm to a
      // prober that a task with that id exists (same reasoning as /api/dismiss).
      const body = await readBody(req)
      const file = path.join(DATA, 'daytasks.json')
      const day = await readJson(file)
      const hit = day?.date === localDate() ? (day.tasks || []).find(t => t.id === body.id) : null
      if (!hit || ((await currentMode(url)) === 'work' && !workVisibleDaytask(hit))) {
        return json(res, 404, { error: 'unknown task' })
      }
      hit.done = !!body.done
      hit.doneAt = hit.done ? new Date().toISOString() : null
      await writeJsonAtomic(file, day)
      notifyClients()
      return json(res, 200, { ok: true })
    }
    if (url.pathname === '/api/daytask-move' && req.method === 'POST') {
      // Reorder within today's board. The neighbour is found among tasks
      // visible in the caller's mode, so an office reorder never silently
      // swaps with an invisible career row; career ids answer 404 in work
      // mode exactly like unknown ids (same reasoning as /api/daytask).
      const body = await readBody(req)
      if (!['up', 'down', 'top', 'bottom'].includes(body.dir)) return json(res, 400, { error: 'dir must be up|down|top|bottom' })
      const mode = await currentMode(url)
      const file = path.join(DATA, 'daytasks.json')
      const day = await readJson(file)
      const hit = day?.date === localDate() ? (day.tasks || []).find(t => t.id === body.id) : null
      if (!hit || (mode === 'work' && !workVisibleDaytask(hit))) return json(res, 404, { error: 'unknown task' })
      const r = moveVisible(day, body.id, body.dir, mode === 'work' ? workVisibleDaytask : () => true)
      if (!r.ok) return json(res, 400, { error: r.error })
      if (r.changed) {
        await writeJsonAtomic(file, day)
        notifyClients()
      }
      return json(res, 200, { ok: true, changed: !!r.changed })
    }
    if (url.pathname === '/api/daytask-add' && req.method === 'POST') {
      // Quick add from the HUD (td: prefix or the board's add box). Never
      // accepts flags over HTTP: everything added this way is a plain
      // personal task, so the endpoint cannot be used to plant or probe
      // career rows. A stale board is carried forward first, which is the
      // bleed rule working as designed.
      const body = await readBody(req)
      const title = String(body.title || '').trim()
      if (!title || title.length > 140) return json(res, 400, { error: 'title must be 1..140 chars' })
      if (title.includes('—')) return json(res, 400, { error: 'no em dashes, house rule' })
      const est = body.est === undefined || body.est === null ? undefined : Number(body.est)
      if (est !== undefined && !(Number.isInteger(est) && est >= 0 && est <= 480)) return json(res, 400, { error: 'est must be minutes, 0..480' })
      const urlField = body.url === undefined ? undefined : String(body.url)
      if (urlField !== undefined && !/^https?:\/\//.test(urlField)) return json(res, 400, { error: 'url must be http(s)' })
      const file = path.join(DATA, 'daytasks.json')
      const today = localDate()
      let day = await readJson(file)
      if (!day || !Array.isArray(day.tasks)) day = { date: today, tasks: [] }
      else if (day.date !== today) day = carryForward(day, today)
      const task = {
        id: makeId(title, day.tasks.map(t => t.id)),
        title,
        kind: 'personal',
        ...(est !== undefined ? { est } : {}),
        ...(urlField !== undefined ? { url: urlField } : {}),
        career: false,
        overflow: false,
        done: false,
        doneAt: null,
      }
      insertMain(day, task)
      await writeJsonAtomic(file, day)
      notifyClients()
      return json(res, 200, { ok: true, id: task.id })
    }
    if (url.pathname === '/api/study-card' && req.method === 'GET') {
      // One recall card: the prompt plus whatever the reveal should show.
      // Career cards answer 404 in work mode, identical to a bad id (same
      // reasoning as /api/guide). Ids may be legacy vault paths, so the
      // check is containment, not a slug pattern.
      const id = String(url.searchParams.get('id') || '')
      if (!id || id.length > 200 || id.includes('..') || id.startsWith('/')) {
        return json(res, 400, { error: 'bad card id' })
      }
      const state = await readJson(path.join(DATA, 'fsrs-state.json'))
      const c = state?.cards?.[id]
      if (!c || (c.career && (await currentMode(url)) === 'work')) {
        return json(res, 404, { error: 'unknown card' })
      }
      let content = null
      if (c.contentFile && /^[\w.-]+\.md$/.test(c.contentFile)) {
        try {
          content = await fsp.readFile(path.join(DATA, 'study-cards', c.contentFile), 'utf8')
        } catch { /* content file gone; the card still works as a bare prompt */ }
      }
      return json(res, 200, {
        id,
        title: c.title,
        module: c.module || 'vault',
        prompt: c.prompt || 'From memory: what are the key points of ' + c.title + '? Say them out loud before you open the note.',
        path: c.path || ((c.source || 'vault') === 'vault' ? id : null),
        content,
      })
    }
    if (url.pathname === '/api/study-review' && req.method === 'POST') {
      // Grade a recall card 1..4. The FSRS maths lives in bin/study.py alone;
      // grades are serialised through a chain so two clicks cannot race the
      // state file. Career ids answer 404 in work mode, identical to bad ids.
      const body = await readBody(req)
      const id = String(body.id || '')
      const rating = Number(body.rating)
      if (!Number.isInteger(rating) || rating < 1 || rating > 4) {
        return json(res, 400, { error: 'rating must be 1..4' })
      }
      const state = await readJson(path.join(DATA, 'fsrs-state.json'))
      const c = state?.cards?.[id]
      if (!c || (c.career && (await currentMode(url)) === 'work')) {
        return json(res, 404, { error: 'unknown card' })
      }
      const graded = await new Promise(resolve => {
        reviewChain = reviewChain.then(() => new Promise(done => {
          const child = spawn('python3', [path.join(ROOT, 'bin', 'study.py'), 'review', id, String(rating)], {
            cwd: ROOT, stdio: 'ignore',
          })
          child.on('exit', code => { resolve(code === 0); done() })
          child.on('error', () => { resolve(false); done() })
        }))
      })
      if (!graded) return json(res, 500, { error: 'grading failed' })
      notifyClients()
      return json(res, 200, { ok: true })
    }
    if (url.pathname === '/api/study-exercise' && req.method === 'GET') {
      // The interactive layer over a recall card. The tier follows the
      // evidence (recognition early, production late): FSRS reps 0-1 serve
      // multiple choice, 2-3 flashcards, 4+ the code task, falling back to
      // whatever the card's exercise file actually has. Career ids answer
      // 404 in work mode, identical to unknown ids and to cards that simply
      // have no exercise file, so the endpoint stays a non-oracle.
      const id = String(url.searchParams.get('id') || '')
      if (!id || id.length > 200 || id.includes('..') || id.startsWith('/')) {
        return json(res, 400, { error: 'bad card id' })
      }
      const state = await readJson(path.join(DATA, 'fsrs-state.json'))
      const c = state?.cards?.[id]
      if (!c || (c.career && (await currentMode(url)) === 'work')) {
        return json(res, 404, { error: 'unknown card' })
      }
      const ex = await readJson(exerciseFile(id), null)
      const has = t => t === 'code'
        ? Boolean(ex?.code?.task)
        : Array.isArray(ex?.[t]) && ex[t].length > 0
      const reps = Number(c.reps || 0)
      const prefer = reps <= 1 ? 'mc' : reps <= 3 ? 'flash' : 'code'
      const ladder = { mc: ['mc', 'flash', 'code'], flash: ['flash', 'mc', 'code'], code: ['code', 'flash', 'mc'] }
      const tier = ladder[prefer].find(has)
      if (!tier) return json(res, 404, { error: 'unknown card' })
      let exercise
      if (tier === 'mc') {
        const q = ex.mc[Math.floor(Math.random() * ex.mc.length)]
        exercise = { q: q.q, options: q.options, answer: q.answer, why: q.why || '' }
      } else if (tier === 'flash') {
        exercise = { pairs: ex.flash.map(p => ({ front: p.front, back: p.back })) }
      } else {
        // solution and checks stay server-side; checking is /api/study-check
        exercise = { task: ex.code.task, starter: ex.code.starter || '' }
      }
      return json(res, 200, { id, tier, reps, exercise })
    }
    if (url.pathname === '/api/study-check' && req.method === 'POST') {
      // Approval process for the code tier: static checks first (contains,
      // regex, absent, each with a hint), then a one-shot claude grader for
      // real feedback. The career guard runs BEFORE any file read or spawn.
      // JARVIS_NO_LLM_CHECK=1 (selfcheck) keeps the gate deterministic.
      const body = await readBody(req)
      const id = String(body.id || '')
      const code = String(body.code || '')
      if (!id || id.length > 200 || id.includes('..') || id.startsWith('/')) {
        return json(res, 400, { error: 'bad card id' })
      }
      if (!code.trim() || code.length > 20000) {
        return json(res, 400, { error: 'code must be 1 to 20000 chars' })
      }
      const state = await readJson(path.join(DATA, 'fsrs-state.json'))
      const c = state?.cards?.[id]
      if (!c || (c.career && (await currentMode(url)) === 'work')) {
        return json(res, 404, { error: 'unknown card' })
      }
      const ex = await readJson(exerciseFile(id), null)
      if (!ex?.code?.task) return json(res, 404, { error: 'unknown card' })
      const checks = []
      for (const chk of ex.code.checks || []) {
        let ok = true
        try {
          if (chk.type === 'contains') ok = code.includes(chk.value)
          else if (chk.type === 'absent') ok = !code.includes(chk.value)
          else if (chk.type === 'regex') ok = new RegExp(chk.value, 'm').test(code)
        } catch { ok = true } // a malformed pattern must not fail his work
        checks.push({ ok, hint: ok ? null : (chk.hint || 'expected: ' + chk.value) })
      }
      const staticPass = checks.every(k => k.ok)
      let verdict = null
      if (!process.env.JARVIS_NO_LLM_CHECK) {
        let content = ''
        if (c.contentFile && /^[\w.-]+\.md$/.test(c.contentFile)) {
          try {
            content = (await fsp.readFile(path.join(DATA, 'study-cards', c.contentFile), 'utf8')).slice(0, 6000)
          } catch { /* grade without the note */ }
        }
        verdict = await gradeWithClaude([
          'You are grading a spaced repetition coding exercise. Judge whether the attempt satisfies the task. Minor style differences are fine; wrong logic, wrong method or unhandled core cases are not. Indentation conveys blocks (Python).',
          'TASK:\n' + ex.code.task,
          ex.code.solution ? 'REFERENCE SOLUTION (one valid answer, not the only one):\n' + ex.code.solution : '',
          content ? 'SOURCE NOTE (context):\n' + content : '',
          'ATTEMPT:\n' + code,
          'Reply with ONLY this JSON, nothing else: {"pass": true|false, "feedback": "max 60 words, direct, name the specific fix if it fails, never use an em dash"}',
        ].filter(Boolean).join('\n\n'))
      }
      const pass = verdict ? verdict.pass : staticPass
      const feedback = verdict?.feedback
        || (staticPass
          ? 'Static checks pass. The full grader was unavailable, so treat this as a light tick.'
          : 'Static checks failed; see the hints below.')
      return json(res, 200, { ok: true, pass, graded: Boolean(verdict), checks, feedback, suggested: pass ? 3 : 1 })
    }
    if (url.pathname === '/api/uni-done' && req.method === 'POST') {
      // Tick an assignment off the University board. done:true remembers the
      // prior status so an untick restores it (Submitted stays Submitted).
      const body = await readBody(req)
      const file = path.join(DATA, 'uni.json')
      const uni = await readJson(file)
      const hit = (uni?.assignments || []).find(a => a.id === body.id)
      if (!hit) return json(res, 404, { error: 'unknown assignment' })
      if (body.done) {
        if (hit.status !== 'done') hit.prevStatus = hit.status
        hit.status = 'done'
        hit.doneAt = new Date().toISOString()
      } else {
        hit.status = hit.prevStatus || 'Not started'
        delete hit.prevStatus
        delete hit.doneAt
      }
      await writeJsonAtomic(file, uni)
      notifyClients()
      return json(res, 200, { ok: true, status: hit.status })
    }
    if (url.pathname === '/api/dismiss' && req.method === 'POST') {
      const body = await readBody(req)
      const id = String(body.id || '')
      const brief = await readJson(path.join(DATA, 'briefing.json'))
      const hit = (brief?.sections || []).find(s => s.id === id)
      // 404 for career sections in work mode, identical to a bad id: a 403
      // would confirm to a prober that a section with that id exists.
      if (!hit || (hit.module === 'career' && (await currentMode(url)) === 'work')) {
        return json(res, 404, { error: 'unknown section' })
      }
      const ids = await dismissedIds(brief.date)
      const next = body.restore ? ids.filter(x => x !== id) : ids.includes(id) ? ids : [...ids, id]
      await writeJsonAtomic(DISMISSED_FILE, { date: brief.date, ids: next })
      notifyClients()
      return json(res, 200, { ok: true })
    }
    if (url.pathname === '/api/guide' && req.method === 'GET') {
      // Guided walkthroughs for the operator board. Career guides answer 404
      // in work mode, identical to a bad id: a 403 would confirm to a prober
      // that a guide by that name exists (same reasoning as /api/dismiss).
      const id = String(url.searchParams.get('id') || '')
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return json(res, 400, { error: 'bad guide id' })
      const g = await readJson(path.join(GUIDES_DIR, id + '.json'))
      if (!g || (g.career && (await currentMode(url)) === 'work')) return json(res, 404, { error: 'unknown guide' })
      // The flag key itself would leak the word "career" into a work-mode
      // payload (same reasoning as proposals), and the client never needs it.
      const { career, ...served } = g
      return json(res, 200, served)
    }
    if (url.pathname === '/api/doc' && req.method === 'GET') {
      // Repo docs on the HUD. Blocked in work mode: the handover and plan
      // files discuss the job hunt in plain words.
      if ((await currentMode(url)) === 'work') return json(res, 403, { error: 'unavailable in work mode' })
      const name = String(url.searchParams.get('file') || '')
      if (!/^[\w.-]+\.md$/.test(name)) return json(res, 400, { error: 'bad doc name' })
      try {
        return json(res, 200, { name, text: await fsp.readFile(path.join(ROOT, 'docs', name), 'utf8') })
      } catch {
        return json(res, 404, { error: 'doc not found' })
      }
    }
    if (url.pathname === '/api/draft' && req.method === 'GET') {
      // Drafts are prepared correspondence; treat every one as career-grade.
      if ((await currentMode(url)) === 'work') return json(res, 403, { error: 'unavailable in work mode' })
      const name = String(url.searchParams.get('file') || '')
      if (!/^[\w.-]+\.md$/.test(name)) return json(res, 400, { error: 'bad draft name' })
      try {
        return json(res, 200, { name, text: await fsp.readFile(path.join(ROOT, 'drafts', name), 'utf8') })
      } catch {
        return json(res, 404, { error: 'draft not found' })
      }
    }
    if (url.pathname === '/api/run-briefing' && req.method === 'POST') {
      // Manual kick for the morning agent, built for the phone in bed case.
      // Full mode only, like every agentic surface; the per-job lock in
      // run-job.sh makes double-firing impossible.
      if ((await currentMode(url)) === 'work') return json(res, 403, { error: 'unavailable in work mode' })
      if (fs.existsSync(DAILY_LOCK)) return json(res, 409, { error: 'a briefing run is already in flight' })
      const child = spawn('bash', [path.join(ROOT, 'bin', 'run-job.sh'), path.join(ROOT, 'jobs', 'jarvis-daily-run.md')], {
        cwd: ROOT,
        detached: true,
        stdio: 'ignore',
      })
      child.on('error', () => {})
      child.unref()
      return json(res, 200, { ok: true, started: true })
    }
    if (url.pathname === '/api/health' && req.method === 'POST') {
      // Apple Health data pushed from the phone (Health Auto Export app).
      // Reachable over the tailnet only; the token stops casual mischief.
      const expected = process.env.JARVIS_HEALTH_TOKEN
      if (!expected) return json(res, 503, { error: 'health ingest not configured: set JARVIS_HEALTH_TOKEN in .env' })
      if (!tokenMatches(url.searchParams.get('token') || '', expected)) return json(res, 403, { error: 'bad token' })
      const body = await readBody(req, 512 * 1024)
      const summary = await ingestHealth(body)
      notifyClients()
      return json(res, 200, { ok: true, ...summary })
    }
    if (url.pathname === '/api/capture' && req.method === 'POST') {
      const body = await readBody(req)
      const { status, out } = await capture(body, await currentMode(url))
      if (status === 200) notifyClients()
      return json(res, status, out)
    }
    if (url.pathname === '/api/feedback' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.text) return json(res, 400, { error: 'text required' })
      if (!body.selfcheck) {
        await recordFeedback({
          at: new Date().toISOString(),
          mode: await currentMode(url),
          type: body.type || 'user',
          text: String(body.text).slice(0, 2000),
        })
      }
      return json(res, 200, { ok: true })
    }
    if ((url.pathname === '/aios' || url.pathname === '/aios/') && req.method === 'GET') {
      // The AIOS career dashboard, served from disk so it is always the
      // current build and never whatever squats on localhost:3000. In work
      // mode it answers 404, indistinguishable from not existing.
      if ((await currentMode(url)) === 'work') return json(res, 404, { error: 'not found' })
      try {
        const buf = await fsp.readFile(AIOS_DASH)
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' })
        return res.end(buf)
      } catch {
        return json(res, 404, { error: 'AIOS dashboard not found on disk' })
      }
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' })
    return await serveStatic(res, url.pathname === '/' ? '/index.html' : url.pathname)
  } catch (e) {
    console.error(req.method, url.pathname, e)
    return json(res, e.status || 500, { error: e.message })
  }
})

watchData()
server.listen(PORT, HOST, () => {
  console.log(`JARVIS online at http://${HOST}:${PORT}`)
  console.log(`AIOS feed: ${AIOS_DATA} ${fs.existsSync(AIOS_DATA) ? '(found)' : '(MISSING)'}`)
  console.log(`Voice: ${process.env.ELEVENLABS_API_KEY ? 'ElevenLabs' : 'macOS say fallback'}`)
})
