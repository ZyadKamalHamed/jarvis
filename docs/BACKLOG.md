# JARVIS Improvement Backlog

Queue for the nightly evolve run (`jobs/jarvis-evolve.md`) and for dev sessions. Top item goes first. One per night for evolve. Anyone (Zyad via `fb:` in the HUD, the daily run, the evolve run itself) can add items; the evolve run grooms and reprioritises. Items marked [dev session] are too large for a single evolve night; they belong to a human-driven session (see `docs/HANDOVER.md` for effort guidance).

1. **Mail.ReadWrite + Mail.Send upgrade** [dev session]. One device-code re-consent, then `bin/outlook.py draft` (POST /me/messages) so approved drafts land in the real Outlook Drafts folder, and a `send` path gated on explicit HUD confirmation. HANDOVER has the verified Graph details.
2. **Calendar module** [dev session]. `shortcuts run "Todays Events"` (or icalBuddy) into `data/calendar.json`, rendered under the clock and folded into the day plan. TCC notes in HANDOVER.
3. **Sonder prep pack** (before 22 Jul). Career-analyst subagent builds role research, likely questions, story mapping into a briefing section plus a drafts/ prep sheet.
4. **Obsidian nightly context sync.** Daily run appends material changes (pipeline moves, new wins, big decisions) to the Second Brain vault notes so they never go stale.
5. **Telegram audio delivery.** Attach the briefing mp3 to the morning ping (OpenClaw or bin/notify.sh).
6. **Briefing history archive.** Keep dated copies of briefing.json so past days are browsable.
7. **Google Drive assignment watching.** Populate `context/uni-watchlist.md` and wire the daily run's progressPct evidence checks.
8. **Audio-reactive reactor for music.** Extend the reactor pulse to the boot track and playlist. (Zyad deferred 2026-07-08; never outranks user feedback.)
9. **Playwright MCP enablement** [optional]. `.mcp.json` + user-scoped `enabledMcpjsonServers` so the head agent can drive a browser for logged-out research; deliberately NOT wired for every ask (1 to 3s startup tax, and `open` beats it for anything needing his logins).

Done (for the record): impact log via `win:` (2026-07-08), 14-day trend strip (2026-07-08), While You Slept line (2026-07-08), phone layout pass (2026-07-08), conversation memory + LOG overlay (2026-07-09), agentic briefing with actions/proposals/drafts (2026-07-09), head agent with subagents (2026-07-09), tailnet mobile access kit (2026-07-09).
