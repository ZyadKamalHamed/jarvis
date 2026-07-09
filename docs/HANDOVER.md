# HANDOVER

Written 9 July 2026 by the session that built the agentic layer, for whichever model continues the work (expected: Claude Opus 4.8). Read `CLAUDE.md` first, then this. Zyad asked for effort guidance per task; it is included and calibrated honestly.

## State of the system tonight

Everything described in `CLAUDE.md` is real, selfcheck-gated and pushed to the private repo (github.com/ZyadKamalHamed/jarvis). Tonight added: head agent with same-day session memory and a conversation log, briefing actions with tab opening, proposals with one-tap routines, drafts pipeline, the agentic daily-run spec, the mobile kit (Tailscale serve, LaunchAgent, migration and notify scripts, GO-MOBILE runbook), the Obsidian Second Brain (14 notes in `~/Documents/Obsidian Vault/Second Brain/`), and staged Friday briefing data with real verified links.

## Invariants you never relax (in order)

1. **Stealth.** Work mode strips career server-side; `bin/selfcheck.mjs` must pass before every commit; the banned list only grows. /api/open, /api/draft and full-mode conversations are DEAD in work mode. If a change makes selfcheck fail, the change is wrong, not the check.
2. **No auto-send.** Drafts are the ceiling. The Telegram ready-ping is the only outbound message. Even after Mail.Send lands, sending requires an explicit human confirmation per message.
3. **Honesty.** No fabricated data, no invented counts, no career claims beyond `~/Coding/AIOS/context/career-context.md` (graduate level, accurate inventory, no Adidas).
4. **Zero dependencies** in server and HUD. Subscription billing only for `claude -p` (never let ANTHROPIC_API_KEY into its env; the server already strips it).
5. **Australian English, no em dashes anywhere** (chat, code, comments, data, docs). Zyad treats this as a hard rule.
6. `data/`, `drafts/`, `.env`, `.cache/` never enter git.

## Gotchas discovered tonight (save yourself the hours)

- `claude -p --resume` sessions are cwd-scoped and race if parallel: the server serialises asks through one promise chain; keep it that way.
- Session JSON: parse `result`, `session_id`, `is_error` from `--output-format json`. A failed resume must null the stored session id so the next ask starts fresh (already implemented).
- Project `.mcp.json` servers do NOT load in `-p` without user-scoped pre-approval (`enabledMcpjsonServers` in `~/.claude/settings.json`, not the repo settings). Each stdio MCP costs 1 to 3 seconds per invocation: keep the ask path MCP-free.
- Permission rules: `Write(drafts/**)` style paths anchor at the project; `Read(**/.env)` deny patterns protect secrets from the head agent (already in `.claude/settings.json`).
- Graph consumer accounts: incremental consent works; one new device-code run with `["Mail.Read","Mail.ReadWrite","Mail.Send"]` upgrades the cached token. MSAL adds reserved scopes itself; passing openid/profile explicitly makes it throw.
- Tailscale on this Mac is now logged in under the ZyadKamalHamed account, which is a DIFFERENT tailnet from the old zyadschneider24 one (tail70b7c5.ts.net). The OpenClaw Google Chat funnel config from memory targets the old tailnet and is currently dead. Fixing it means either re-login with the Google account or re-running the funnel setup for the new hostname AND updating the Google Chat app's audience URL (see the openclaw-g-chat-config skill notes).
- `tailscale serve` needed one-time tailnet enablement (admin URL); if serve status looks empty, check that first.
- The scheduled tasks (jarvis-daily-run 7:30am, jarvis-evolve 9:30pm) exist as SKILL.md folders but were still NOT registered in the Claude app UI as of tonight. Nothing agentic happens in the morning until Zyad does that by hand. This is the number one operational gap.

## Task queue with effort guidance

Effort levels refer to Claude Code's /effort (or equivalent care): low = mechanical, medium = normal engineering, high = touching stealth, money, or outbound surfaces.

1. **Register scheduled tasks** (Zyad's hands, 3 minutes, no model needed). Blocks everything agentic.
2. **Home laptop migration** (follow `docs/GO-MOBILE.md` phase 1): effort **medium**. Mostly mechanical; the two judgement points are the plist node path and re-registering scheduled tasks there.
3. **Graph Mail.ReadWrite + Mail.Send** (`bin/outlook.py` consent + draft + send): effort **high**. It is an outbound-capable surface: draft creation is safe, the send path must demand an explicit fresh confirmation string from the HUD per message and log every send to conversations. Verified API shapes are in AGENT-UPGRADES.
4. **Calendar module** (Shortcuts route into `data/calendar.json`, day-plan integration): effort **medium**. Watch the TCC notes.
5. **Sonder prep pack before 22 Jul** (career-analyst output into briefing + drafts): effort **medium**, content quality matters more than code.
6. **Obsidian nightly sync** (daily run appends material changes to Second Brain notes): effort **medium**; append-only, never rewrite user edits, no #review tags.
7. **Telegram audio delivery, briefing archive, Drive watching, reactor-music sync**: effort **low**, good evolve-agent fodder; leave them to the nightly loop unless Zyad asks.
8. **Anything touching selfcheck, stripCareer, or the banned list**: effort **high**, always, regardless of size.

## How to work here

Small diffs, selfcheck before every commit, one concern per commit, plain-language commit messages (existing log shows the register). Data files change via atomic writes only. When Zyad gives feedback ("fb:" entries in `data/feedback.jsonl`), it outranks the backlog. When in doubt about a career claim, `career-context.md` wins over memory, enthusiasm and marketing instinct.

The bar the briefing must clear, kept from the original build note: nothing in it may be homework that could already have been done. Check the link, draft the email, research the unknown, propose the routine. He should only ever have to decide.
