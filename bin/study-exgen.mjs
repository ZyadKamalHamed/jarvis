#!/usr/bin/env node
// Exercise generator for the active recall module.
//
//   node bin/study-exgen.mjs [--due] [--id <cardId>] [--force] [--quiet]
//
// For every card in data/fsrs-state.json that has readable content (a
// data/study-cards file, or a vault note), spawn a one-shot claude -p to
// author interactive exercises and write them to
// data/study-exercises/<id>.json. Cards whose content is unchanged
// (sourceHash) are skipped unless --force. Generation is best-effort: a
// card without exercises simply keeps the classic reveal flow, so this
// script exits 0 even when some cards fail.
//
// --due limits work to cards due within 24 hours; the morning run uses it.

import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATA = path.join(ROOT, 'data')
const EXDIR = path.join(DATA, 'study-exercises')
const VAULT = process.env.JARVIS_VAULT || path.join(os.homedir(), 'Documents', 'Obsidian Vault')

const args = process.argv.slice(2)
const FLAG = f => args.includes(f)
const onlyId = args.includes('--id') ? args[args.indexOf('--id') + 1] : null
const QUIET = FLAG('--quiet')
const log = m => { if (!QUIET) console.log(m) }

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return fallback }
}

// The exercises travel to the HUD; the no-em-dash rule applies to them the
// same as to every other surface.
function scrub(s) {
  return String(s || '').replace(/—/g, ', ').replace(/\s+,/g, ',')
}

function cardContent(id, card) {
  if (card.contentFile && /^[\w.-]+\.md$/.test(card.contentFile)) {
    try { return fs.readFileSync(path.join(DATA, 'study-cards', card.contentFile), 'utf8') } catch { /* fall through */ }
  }
  // Vault cards: the id is the vault-relative path for auto-captured notes.
  const rel = card.path || ((card.source || 'vault') === 'vault' ? id : null)
  if (rel && !rel.includes('..')) {
    for (const p of [rel, rel + '.md']) {
      try {
        const full = path.join(VAULT, p)
        if (fs.statSync(full).isFile()) return fs.readFileSync(full, 'utf8')
      } catch { /* try next */ }
    }
  }
  return null
}

function askClaudeJson(prompt) {
  return new Promise(resolve => {
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ANTHROPIC_AUTH_TOKEN
    let out = ''
    let child
    try {
      child = spawn('claude', ['-p', prompt, '--output-format', 'json',
        '--disallowedTools', 'Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite'],
      { cwd: ROOT, env, timeout: 180000, stdio: ['ignore', 'pipe', 'ignore'] })
    } catch { return resolve(null) }
    child.stdout.on('data', d => { out += d })
    child.on('error', () => resolve(null))
    child.on('close', () => {
      try {
        const result = String(JSON.parse(out).result || '')
        const m = result.match(/\{[\s\S]*\}/)
        resolve(JSON.parse(m ? m[0] : result))
      } catch { resolve(null) }
    })
  })
}

function validate(raw, id, hash) {
  const out = { id, generatedAt: new Date().toISOString(), sourceHash: hash }
  if (Array.isArray(raw?.mc)) {
    const mc = raw.mc.slice(0, 3).filter(q =>
      q && typeof q.q === 'string' && q.q.trim()
      && Array.isArray(q.options) && q.options.length === 4
      && q.options.every(o => typeof o === 'string' && o.trim())
      && Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3)
      .map(q => ({ q: scrub(q.q), options: q.options.map(scrub), answer: q.answer, why: scrub(q.why || '') }))
    if (mc.length) out.mc = mc
  }
  if (Array.isArray(raw?.flash)) {
    const flash = raw.flash.slice(0, 4).filter(p =>
      p && typeof p.front === 'string' && p.front.trim() && typeof p.back === 'string' && p.back.trim())
      .map(p => ({ front: scrub(p.front), back: scrub(p.back) }))
    if (flash.length) out.flash = flash
  }
  const c = raw?.code
  if (c && typeof c.task === 'string' && c.task.trim() && typeof c.solution === 'string' && c.solution.trim()) {
    const checks = (Array.isArray(c.checks) ? c.checks : []).slice(0, 6).filter(k =>
      k && ['contains', 'regex', 'absent'].includes(k.type) && typeof k.value === 'string' && k.value)
      .map(k => ({ type: k.type, value: k.value, hint: scrub(k.hint || '') }))
    out.code = { task: scrub(c.task), starter: scrub(c.starter || ''), checks, solution: scrub(c.solution) }
  }
  if (!out.mc && !out.flash && !out.code) return null
  if (JSON.stringify(out).length > 30000) return null
  return out
}

function prompt(card, content) {
  return [
    'Author spaced repetition exercises from this study note. Reply with ONLY a JSON object, no prose, no code fences.',
    'Shape: {"mc":[{"q","options":[4 strings],"answer":<0-3 index>,"why"} x up to 3], "flash":[{"front","back"} x up to 4], "code":{"task","starter","checks":[{"type":"contains|regex|absent","value","hint"} x up to 5],"solution"}}',
    'Rules: mc questions test the concepts that matter, one clearly correct option, plausible distractors, "why" is one sentence. flash fronts are cues, not questions copied from mc; backs are short. Include "code" ONLY if the note teaches something you can practise by writing Python: task says exactly what to write, starter is a small scaffold ending where typing begins, checks are patterns a correct answer would contain (keep them loose: method names, keywords, not whitespace), solution is a clean reference. If the note is not codeable, omit "code" entirely. Never use an em dash anywhere. Australian English.',
    'NOTE TITLE: ' + card.title,
    'NOTE PROMPT: ' + (card.prompt || ''),
    'NOTE CONTENT:\n' + content.slice(0, 7000),
  ].join('\n\n')
}

async function main() {
  const state = readJson(path.join(DATA, 'fsrs-state.json'))
  if (!state?.cards) { log('no fsrs-state.json; nothing to do'); return }
  fs.mkdirSync(EXDIR, { recursive: true })
  const soon = Date.now() + 24 * 3600e3
  const jobs = []
  for (const [id, card] of Object.entries(state.cards)) {
    if (onlyId && id !== onlyId) continue
    if (!/^[\w][\w\/ .-]{0,199}$/.test(id) || id.includes('..')) continue
    if (FLAG('--due') && card.due && new Date(card.due).getTime() > soon) continue
    const content = cardContent(id, card)
    if (!content || content.length < 80) continue
    const hash = crypto.createHash('md5').update(content).digest('hex')
    const exFile = path.join(EXDIR, id.replace(/[\/ ]/g, '_') + '.json')
    const existing = readJson(exFile)
    if (existing?.sourceHash === hash && !FLAG('--force')) continue
    jobs.push({ id, card, content, hash, exFile })
  }
  log(jobs.length + ' card(s) need exercises')
  let made = 0
  for (const j of jobs) {
    const raw = await askClaudeJson(prompt(j.card, j.content))
    const ex = raw ? validate(raw, j.id, j.hash) : null
    if (!ex) { log('  skip ' + j.id + ' (generation failed)'); continue }
    const tmp = j.exFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(ex, null, 2) + '\n')
    fs.renameSync(tmp, j.exFile)
    made++
    log('  wrote ' + path.basename(j.exFile) + ' [' + ['mc', 'flash', 'code'].filter(t => ex[t]).join(', ') + ']')
  }
  log(made + '/' + jobs.length + ' exercise files written')
}

main()
