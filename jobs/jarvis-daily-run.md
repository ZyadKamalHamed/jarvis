# JARVIS Daily Run

> Instructions for the scheduled morning agent. Runs at 7:30am Sydney, after the 7:00am AIOS run. Writes the data files in `~/Coding/JARVIS/data/` and the morning briefing. Read `CLAUDE.md` first; its data contract and hard rules are binding.

## Order of work

1. **Career (no scanning, AIOS owns that).** Read `~/Coding/AIOS/data/aios-data.json`. Extract today's pick, pipeline stats, DSA streak and any application deadlines within 7 days. Read only.
2. **Uni.** Refresh `data/uni.json`:
   - Canvas API when `CANVAS_TOKEN` exists in `.env`: GET `https://canvas.uts.edu.au/api/v1/courses?enrollment_state=active` then per-course `.../assignments?bucket=upcoming&order_by=due_at` and `.../discussion_topics?only_announcements=true`. Map to the schema.
   - Google Drive MCP (UTS account): check progress on assignment documents listed in `context/uni-watchlist.md`; update `progressPct` only from real evidence (document length, sections done, revision activity), otherwise leave unchanged.
   - Flag: anything due within 72 hours with progress under 60 percent, and any new announcement mentioning assessment, exam or due date changes.
3. **Study / spaced repetition.** Run `python3 bin/study.py refresh` (FSRS over the Obsidian vault at `~/Documents/Obsidian Vault`, override with `JARVIS_VAULT`). It rewrites `data/study.json`. If the vault is missing, mark the pipeline degraded in `system.json` instead of failing.
4. **Fitness.** Refresh `data/fitness.json`:
   - If `~/HealthAutoExport/` contains new JSON exports (Health Auto Export app on the iPhone drops them via iCloud Drive), parse weight, dietary energy and macros from the newest file.
   - TrainHeroic has no API: read `data/manual/log.jsonl` for `workout` check-ins instead.
   - Never fabricate: if there is no new data, carry the old series forward and set `source` honestly.
5. **Email triage.** Refresh `data/emails.json` for whichever accounts are reachable:
   - Personal Outlook (zyad2408@live.com.au): run `.venv-jarvis/bin/python bin/outlook.py fetch` (Microsoft Graph, token cached in .cache/). This account carries job application context, so its entry keeps `jobhunt: true` for stealth stripping.
   - Work Gmail (zyad.hamed@thegstore.com.au) via the Gmail MCP: search_threads `newer_than:1d in:inbox`.
   - Summarise at most the top 5 threads per account: from, subject, one-line summary, urgency (act-now, today, fyi).
   - Mark unreachable accounts `connected: false`; never invent counts.
   - Any thread that looks like a job application response (interview, assessment, offer, rejection) is career data: tag the account entry `jobhunt: true` context or put the item in a career briefing section, so stealth mode strips it.
6. **Work.** Refresh `data/work.json` from Google Chat via OpenClaw session context and work email if connected; otherwise from `data/manual/log.jsonl` `work` entries. TGS projects list is maintained in `context/work-projects.md`; carry it through with status updates you can actually see.
7. **Briefing.** Write `data/briefing.json`:
   - `headline`: the single most important thing today, one sentence.
   - If `data/evolution.json` has `changed: true` for last night, add a low-priority `module: "general"` section titled "While you slept" with its `summary`. That summary is written to be work-safe; include it verbatim, add nothing.
   - Sections in priority order, each tagged with its `module`. Career sections carry `module: "career"` without exception, including DSA and LeetCode content.
   - `voiceScript`: a spoken briefing, JARVIS persona (composed, dry, Australian English, no em dashes), under 120 seconds. Address him as "Sir" once at the open, sparingly after.
   - `workVoiceScript`: the same script with every career line removed, safe to play at the office.
   - If `ELEVENLABS_API_KEY` exists, POST the voiceScript to the running server `http://127.0.0.1:4777/api/tts` and save the reply to `public/assets/briefing-YYYY-MM-DD.mp3`, set `audioFile`. If the server is down, skip audio; do not fail the run.
8. **System.** Update `data/system.json` with each pipeline's `lastRun`, `status` (ok, degraded, missing-credential, error) and a one-line `note`. Then append one line to `data/metrics.jsonl`: `{"at": "<ISO>", "pipelines": {"<id>": "<status>", ...}, "unread": <total unread across connected accounts>, "assignmentsOpen": <count>, "reviewsDue": <count>}`. This history is what the nightly evolve run trends against; never rewrite old lines.
9. **Notify.** `openclaw message send --channel telegram --target 8343303630 --message "JARVIS briefing ready. <headline>"`. In one line, no career details in the message body.

## Guardrails (binding)

- Atomic writes only (tmp + rename). Extend schemas backwards-compatibly.
- No fabricated data, ever. Missing feed = honest degraded state.
- Do not touch anything inside `~/Coding/AIOS` except reading `data/aios-data.json`.
- Never auto-send email, chat replies or applications. The Telegram ready-ping is the only outbound message.
- Australian English. No em dashes in any generated copy.
- Keep the total run under 15 minutes; prefer degrading a module over blowing the window.
