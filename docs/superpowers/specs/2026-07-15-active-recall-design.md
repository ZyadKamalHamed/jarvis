# Active recall: spaced repetition that actually runs the session

Date: 15 Jul 2026. Replaces the passive "reviews due" list with a system that captures new notes automatically, schedules them with FSRS, and runs a 5 to 20 minute daily recall session from the HUD.

## What changes and why

The old Study matrix card listed note titles tagged #review and told him to go read them. The goal (Zyad, 15 Jul): any note he writes enters the algorithm the next day without tagging; the HUD card tells him what to recall today in priority order; PLAY runs the session (prompt first, reveal to check, grade to reschedule); the daily load is 5 to 20 minutes; a 20 page Notion DSA deck enters staggered, page 1 today through page 20 at day 20.

## Engine: bin/study.py v2

FSRS-5 scheduling is unchanged. Card state stays in `data/fsrs-state.json`, the served queue in `data/study.json`.

Card state gains fields (all optional, legacy cards keep working):

- `source`: `vault | notion | manual` (legacy cards default vault, key is the vault-relative path)
- `path`: vault-relative note path (vault cards)
- `career`: bool, binding stealth flag (DSA, interview and assessment material)
- `prompt`: the active recall cue shown before reveal; absent means a generated fallback
- `contentFile`: markdown in `data/study-cards/` shown on reveal (imported decks)
- `estMin`: honest minutes for the card (default 2)
- `startDate`: local date the card enters rotation; before it the card is scheduled, never due

Vault scan (refresh): a note enters the rotation when it is tagged `#review` OR its mtime is within the last 36 hours (auto-capture of anything new). Excluded: hidden folders, `Second Brain/Daily/` (JARVIS writes those), `Welcome.md`. Deletion: only vault-source cards whose file vanished; notion and manual cards are never dropped by a scan.

Queue (data/study.json): `queue` is due cards in priority order (oldest due first), each entry `{id, title, module, due, prompt, career, estMin, source, hasContent, path?, isNew, stability, retrievability}`. `stats` gains `dueCount`, `sessionMin` (0 when clear, else the sum of due estMin clamped to 5..20), `scheduledAhead` and `nextIntro`. `upcoming` includes scheduled cards at their startDate.

New commands:

- `add <id> --title T [--prompt P] [--career] [--start YYYY-MM-DD] [--est N] [--module M] [--content-file F]`: upsert one card (the head agent's voice-add path)
- `import <file.json>`: batch upsert `[{id, title, prompt, career, startDate, estMin, module, contentFile}]` (the deck path)

Validation: slug ids for new cards, em dashes rejected in title and prompt, est 1..30.

## Server

- Work mode strips career cards from `study.queue` and `study.upcoming`, sheds the flag key from survivors, and recomputes `dueCount` and `sessionMin` so the chip stays honest. Counts (`scheduledAhead`) are plain numbers and carry no words.
- `GET /api/study-card?id=`: prompt plus reveal content (contentFile read from `data/study-cards/`, path for vault cards). Career ids answer 404 in work mode, indistinguishable from unknown ids.
- `POST /api/study-review {id, rating 1..4}`: grades via `python3 bin/study.py review`, serialised so concurrent grades cannot race the state file. Career ids 404 in work mode; bad rating 400.
- `trimmedSnapshot` gains `recall` (top due titles, sessionMin, scheduledAhead) so voice can name today's recall topics without file reads.

## HUD

The Study matrix panel becomes Active recall: due count and session minutes on the chip, the top of the queue listed in priority order, a PLAY button. The session overlay runs card by card: recall prompt first (spoken when sound is on), REVEAL shows the stored content (md-lite render) or an OPEN NOTE link into Obsidian for vault cards, grade AGAIN / HARD / GOOD / EASY posts the rating and advances. Space reveals, 1 to 4 grade, Esc bails. The session cuts off at sessionMin; the rest stays due for tomorrow.

## The DSA deck (test load)

20 Notion lessons under Python Practise, fetched once and stored as `data/study-cards/lNN-*.md` (signed image URLs replaced, em dashes stripped). All career: true (DSA is interview material, binding). `startDate` staggered: lesson 1 on 2026-07-15, lesson N at day N. FSRS then owns each card from its first grade.

## Morning run and voice

Phase 1 refresh already runs `study.py refresh`; that now performs the auto-capture. Phase 3 folds a recall task into the day board sized by `sessionMin`. Phase 4 names today's recall topics instead of saying "go review". The head agent may add cards by voice through `study.py add` and may grade ONLY on Zyad's explicit statement that he reviewed something.

## Stealth invariants

Career cards: invisible in work mode payloads (flag keys shed, counts recomputed), 404 on both endpoints, content files live under gitignored `data/`. Selfcheck gains probes for all of it with byte-identical state restore.

## Deferred

- FSRS parameter optimisation from his review history (needs months of data)
- Card-level media (the Notion diagrams stay in Notion; reveal links out)
- Cross-linking recall cards to day-board tasks
