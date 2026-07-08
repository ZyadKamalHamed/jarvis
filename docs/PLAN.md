# JARVIS Master Plan

> Written 2026-07-07. The definitive design, integration and cost plan for Zyad's life operating system. Companion to CLAUDE.md (the binding data contract) and jobs/jarvis-daily-run.md (the morning agent spec). Australian English, no em dashes, no fabricated data.

## 1. Vision

One dashboard, opened every morning, that knows everything going on in Zyad's life and briefs him like Tony Stark's JARVIS: career pipeline, uni deadlines, spaced repetition, fitness, work at The General Store, and email triage across four accounts, with a voice that reads the briefing aloud and a chat line that answers questions using the live data. A stealth switch strips every trace of the job hunt so the dashboard is safe to show colleagues.

## 2. What exists today (verified 7 Jul 2026)

- `~/Coding/JARVIS/` runs at http://localhost:4777 via `node server.mjs`, zero npm dependencies.
- Boot screen (INITIALISE, terminal boot lines, reactor hum fallback when boot.mp3 is absent), full HUD: priority feed, arc reactor with day-cycle ring, career ops (live from AIOS), university, study matrix, fitness, work ops, comms, system health, and the `jarvis>` ask bar (shells to `claude -p` on the subscription, no API fees).
- Stealth mode confirmed working: `mode: "work"` (5 clicks on the wordmark, Ctrl+Shift+J, or `?work=1`) strips career data server side; the client never receives it.
- Voice: `/api/tts` uses ElevenLabs when a key exists, else macOS `say`. TTS responses cached by content hash.
- FSRS spaced repetition engine (`bin/study.py`, pure Python, no deps) over the Obsidian vault at `~/Documents/Obsidian Vault`, state in `data/fsrs-state.json`.
- AIOS (`~/Coding/AIOS`) remains the career brain: 7am daily agent scans, scores 0-100, verifies, drafts application kits, syncs Notion, logs DSA. JARVIS reads `aios-data.json` and never writes to AIOS.
- NEW today: the 7:30am scheduled task `jarvis-daily-run` now exists at `~/Documents/Claude/Scheduled/jarvis-daily-run/SKILL.md` (mirrors how aios-daily-run is scheduled). Zyad must confirm it appears and is enabled in the Claude scheduled tasks UI.

## 3. Architecture (settled, do not relitigate)

Data files are the single source of truth; agents own them; the dashboard is a view.

```
7:00am  aios-daily-run   -> ~/Coding/AIOS/data/aios-data.json   (career, owned by AIOS)
7:30am  jarvis-daily-run -> ~/Coding/JARVIS/data/*.json         (uni, study, fitness, work, email, briefing, system)
any     bin/study.py     -> data/study.json + data/fsrs-state.json
open    server.mjs       -> renders data, /api/tts, /api/ask, /api/mode, /api/checkin
```

Why this shape: no always-on backend, no API fees (agents run on the Claude subscription), every module degrades honestly (SETUP badge) instead of faking data, and the whole thing survives laptop restarts because state is plain files.

## 4. Integration matrix (researched 7 Jul 2026, C.R.A.P.-checked sources)

GREEN, wire now:
- Career: AIOS aios-data.json. Live already.
- Notion: Applications DB (collection://70a2fb1a-4294-4fd2-9c37-a09844c836ac), 2026-2027 Grad search DB (collection://ad1a9e0d-beb3-47c5-8300-5ed42f3d1dd8), UTS Assignments Tracker (collection://fe4763a0-b841-400a-94cc-584c6a0e3e3b), Subjects DB. Via Notion MCP in the daily run.
- Canvas (UTS): students can self-mint a personal access token (canvas.uts.edu.au > Account > Settings > Approved Integrations > New Access Token). Endpoints: /api/v1/courses, /courses/:id/assignments, /users/self/todo, /users/self/upcoming_events, announcements. The previous token expired 7 May; re-mint and drop into `.env` as CANVAS_TOKEN.
- LeetCode: public GraphQL / alfa-leetcode-api for user Zyad124. Already wired through AIOS.
- Outlook personal (zyad2408@live.com.au): IMAP app passwords are dead (Microsoft killed basic auth Sep 2024). Correct path is Microsoft Graph: free Entra app registration, delegated Mail.Read, MSAL device-code flow, tenant `consumers`. One interactive login, then headless refresh tokens. Alternative until then: the existing email-cleanup browser automation.
- Gmail accounts (TGS work + personal Gmail): Gmail MCP already connected on claude.ai; the daily run uses search_threads newer_than:1d.
- Google Drive (UTS assignment progress): Drive MCP, watchlist in `context/uni-watchlist.md`, progress updated only from real evidence.
- Obsidian + FSRS: py-fsrs pattern implemented locally in bin/study.py. Vault exists but is nearly empty; the system grows as notes are tagged #review.

YELLOW, best-effort only:
- MyFitnessPal: no public API (partner-only, closed). python-myfitnesspal rides browser session cookies (2FA irrelevant) but breaks periodically behind Cloudflare. RECOMMENDED PATH INSTEAD: MyFitnessPal syncs meal summaries and weight to Apple Health; the iPhone app Health Auto Export (about A$40 one-off) POSTs or drops JSON to iCloud Drive (`~/HealthAutoExport/`), which the daily run parses. Robust, terms-clean, also captures gym sessions and heart rate from the watch.
- Google Chat (work context): via OpenClaw session context on manual runs; treat as enrichment, not a guaranteed feed.

RED, do not promise:
- TrainHeroic: no API at all (confirmed by their support docs). Manual CSV export from account.trainheroic.com/data-export into a watched folder is the honest baseline; watch-synced Apple Health data covers sessions anyway.
- CodeSignal: the GraphQL API is enterprise/hiring-side only. Personal progress stays self-reported (the dashboard check-in), exactly as AIOS already handles it.

## 5. Voice and persona

- Live TTS: ElevenLabs Flash v2.5 (0.5 credits per character, about 75ms first-audio) through the existing /api/tts streaming path. Fallback stays macOS `say`.
- Pre-rendered morning briefing: the daily run renders voiceScript to `public/assets/briefing-YYYY-MM-DD.mp3` when a key exists (use eleven_v3 or multilingual for the nicer read; it is not a latency path).
- Voice: default Daniel (composed British male). Better: pick a proper JARVIS-adjacent voice in the ElevenLabs library once the account exists. Free alternative if ever needed: Piper with the community JARVIS voice, or Kokoro local.
- Persona rules live in jobs/jarvis-daily-run.md: composed, dry, Australian English, "Sir" once at the open, under 120 seconds.
- Ask bar: `claude -p` on the subscription. No ElevenLabs Conversational AI needed; we keep our own agent loop and pay only for speech.
- Boot audio: `public/assets/boot.mp3` is user-supplied (Sympathy For The Devil). Gitignored, app boots cleanly without it. Drop the mp3 in and it plays on INITIALISE.

## 6. Second brain: Obsidian, not Notion (decision)

Obsidian wins for Claude integration: the vault is plain markdown on disk, so every agent reads and writes it natively with no MCP, no rate limits, no auth. The 2026 practitioner consensus (MindStudio, nxcode, multiple builder writeups) matches. FSRS-based spaced repetition is already implemented against it.

Pragmatic split, already reflected in the code:
- Obsidian (`~/Documents/Obsidian Vault`): lectures, notes, DSA patterns, Arabic vocab, exam prep. Tag a note `#review` and it enters the FSRS rotation automatically.
- Notion: stays the home of structured databases that already live there (job tracker, assignments tracker, subjects). The daily run reads them via MCP.

Migration step for Zyad: start taking lecture notes in the vault (any folder structure), tag `#review`. The old ClaudeClaw 8:15am quiz silently died in early June (task missing from its DB, state frozen 2026-06-09); JARVIS study replaces it. Optionally keep a ClaudeClaw Telegram quiz that reads `data/study.json` for on-the-go reviews.

## 7. Costs (monthly, as of July 2026)

| Item | Plan | USD | approx AUD |
|---|---|---|---|
| Claude subscription (already paying) | Pro $20 or Max 5x $100 | 20 to 100 | 31 to 155 |
| ElevenLabs | Creator (121k credits, covers a 2 min daily briefing with about 2x headroom; Starter's 30k does not) | 22 | 34 |
| Notion | Free tier is fine for current use | 0 | 0 |
| Hosting | localhost, nothing to pay | 0 | 0 |
| Health Auto Export (iOS) | one-off | ~40 AUD once | once |
| Canvas, LeetCode, Graph API, Obsidian, FSRS | free | 0 | 0 |

Marginal new cost over what Zyad already pays: about A$34/month (ElevenLabs Creator) plus the one-off A$40 app. Budget mode: A$0/month extra using macOS say and skipping Health Auto Export (manual check-ins). Fully loaded with Max 20x and ElevenLabs Pro would be roughly A$460/month and is not recommended; the dominant cost is always the Claude plan, and the current architecture deliberately avoids API token billing by running everything through the subscription (`claude -p` and scheduled tasks).

## 8. Roadmap

Phase 1 (done): HUD + boot + stealth + career live + FSRS engine + ask bar + TTS with fallback.
Phase 2 (this week, needs Zyad's five inputs below): Canvas token in, boot.mp3 in, ElevenLabs key in, Health Auto Export configured, first #review notes tagged. Confirm jarvis-daily-run is enabled in the scheduled tasks UI. First full 7:30am briefing with audio.
Phase 3 (next): Microsoft Graph device-code login for Outlook personal; `context/work-projects.md` + `context/uni-watchlist.md` seeded by Zyad; Google Drive progress tracking live; work module fed from Google Chat context.
Phase 4 (polish): audio-reactive reactor upgrade (AnalyserNode already drives a speaking state; extend to particle ring), briefing history archive, mobile layout for the phone on the train, optional Telegram delivery of the audio briefing via OpenClaw.

## 8b. Self-evolution loop (added 2026-07-08)

The system now improves itself on a daily cadence. Four parts, all in place:

- **Signal in.** `fb: <note>` typed into the HUD prompt files an improvement request to `data/feedback.jsonl`; failed asks are logged there automatically; the 7:30am run appends pipeline health to `data/metrics.jsonl` every morning so trends are visible.
- **Safe change.** The folder is a git repo, and `bin/selfcheck.mjs` is the gate: it boots a throwaway server and fails on any broken module or any career term leaking into the work-mode payload. Nothing commits without a pass.
- **Improver.** The `jarvis-evolve` scheduled task (9:30pm nightly, `jobs/jarvis-evolve.md`) picks exactly one item (feedback first, then repeat failures, then `docs/BACKLOG.md`), implements, verifies, commits, or reverts and logs the failure.
- **Report out.** `data/evolution.json` feeds a "While you slept" line into the next morning briefing, so every improvement is visible the day after.

The compounding maths is the point: one small verified improvement a night is ~30 a month, with git history as the audit trail and selfcheck guaranteeing stealth never regresses.

## 9. What Zyad must provide (nothing else is blocked)

1. `boot.mp3`: drop Sympathy For The Devil at `~/Coding/JARVIS/public/assets/boot.mp3`.
2. Canvas token: canvas.uts.edu.au > Account > Settings > Approved Integrations > New Access Token, paste into `~/Coding/JARVIS/.env` as `CANVAS_TOKEN=`.
3. ElevenLabs account: Creator tier (A$34/mo, first month half price), key into `.env` as `ELEVENLABS_API_KEY=`. Skip if happy with the macOS voice for now.
4. iPhone: MyFitnessPal > enable Apple Health sync; install Health Auto Export; point an automation at iCloud Drive folder `HealthAutoExport`.
5. Obsidian: open the existing vault, take notes normally, tag anything worth remembering `#review`.
6. Confirm the `jarvis-daily-run` scheduled task shows up enabled for 7:30am in the Claude app (folder created today).
7. Optional: TrainHeroic CSV export from account.trainheroic.com/data-export dropped into `~/Coding/JARVIS/data/manual/` whenever curious about full history.

## 10. Hard rules carried everywhere

No em dashes. Australian English. No fabricated data, SETUP badges over fake numbers. Stealth mode strips career data server side, always. Never auto-send anything. AIOS is read-only from here. Atomic writes. Everything runs on the subscription, never an API key for the agent brain.
