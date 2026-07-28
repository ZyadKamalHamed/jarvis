#!/usr/bin/env python3
"""Find vault notes that deserve flashcards drafted by the morning run.

A candidate is a study note edited recently (default 36 hours, matching the
old auto-capture window) that has real content and no #flashcards tag yet.
The morning agent reads each candidate and APPENDS a ## Flashcards section
with inline question::answer cards for the Obsidian Spaced Repetition
plugin; it never edits existing prose. This script only finds and reports,
it changes nothing.

Usage:
  python3 bin/flashcard-candidates.py [--hours 36]

Prints a JSON array: [{"path", "lines", "modified"}], newest first.
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

VAULT = Path.home() / "Documents" / "Obsidian Vault"

EXCLUDE_DIRS = {"Flashcards", ".obsidian", ".trash", "_templates", "Daily", "Second Brain"}
DAILY_NOTE = re.compile(r"^\d{4}-\d{2}-\d{2}\.md$")
MIN_CONTENT_LINES = 8


def main():
    hours = 36
    if "--hours" in sys.argv:
        hours = float(sys.argv[sys.argv.index("--hours") + 1])
    cutoff = datetime.now(timezone.utc).timestamp() - hours * 3600

    out = []
    if not VAULT.exists():
        print(json.dumps({"error": f"vault missing at {VAULT}"}))
        return
    for p in VAULT.rglob("*.md"):
        parts = p.relative_to(VAULT).parts
        if any(part in EXCLUDE_DIRS for part in parts[:-1]):
            continue
        if DAILY_NOTE.match(p.name):
            continue
        try:
            st = p.stat()
        except OSError:
            continue
        if st.st_mtime < cutoff:
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        if "#flashcards" in text:
            continue
        content_lines = [l for l in text.splitlines() if l.strip()]
        if len(content_lines) < MIN_CONTENT_LINES:
            continue
        out.append({
            "path": str(p),
            "lines": len(content_lines),
            "modified": datetime.fromtimestamp(st.st_mtime).astimezone().isoformat(timespec="minutes"),
        })
    out.sort(key=lambda e: e["modified"], reverse=True)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
