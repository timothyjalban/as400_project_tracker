#!/usr/bin/env python3
"""Export a curated spread of real orders from the live DB into test fixtures.

Each fixture is one JSON file under tests/fixtures/orders/ holding the fields the
AS400 preview + macro paths actually read:

    { "id", "customer_name", "vendor_sku", "needs_prefit", "prefit_meta",
      "line_items": [ ... ] }

Run once to seed fixtures, then hand-curate: delete noise, keep a good spread of
doors / windows / hardware / bypass / prefit / multi-item / no-cost orders.
Fixtures are committed; snapshots are generated from them.

Usage:
    python tests/export_fixtures.py                 # default DB path
    ORDER_TRACKER_DB_PATH=... python tests/export_fixtures.py
    python tests/export_fixtures.py --limit 40
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "tests" / "fixtures" / "orders"
DEFAULT_DB = ROOT / "orders.db"

# Fields on the order row (not the line items) that the automation payload uses.
ORDER_FIELDS = ("id", "customer_name", "vendor_sku", "needs_prefit")


def slugify(text: str) -> str:
    text = re.sub(r"[^a-zA-Z0-9]+", "-", str(text or "")).strip("-").lower()
    return text or "order"


def load_rows(db_path: Path):
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT * FROM orders "
        "WHERE line_items IS NOT NULL AND TRIM(line_items) NOT IN ('', '[]') "
        "ORDER BY id DESC"
    ).fetchall()
    conn.close()
    return rows


def item_types(line_items: list) -> set[str]:
    kinds = set()
    for it in line_items:
        if isinstance(it, dict):
            kinds.add(str(it.get("type") or it.get("item_type") or "unknown").lower())
    return kinds


def curate(rows, limit: int) -> list[sqlite3.Row]:
    """Pick a spread: prioritise variety over recency."""
    buckets: dict[str, list] = {
        "prefit": [], "bypass": [], "multi": [], "hardware": [],
        "window": [], "door": [], "other": [],
    }
    for row in rows:
        try:
            items = json.loads(row["line_items"])
        except (ValueError, TypeError):
            continue
        if not isinstance(items, list) or not items:
            continue
        kinds = item_types(items)
        blob = json.dumps(items).lower()

        if row["needs_prefit"] or "prefit_enabled" in blob and '"prefit_enabled": true' in blob:
            buckets["prefit"].append(row)
        elif "bypass" in blob:
            buckets["bypass"].append(row)
        elif len(items) >= 3:
            buckets["multi"].append(row)
        elif "hardware" in kinds:
            buckets["hardware"].append(row)
        elif "window" in kinds:
            buckets["window"].append(row)
        elif "door" in kinds:
            buckets["door"].append(row)
        else:
            buckets["other"].append(row)

    picked: list = []
    # Round-robin across buckets so every category is represented.
    per_bucket = max(2, limit // max(1, len(buckets)))
    for name, bucket in buckets.items():
        picked.extend(bucket[:per_bucket])
    # Top up to the limit with whatever's left, newest first.
    if len(picked) < limit:
        seen = {id(r) for r in picked}
        for row in rows:
            if len(picked) >= limit:
                break
            if id(row) not in seen:
                picked.append(row)
    return picked[:limit]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default=os.environ.get("ORDER_TRACKER_DB_PATH", str(DEFAULT_DB)))
    parser.add_argument("--limit", type=int, default=30)
    parser.add_argument("--all", action="store_true", help="export every order, skip curation")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.exists():
        print(f"DB not found: {db_path}", file=sys.stderr)
        return 1

    rows = load_rows(db_path)
    print(f"{len(rows)} orders with line items in {db_path.name}")

    selected = rows if args.all else curate(rows, args.limit)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    written = 0
    for row in selected:
        try:
            line_items = json.loads(row["line_items"])
        except (ValueError, TypeError):
            continue
        if not isinstance(line_items, list) or not line_items:
            continue

        fixture = {f: row[f] for f in ORDER_FIELDS if f in row.keys()}
        fixture["needs_prefit"] = bool(fixture.get("needs_prefit"))
        fixture["prefit_meta"] = None
        fixture["line_items"] = line_items

        name = f"{row['id']:04d}-{slugify(row['customer_name'])[:32]}.json"
        (OUT_DIR / name).write_text(json.dumps(fixture, indent=2, ensure_ascii=False), encoding="utf-8")
        written += 1

    print(f"wrote {written} fixtures to {OUT_DIR.relative_to(ROOT)}")
    print("Next: curate them by hand, then run `npm run snapshots -- --update`.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
