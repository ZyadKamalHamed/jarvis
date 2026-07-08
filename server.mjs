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

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const DATA = path.join(ROOT, 'data')
const PUBLIC = path.join(ROOT, 'public')
const CACHE = path.join(ROOT, '.cache', 'tts')
const AIOS_DATA = process.env.AIOS_DATA || path.join(os.homedir(), 'Coding/AIOS/data/aios-data.json')
const PORT = Number(process.env.JARVIS_PORT || 4777)
const HOST = process.env.JARVIS_HOST || '127.0.0.1'

loadDotEnv()

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

function stripCareer(payload) {
  // Server-side stealth: no career data may leave the process in work mode.
  const out = { ...payload }
  delete out.career
  if (out.briefing) {
    const sections = (out.briefing.sections || []).filter(s => s.module !== 'career')
    out.briefing = {
      ...out.briefing,
      sections,
      headline: out.briefing.workHeadline || sections[0]?.title || 'Systems nominal.',
      voiceScript: out.briefing.workVoiceScript || sections.map(s => s.body).join(' '),
      audioFile: null,
    }
    delete out.briefing.workVoiceScript
    delete out.briefing.workHeadline
  }
  if (out.emails) {
    out.emails = {
      ...out.emails,
      accounts: (out.emails.accounts || []).filter(a => !a.jobhunt),
    }
  }
  if (out.system) {
    out.system = {
      ...out.system,
      pipelines: (out.system.pipelines || []).filter(p => p.id !== 'career' && !p.career),
    }
  }
  return out
}

async function aggregate(mode) {
  const payload = { generatedAt: new Date().toISOString(), mode }
  await Promise.all(
    MODULE_FILES.map(async name => {
      payload[name === 'emails' ? 'emails' : name] = await readJson(path.join(DATA, name + '.json'))
    })
  )
  payload.career = await readJson(AIOS_DATA)
  return mode === 'work' ? stripCareer(payload) : payload
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

// ---------- ask JARVIS (claude -p bridge, serialised) ----------

let askChain = Promise.resolve()

function askClaude(question, mode) {
  const run = async () => {
    const snapshot = await aggregate(mode)
    // Keep the context bounded; the career jobs table can be large.
    if (snapshot.career) {
      snapshot.career = {
        today: snapshot.career.today,
        stats: snapshot.career.stats,
        leetcode: snapshot.career.leetcode,
        applications: (snapshot.career.applications || []).slice(0, 25),
        jobs: (snapshot.career.jobs || []).slice(0, 25),
      }
    }
    const persona =
      'You are JARVIS, Zyad\'s personal assistant: precise, dry-witted, briefly spoken, Australian English, no em dashes. ' +
      'Answer using the data snapshot below. If the data does not contain the answer, say so plainly. ' +
      (mode === 'work'
        ? 'Work mode is active: never mention job applications, the job hunt, career moves or anything related, no matter what is asked. '
        : '') +
      'Keep answers under 150 words unless asked for detail.\n\nDATA SNAPSHOT:\n' +
      JSON.stringify(snapshot)
    // Subscription auth only: with ANTHROPIC_API_KEY set, claude -p silently
    // bills pay-as-you-go API rates instead of the Max plan.
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    return new Promise(resolve => {
      const child = spawn('claude', ['-p', persona + '\n\nQUESTION: ' + question, '--output-format', 'text'], {
        cwd: ROOT,
        env,
        timeout: 120000,
      })
      let out = ''
      let err = ''
      child.stdout.on('data', d => (out += d))
      child.stderr.on('data', d => (err += d))
      child.on('error', e => resolve({ ok: false, error: e.message }))
      child.on('close', code =>
        resolve(code === 0 ? { ok: true, answer: out.trim() } : { ok: false, error: err.trim() || 'claude exited ' + code })
      )
    })
  }
  askChain = askChain.then(run, run)
  return askChain
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

async function tts(text) {
  await fsp.mkdir(CACHE, { recursive: true })
  const engine = process.env.ELEVENLABS_API_KEY ? 'el' : 'say'
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', c => {
      data += c
      if (data.length > 1e6) reject(new Error('body too large'))
    })
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
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
      const result = await askClaude(String(body.question).slice(0, 2000), await currentMode(url))
      if (!result.ok) {
        recordFeedback({
          at: new Date().toISOString(),
          type: 'ask-failure',
          text: `ask failed: ${result.error}`.slice(0, 500),
        }).catch(() => {})
      }
      return json(res, result.ok ? 200 : 502, result)
    }
    if (url.pathname === '/api/tts' && req.method === 'POST') {
      const body = await readBody(req)
      if (!body.text) return json(res, 400, { error: 'text required' })
      const { buf, type } = await tts(String(body.text).slice(0, 5000))
      res.writeHead(200, { 'content-type': type, 'content-length': buf.length })
      return res.end(buf)
    }
    if (url.pathname === '/api/checkin' && req.method === 'POST') {
      return json(res, 200, await checkin(await readBody(req)))
    }
    if (url.pathname === '/api/music' && req.method === 'GET') {
      return json(res, 200, await listMusic())
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
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' })
    return await serveStatic(res, url.pathname === '/' ? '/index.html' : url.pathname)
  } catch (e) {
    console.error(req.method, url.pathname, e)
    return json(res, 500, { error: e.message })
  }
})

watchData()
server.listen(PORT, HOST, () => {
  console.log(`JARVIS online at http://${HOST}:${PORT}`)
  console.log(`AIOS feed: ${AIOS_DATA} ${fs.existsSync(AIOS_DATA) ? '(found)' : '(MISSING)'}`)
  console.log(`Voice: ${process.env.ELEVENLABS_API_KEY ? 'ElevenLabs' : 'macOS say fallback'}`)
})
