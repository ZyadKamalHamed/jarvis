# The Day Board: one prioritised list for the whole day

15 July 2026. Zyad's ask, distilled: replace the focus-mode task list with a conglomerate of everything the day holds (uni, job applications, interview prep, gym, errands, operator tasks), auto-ordered by priority, rebuilt each morning by the daily run, manually reorderable, tickable, voice-editable through JARVIS, with time estimates, deep links to the thing each task is about, overflow that bleeds into the next day, and a compact presence on the home dashboard that does not take over the priority feed.

## What already exists

`data/daytasks.json` (date-gated in `aggregate()`), `POST /api/daytask` tick endpoint, `#day-list` renderer inside the priority feed panel, and a `stripCareer` branch that filters career tasks and sheds the flag key. Nothing composes the file, there are no estimates, no ordering controls, no add path, and focus mode shows the uni board instead. This build completes the system on those bones rather than inventing a parallel one.

## Data contract (extends daytasks.json backwards-compatibly)

```json
{
  "date": "2026-07-15",
  "updatedAt": "ISO",
  "capacityMin": 240,
  "tasks": [
    {
      "id": "finish-td-a1",
      "title": "Assessment 1 main pass",
      "detail": "55 points, due Friday 5pm.",
      "kind": "uni",
      "est": 120,
      "priority": "high",
      "career": false,
      "overflow": false,
      "carried": "2026-07-14",
      "url": "https://canvas.uts.edu.au/...",
      "uniId": "td-a1",
      "done": false,
      "doneAt": null
    }
  ]
}
```

- **Array order IS the priority order** among open tasks. No scoring engine: the morning agent is the scorer, manual moves and voice reshuffles re-splice the array, and nothing reorders behind his back between mornings.
- `kind` is one of `uni | study | career | fitness | personal | ops` and drives a small chip colour. The value `career` only ever rides on tasks flagged `career: true`, which never travel in work mode.
- `est` is minutes (integer, 0 to 480). The HUD renders it as an hourglass chip. `capacityMin` is the agent's honest estimate of free minutes today after fixed commitments; absent means unknown, never guessed by the HUD.
- `overflow: true` renders under an IF TIME REMAINS divider: the bleed zone for things that only happen if the main list clears.
- `carried` is the date the task was first planned, stamped when a task rolls over; the HUD shows its age. Tasks may also carry `url`, `draft`, `doc` (existing action-button contract) and `uniId`/`jobId` provenance.
- Existing readers keep working: every new field is additive, ticks use the same `done`/`doneAt`.

## Write paths (exactly three)

1. **`bin/dayplan.mjs`**, the sanctioned CLI, used by the morning agent and the head agent:
   - `plan --file <json>|stdin` validates and writes the whole board. Guards: date is today (or `--date`), unique slug ids, titles 1 to 140 chars, est 0 to 480, kind from the enum, career boolean, at most 40 tasks, no em dash anywhere. Done states of matching ids survive a replan so a rebuild never unticks his day.
   - `add "title" [--est 25] [--kind personal] [--career] [--detail ...] [--url ...] [--overflow]` appends; on a stale file it carries first.
   - `done <id>` / `undone <id>` / `remove <id>` / `move <id> up|down|top|bottom`.
   - `carry` rolls a stale file forward: undone tasks keep their order and gain `carried` (original date preserved if already carried), done ones drop off.
   - `show` prints the current board.
   Atomic writes; the server's data watcher turns every CLI write into an SSE push, so the HUD updates live.
2. **Server endpoints** for the HUD: existing `POST /api/daytask` tick; new `POST /api/daytask-move { id, dir: up|down }` and `POST /api/daytask-add { title, est?, url? }`. Add never accepts career or kind flags over HTTP (always `career: false`, `kind: personal`); on a stale file it carries first, so a Thursday quick-add resurrects Wednesday's leftovers exactly as the bleed rule wants. Move finds the neighbour among tasks **visible in the caller's mode**, so an office reorder never no-ops against an invisible career row; moving up from the first overflow task promotes it to the main list, moving down from the last main task demotes it, ends are no-ops.
3. **The morning agent** composes the whole board through the CLI in phase 3 (below).

## HUD surfaces

- **Focus mode becomes pomodoro + day board.** `#panel-day` (span6) joins `#panel-focus`; the uni panel returns to the home grid only. The board: open main tasks in order, the first tagged NOW; the IF TIME REMAINS divider and overflow zone; struck done rows at the bottom, restorable. Each row: tick, kind chip, title, detail, hourglass est chip, carried age badge, action buttons (OPEN, VIEW DRAFT, DOC, WALKTHROUGH), and up/down arrows. Footer: an add box (`title`, optional `25m` suffix parsed as est). Header chip: `5 TO GO · 3H 40M` plus `OVER CAPACITY` warning when open main minutes exceed `capacityMin`.
- **Home stays calm.** The old full list inside the priority feed shrinks to a strip: header with the same totals chip, the top three open tasks (tickable), and `+N MORE · FULL BOARD` which enters focus mode. Done items do not render on home.
- **`td:` prefix** on the prompt bar quick-adds (`td: buy milk 15m`), joining `in:`, `win:` and `fb:`; the palette gains an Add-to-today preset and the help overlay documents all of it.
- The uni board gains OPEN buttons on assignments once `bin/canvas.mjs` starts persisting each assignment's `html_url` (one additive field, `url`), which also gives uni day-tasks their Canvas deep link.

## Voice protocol (head agent charter)

`jobs/ask-system.md` gains a numbered capability: manage the day board only through `node bin/dayplan.mjs`. Dictated plans (`here is my plan for today...`) become a full ordered `plan` write that merges what already exists, keeps done states, estimates honestly in minutes, flags career items, and puts genuine maybes in overflow. Reshuffles use `move` or a re-`plan`. `done <id>` only when he explicitly says he finished something; JARVIS never ticks on inference. In work mode the head agent is tool-less by design, so board edits are declined there with a pointer to the tick buttons; the snapshot still lets him ask what is on the list. `trimmedSnapshot` gains the open board (title, est, overflow) so plan questions need no file reads.

## Morning rebuild (daily run phase 3)

Rewritten to compose the board, not briefing prose: carry first (`carry`), then `plan` the merged day from uni flags, AIOS career deadlines and today's pick, accepted routines (respecting pauses and the winter intensive shape), open operator todos (weekends, or high priority any day), unplaced inbox captures, gym from the schedule, and calendar anchors to route around. Every task gets an honest `est`, the deep link that matters (Canvas url, apply url plus kit draft for job applications, walkthrough guides auto-annotate as today), `capacityMin` from schedule minus fixed commitments, and anything beyond capacity goes to overflow rather than pretending the day is longer than it is. The briefing keeps one general section describing the shape of the day and narrates the top of the board in the voice script; the board is the single source of task truth so the two can never drift.

## Stealth (binding, effort high)

Career tasks are filtered server-side in work mode and the `career` key is shed from survivors (already live); the new endpoints answer 404 for career ids in work mode, indistinguishable from unknown ids; `/api/daytask-add` cannot introduce career flags over HTTP at all; mode-visible move semantics prevent invisible-neighbour probing; the work-mode snapshot inherits the stripped aggregate. `bin/selfcheck.mjs` gains day-board probes: back up the real file bytes (or its absence), inject a synthetic board holding a banned-word career task, assert full mode serves it and work mode neither serves it nor sheds evidence of it (payload scan stays clean, no flag keys), assert career-id tick and move answer 404 in work mode, unknown ids 404 in both, malformed add and move bodies 400, then restore the original bytes in a finally block.

## Deliberately deferred

Drag-and-drop reordering (arrows are phone-friendly and zero-dep), pomodoro-task linkage (click a task to load its est into the timer), auto-ticking uni assignments when the mirrored day task ticks (cross-board writes surprise more than they save), and a done-history archive beyond the day file (the Obsidian daily note and metrics already record outcomes).

## Verification

`node bin/selfcheck.mjs` green; Playwright against a synthetic board in both modes (tick and untick round trip, move across the overflow boundary and back, quick-add, work-mode DOM contains zero banned strings) with `data/` restored byte-identical; then seed today's real board through the CLI from uni.json, todos.json, routines.json and AIOS data, honouring the winter intensive shape; commit and restart.
