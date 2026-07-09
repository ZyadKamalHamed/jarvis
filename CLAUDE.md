# JARVIS - Zyad's Life Operating System

The Iron Man style daily dashboard. A folder of JSON data files owned by a scheduled morning agent, plus a dependency-free local web app (`server.mjs` + `public/`) that renders them as a cinematic HUD. Data files are the single source of truth; the dashboard is a view.

JARVIS wraps and extends AIOS (`~/Coding/AIOS`), which remains the career module's source of truth. Never write to AIOS from here; read `~/Coding/AIOS/data/aios-data.json` only.

## Run

```bash
node server.mjs          # http://localhost:4777
JARVIS_PORT=5000 node server.mjs   # alternate port
```

No npm install. Node 18+. Zero dependencies by design (Node 25 + Turbopack burned us in AIOS; see its CLAUDE.md).

## Data contract (load-bearing)

Everything under `data/` is written by the daily agent (`jobs/jarvis-daily-run.md`) or by the app's narrow write paths. All writes are atomic (tmp file + rename). Extend schemas backwards-compatibly only.

- `data/briefing.json`: the morning briefing. `{ generatedAt, date, greeting, headline, workHeadline, sections: [{id, module, title, body, priority, actions?}], voiceScript, workVoiceScript, audioFile }`. `module` is one of `career | uni | study | fitness | work | email | general`. `voiceScript` is what JARVIS speaks; keep it under 120 seconds read aloud. `workHeadline` and `workVoiceScript` are the career-free variants served in work mode; nothing career-related may appear in ANY non-career-tagged field, including the general section. `actions` is optional per section: `[{label, url, autoOpen?} | {label, draft}]`; `autoOpen` on at most three actions per briefing (they open on SPEAK in full mode, and the daily agent pre-opens them via `open`); `draft` names a file in `drafts/`.
- `data/schedule.json`: his fixed weekly shape (work hours, train slots, gym, evening block). Read by the daily agent for the day plan. Edit only when his routine actually changes.
- `data/proposals.json`: routine proposals from the daily agent, `[{id, title, summary, routine, career, createdAt, status?, decidedAt?}]`. The HUD renders undecided ones as YES/LATER cards. `data/routines.json`: accepted routines; the day plan honours them from the next morning.
- `data/conversations.jsonl`: append-only ask log `{at, mode, q, a, ms}`. `data/ask-session.json`: the head agent's rolling session ids (one per mode per day). Both owned by the server.
- `drafts/*.md`: prepared correspondence (Context/To/Subject then body). Written by agents, sent by nobody. Gitignored like `data/`.
- `data/uni.json`: `{ updatedAt, semester, subjects[], assignments: [{id, subject, title, due, progressPct, status, source, nextAction, flags[]}], exams[], flags[] }`
- `data/study.json`: spaced repetition state. `{ updatedAt, queue: [{noteId, title, path, due, stability, retrievability}], stats: {reviewsToday, streak}, upcoming[] }`. FSRS scheduling state itself lives in `data/fsrs-state.json`, owned by `bin/study.py`.
- `data/fitness.json`: `{ updatedAt, source, weight: {currentKg, goalKg, trend7d, series[]}, nutrition: {todayKcal, targetKcal, proteinG, carbsG, fatG}, training: {program, weekSessions, lastSession, prs[]} }`
- `data/work.json`: `{ updatedAt, projects: [{client, name, status, nextMilestone}], inbox: {unread, flagged[]}, chatHighlights[], today[] }`
- `data/emails.json`: `{ updatedAt, accounts: [{address, label, connected, unread, topThreads: [{from, subject, summary, urgency}]}] }`
- `data/system.json`: pipeline health. `{ pipelines: [{id, name, lastRun, status, note}] }`
- `data/mode.json`: `{ mode: "full" | "work" }`. Stealth switch, written by the app only.
- `data/manual/log.jsonl`: append-only quick check-ins from the app (weight, workout done, review done).
- Career data: read live from `~/Coding/AIOS/data/aios-data.json` (contract documented in AIOS CLAUDE.md). READ ONLY.

## Stealth mode (binding)

`mode: "work"` must strip every trace of the job hunt SERVER SIDE before data leaves `/api/data`: the career module, career briefing sections, career voice lines, and jobhunt email accounts. The client never receives career data in work mode, so nothing can leak via devtools. The toggle in the UI is deliberately unlabelled (5 rapid clicks on the JARVIS wordmark, or Ctrl+Shift+J). `?work=1` on the URL forces work mode for the session regardless of mode.json.

## App write paths (the only ones)

- `POST /api/mode` toggles `data/mode.json`
- `POST /api/checkin` appends to `data/manual/log.jsonl` and may update `fitness.json` weight series
- `POST /api/feedback` appends to `data/feedback.jsonl` (user notes via the `fb:` prompt prefix, plus automatic ask-failure entries)
- `POST /api/win` appends to `data/wins.jsonl` (the salary-review impact log, via the `win:` prompt prefix). Career data: stripped whole from work mode, panel is `career-only`.
- `POST /api/ask` appends to `data/conversations.jsonl` and maintains `data/ask-session.json`
- `POST /api/proposal` updates `data/proposals.json` (accept/dismiss) and appends accepted routines to `data/routines.json`
- Everything else in `data/` is read-only to the app.

`/api/data` additionally serves `wins` (last 50), `metrics` (last 14 lines of metrics.jsonl, career pipeline key removed in work mode), `evolution` (evolution.json; its `summary` must always be work-safe) and `proposals` (career-flagged ones stripped in work mode).

Other endpoints: `GET /api/conversations` (mode-filtered: work mode only ever sees work-mode exchanges), `POST /api/open {url}` (opens a tab on the server's Mac via `open`; 403 in work mode; http(s) only), `GET /api/draft?file=` (serves a drafts/ file; 403 in work mode).

## Self-evolution (binding)

The system improves itself nightly via `jobs/jarvis-evolve.md` (9:30pm agent): read signals (`data/feedback.jsonl`, `data/metrics.jsonl`, `data/system.json`, `docs/BACKLOG.md`), make ONE small improvement, verify, commit, report via `data/evolution.json` which the morning briefing surfaces as "While you slept".

- This directory is a git repo. Every change, human or agent, must pass `node bin/selfcheck.mjs` before commit. Selfcheck boots a throwaway server on port 4779 and fails on any career leak in the work-mode payload; the banned-terms list may be extended, never trimmed.
- `data/` is gitignored on purpose: runtime state carries personal and career content and this repo may be seen at work. Never force-add data files.
- The evolve agent may strengthen stealth, never relax it. It never touches `.env`, `.cache/`, AIOS, or adds dependencies.
- `docs/BACKLOG.md` is the improvement queue; `data/metrics.jsonl` is append-only telemetry written by the daily run.

## Hard rules

- Australian English in UI copy. No em dashes anywhere: not in copy, code, comments or data.
- No fabricated data. Modules with no real feed yet render their `source: "sample"` state honestly with a SETUP badge.
- Briefings never invent facts. Unverifiable claims get dropped, not guessed.
- The boot audio (`public/assets/boot.mp3`, gitignored) is user-supplied. The app must boot cleanly without it. Extra tracks dropped into `public/assets/music/` (also gitignored) are listed by `GET /api/music` and playable via the footer player (play/pause, skip, repeat).
- Never auto-send anything (email, chat, applications) from this system. Telegram notification of "briefing ready" via OpenClaw is the only outbound push.

## Voice and the head agent

- `POST /api/tts {text}` returns audio. Uses ElevenLabs streaming when `ELEVENLABS_API_KEY` is set (env or `.env` file), else falls back to macOS `say`. Responses cached in `.cache/tts/` by content hash.
- `POST /api/ask {question}` runs the head agent: `claude -p` (Zyad's subscription, no API fees) with one rolling session per mode per day (`--session-id`/`--resume`), so the conversation carries across asks. System prompt: `jobs/ask-system.md` plus a trimmed live snapshot. Tool permissions come from `.claude/settings.json` (reads, WebSearch/WebFetch, Write only under `drafts/`, whitelisted bin scripts, `open https://*`; `.env` and `.cache` denied). Subagents in `.claude/agents/` (scribe, researcher, career-analyst, coach) take delegated work. Work-mode asks run tool-less on the stripped snapshot in their own session; full-mode and work-mode sessions never share a context window. Serialised, one at a time.

## Daily run

`jobs/jarvis-daily-run.md` defines the 7:30am agent: refresh every module JSON, then THINK (check link liveness, write needed drafts, research unknowns, propose routines), compose the schedule-aware day plan, write the briefing with actions, pre-open autoOpen tabs (full mode only), pre-render audio if a key is present, ping Telegram. AIOS's own 7:00am run happens first; JARVIS consumes its output and never duplicates its job scanning.

## Mobile and deployment

Tailnet-only exposure via `bin/go-mobile.sh` (tailscale serve on 8443; NEVER funnel). Always-on service: `deploy/com.zyad.jarvis.plist`. Machine moves: `bin/migrate-to-home.sh` carries what git ignores. Updates on the always-on box: `bin/update.sh` (pull, selfcheck gate, restart). Telegram without OpenClaw: `bin/notify.sh`. Full runbook: `docs/GO-MOBILE.md`. Current dev/ops handover: `docs/HANDOVER.md`; capability research: `docs/AGENT-UPGRADES.md`.
