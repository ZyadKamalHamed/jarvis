# Active recall exercises: checked work, not honour-system reveals (2026-07-16)

## Why

The 15 Jul recall module tells Zyad what to recall and shows the note; grading is self-reported. He wants the session to hand him a task and CHECK the work: a small Python editor whose output gets verified, flashcards for specific facts, and multiple choice, with some approval process running in JavaScript.

He also asked whether the literature supports rotating sensory modalities across review days (auditory day 2, visual day 3, interactive day 5), and to implement whatever order the evidence backs.

## Research verdict (checked 16 Jul 2026)

Modality-by-day rotation is the learning styles "meshing" hypothesis wearing a trench coat. Pashler, McDaniel, Rohrer and Bjork (2008, Psychological Science in the Public Interest) found no credible evidence for matching instruction modality to learners, and Rogowsky, Calhoun and Tallal (2015, J. Educational Psychology) confirmed the null experimentally. Not implemented.

What the evidence does support is escalating RETRIEVAL EFFORT as a memory matures (Bjork's desirable difficulties; Karpicke's retrieval-based learning reviews): generative formats (free recall, writing code) beat recognition formats (multiple choice), and the advantage grows with the retention interval, while recognition formats are effective and lower-friction early. So the ladder is difficulty-by-maturity, driven by the card's FSRS review count:

- reps 0-1 (new card): multiple choice (recognition)
- reps 2-3: flashcards (cued recall)
- reps 4+: production (write the Python in an editor, work gets checked)

Fallback chain when a tier is missing for a card: preferred tier, then flash, then mc, then the classic reveal-and-grade flow. Cards with no exercises behave exactly as before.

## Exercise files

One JSON per card at `data/study-exercises/<cardId>.json`:

```json
{
  "id": "l01-lists",
  "generatedAt": "ISO",
  "sourceHash": "md5 of the content the exercises were written from",
  "mc": [ { "q": "...", "options": ["A","B","C","D"], "answer": 2, "why": "..." } ],
  "flash": [ { "front": "...", "back": "..." } ],
  "code": {
    "task": "...",
    "starter": "def insert_at(items, i, value):\n    ",
    "checks": [ { "type": "contains|regex|absent", "value": "...", "hint": "..." } ],
    "solution": "..."
  }
}
```

`mc` up to 3 questions (server serves one at random), `flash` up to 4 pairs, `code` only where the content is genuinely codeable. Generated content is scrubbed: em dashes replaced, shapes validated, oversized files rejected.

## Server (server.mjs)

- `GET /api/study-exercise?id=` : guard byte-identical to /api/study-card (career ids 404 in work mode, indistinguishable from unknown; traversal ids 400). Reads fsrs-state for `reps`, picks the tier, returns `{ id, tier, reps, exercise }`. The code tier never ships `solution` or `checks`; checking is server-side. Nothing is added to /api/data, so stripCareer's study block is untouched.
- `POST /api/study-check` `{ id, code }` : same guard BEFORE any file read or spawn. Loads the card's code exercise, runs the static checks (contains/regex/absent with hints), then spawns `claude -p` (same subscription-only pattern as /api/ask: API-key env vars deleted, all tools disallowed, one-shot session, --output-format json) asking for a strict JSON verdict `{pass, feedback}` against the task, the card content and the reference solution. Falls back to heuristics-only when claude is unavailable or times out (90s), and always when `JARVIS_NO_LLM_CHECK=1` (selfcheck sets this). Responds `{ ok, pass, feedback, checks, suggested }` where suggested is a 1..4 grade hint (pass GOOD, fail AGAIN). Checks serialise through a chain so only one claude grader runs at a time.

## Generator (bin/study-exgen.mjs)

`node bin/study-exgen.mjs [--due] [--id X] [--force] [--quiet]`. For each card in fsrs-state with content (data/study-cards file, or a vault note resolved via the same vault root study.py uses), spawn `claude -p` to author the exercise JSON. Validates shape, scrubs em dashes, skips cards whose sourceHash is unchanged, writes atomically. `--due` limits to cards due within 24h (what the morning run wants). Career flags never enter exercise files; visibility is enforced at serve time by the card's own career flag.

## HUD (public/)

The session player picks up the served tier per card:

- **mc**: question + four option buttons; click checks locally, marks right/wrong, shows the `why`, then the grade bar appears with the suggested grade highlighted (right GOOD, wrong AGAIN). He always has final say.
- **flash**: front shown big, SPACE reveals the back, one pair at a time through the card's pairs, then the usual 1..4 self-grade.
- **code**: task + a Python-flavoured textarea: Tab inserts 4 spaces, Shift+Tab dedents, Enter keeps the current indent and adds one level after a trailing colon, monospace. CHECK sends to /api/study-check, shows pass/fail + feedback + failed hint list, then the grade bar with the suggestion. RE-CHECK allowed until he grades.
- **fallback**: cards without exercises keep the current reveal flow untouched.

Voice reads the question/task as before. Keyboard: Space reveals where relevant, 1..4 grade once the grade bar is visible, Escape closes (never while typing in the editor).

## Stealth invariants (unchanged in spirit, extended in coverage)

- Career exercise ids 404 in work mode from both new endpoints, byte-identical to unknown ids; guard runs before any filesystem read or spawn.
- Exercise payloads travel only through the guarded per-card endpoints, never in /api/data.
- selfcheck gains probes: synthetic career exercise file, work-mode 404s, full-mode serve with no career key, traversal 400, bad-body 400, and byte-identical restore (exercise file deleted, state/study restored as before). Selfcheck boots the server with JARVIS_NO_LLM_CHECK=1 so no grader spawns during the gate.

## Morning run

Phase 1 study item additionally runs `node bin/study-exgen.mjs --due --quiet` after the refresh so newly captured vault notes get exercises before their first review. Generation failures degrade gracefully: the card just runs classic reveal.

## Out of scope

Auditory-only exercise tiers (no evidence; the existing TTS already reads prompts aloud). True Python execution (checking is static + LLM; the editor mimics Python indentation only). Exercise authoring UI; regeneration is `--force`.
