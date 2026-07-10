# JARVIS Nightly Evolve

> Instructions for the 9:30pm self-improvement agent. One small, verified improvement per night. Read `CLAUDE.md` first; its data contract and hard rules are binding, and `bin/selfcheck.mjs` is the gate on every change.

## Why this exists

JARVIS gets better through a closed loop: signals in (feedback, telemetry, failures), one change out, verified, committed, reported in the next morning briefing. Small and verified beats big and hopeful. A night with no worthwhile change is a valid outcome; log it honestly.

## Order of work

1. **Gather signals.**
   - `data/feedback.jsonl`: entries newer than `lastRun` in `data/evolution.json`. Zyad's `fb:` notes from the HUD are the highest-priority signal there is.
   - `data/metrics.jsonl`: pipeline statuses over the last 14 runs. A pipeline degraded 3+ days running is a defect, not a state.
   - `data/system.json`: current health.
   - `docs/BACKLOG.md`: the improvement queue, top item first.
2. **Pick ONE improvement.** Priority: explicit user feedback, then repeat pipeline failures, then the top backlog item. It must be completable and verifiable inside 20 minutes. If the best candidate is bigger than that, split it: do the first slice tonight and write the rest back into `docs/BACKLOG.md` as new items.
3. **Snapshot.** `git add -A && git commit -m "pre-evolve snapshot"` so there is always a clean point to revert to. If the tree was already clean, skip.
4. **Implement.** Smallest change that fully addresses the item. Match existing style: vanilla JS, zero dependencies, Australian English, no em dashes.
5. **Verify.** `node bin/selfcheck.mjs` must pass. If the change touched the UI, also load `http://127.0.0.1:4779` headlessly if a browser tool is available and confirm it renders. If selfcheck fails and you cannot fix it within two attempts: `git reset --hard` back to the snapshot and record the failure as a backlog item with what went wrong.
6. **Commit.** `git add -A && git commit -m "evolve: <what and why in one line>"`.
7. **Record.** Update `data/evolution.json` (atomic write):
   ```json
   {
     "lastRun": "<ISO timestamp>",
     "changed": true,
     "summary": "One sentence on what improved tonight, safe to show in work mode",
     "detail": "What, why, which signal prompted it",
     "feedbackProcessed": 2,
     "backlogSize": 7
   }
   ```
   `summary` appears in the morning briefing, so it must contain zero career content regardless of mode. Mark processed feedback by carrying `lastRun` forward; never delete feedback.jsonl.
8. **Refresh the head agent's memory.** Read today's `data/conversations.jsonl` entries and today's decisions (proposals decided, todos ticked, deadlines passed or moved). Update `data/agent-memory.md`: add what must survive across days, rewrite stale lines, convert relative dates to absolute, keep it under 120 lines. Then update `data/agent-memory-work.md` under the same rules but containing ONLY work-safe content; it must pass the banned-terms scan in `bin/selfcheck.mjs`. Never delete either file; a night with nothing worth remembering is a valid outcome.
9. **Run the backup.** `bash bin/backup.sh` (rotating tarball of data/, drafts/ and .env to ~/Backups/jarvis). This is not optional; it is the only copy of runtime state that exists outside this folder.
10. **Groom the backlog.** Add new items observed during the run (errors seen, awkward code, missing telemetry). Reprioritise: user-facing first. Cap the file at 25 items; drop the stalest with a note in the commit.
11. **Restart the live server only if server.mjs changed:** kill the process on port 4777 and relaunch `nohup node server.mjs > /tmp/jarvis-server.log 2>&1 &`. The HUD reconnects on its own.

## Guardrails (binding)

- ONE improvement per night. Resist scope creep; the loop compounds daily.
- `bin/selfcheck.mjs` must pass before every commit. No exceptions, no "it's probably fine".
- Never weaken stealth: `stripCareer()`, the banned-terms list in selfcheck, and work-mode behaviour may be strengthened, never relaxed or bypassed.
- Never write to `~/Coding/AIOS`. Never touch `.env`, credentials or `.cache/`.
- Never add npm dependencies, external CDNs or network calls to new third parties.
- Never auto-send anything. This run produces no outbound messages; the morning briefing carries the report.
- No fabricated telemetry. If a signal file is missing, note it and move on.
- Keep the run under 30 minutes total. Out of time = revert, log, exit clean.
