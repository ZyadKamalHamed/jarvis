#!/usr/bin/env node
// Writes the JARVIS daily note into the Second Brain vault: today's plan,
// plus everything logged since yesterday's note (wins, check-ins, overnight
// self-improvement). Owns only Daily/YYYY-MM-DD.md; touches nothing else.
// Safe while Obsidian is open (direct vault writes are officially fine).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const VAULT = process.env.JARVIS_VAULT || path.join(os.homedir(), 'Documents/Obsidian Vault/Second Brain')

if (!fs.existsSync(VAULT)) {
  console.log('vault not found at', VAULT, '(skipping, not an error)')
  process.exit(0)
}

const readJson = f => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')) } catch { return null } }
const readJsonl = f => {
  try {
    return fs.readFileSync(path.join(ROOT, f), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l))
  } catch { return [] }
}

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })
const dayAgo = Date.now() - 24 * 3600000
const recent = rows => rows.filter(r => r.at && new Date(r.at).getTime() > dayAgo)

const briefing = readJson('data/briefing.json')
const evolution = readJson('data/evolution.json')
const study = readJson('data/study.json')
const wins = recent(readJsonl('data/wins.jsonl'))
const checkins = recent(readJsonl('data/manual/log.jsonl')).filter(c => !c.selfcheck)

const focusBlocks = checkins.filter(c => c.type === 'focus')
const focusMinutes = focusBlocks.reduce((a, c) => a + (Number(c.minutes) || 0), 0)
const weightIns = checkins.filter(c => c.type === 'weight')

const lines = []
lines.push('---')
lines.push('type: jarvis-daily')
lines.push('generated: ' + new Date().toISOString())
lines.push('---')
lines.push('')
lines.push(`# Daily log ${today}`)
lines.push('')
lines.push('Auto-written by JARVIS each morning. Edits here may be overwritten tomorrow; move keepers into a proper note.')
lines.push('')
if (briefing?.headline) {
  lines.push('## Headline')
  lines.push(briefing.headline)
  lines.push('')
}
const planSections = (briefing?.sections || []).filter(s => /day plan|career ops today/i.test(s.title || ''))
if (planSections.length) {
  lines.push('## The plan')
  for (const s of planSections) {
    lines.push(`**${s.title}.** ${s.body}`)
    lines.push('')
  }
}
lines.push('## Since yesterday')
if (wins.length) {
  for (const w of wins) lines.push(`- Win: ${w.text}`)
}
if (focusBlocks.length) lines.push(`- Deep work: ${focusBlocks.length} focus block${focusBlocks.length > 1 ? 's' : ''}, ${focusMinutes} minutes banked`)
for (const w of weightIns) lines.push(`- Weight: ${w.kg}kg`)
if (!wins.length && !focusBlocks.length && !weightIns.length) lines.push('- Nothing logged.')
lines.push('')
if (evolution?.changed && evolution.summary) {
  lines.push('## While you slept')
  lines.push(evolution.summary)
  lines.push('')
}
if (study?.stats) {
  lines.push(`Reviews due today: ${study.queue?.length ?? 0}. Streak: ${study.stats.streak ?? 0} days.`)
  lines.push('')
}
lines.push('Related: [[JARVIS System]]')
lines.push('')

const dir = path.join(VAULT, 'Daily')
fs.mkdirSync(dir, { recursive: true })
const file = path.join(dir, `${today}.md`)
const tmp = file + '.tmp-jarvis'
fs.writeFileSync(tmp, lines.join('\n'))
fs.renameSync(tmp, file)
console.log('daily note written:', file)
