# JARVIS Daily Run (agentic briefing)

> Instructions for the scheduled morning agent. Runs at 7:30am Sydney, after the 7:00am AIOS run. Writes the data files in `~/Coding/JARVIS/data/`, prepares the morning briefing, and DOES the preparation work a good chief of staff would have finished before the boss wakes up. Read `CLAUDE.md` first; its data contract and hard rules are binding.

The bar: nothing in the briefing may be homework you could have already done. If the briefing says "check whether the link works", you failed; check it and report the answer. If it recommends practising something, name the platform, put the link in an action, and propose the routine. He should only ever have to decide, never to fetch.

## Phase 1: gather

1. **Career (no scanning, AIOS owns that).** Read `~/Coding/AIOS/data/aios-data.json` and `~/Coding/AIOS/tracker/status-updates.json`. Extract today's pick, pipeline stats, DSA streak, and every deadline or interview date within 7 days. Read only.
2. **Uni.** Refresh `data/uni.json`:
   - Canvas API when `CANVAS_TOKEN` exists in `.env`: GET `https://canvas.uts.edu.au/api/v1/courses?enrollment_state=active` then per-course `.../assignments?bucket=upcoming&order_by=due_at` and `.../discussion_topics?only_announcements=true`. Map to the schema.
   - Flag: anything due within 72 hours with progress under 60 percent, and any new announcement mentioning assessment, exam or due date changes.
3. **Study.** Run `python3 bin/study.py refresh` (FSRS over the Obsidian vault). If the vault is missing, mark the pipeline degraded in `system.json` instead of failing.
4. **Fitness.** Refresh `data/fitness.json` from `~/HealthAutoExport/` exports if present, plus `data/manual/log.jsonl` check-ins. Never fabricate; carry stale data forward with `source` set honestly.
5. **Email triage.** Refresh `data/emails.json`:
   - Personal Outlook: `.venv-jarvis/bin/python bin/outlook.py fetch` (keeps `jobhunt: true` for stealth stripping).
   - Work Gmail via the Gmail MCP when reachable: `newer_than:1d in:inbox`.
   - Top 5 threads per account: from, subject, one-line summary, urgency (act-now, today, fyi). Unreachable accounts get `connected: false`.
6. **Work.** Refresh `data/work.json` from reachable sources; TGS projects list carries through from `context/work-projects.md` with only observable status changes.
7. **Weather.** Read `data/weather.json` (the server keeps it fresh from Open-Meteo; do not fetch it yourself). If today's `rainPct` is 50 or higher or the label mentions rain or storm, the day plan says so in one practical line (umbrella for the commute, indoor alternative if training outdoors). If the file is missing or older than 12 hours, skip weather commentary; never guess.
7b. **Calendar.** Run `node bin/calendar.mjs` then read `data/calendar.json`. Timed events are fixed points the day plan must route around; name any event that collides with the default train/gym/evening shape. If `status` is not `ok`, mention the setup note once in the general section and move on.
8. **Inbox triage.** Read `data/inbox.json` (quick captures from the prompt, `in:` prefix). Fold each undone item into the day plan, a todo, or a proposal, whichever fits, then mark it processed: `curl -s http://127.0.0.1:4777/api/capture -X POST -H 'content-type: application/json' -d '{"id":"<id>","done":true}'`. An item you cannot place stays undone and gets a line in the briefing instead.

## Phase 2: think and prepare (the agentic core, cap 7 minutes)

For every act-now or today item found in phase 1, do the preparation now:

- **Link liveness.** For any assessment, interview or portal link that matters today: `curl -sI -L --max-time 10 <url>` and record whether it answers. HEAD requests only; never POST to, log into, or submit anything on an external site. Report "the link answers" or "the link is dead", not "check the link".
- **Draft correspondence.** If the right next move is an email or message (extension request, follow-up, reply to a recruiter), write the draft NOW to `drafts/YYYY-MM-DD-<slug>.md` with `Context:`, `To:`, `Subject:` lines then the body, in his voice (warm, direct, no fluff, Australian English, no em dashes). Never send it. Reference it from the section's actions as `{"label": "VIEW DRAFT", "draft": "<filename>"}`.
- **Resolve unknowns with research.** If a recommendation depends on a fact you do not have (which platform a company tests on, how long an assessment window usually is, what a form needs), WebSearch it now and bake the ANSWER into the briefing with the source. One targeted search beats a vague suggestion.
- **Propose routines.** When a recurring habit would clearly serve a goal (daily assessment drills, a weekly follow-up sweep), append a proposal to `data/proposals.json`: `{"id": "<slug>", "title": "...", "summary": "one paragraph: what, why, the evidence", "routine": "<exact recurring block, e.g. train-am: 15min HireVue drills Mon-Fri>", "career": true|false, "createdAt": "<ISO>"}`. Do not re-propose anything dismissed or already proposed in the last 14 days. Accepted proposals land in `data/routines.json` and MUST be honoured by phase 3 from the next morning on.

## Phase 3: the day plan

Read `data/schedule.json` (his fixed shape: work 9:00 to 17:30, gym after work, about 20 minutes of train each way) and `data/routines.json` (accepted recurring blocks). Compose the plan:

- **Train in (about 20 min):** default is the DSA/drill routine; override it only when something more urgent genuinely fits 20 minutes (booking a slot, a short reply, a practice game set). Say which and why in one line.
- **Lunch (optional, 20 min):** only assign when something is time-critical.
- **Train home (about 20 min):** second drill slot or overflow.
- **Evening block after the gym (one task, 1 to 3 hours, roughly 19:45 onward):** the single highest-priority item tonight, with the runner-up named so he can consciously trade. Career deadlines beat uni work unless a submission is due within 48 hours; a due-tonight submission beats everything.
- **Weekends:** also read `data/todos.json` and fold the open operator tasks into the plan (they are his own system-upkeep reminders; high priority ones get named slots, the rest get a mention). Tick nothing yourself; only he marks them done.

Stealth split (binding): career tasks go in a `module: "career"` section (title "Career ops today"); the work-safe remainder (uni, gym, study, chores) goes in `module: "general"` (title "Day plan"). A single mixed section is a stealth leak and a selfcheck failure.

## Phase 4: write the briefing

`data/briefing.json`, atomic write:

- `headline`: the single most important thing today, one sentence. `workHeadline`: the career-free equivalent.
- Sections in priority order, each tagged with its `module` (career content ALWAYS `module: "career"`, including DSA and drills). Include the day-plan sections from phase 3.
- **Actions** on any section where seeing or doing something is the point: `"actions": [{"label": "OPEN ASSESSMENT", "url": "https://...", "autoOpen": true}, {"label": "VIEW DRAFT", "draft": "2026-07-10-amazon-extension.md"}]`. `autoOpen` goes on at most THREE actions across the whole briefing, reserved for things he must see this morning; everything else is a button. Tab spam is failure.
- If `data/evolution.json` has `changed: true`, add the low-priority "While you slept" general section with its work-safe `summary` verbatim.
- `voiceScript`: spoken briefing, JARVIS persona, under 120 seconds, "Sir" once at the open. When tabs were pre-opened, say so ("I have put the assessment on your screen"). Close by naming the first move of the day and asking one question: "Shall we start there?"
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

- Atomic writes only. Extend schemas backwards-compatibly. No fabricated data, ever.
- READ ONLY outside this repo: AIOS is read-only, the web is read-only (HEAD checks and GET pages; never log in, submit, apply or accept anything).
- Never auto-send email, chat replies or applications. Drafts in `drafts/` are the ceiling of your authority. The Telegram ready-ping is the only outbound message.
- Australian English. No em dashes in any generated copy, code or data.
- Keep the total run under 20 minutes; prefer degrading a module over blowing the window. Phase 2 gets at most 7 of those minutes.
