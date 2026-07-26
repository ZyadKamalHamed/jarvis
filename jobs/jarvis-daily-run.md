# JARVIS Daily Run (agentic briefing)

> Instructions for the scheduled morning agent. Runs at 7:30am Sydney, after the 7:00am AIOS run. Writes the data files in `~/Coding/JARVIS/data/`, prepares the morning briefing, and DOES the preparation work a good chief of staff would have finished before the boss wakes up. Read `CLAUDE.md` first; its data contract and hard rules are binding.

The bar: nothing in the briefing may be homework you could have already done. If the briefing says "check whether the link works", you failed; check it and report the answer. If it recommends practising something, name the platform, put the link in an action, and propose the routine. He should only ever have to decide, never to fetch.

## Phase 1: gather

1. **Career (no scanning, AIOS owns that).** Read `~/Coding/AIOS/data/aios-data.json` and `~/Coding/AIOS/tracker/status-updates.json`. Extract today's pick, pipeline stats, DSA streak, and every deadline or interview date within 7 days. Read only.
2. **Uni.** Refresh `data/uni.json`:
   - Run `node bin/canvas.mjs --write`. It reads `CANVAS_TOKEN` from `.env` in its own process (agents cannot and must not read `.env` directly), pulls active courses and dated assignments from the UTS Canvas API, and merges them in while preserving editorial fields (nextAction, flags, progressPct). On a non-zero exit, mark the uni pipeline degraded in `system.json` with the script's stderr message and carry the old data forward.
   - Flag: anything due within 72 hours with progress under 60 percent, and any new announcement mentioning assessment, exam or due date changes.
3. **Study.** SRS trial since 26 Jul 2026: reviews live in Anki (synced from the vault Flashcards folder by the Yanki plugin) and the Obsidian Spaced Repetition plugin (inline cards in notes tagged #flashcards). Run `python3 bin/anki-due.py --write`; it prints a JSON summary (per-deck Anki due/new counts, Obsidian plugin due/new counts, `careerOnly`) and writes `data/study.json` with an empty queue so the HUD shows the trial note instead of a PLAY session. Do NOT run `bin/study.py refresh` or `bin/study-exgen.mjs`; the legacy FSRS pipeline is retired for the trial. If the script reports `"source": "unavailable"`, mark the study pipeline degraded in `system.json` and carry on. The trial decision is due Sun 9 Aug 2026: from 7 Aug, add one board task reminding him to pick Anki or the Obsidian plugin.
4. **Fitness.** Refresh `data/fitness.json` from `~/HealthAutoExport/` exports if present, plus `data/manual/log.jsonl` check-ins. Never fabricate; carry stale data forward with `source` set honestly.
5. **Email triage.** Refresh `data/emails.json`:
   - Personal Outlook: `.venv-jarvis/bin/python bin/outlook.py fetch` (keeps `jobhunt: true` for stealth stripping).
   - Work Gmail via the Gmail MCP when reachable: `newer_than:1d in:inbox`.
   - **High-stakes sweep (binding).** Before ranking anything, scan EVERY unread subject and sender on each reachable account, not just the freshest few, for things that must never be missed: assessment or assessment centre, interview, offer, invitation to attend or book a time, online test or coding test invites, application outcomes, deadlines or expiries on an application, and urgent account or security alerts. Read any hit in full. A hit is FORCED into that account's `topThreads` with urgency `act-now` (displace a routine thread if the list is full) and gets its own briefing section in phase 4 carrying the concrete facts: date, time, location or link, and what he must do by when. Career hits are `module: "career"` and their dates feed the phase 3 board like any other deadline. Thread ranking never outranks this sweep; the 17 Jul missed assessment centre invite is the failure this exists to prevent.
   - Top 5 threads per account: from, subject, one-line summary, urgency (act-now, today, fyi). Unreachable accounts get `connected: false`.
6. **Work.** Refresh `data/work.json` from reachable sources; TGS projects list carries through from `context/work-projects.md` with only observable status changes.
7. **Weather.** Read `data/weather.json` (the server keeps it fresh from Open-Meteo; do not fetch it yourself). If today's `rainPct` is 50 or higher or the label mentions rain or storm, the day plan says so in one practical line (umbrella for the commute, indoor alternative if training outdoors). If the file is missing or older than 12 hours, skip weather commentary; never guess.
7b. **Calendar.** Run `node bin/calendar.mjs` then read `data/calendar.json`. Timed events are fixed points the day plan must route around; name any event that collides with the default train/gym/evening shape. If `status` is not `ok`, mention the setup note once in the general section and move on.
8. **Inbox triage.** Read `data/inbox.json` (quick captures from the prompt, `in:` prefix). Fold each undone item into the day board, a todo, or a proposal, whichever fits, then mark it processed: `curl -s http://127.0.0.1:4777/api/capture -X POST -H 'content-type: application/json' -d '{"id":"<id>","done":true}'`. An item you cannot place stays undone and gets a line in the briefing instead.

## Phase 2: think and prepare (the agentic core, cap 7 minutes)

For every act-now or today item found in phase 1, do the preparation now:

- **Link liveness.** For any assessment, interview or portal link that matters today: `curl -sI -L --max-time 10 <url>` and record whether it answers. HEAD requests only; never POST to, log into, or submit anything on an external site. Report "the link answers" or "the link is dead", not "check the link".
- **Draft correspondence.** If the right next move is an email or message (extension request, follow-up, reply to a recruiter), write the draft NOW to `drafts/YYYY-MM-DD-<slug>.md` with `Context:`, `To:`, `Subject:` lines then the body, in his voice (warm, direct, no fluff, Australian English, no em dashes). Never send it. Reference it from the section's actions as `{"label": "VIEW DRAFT", "draft": "<filename>"}`.
- **Resolve unknowns with research.** If a recommendation depends on a fact you do not have (which platform a company tests on, how long an assessment window usually is, what a form needs), WebSearch it now and bake the ANSWER into the briefing with the source. One targeted search beats a vague suggestion.
- **Propose routines.** When a recurring habit would clearly serve a goal (daily assessment drills, a weekly follow-up sweep), append a proposal to `data/proposals.json`: `{"id": "<slug>", "title": "...", "summary": "one paragraph: what, why, the evidence", "routine": "<exact recurring block, e.g. train-am: 15min HireVue drills Mon-Fri>", "career": true|false, "createdAt": "<ISO>"}`. Do not re-propose anything dismissed or already proposed in the last 14 days. Accepted proposals land in `data/routines.json` and MUST be honoured by phase 3 from the next morning on.

## Phase 3: the day board

`data/daytasks.json` is the single prioritised list for his whole day: uni, career, gym, errands, operator tasks, all of it, in the order he should attack it. The HUD renders it in focus mode and as the Today strip; he ticks, reorders and adds through the day. Compose it ONLY through the CLI, never by writing the file:

1. **Carry first.** `node bin/dayplan.mjs carry` rolls yesterday's undone tasks forward with their age showing (skip if the file is already today's). Then write the full board with `node bin/dayplan.mjs plan --file <tmp.json>` (schema in CLAUDE.md). A replan preserves his ticks for matching ids, so re-running is safe.
2. **Sources, in priority order:** uni flags from phase 1 (a submission due within 48 hours leads outright); career deadlines and today's pick from AIOS; accepted `data/routines.json` blocks (honour `pausedUntil` and `until`; the winter intensive reshapes Mon-Thu until 24 Jul); the review session when `bin/anki-due.py` reports cards due (one task, title like "Review: N cards" with N the combined Anki plus Obsidian due count, `est` = max(5, round to 5 of N halved) minutes capped at 25, kind `study`, `career: true` ONLY if the summary says `careerOnly` true; a train slot suits it since Anki reviews work on the phone); open `data/todos.json` operator tasks (high priority any day, the rest on weekends); unplaced inbox captures; the gym from `data/schedule.json`. Calendar events are anchors the ORDER routes around, not tasks; name any collision in the briefing instead. Career deadlines beat uni work unless that 48-hour rule fires; a due-tonight submission beats everything.
3. **Every task gets:** an honest `est` in minutes (round to 5; omit rather than guess), a `kind`, `career: true` on anything jobhunt, interview, assessment or DSA related (binding; the server strips these in work mode), and the deep link that saves him a fetch: `url` for Canvas assignments (uni.json carries them now) and apply pages, `draft` for prepared correspondence, `doc` for repo docs. A job-application task links the apply page AND its tailored kit written to `drafts/` and referenced via `draft`.
4. **capacityMin:** the free minutes you can actually count after work or uni hours, commute, gym and calendar events. Fill the main list to roughly capacity in priority order; everything beyond it gets `"overflow": true` (the bleed zone under IF TIME REMAINS) rather than pretending the day is longer than it is. Train-sized tasks (est 20 or less) sit where a commute would take them in the order.
5. Tick nothing yourself; only he marks tasks done.

## Phase 4: write the briefing

`data/briefing.json`, atomic write:

- `headline`: the single most important thing today, one sentence. `workHeadline`: the career-free equivalent.
- Sections in priority order, each tagged with its `module` (career content ALWAYS `module: "career"`, including DSA and drills). ONE general section describes the shape of the day (anchors, capacity, what leads and why); it points at the board and never duplicates board items as prose. Career narrative that needs telling (deadline context, interview prep reasoning) stays in a `module: "career"` section.
- **Actions** on any section where seeing or doing something is the point: `"actions": [{"label": "OPEN ASSESSMENT", "url": "https://...", "autoOpen": true}, {"label": "VIEW DRAFT", "draft": "2026-07-10-amazon-extension.md"}]`. `autoOpen` goes on at most THREE actions across the whole briefing, reserved for things he must see this morning; everything else is a button. Tab spam is failure.
- If `data/evolution.json` has `changed: true`, add the low-priority "While you slept" general section with its work-safe `summary` verbatim.
- Reviews get one line, not a lecture: when cards are due, the study section (or the general section's day shape) gives the counts and where to do them ("Twelve Anki reviews, about six minutes, phone or desktop; three cards due in Obsidian"). Deck or topic NAMES follow the stealth rules: the DSA deck is career content, so name it only in `module: "career"` sections and full-mode voice; general sections and work surfaces carry counts only. Never say "go review your notes"; the apps do the scheduling.
- `voiceScript`: spoken briefing, JARVIS persona, under 120 seconds, "Sir" once at the open. Walk the top of the board in order (two or three items, with their estimates) rather than reading every section. When tabs were pre-opened, say so ("I have put the assessment on your screen"). Close by naming the first move of the day, which is the top of the board, and asking one question: "Shall we start there?"
- `workVoiceScript`: same script with every career line removed.

## Phase 5: pull it up (full mode only)

Read `data/mode.json` FIRST. If mode is `work`, skip this phase entirely; no career material may ever open on a screen that might be visible at the office, and do not open tabs at all in work mode.

In full mode: for each `autoOpen` action, run `open <url>` so the tabs are sitting there when he walks past the Mac at 7:30. Open the most important last so it has focus.

## Phase 6: audio, telemetry, ping

- If `ELEVENLABS_API_KEY` exists, POST the voiceScript to `http://127.0.0.1:4777/api/tts`, save to `public/assets/briefing-YYYY-MM-DD.mp3`, set `audioFile`. Server down = skip audio, never fail the run.
- Run `node bin/obsidian-note.mjs` (writes the daily log into the Second Brain vault; missing vault = harmless skip).
- Update `data/system.json` (per-pipeline lastRun, status, note) and append one line to `data/metrics.jsonl`. Never rewrite old lines.
- `openclaw message send --channel telegram --target 8343303630 --message "JARVIS briefing ready. <workHeadline>"` (career-free, one line). If openclaw is unavailable, `bash bin/notify.sh "JARVIS briefing ready. <workHeadline>"` is the fallback; if both fail, note it in system.json and move on.

## Guardrails (binding)

- Free text on work-visible surfaces must never name employers, applications, assessments or career artefacts: that means `workHeadline`, `workVoiceScript`, `module: "general"` sections, and `system.json` notes on non-career pipelines. Career detail belongs on the career pipeline note, career sections and full-mode fields. The metrics run note never reaches work mode (the server sheds it), but write it as if it might.
- Atomic writes only. Extend schemas backwards-compatibly. No fabricated data, ever.
- READ ONLY outside this repo: AIOS is read-only, the web is read-only (HEAD checks and GET pages; never log in, submit, apply or accept anything).
- Never auto-send email, chat replies or applications. Drafts in `drafts/` are the ceiling of your authority. The Telegram ready-ping is the only outbound message.
- Australian English. No em dashes in any generated copy, code or data.
- Keep the total run under 20 minutes; prefer degrading a module over blowing the window. Phase 2 gets at most 7 of those minutes.
