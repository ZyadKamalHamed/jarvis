#!/usr/bin/env python3
"""JARVIS spaced repetition engine.

Scans the Obsidian vault for notes tagged #review, schedules them with the
FSRS-5 algorithm (default published weights, no dependencies), and writes the
daily queue to data/study.json.

Usage:
  python3 bin/study.py refresh              rebuild queue from vault + state
  python3 bin/study.py review <id> <1-4>    grade a card (1 again, 2 hard, 3 good, 4 easy)
  python3 bin/study.py list                 show due cards
Card state lives in data/fsrs-state.json. Australian English. No em dashes.
"""

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

# FSRS-5 default parameters (open-spaced-repetition, MIT licensed constants).
W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
     1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
     2.9898, 0.51655, 0.6621]
DECAY = -0.5
FACTOR = 19.0 / 81.0
DESIRED_RETENTION = 0.9

AGAIN, HARD, GOOD, EASY = 1, 2, 3, 4


def now():
    return datetime.now(timezone.utc)


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


def scan_vault():
    """Return {card_id: {title, path, module}} for every note tagged #review."""
    cards = {}
    if not VAULT.exists():
        return cards
    for md in VAULT.rglob("*.md"):
        if any(part.startswith(".") for part in md.parts):
            continue
        try:
            text = md.read_text(errors="ignore")
        except OSError:
            continue
        if not re.search(r"(^|\s)#review\b", text) and '"review"' not in text.split("---")[0]:
            continue
        rel = str(md.relative_to(VAULT))
        module = md.parts[len(VAULT.parts)] if len(md.parts) > len(VAULT.parts) + 1 else "vault"
        cards[rel] = {"title": md.stem, "path": rel, "module": module.lower()}
    return cards


def refresh():
    state = load_state()
    vault_cards = scan_vault()
    known = state["cards"]

    for cid, meta in vault_cards.items():
        if cid not in known:
            known[cid] = {
                "title": meta["title"],
                "module": meta["module"],
                "added": now().isoformat(),
                "due": now().isoformat(),
                "stability": None,
                "difficulty": None,
                "reps": 0,
                "lapses": 0,
                "last_review": None,
            }
        else:
            known[cid]["title"] = meta["title"]
            known[cid]["module"] = meta["module"]
    # drop cards whose notes vanished
    for cid in [c for c in known if c not in vault_cards]:
        del known[cid]

    atomic_write(STATE_FILE, state)
    write_queue(state)
    print(f"vault: {len(vault_cards)} tagged notes, queue written to {OUT_FILE.name}")


def write_queue(state):
    t = now()
    due, upcoming = [], []
    reviews_today = 0
    today = t.astimezone().date().isoformat()
    for cid, c in state["cards"].items():
        entry = {
            "noteId": cid,
            "title": c["title"],
            "path": cid,
            "module": c.get("module", "vault"),
            "due": c["due"],
            "stability": c["stability"],
            "retrievability": None,
        }
        if c["stability"] and c["last_review"]:
            elapsed = (t - datetime.fromisoformat(c["last_review"])).total_seconds() / 86400
            entry["retrievability"] = round(retrievability(c["stability"], elapsed), 3)
        if c.get("last_review", "") and str(c["last_review"]).startswith(today):
            reviews_today += 1
        if datetime.fromisoformat(c["due"]) <= t:
            due.append(entry)
        else:
            upcoming.append(entry)
    due.sort(key=lambda e: e["due"])
    upcoming.sort(key=lambda e: e["due"])

    streak = compute_streak(state)
    out = {
        "updatedAt": t.isoformat(),
        "queue": due,
        "stats": {"reviewsToday": reviews_today, "streak": streak},
        "upcoming": upcoming[:10],
        "source": "fsrs-engine",
    }
    if not state["cards"]:
        out["setupNote"] = (
            "The vault at " + str(VAULT) + " has no notes tagged #review yet. "
            "Tag any lecture note or Arabic vocab list with #review and it enters the rotation."
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


def list_due():
    state = load_state()
    t = now()
    rows = [(cid, c) for cid, c in state["cards"].items() if datetime.fromisoformat(c["due"]) <= t]
    if not rows:
        print("queue clear")
    for cid, c in sorted(rows, key=lambda x: x[1]["due"]):
        print(f"  [{c.get('module','vault'):8}] {c['title']}  ({cid})")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "refresh"
    if cmd == "refresh":
        refresh()
    elif cmd == "review" and len(sys.argv) == 4:
        review(sys.argv[2], int(sys.argv[3]))
    elif cmd == "list":
        list_due()
    else:
        sys.exit(__doc__)
