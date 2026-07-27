#!/usr/bin/env node
// Counts due and new inline cards for the Obsidian Spaced Repetition plugin.
// Lives in node rather than in bin/anki-due.py on purpose: homebrew python3
// holds no TCC grant for ~/Documents, so scanning the vault from python
// blocks forever in the scheduled run (nothing can show a prompt there),
// while node reads the same vault on the same run without complaint.
// Prints one JSON object to stdout: {due, new, ok, scanned, reason?}.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const VAULT = process.env.JARVIS_VAULT_ROOT || path.join(os.homedir(), 'Documents/Obsidian Vault')

// Yanki owns Flashcards (that is Anki territory, counted separately), and the
// plugin never schedules cards inside Obsidian's own dot folders.
const SKIP_TOP = new Set(['Flashcards', '.obsidian', '.trash'])

// The plugin stores its schedule as an HTML comment per card block; each
// entry is !YYYY-MM-DD,interval,ease.
const SR_COMMENT = /<!--SR:([^>]*)-->/g
const SR_ENTRY = /!(\d{4}-\d{2}-\d{2}),\d+,\d+/g
const INLINE_CARD = /^[^\n:]+::.+$/gm

const done = out => {
  process.stdout.write(JSON.stringify(out) + '\n')
  process.exit(0)
}

if (!fs.existsSync(VAULT)) done({ due: 0, new: 0, ok: false, scanned: 0, reason: 'vault-not-found' })

// Walks the vault, skipping the top-level folders above. Unreadable entries
// are stepped over rather than thrown on: one bad file must not cost the count.
const collect = (dir, top) => {
  let files = []
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const e of entries) {
    if (top === null && SKIP_TOP.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) files = files.concat(collect(full, top === null ? e.name : top))
    else if (e.name.endsWith('.md')) files.push(full)
  }
  return files
}

const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' })

let due = 0
let fresh = 0
let scanned = 0

for (const file of collect(VAULT, null)) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    continue
  }
  // Only notes tagged #flashcards carry plugin cards, matching its default.
  if (!text.includes('#flashcards')) continue
  scanned++
  let scheduled = 0
  for (const comment of text.matchAll(SR_COMMENT)) {
    for (const entry of comment[1].matchAll(SR_ENTRY)) {
      scheduled++
      if (entry[1] <= today) due++
    }
  }
  // Cards beyond the scheduled ones have never been reviewed, so they are new.
  const cards = (text.match(INLINE_CARD) || []).length
  if (cards > scheduled) fresh += cards - scheduled
}

done({ due, new: fresh, ok: true, scanned })
