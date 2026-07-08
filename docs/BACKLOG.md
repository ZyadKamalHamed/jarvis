# JARVIS Improvement Backlog

Queue for the nightly evolve run (`jobs/jarvis-evolve.md`). Top item goes first. One per night. Anyone (Zyad via `fb:` in the HUD, the daily run, the evolve run itself) can add items; the evolve run grooms and reprioritises.

1. **Briefing "overnight improvements" line.** The morning briefing should read `data/evolution.json` and include a one-line "while you slept" note when `changed` is true. Touches `jobs/jarvis-daily-run.md` output only.
2. **Metrics history chart.** Render pipeline health over the last 14 days from `data/metrics.jsonl` as a small strip in the System panel, so degradation trends are visible at a glance.
3. **Impact log for the salary review.** A `data/wins.jsonl` appended via `win:` prefix in the HUD prompt, rendered as a review-ready list. Career-adjacent: must be stripped in work mode like everything else.
4. **Audio-reactive reactor polish.** The arc reactor already pulses to TTS; extend it to the boot track and smooth the decay curve.
5. **Mobile layout.** The HUD grid collapses poorly under 700px; single-column stack with the reactor docked top-right.
6. **Telegram audio delivery.** Attach the briefing m4a to the morning OpenClaw ping instead of text only.
7. **Google Drive assignment watching.** Populate `context/uni-watchlist.md` and wire the daily run's progressPct evidence checks.
8. **Ask-history.** Log questions asked (not answers) to metrics so evolve can see what Zyad actually uses JARVIS for and optimise those paths.
