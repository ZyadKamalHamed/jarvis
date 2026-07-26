#!/usr/bin/env python3
"""Due counts for the SRS trial (started 26 Jul 2026): Anki + Obsidian
Spaced Repetition plugin. Replaces the legacy FSRS queue as the writer of
data/study.json while the trial runs; the HUD keeps its panel but PLAY
sessions are retired (queue stays empty).

Anki counts come from AnkiConnect when Anki is open, otherwise from a
read-only copy of collection.anki2. Obsidian counts come from scanning the
vault for the plugin's <!--SR:...--> scheduling comments; inline cards
without a comment yet are counted as new.

Usage:
  python3 bin/anki-due.py            print JSON summary to stdout
  python3 bin/anki-due.py --write    also write data/study.json

The setupNote written here reaches work mode unshed, so it must never name
decks or topics, only counts.
"""

import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import urllib.request
from datetime import date, datetime, timezone, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / "data" / "study.json"
VAULT = Path.home() / "Documents" / "Obsidian Vault"
ANKI_DIR = Path.home() / "Library" / "Application Support" / "Anki2" / "User 1"
ANKICONNECT = "http://127.0.0.1:8765"

CAREER_DECK_PREFIXES = ("Flashcards::DSA",)

SYD = timezone(timedelta(hours=10))


def anki_request(action, **params):
    payload = json.dumps({"action": action, "version": 6, "params": params}).encode()
    req = urllib.request.Request(ANKICONNECT, data=payload)
    with urllib.request.urlopen(req, timeout=3) as res:
        out = json.load(res)
    if out.get("error"):
        raise RuntimeError(out["error"])
    return out["result"]


def anki_via_connect():
    decks = anki_request("deckNames")
    per_deck = {}
    for d in decks:
        if d == "Default":
            continue
        due = len(anki_request("findCards", query=f'deck:"{d}" is:due -is:suspended'))
        new = len(anki_request("findCards", query=f'deck:"{d}" is:new -is:suspended'))
        if due or new:
            per_deck[d] = {"due": due, "new": new}
    reviewed = anki_request("getNumCardsReviewedToday")
    return per_deck, reviewed, "ankiconnect"


def anki_via_sqlite():
    src = ANKI_DIR / "collection.anki2"
    if not src.exists():
        return {}, 0, "no-collection"
    tmp = Path(tempfile.mkdtemp()) / "collection.anki2"
    shutil.copy2(src, tmp)
    for ext in ("-wal", "-shm"):
        side = Path(str(src) + ext)
        if side.exists():
            shutil.copy2(side, Path(str(tmp) + ext))
    con = sqlite3.connect(str(tmp))
    con.create_collation("unicase", lambda a, b: (a.lower() > b.lower()) - (a.lower() < b.lower()))
    try:
        crt = con.execute("SELECT crt FROM col").fetchone()[0]
        today_days = (datetime.now(SYD).date() - datetime.fromtimestamp(crt, SYD).date()).days
        now_s = int(datetime.now(tz=timezone.utc).timestamp())
        decks = {int(i): n.replace("\x1f", "::") for i, n in con.execute("SELECT id, name FROM decks")}
        per_deck = {}
        rows = con.execute("SELECT did, queue, due FROM cards WHERE queue IN (0, 1, 2, 3)")
        for did, queue, due in rows:
            name = decks.get(did, "?")
            if name == "Default":
                continue
            slot = per_deck.setdefault(name, {"due": 0, "new": 0})
            if queue == 0:
                slot["new"] += 1
            elif queue == 1 and due <= now_s:
                slot["due"] += 1
            elif queue in (2, 3) and due <= today_days:
                slot["due"] += 1
        per_deck = {k: v for k, v in per_deck.items() if v["due"] or v["new"]}
        return per_deck, 0, "sqlite"
    finally:
        con.close()
        shutil.rmtree(tmp.parent, ignore_errors=True)


SR_COMMENT = re.compile(r"<!--SR:([^>]*)-->")
SR_ENTRY = re.compile(r"!(\d{4}-\d{2}-\d{2}),\d+,\d+")
INLINE_CARD = re.compile(r"^[^\n:]+::.+$", re.M)


def obsidian_sr_counts():
    """Count due and new inline cards for the Spaced Repetition plugin.

    Only notes tagged #flashcards are scanned, matching the plugin's default.
    The Flashcards folder is Yanki (Anki) territory and is skipped.
    """
    due = new = 0
    today = date.today().isoformat()
    if not VAULT.exists():
        return {"due": 0, "new": 0, "ok": False}
    for p in VAULT.rglob("*.md"):
        parts = p.relative_to(VAULT).parts
        if parts[0] in {"Flashcards", ".obsidian", ".trash"}:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "#flashcards" not in text:
            continue
        scheduled = 0
        for m in SR_COMMENT.finditer(text):
            for e in SR_ENTRY.finditer(m.group(1)):
                scheduled += 1
                if e.group(1) <= today:
                    due += 1
        cards = len(INLINE_CARD.findall(text))
        if cards > scheduled:
            new += cards - scheduled
    return {"due": due, "new": new, "ok": True}


def main():
    try:
        per_deck, reviewed_today, anki_source = anki_via_connect()
    except Exception:
        try:
            per_deck, reviewed_today, anki_source = anki_via_sqlite()
        except Exception as exc:
            print(f"anki-due: both AnkiConnect and sqlite failed: {exc}", file=sys.stderr)
            per_deck, reviewed_today, anki_source = {}, 0, "unavailable"

    sr = obsidian_sr_counts()
    anki_due = sum(v["due"] for v in per_deck.values())
    anki_new = sum(v["new"] for v in per_deck.values())
    total_due = anki_due + sr["due"]
    career_only = bool(per_deck) and all(
        d.startswith(CAREER_DECK_PREFIXES) for d in per_deck
    ) and sr["due"] == 0

    note = "SRS trial: reviews live in Anki ({} due, {} new) and the Obsidian review plugin ({} due, {} new). Sessions here are paused during the trial.".format(
        anki_due, anki_new, sr["due"], sr["new"]
    )

    now = datetime.now(SYD)
    out = {
        "updatedAt": now.isoformat(),
        "queue": [],
        "stats": {
            "reviewsToday": reviewed_today,
            "streak": 0,
            "dueCount": 0,
            "sessionMin": 0,
            "scheduledAhead": 0,
            "nextIntro": None,
            # careerOnly stays out of this file on purpose: study.json is
            # served in work mode and the key name itself is a banned term.
            # The agent reads it from this script's stdout summary instead.
            "trial": {
                "ankiDue": anki_due,
                "ankiNew": anki_new,
                "srDue": sr["due"],
                "srNew": sr["new"],
                "ankiSource": anki_source,
            },
        },
        "upcoming": [],
        "source": "srs-trial",
        "setupNote": note,
    }

    summary = {
        "totalDue": total_due,
        "anki": {"due": anki_due, "new": anki_new, "source": anki_source, "decks": per_deck},
        "obsidianSR": sr,
        "careerOnly": career_only,
    }
    print(json.dumps(summary, indent=2))

    if "--write" in sys.argv:
        tmp = OUT_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, OUT_FILE)
        print(f"wrote {OUT_FILE}", file=sys.stderr)


if __name__ == "__main__":
    main()
