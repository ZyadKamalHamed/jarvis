# JARVIS Beef-Up: Impact Log, Mobile, Trends + Overnight Report

Approved by Zyad 2026-07-08 (picked 3 of 4 offered upgrades; music-reactive reactor deferred to backlog). Implemented autonomously while he works on a uni assignment. Each feature ships as its own commit, gated by `bin/selfcheck.mjs`.

## 1. Salary impact log

Purpose: ammunition for the 6-month performance review. Zyad logs wins the moment they happen; JARVIS keeps a dated, review-ready record.

- Capture: `win: <text>` typed into the jarvis> prompt posts `{text}` to new endpoint `POST /api/win`, which appends `{at, text}` to `data/wins.jsonl` (append-only, atomic append). Confirmation reply in the answer panel with the running total.
- Serve: `aggregate()` reads the last 50 entries into `payload.wins = { count, entries }`.
- Stealth: this is career data by definition. `stripCareer()` deletes `payload.wins` entirely; `bin/selfcheck.mjs` gains an assertion that `wins` is absent from the work-mode payload. The panel carries `career-only` so the DOM hides it even before data stripping.
- Render: a sub-section inside the Career ops panel ("Impact log"): running count plus the 4 most recent wins with dates. No new grid panel; avoids layout upheaval.

## 2. Mobile layout

Purpose: dashboard readable on the phone on the train. A 720px breakpoint already stacks panels; this pass makes it actually pleasant:

- Rail: smaller wordmark and clock, freshness stays, pipeline LEDs stay (tiny).
- Reactor: core panel reduces height; reactor caps at ~180px and centres.
- Panels: tighter padding, headline font steps down, feed bodies clamp long text.
- Terminal footer: wraps to two rows when narrow (input full width on top; mic, voice, player below), player track name hides under 480px.
- No JS changes; CSS-only within the existing 720px and a new 480px breakpoint.

## 3. Trends + overnight report

Purpose: make system health visible over time, and surface what the nightly evolve run changed.

- Server: `aggregate()` additionally reads the last 14 lines of `data/metrics.jsonl` into `payload.metrics` and `data/evolution.json` into `payload.evolution`. Stealth: work mode removes the `career` pipeline key from every metrics entry; `evolution.summary` is work-safe by the evolve contract and passes through.
- Trend strip: in the System section of the Comms panel, one cell per day (up to 14): green if all pipelines ok, amber if any degraded/missing-credential, red if any error. Tooltip lists date and non-ok pipelines.
- Overnight report: when `evolution.changed` is true, the Priority feed shows a muted footer line "WHILE YOU SLEPT: <summary>". Client-side render; the 7:30am briefing agent also includes it as a section per the daily-run doc (already specified there).

## Error handling

Missing wins.jsonl, metrics.jsonl or evolution.json = feature renders nothing; no errors, no fabricated data. All new server reads are wrapped like existing readJson/readdir patterns.

## Testing

`node bin/selfcheck.mjs` (extended with the wins stealth assertion) after each feature; Playwright smoke of desktop and 390px viewport; `node --check` on app.js. Commit per feature.
