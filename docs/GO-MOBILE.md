# JARVIS on the go

The recommended shape, in one line: **the home laptop is the always-on brain, the phone is the HUD, this machine becomes a dev satellite.** Tailscale `serve` carries the HUD to the phone privately; git carries code between machines; Taildrop carries the private data git refuses to.

Why this over the alternatives:

- **Cloud deploy (Vercel, a VPS): rejected.** The HUD has no auth of its own and the data is career and personal. Public exposure of any kind is a stealth breach waiting to happen.
- **Tailscale Funnel: rejected**, same reason. Funnel is public internet. JARVIS uses `serve`, which stays inside the tailnet (only devices signed in to the Tailscale account can even route to it), wrapped in automatic HTTPS.
- **Port forwarding / DDNS: rejected.** All of the risk, none of the convenience.

## Phase 0: phone access tonight (this machine)

Already scripted:

```bash
bash bin/go-mobile.sh
```

Then on the iPhone: App Store, install **Tailscale**, sign in with the same account the Mac is logged in with (currently the GitHub-linked ZyadKamalHamed account, tailnet tailb73e19.ts.net), toggle the VPN on, open the URL the script printed (https://zyad-hamed.tailb73e19.ts.net:8443) in Safari, Share, **Add to Home Screen**. The HUD installs like a real app since 10 Jul: arc reactor icon, standalone full screen, offline shell (live data still needs the tailnet, by design; nothing from /api is ever cached). The AIOS career dashboard rides along at `/aios/` on the same host (served from disk by JARVIS, so nothing squatting on localhost:3000 can ever hijack it; invisible in work mode). Caveat until the home laptop takes over: it works while this Mac is awake.

## Phase 1: the home laptop becomes the brain

1. **Prereqs on the home laptop:** Node 18+ (`brew install node`), git, Tailscale (sign in, same account), Claude Code (`npm i -g @anthropic-ai/claude-code`, log in on the subscription).
2. **Code:** `git clone https://github.com/ZyadKamalHamed/jarvis.git ~/Coding/JARVIS` (private repo; authenticate with `gh auth login`).
3. **Private data:** on THIS machine run `bash bin/migrate-to-home.sh`, then send the bundle: `tailscale file cp ~/jarvis-move-*.tgz <home-laptop>:` (lands in ~/Downloads). On the home laptop: `cd ~/Coding/JARVIS && tar -xzf ~/Downloads/jarvis-move-*.tgz`, then `python3 -m venv .venv-jarvis && .venv-jarvis/bin/pip install msal`.
4. **AIOS:** clone/copy `~/Coding/AIOS` the same way if it is not already there (JARVIS reads its data file; the AIOS 7:00am scheduled task should also move).
5. **Always-on server and agents:** `mkdir -p ~/Library/LaunchAgents && cp deploy/com.zyad.jarvis.plist deploy/com.zyad.jarvis.daily.plist deploy/com.zyad.jarvis.evolve.plist deploy/com.zyad.jarvis.catchup.plist ~/Library/LaunchAgents/` then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/<each>.plist`. Check the node path inside com.zyad.jarvis.plist matches `which node` on that machine, and the hardcoded /Users/Zyad paths if the username differs. The catchup agent is the safety net: every 30 minutes it runs whatever the day still owes (missed briefing after 7:30, missed evolve after 21:30), so offline mornings and reboots cost half an hour, not the day.
6. **Tailnet exposure:** `bash bin/go-mobile.sh` there too. The phone bookmark then points at the home laptop's name instead; update the Home Screen app once.
7. **Stay awake:** System Settings, Displays, Advanced, "Prevent automatic sleeping on power adapter when the display is off" ON (or `sudo pmset -c sleep 0`). Keep the laptop on power. Keep Tailscale in Login Items ("Quit Leave VPN Active" exists in its debug menu if the GUI bothers you).
8. **Scheduled agents come with step 5** (the daily and evolve plists). Two extra requirements on the new machine: log claude in on the subscription, and trust the workspace for headless runs: either run `claude` interactively inside `~/Coding/JARVIS` once and accept the trust dialog, or set `projects["/Users/Zyad/Coding/JARVIS"].hasTrustDialogAccepted: true` in `~/.claude.json`. Without it, headless jobs run with NO permissions and every write is denied. Verify with `bash bin/run-job.sh --selftest` then read `data/joblogs/selftest.log`: no trust warning, result JARVIS-LAUNCHD-OK.
9. **Telegram ping without OpenClaw:** the OpenClaw gateway lives on this machine. On the home laptop, create a NEW bot with @BotFather (30 seconds), put `TELEGRAM_BOT_TOKEN=` and `TELEGRAM_CHAT_ID=8343303630` into `.env`, and the daily run's fallback `bin/notify.sh` handles the morning ping. Do not reuse the OpenClaw bot token; two pollers on one token fight.

## Updating on the go

- **Content updates happen by themselves:** the 7:30am and 9:30pm agents write data and improve code nightly on the home laptop.
- **Code updates:** push from wherever you are; on the home laptop run `bash bin/update.sh` (pull, selfcheck gate, service restart). Or start a Remote Control session on the home laptop's Claude app from your phone and just ask for what you want changed; the session works in the repo directly.
- **Break glass:** the phone Tailscale app can SSH to the laptop if you enable Tailscale SSH later; until then Remote Control is the hands.

## Rules that survive the move

- data/, drafts/, .env, .cache never enter git. The migrate bundle is their only transport.
- `tailscale serve` only. The word funnel does not appear near this system again.
- Every code change passes `node bin/selfcheck.mjs` before it ships, no matter which machine or who (you, Opus, the nightly evolve agent) makes it.
