#!/usr/bin/env python3
"""JARVIS active recall engine.

Schedules cards with the FSRS-5 algorithm (default published weights, no
dependencies) and writes the daily queue to data/study.json. Cards come from
three sources: the Obsidian vault (any note modified in the last 36 hours is
captured automatically, and #review remains an explicit opt-in), imported
decks (Notion exports stored under data/study-cards/), and manual adds.

Usage:
  python3 bin/study.py refresh              rebuild queue from vault + state
  python3 bin/study.py review <id> <1-4>    grade a card (1 again, 2 hard, 3 good, 4 easy)
  python3 bin/study.py list                 show due cards
  python3 bin/study.py add <id> --title T [--prompt P] [--career] [--start YYYY-MM-DD]
                        [--est N] [--module M] [--content-file F]
  python3 bin/study.py import <file.json>   batch upsert a deck (staggered startDate supported)
  python3 bin/study.py remove <id>          drop a card from the rotation entirely

Card state lives in data/fsrs-state.json. A card with a future startDate is
scheduled, not due; it enters the rotation on that local date. career: true
cards are stripped server-side in work mode (binding). Australian English.
No em dashes.
"""

import argparse
import json
import math
import os
import re
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VAULT = Path(os.environ.get("JARVIS_VAULT", str(Path.home() / "Documents" / "Obsidian Vault")))
STATE_FILE = ROOT / "data" / "fsrs-state.json"
OUT_FILE = ROOT / "data" / "study.json"
CARDS_DIR = ROOT / "data" / "study-cards"

FRESH_HOURS = 36  # a note touched within this window is captured automatically
VAULT_EXCLUDE_DIRS = {"Daily", "_templates", "Flashcards"}  # daily logs, note templates and Anki card files are not study material
VAULT_EXCLUDE_FILES = {"Welcome.md"}

# FSRS-5 default parameters (open-spaced-repetition, MIT licensed constants).
W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
     1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
     2.9898, 0.51655, 0.6621]
DECAY = -0.5
FACTOR = 19.0 / 81.0
DESIRED_RETENTION = 0.9

AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4

ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
EM_DASH = "—"


def now():
    return datetime.now(timezone.utc)


def local_today():
    return datetime.now().astimezone().date()


def retrievability(stability, elapsed_days):
    if stability <= 0:
        return 0.0
    return (1 + FACTOR * elapsed_days / stability) ** DECAY


def next_interval(stability):
    ivl = stability / FACTOR * (DESIRED_RETENTION ** (1 / DECAY) - 1)
    return max(1, round(ivl))


def init_stability(rating):
    return max(W[rating - 1], 0.1)


def init_difficulty(rating):
    d = W[4] - math.exp(W[5] * (rating - 1)) + 1
    return min(max(d, 1.0), 10.0)


def next_difficulty(d, rating):
    delta = -W[6] * (rating - 3)
    d_new = d + delta * ((10 - d) / 9)
    # mean reversion toward the difficulty of a Good init
    d_new = W[7] * init_difficulty(GOOD) + (1 - W[7]) * d_new
    return min(max(d_new, 1.0), 10.0)


def next_stability(d, s, r, rating):
    if rating == AGAIN:
        return min(
            W[11] * d ** (-W[12]) * ((s + 1) ** W[13] - 1) * math.exp(W[14] * (1 - r)),
            s,
        )
    hard_penalty = W[15] if rating == HARD else 1.0
    easy_bonus = W[16] if rating == EASY else 1.0
    growth = math.exp(W[8]) * (11 - d) * s ** (-W[9]) * (math.exp(W[10] * (1 - r)) - 1)
    return s * (1 + growth * hard_penalty * easy_bonus)


def load_state():
    try:
        return json.loads(STATE_FILE.read_text())
    except (OSError, json.JSONDecodeError):
        return {"cards": {}}


def atomic_write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    with os.fdopen(fd, "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")
    os.replace(tmp, str(path))


def card_source(c):
    return c.get("source") or "vault"


def card_path(cid, c):
    # Legacy vault cards used the vault-relative path as their id.
    return c.get("path") or (cid if card_source(c) == "vault" else None)


def started(c, today):
    sd = c.get("startDate")
    return not sd or sd <= today.isoformat()


def fallback_prompt(title):
    return (
        "From memory: what are the key points of " + title
        + "? Say them out loud before you open the note."
    )


def scan_vault():
    """Return {rel_path: {title, path, module}} for notes in the rotation.

    A note qualifies when it is tagged #review (explicit opt-in) or its
    mtime falls within the last FRESH_HOURS (automatic capture of anything
    newly written or meaningfully edited). JARVIS's own Daily logs and the
    vault welcome file never qualify.
    """
    cards = {}
    if not VAULT.exists():
        return cards
    cutoff = now().timestamp() - FRESH_HOURS * 3600
    for md in VAULT.rglob("*.md"):
        parts = md.relative_to(VAULT).parts
        if any(p.startswith(".") for p in parts):
            continue
        if any(p in VAULT_EXCLUDE_DIRS for p in parts[:-1]):
            continue
        if parts[-1] in VAULT_EXCLUDE_FILES:
            continue
        try:
            fresh = md.stat().st_mtime >= cutoff
            text = md.read_text(errors="ignore")
        except OSError:
            continue
        tagged = re.search(r"(^|\s)#review\b", text) or '"review"' in text.split("---")[0]
        if not (tagged or fresh):
            continue
        rel = str(md.relative_to(VAULT))
        module = parts[0].lower() if len(parts) > 1 else "vault"
        cards[rel] = {"title": md.stem, "path": rel, "module": module}
    return cards


def refresh():
    state = load_state()
    vault_cards = scan_vault()
    known = state["cards"]

    captured = 0
    for cid, meta in vault_cards.items():
        if cid not in known:
            known[cid] = {
                "title": meta["title"],
                "module": meta["module"],
                "source": "vault",
                "path": meta["path"],
                "added": now().isoformat(),
                "due": now().isoformat(),
                "stability": None,
                "difficulty": None,
                "reps": 0,
                "lapses": 0,
                "last_review": None,
            }
            captured += 1
        else:
            known[cid]["title"] = meta["title"]
            known[cid]["module"] = meta["module"]
    # Drop only vault cards whose note file actually vanished. A card that
    # simply fell out of the freshness window keeps its schedule; imported
    # and manual cards are never touched by a vault scan.
    for cid in list(known):
        c = known[cid]
        if card_source(c) != "vault":
            continue
        p = card_path(cid, c)
        if p and not (VAULT / p).exists():
            del known[cid]

    atomic_write(STATE_FILE, state)
    write_queue(state)
    print(
        f"vault: {len(vault_cards)} in rotation ({captured} newly captured), "
        f"{len(known)} cards total, queue written to {OUT_FILE.name}"
    )


def queue_entry(cid, c, t):
    entry = {
        "id": cid,
        "noteId": cid,
        "title": c["title"],
        "module": c.get("module", "vault"),
        "due": c["due"],
        "stability": c["stability"],
        "retrievability": None,
        "prompt": c.get("prompt") or fallback_prompt(c["title"]),
        "career": bool(c.get("career")),
        "estMin": int(c.get("estMin") or 2),
        "source": card_source(c),
        "hasContent": bool(c.get("contentFile")),
        "isNew": c["stability"] is None,
    }
    p = card_path(cid, c)
    if p:
        entry["path"] = p
    if c["stability"] and c["last_review"]:
        elapsed = (t - datetime.fromisoformat(c["last_review"])).total_seconds() / 86400
        entry["retrievability"] = round(retrievability(c["stability"], elapsed), 3)
    return entry


def write_queue(state):
    t = now()
    today = local_today()
    due, upcoming = [], []
    reviews_today = 0
    scheduled_ahead = 0
    next_intro = None
    for cid, c in state["cards"].items():
        entry = queue_entry(cid, c, t)
        if c.get("last_review", "") and str(c["last_review"]).startswith(today.isoformat()):
            reviews_today += 1
        if not started(c, today):
            scheduled_ahead += 1
            sd = c["startDate"]
            if next_intro is None or sd < next_intro:
                next_intro = sd
            entry["due"] = sd + "T00:00:00+10:00"
            upcoming.append(entry)
        elif datetime.fromisoformat(c["due"]) <= t:
            due.append(entry)
        else:
            upcoming.append(entry)
    due.sort(key=lambda e: e["due"])
    upcoming.sort(key=lambda e: e["due"])

    est_total = sum(e["estMin"] for e in due)
    out = {
        "updatedAt": t.isoformat(),
        "queue": due,
        "stats": {
            "reviewsToday": reviews_today,
            "streak": compute_streak(state),
            "dueCount": len(due),
            "sessionMin": 0 if not due else min(20, max(5, est_total)),
            "scheduledAhead": scheduled_ahead,
            "nextIntro": next_intro,
        },
        "upcoming": upcoming[:10],
        "source": "fsrs-engine",
    }
    if not state["cards"]:
        out["setupNote"] = (
            "The vault at " + str(VAULT) + " has no captured notes yet. "
            "Anything you write enters the rotation the next morning; #review tags a note in immediately."
        )
    atomic_write(OUT_FILE, out)


def compute_streak(state):
    days = set()
    for c in state["cards"].values():
        for r in c.get("history", []):
            days.add(r[:10])
    if not days:
        return 0
    streak = 0
    d = datetime.now().astimezone().date()
    while d.isoformat() in days or (streak == 0 and (d - timedelta(days=1)).isoformat() in days):
        if d.isoformat() in days:
            streak += 1
        d -= timedelta(days=1)
        if streak == 0:
            break
    return streak


def review(cid, rating):
    state = load_state()
    c = state["cards"].get(cid)
    if not c:
        sys.exit(f"unknown card: {cid}")
    if rating not in (AGAIN, HARD, GOOD, EASY):
        sys.exit("rating must be 1..4")
    t = now()
    if c["stability"] is None:
        s = init_stability(rating)
        d = init_difficulty(rating)
    else:
        elapsed = (t - datetime.fromisoformat(c["last_review"])).total_seconds() / 86400
        r = retrievability(c["stability"], elapsed)
        s = next_stability(c["difficulty"], c["stability"], r, rating)
        d = next_difficulty(c["difficulty"], rating)
        if rating == AGAIN:
            c["lapses"] += 1
    c["stability"] = round(s, 4)
    c["difficulty"] = round(d, 4)
    c["reps"] += 1
    c["last_review"] = t.isoformat()
    ivl = 0.007 if rating == AGAIN else next_interval(s)  # Again = 10 minutes
    c["due"] = (t + timedelta(days=ivl)).isoformat()
    c.setdefault("history", []).append(t.isoformat() + f"|{rating}")
    atomic_write(STATE_FILE, state)
    write_queue(state)
    print(f"{cid}: rating {rating}, next due in {ivl} day(s)")


def validate_card_fields(cid, title, prompt, start, est):
    if not ID_RE.match(cid):
        sys.exit(f"bad id (lowercase slug, max 60 chars): {cid}")
    if not title or len(title) > 140:
        sys.exit(f"title must be 1..140 chars: {cid}")
    for field in (title, prompt or ""):
        if EM_DASH in field:
            sys.exit(f"no em dashes, house rule: {cid}")
    if start and not DATE_RE.match(start):
        sys.exit(f"startDate must be YYYY-MM-DD: {cid}")
    if est is not None and not (1 <= est <= 30):
        sys.exit(f"estMin must be 1..30: {cid}")


def upsert_card(state, cid, *, title, prompt=None, career=False, start=None,
                est=None, module=None, content_file=None, source="manual"):
    validate_card_fields(cid, title, prompt, start, est)
    if content_file and not re.match(r"^[\w.-]+\.md$", content_file):
        sys.exit(f"contentFile must be a bare .md filename: {cid}")
    c = state["cards"].get(cid)
    fresh = c is None
    if fresh:
        due = now().isoformat()
        if start and start > local_today().isoformat():
            due = start + "T00:00:00+10:00"
        c = state["cards"][cid] = {
            "added": now().isoformat(),
            "due": due,
            "stability": None,
            "difficulty": None,
            "reps": 0,
            "lapses": 0,
            "last_review": None,
        }
    # Metadata always follows the latest add/import; the schedule (due,
    # stability) is FSRS's alone once a card exists.
    c["title"] = title
    c["module"] = module or c.get("module") or "deck"
    c["source"] = source
    c["career"] = bool(career)
    if prompt:
        c["prompt"] = prompt
    if est is not None:
        c["estMin"] = est
    if start:
        c["startDate"] = start
    if content_file:
        c["contentFile"] = content_file
    return fresh


def cmd_add(args):
    state = load_state()
    fresh = upsert_card(
        state, args.id, title=args.title, prompt=args.prompt, career=args.career,
        start=args.start, est=args.est, module=args.module,
        content_file=args.content_file, source="manual",
    )
    atomic_write(STATE_FILE, state)
    write_queue(state)
    print(f"{args.id}: {'added' if fresh else 'updated'}")


def cmd_import(path_arg):
    try:
        cards = json.loads(Path(path_arg).read_text())
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"cannot read deck: {e}")
    if not isinstance(cards, list) or not cards:
        sys.exit("deck must be a non-empty JSON array")
    state = load_state()
    added = updated = 0
    for card in cards:
        fresh = upsert_card(
            state, str(card.get("id", "")),
            title=str(card.get("title", "")),
            prompt=card.get("prompt"),
            career=bool(card.get("career")),
            start=card.get("startDate"),
            est=int(card["estMin"]) if card.get("estMin") is not None else None,
            module=card.get("module"),
            content_file=card.get("contentFile"),
            source=str(card.get("source") or "notion"),
        )
        added += fresh
        updated += not fresh
    atomic_write(STATE_FILE, state)
    write_queue(state)
    print(f"deck: {added} added, {updated} updated, {len(state['cards'])} cards total")


def cmd_remove(cid):
    state = load_state()
    if cid not in state["cards"]:
        sys.exit(f"unknown card: {cid}")
    del state["cards"][cid]
    atomic_write(STATE_FILE, state)
    write_queue(state)
    print(f"{cid}: removed")


def list_due():
    state = load_state()
    t = now()
    today = local_today()
    rows = [
        (cid, c) for cid, c in state["cards"].items()
        if started(c, today) and datetime.fromisoformat(c["due"]) <= t
    ]
    if not rows:
        print("queue clear")
    for cid, c in sorted(rows, key=lambda x: x[1]["due"]):
        flag = "*" if c.get("career") else " "
        print(f" {flag}[{c.get('module','vault'):10}] {c['title']}  ({cid})")


def main():
    argv = sys.argv[1:]
    cmd = argv[0] if argv else "refresh"
    if cmd == "refresh":
        refresh()
    elif cmd == "review" and len(argv) == 3:
        review(argv[1], int(argv[2]))
    elif cmd == "list":
        list_due()
    elif cmd == "add":
        p = argparse.ArgumentParser(prog="study.py add")
        p.add_argument("id")
        p.add_argument("--title", required=True)
        p.add_argument("--prompt")
        p.add_argument("--career", action="store_true")
        p.add_argument("--start")
        p.add_argument("--est", type=int)
        p.add_argument("--module")
        p.add_argument("--content-file", dest="content_file")
        cmd_add(p.parse_args(argv[1:]))
    elif cmd == "import" and len(argv) == 2:
        cmd_import(argv[1])
    elif cmd == "remove" and len(argv) == 2:
        cmd_remove(argv[1])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
