# JARVIS ultimate upgrade batch: design

Date: 2026-07-10. Approved by Zyad (all four bundles plus scheduling) via the HUD session. Built by Fable 5 while he works on a uni assignment. Every feature ships as its own selfcheck-gated commit; stealth may only be strengthened.

## Scheduling (the standing blocker)

The 7:30am daily-run and 9:30pm evolve agents get registered as **launchd LaunchAgents** on this Mac instead of Claude-app scheduled tasks:

- `bin/run-job.sh <jobfile>`: wrapper that sets PATH (`~/.local/bin`, `/opt/homebrew/bin`), cds into the repo, strips `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN` (subscription billing only), runs `claude -p "Read <jobfile> and follow it exactly." --output-format json` with a hard timeout, and appends a log line to `data/joblogs/<job>-<date>.log`.
- `deploy/com.zyad.jarvis.daily.plist` (StartCalendarInterval 07:30) and `deploy/com.zyad.jarvis.evolve.plist` (21:30), both version-controlled so the home-laptop migration inherits them.
- launchd fires missed jobs on wake, survives reboots, and needs no Claude app. Verified end-to-end with a temporary near-future test job before trusting.

## Bundle 1: Brain

**Long-term memory.** Two files, both plain markdown:

- `data/agent-memory.md`: everything worth remembering across days (deadlines, decisions, preferences, active threads). Loaded (capped at 6KB) into the head agent's system prompt on every full-mode ask.
- `data/agent-memory-work.md`: the work-safe variant, zero career content, loaded on work-mode asks. Selfcheck scans it against the banned-terms list on every run.
- Seeded today with real current facts. The nightly evolve run gains a standing step: distil the day's `conversations.jsonl` and decisions into both files (update in place, prune stale lines, never let either exceed ~120 lines).

**Streaming answers.** `POST /api/ask` with `{stream: true}` responds as `text/event-stream`: the server runs `claude -p --output-format stream-json --include-partial-messages`, forwards text deltas as SSE `delta` events, then a final `done` event with the full result. Session bookkeeping, conversation logging, work-mode tool bans and the ask serialiser are shared with the non-streaming path, which remains as fallback. The client reads the stream and renders text as it arrives; voice (if enabled) speaks the completed answer.

## Bundle 2: Senses

**Weather.** Server-side lazy refresh: on `/api/data`, if `data/weather.json` is older than 30 minutes, fire-and-forget fetch to Open-Meteo (Sydney, no API key, 5s abort) and serve the cached copy meanwhile. Payload gains `weather` in BOTH modes (weather is not career data). Rail chip renders current temp + rain probability; absent data renders nothing (no fabrication). The daily-run job reads `data/weather.json` for umbrella/day-plan guidance.

**Calendar.** `bin/calendar.mjs` uses osascript JXA + EventKit (no Calendar.app launch) to write today's and tomorrow's events to `data/calendar.json`. Server refreshes it lazily (30 min) by spawning the script. Events render in the core panel, FULL MODE ONLY: work mode strips `calendar` whole (an event title like an interview cannot be auto-classified, so the safe default is total removal; selfcheck asserts it). First run triggers one macOS calendar-access prompt; denied access renders an honest SETUP note.

**Quick capture.** `in: <thought>` in the prompt POSTs `/api/capture`, appending `{id, at, text, done}` to `data/inbox.jsonl`. Capture WORKS in work mode (write-only, nothing echoes back); the inbox card renders in full mode only and items are never served in the work payload (selfcheck-asserted). Items tick off via the same endpoint (`{id, done: true}`), which the morning agent may also call (curl to 127.0.0.1:4777 is already whitelisted) after folding items into the day plan.

**Health webhook.** `POST /api/health?token=<JARVIS_HEALTH_TOKEN>` accepts Health Auto Export's JSON push, parses weight and nutrition metrics into `fitness.json` (series deduped by date, source set honestly), 512KB body cap. No token configured = 503 with a setup hint; wrong token = 403 (selfcheck-asserted). Token generated into `.env`; the operator todo shrinks to installing the app and pasting the tailnet URL.

## Bundle 3: Cockpit

**Focus mode.** FOCUS rail button (and palette entry). Hides every panel except University, shows a pomodoro card: 25/5 and 50/10 presets, timestamps not tick-counting (sleep and tab-switch safe), tab-title countdown, completed focus blocks logged via the existing `/api/checkin` (`{type: "focus", minutes}`), optional spoken nudge at block end. Esc exits. State survives reload via localStorage.

**Command palette.** Cmd+K (or Ctrl+K) opens a fuzzy-filtered action list: speak briefing, silence, conversation log, focus mode, work-mode toggle, play/pause/next music, open AIOS (full mode only), jump to panel, and "ask..." which focuses the prompt. `?` opens a static shortcut help overlay. All keys inert while typing in an input.

**PWA polish.** `bin/make-icons.mjs`: zero-dependency PNG encoder (node:zlib + hand-rolled chunks) renders the arc reactor at 180/192/512px into `public/assets/icons/` (committed). `manifest.webmanifest` + apple-touch-icon links. `public/sw.js`: network-first for shell assets with cache fallback, and `/api/*` is NEVER cached (stealth: no career payload may persist in Cache Storage). Registered from app.js.

## Bundle 4: Armour

**Backups.** `bin/backup.sh` (shipped first, before any other change): tarball of `data/`, `drafts/`, `.env` to `~/Backups/jarvis` (or `JARVIS_BACKUP_DIR`), newest 14 kept. The evolve job runs it as step 0 nightly. First snapshot taken 2026-07-10 22:58.

**Obsidian daily note.** `bin/obsidian-note.mjs` composes `Second Brain/Daily/YYYY-MM-DD.md` (briefing digest, wins logged, check-ins, review stats) with a provenance header, overwriting only its own file. Wired into daily-run phase 6. No `#review` tag (reserved for FSRS). Direct vault writes are safe while Obsidian is open.

**Hardening.** Request body caps (64KB default, 512KB for /api/health), `/api/ask` rate limit 30/rolling hour (429), `/api/tts` text cap 1200 chars (ElevenLabs credit protection), `X-Content-Type-Options: nosniff` globally.

## Selfcheck additions

- `data/agent-memory-work.md` scanned against BANNED terms.
- Work payload contains no `inbox` and no `calendar` key.
- `/api/health` with wrong token rejected; `/api/capture` probe accepted and selfcheck-flagged entries never served.
- `manifest.webmanifest` serves 200.

## Out of scope (stays on the operator card or HANDOVER)

Mail.Send consent + outlook.py send wiring, ElevenLabs tier decision, phone Tailscale install, home-laptop migration, TfNSW live train times (needs an API key).
