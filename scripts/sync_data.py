#!/usr/bin/env python3
"""Fetch the latest Marche applications from Google Sheets and save CSV + JSON snapshots."""

from __future__ import annotations

import csv
import io
import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SPREADSHEET_ID = "1JsWTeCi9Kfs2rv6PspxkOYvtq4zkLdSy0gS_qwrfjfM"
SHEET_GID = "312516554"
CSV_URL = (
    f"https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/export"
    f"?format=csv&gid={SHEET_GID}"
)

ROOT_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT_DIR / "data"


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    req = urllib.request.Request(
        CSV_URL,
        headers={"User-Agent": "marche-applications-sync/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        raw_bytes = resp.read()

    csv_text = raw_bytes.decode("utf-8")
    (DATA_DIR / "applications.csv").write_text(csv_text, encoding="utf-8")

    parsed = [
        row
        for row in csv.reader(io.StringIO(csv_text))
        if any(cell.strip() for cell in row)
    ]
    if not parsed:
        raise RuntimeError("Fetched CSV is empty.")

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "spreadsheetId": SPREADSHEET_ID,
        "gid": SHEET_GID,
        "count": max(0, len(parsed) - 1),
        "headers": parsed[0],
        "rows": parsed[1:],
    }
    (DATA_DIR / "applications.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Synced {payload['count']} applications to {DATA_DIR}")


if __name__ == "__main__":
    main()
