# Agent upgrades: the capability matrix

Research synthesis (9 Jul 2026, verified against live docs and local testing) for turning JARVIS from a briefing tool into a working-alongside agent. What is wired, what is one step away, what is deliberately parked. Companion to `docs/HANDOVER.md` (which says who does what) and `docs/GO-MOBILE.md`.

## Wired tonight

| Capability | Mechanism | Notes |
|---|---|---|
| Conversation memory | one `claude -p` session per mode per day (`--session-id`/`--resume`), serialised | proven with a recall test; log in `data/conversations.jsonl`, LOG button on HUD |
| Head agent with tools | `.claude/settings.json` permissions.allow (reads, WebSearch/WebFetch, Write drafts/ only, whitelisted bin scripts, `open https://*`) | `.env` and `.cache` explicitly denied |
| Subagent staff | `.claude/agents/`: scribe, researcher, career-analyst, coach (sonnet, auto-delegation by description) | per-agent model pinning verified |
| Pull it up | `POST /api/open` + macOS `open` (uses HIS logged-in browser) | 403 in work mode; phone falls back to window.open |
| Draft correspondence | agents write `drafts/*.md`; HUD VIEW DRAFT button | sending stays manual until Graph scopes upgrade |
| One-tap routines | `data/proposals.json` cards, YES bakes into `data/routines.json`, day plan honours them | career proposals stripped in work mode |
| Phone HUD | Tailscale serve (tailnet-only) :8443 + PWA meta tags | never Funnel; see GO-MOBILE.md |

## One step away (verified how, not yet built)

- **Real email drafts and send (Outlook).** Graph consumer accounts support it: `Mail.ReadWrite` to create drafts (`POST /me/messages`), `Mail.Send` to send (`POST /me/sendMail`). One fresh device-code consent on the same client id upgrades the cached refresh token (incremental consent, verified). Build order: consent script, `outlook.py draft`, then a send path that only fires after an explicit spoken/clicked confirmation. Never auto-send.
- **Calendar awareness.** Two OAuth-free options on macOS: `brew install ical-buddy` (reads Calendar.app; check `icalBuddy calendars` sees the Google account; TCC prompt attaches to the invoking app, headless needs one interactive first run) or a Shortcuts shortcut run via `shortcuts run "Todays Events"` (EventKit, sees everything Calendar.app sees, permission granted once in the Shortcuts GUI). Recommendation: Shortcuts route; it dodges the cron TCC trap.
- **Google Calendar MCP / Workspace MCP** (nspady/google-calendar-mcp or taylorwilsdon/google_workspace_mcp) if two-way calendar write (creating events by voice) becomes wanted; needs a Google Cloud OAuth app; heavier than the read-only path above.
- **Notion headless.** The claude.ai Notion connector does not reach `-p` sessions. Official hosted MCP (`https://mcp.notion.com/mcp`) with an internal integration token gives the head agent direct tracker access. Medium value: AIOS already mirrors statuses daily.

## Parked, with reasons

- **Playwright MCP on the ask path.** Verified config (`.mcp.json` + user-scoped `enabledMcpjsonServers`), but each stdio MCP adds 1 to 3 seconds to EVERY ask, and a robot browser has none of his logins, so it cannot see portals, HireVue, or application states. `open` into his real browser wins for "pull it up"; `curl -sI` wins for liveness. Enable only for a specific scripted job (e.g. logged-out scraping runs).
- **Wake word / always-listening.** The HUD mic already does continuous dictation on click. True wake-word ("Jarvis...") needs a local model (openWakeWord/Porcupine) and a persistent audio process; battery and privacy cost on a laptop, low marginal value while the click-to-talk flow works. Revisit on the home laptop where it can run as a service.
- **apple-mcp (Messages, Reminders, Notes).** Powerful but wide TCC grants; add per-capability when a concrete need appears.
- **LinkedIn MCP.** Session-cookie auth, ban risk managed by excluding auto-apply. AIOS already covers discovery; park until a specific gap shows.
- **Home Assistant, Spotify MCPs.** Fun, not mission. The music player already covers the vibe locally.

## The reference stack (from the survey, for future reach)

Browser: microsoft/playwright-mcp. GitHub: github/github-mcp-server (OAuth remote). Notion: hosted official. Calendar: nspady/google-calendar-mcp. Workspace/Gmail: taylorwilsdon/google_workspace_mcp. Slack: korotovsky/slack-mcp-server. Filesystem + Memory: official modelcontextprotocol/servers. Telegram: chigwell/telegram-mcp (OpenClaw already covers ours). Home Assistant: official HA MCP integration. Obsidian: plain file writes beat every wrapper for nightly automation (officially safe while the app is open; the Local REST API plugin's built-in MCP exists if surgical patches are ever needed).
