# Agent hologram deck

12 July 2026. Zyad asked: visualise the agents in the dashboard, same JARVIS world aesthetic, blue holograms of different characters per agent, JARVIS the main one as a butler; clicking one shows the agent's name, model, tools, role and a brief description. Plan approved verbally in the request itself ("write a plan to build this then build it").

## What renders

A full-width "Agent deck" panel at the bottom of the HUD: a row of small blue hologram figures, each standing on a glowing projector pad, flickering and floating the way this HUD already breathes. JARVIS stands centre and taller, drawn as a butler (tray, bowtie). Clicking a figure lights its pad and opens a dossier card under the row: name in Orbitron, role and model as chips, tool list as chips, one honest paragraph of description. Selecting also speaks the name and role through the existing voice path (gated by the SND toggle and the mixer's voice channel, so it costs nothing when muted and uses the chosen engine when not).

## The roster and where truth comes from

Two sources, zero drift:

- **Subagents** (`scribe`, `researcher`, `coach`, `career-analyst`) parse live from `.claude/agents/*.md` frontmatter at request time: `name`, `description`, `model`, `tools`, plus a new `career: true` key added to `career-analyst.md`. If a future agent file appears, it shows up on the deck by itself.
- **Built-ins** are hardcoded in `server.mjs` with honest strings, because their configuration lives in code and launchd, not frontmatter: **JARVIS** (head agent, `claude -p`, subscription default model, tools summarised from `.claude/settings.json` reality), **Daily run** (7:30am briefing agent), **Evolve** (9:30pm self-improvement loop), **Catchup** (the half-hourly launchd sweeper; a shell script, model listed as none, which is the honest answer).

The roster ships inside `/api/data` as `payload.agents` (small, and it inherits the SSE refresh plus every existing payload guarantee). No new endpoint.

## Stealth (binding, as always)

`career-analyst`'s name and description are wall-to-wall banned terms. `stripCareer()` filters career-flagged agents from the work payload and drops the flag key from the survivors (the proposals pattern: the key itself is a banned word). Selfcheck gains explicit assertions: the work payload contains no career-flagged agent and still contains the JARVIS entry, on top of the existing whole-payload banned-terms scan which would already redden on a leak.

## Holograms without dependencies

Pure inline SVG and CSS, nothing external. A shared construction: silhouette paths filled with a cyan vertical gradient that fades out toward the feet (holograms dissolve at the base), a CSS scanline overlay, a flicker-and-float animation with per-agent delays so the row shimmers out of phase, and an elliptical pad with an expanding ring. Eight distinct silhouettes, one accessory each so they read at 70px: butler with tray (JARVIS), herald raising a sun disc (daily run), tinker holding a gear (evolve), sprinting figure with a clock (catchup), hooded scribe with scroll, researcher with magnifier, coach with whistle and stopwatch, analyst with briefcase (career-only, so the office never sees it).

## Files touched

`server.mjs` (frontmatter parser, built-ins, aggregate + stripCareer), `.claude/agents/career-analyst.md` (career flag), `public/index.html` (panel), `public/app.js` (renderAgents + select/speak), `public/styles.css` (hologram construction), `bin/selfcheck.mjs` (assertions), `CLAUDE.md` and `docs/HANDOVER.md`.

## Not doing

No live "agent is currently running" telemetry on the deck in v1 (the System card already tracks pipelines); no animation library; no images or fonts beyond what the HUD loads today.
