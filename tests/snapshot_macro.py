#!/usr/bin/env python3
"""Generates / checks the "what actually gets typed into AS400" snapshot for
every fixture order. Pair with snapshot_preview.mjs ("what the preview shows").

    python tests/snapshot_macro.py            # check against committed snapshots
    python tests/snapshot_macro.py --update   # rewrite snapshots

Exit 0 = match, 1 = drift, 2 = harness error.

This imports launch_ibm from the desktop automation project (the same module
desktop_helper_service.py uses). Its GUI deps (pyautogui etc.) are import-guarded
there, so it loads headless. We only call its pure text-building helpers - nothing
touches a screen.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "orders"
SNAPSHOTS = ROOT / "tests" / "snapshots"

# Same path desktop_helper_service.py adds.
DESKTOP_APP_PATH = Path(os.environ.get("DESKTOP_APP_PATH", r"C:\Projects\Order-Tracker"))
sys.path.insert(0, str(DESKTOP_APP_PATH))


def load_launch_ibm():
    try:
        from scripts import launch_ibm  # type: ignore
    except Exception as exc:  # pragma: no cover - environment specific
        print(f"Could not import scripts.launch_ibm from {DESKTOP_APP_PATH}:\n  {exc}", file=sys.stderr)
        print("Set DESKTOP_APP_PATH if the automation project lives elsewhere.", file=sys.stderr)
        raise SystemExit(2)
    return launch_ibm


def read_lf(path: Path) -> str:
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def write_lf(path: Path, text: str) -> None:
    # Force LF regardless of platform so snapshots compare byte-for-byte and match
    # the LF the .mjs generator writes (see .gitattributes).
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def item_type(item: dict) -> str:
    return str(item.get("type") or item.get("item_type") or item.get("product") or "unknown").lower()


def indent_block(text: str, pad: str) -> str:
    lines = str(text or "").split("\n")
    if len(lines) <= 1:
        return text or ""
    return ("\n" + pad).join(lines)


def render_macro_snapshot(L, fixture: dict, name: str) -> str:
    # Prefer the JS automation payload (post mapLineItemForAs400Automation) so the
    # snapshot reflects the real handoff, including as400_comment_authoritative.
    payload_path = SNAPSHOTS / f"{name}.payload.json"
    payload_note = ""
    if payload_path.exists():
        source_items = json.loads(payload_path.read_text(encoding="utf-8"))
    else:
        source_items = fixture.get("line_items", [])
        payload_note = "# NOTE: no payload.json - typed from raw fixture, not the JS-mapped payload"

    items = [it for it in source_items if isinstance(it, dict)]
    needs_prefit = bool(fixture.get("needs_prefit"))
    prefit_meta = fixture.get("prefit_meta")
    vendor_sku = fixture.get("vendor_sku") or ""

    resolved_sku = L._resolve_vendor_sku_for_macro(vendor_sku, items)
    comment_plan = L._build_sequential_comment_plan(items) if items else []

    out: list[str] = []
    out.append(f"# {name}")
    out.append(f"# order {fixture.get('id', '(none)')}  needs_prefit={needs_prefit}  items={len(items)}")
    if payload_note:
        out.append(payload_note)
    out.append(f"resolved_vendor_sku: {resolved_sku or '(blank)'}")
    out.append("")

    # The row plan the web app would send (for the AS400_USE_ROW_PLAN branch).
    rowplan_path = SNAPSHOTS / f"{name}.rowplan.json"
    row_plan = json.loads(rowplan_path.read_text(encoding="utf-8")) if rowplan_path.exists() else []

    for i, item in enumerate(items):
        out.append(f"=== item {i + 1}  ({item_type(item)}) ===")

        is_prefit_preview = (
            needs_prefit
            and L._looks_like_door_item(item)
            and L._item_has_prefit_style(item)
        )
        item_sku = str(item.get("vendor_sku") or item.get("sku") or "").strip() or resolved_sku

        out.append(f"sku:         {item_sku or '(blank)'}")
        out.append(f"description: {L._build_macro_description(item)!s}")
        out.append(f"um:          {L._macro_um_text(item)!s}")
        out.append(f"price:       {L._macro_price_text(item) or '(blank)'}")
        out.append(f"qty:         {L._macro_quantity_text(item)!s}")

        # What the AS400_USE_ROW_PLAN=1 branch in run_vendor_sku_macro_dialog
        # would type instead (see _row_plan_entry + the override block).
        pr = row_plan[i] if i < len(row_plan) and isinstance(row_plan[i], dict) else None
        if pr is not None:
            rp_sku = str(pr.get("sku") or "").strip() or item_sku
            rp_qty = pr.get("qty")
            out.append(
                "  [row-plan] "
                f"sku={rp_sku or '(blank)'} | desc={pr.get('description') or '(blank)'} | "
                f"um={(str(pr.get('um') or '').strip() or 'EA')} | "
                f"price={pr.get('price') or '(blank)'} | "
                f"qty={rp_qty if rp_qty not in (None, '') else L._macro_quantity_text(item)}"
            )

        if is_prefit_preview:
            comment = L._build_prefit_comment_preview(item)
            label = "comment (prefit):"
        else:
            comment = comment_plan[i] if i < len(comment_plan) else ""
            label = "comment:"
        pad = " " * 13
        if comment:
            out.append(f"{label}\n{pad}{indent_block(comment, pad)}")
        else:
            out.append(f"{label} (inherits previous block)")
        out.append("")

    return "\n".join(out).rstrip() + "\n"


def print_diff(expected: str, actual: str) -> None:
    e = expected.split("\n")
    a = actual.split("\n")
    for i in range(max(len(e), len(a))):
        el = e[i] if i < len(e) else None
        al = a[i] if i < len(a) else None
        if el != al:
            if el is not None:
                print(f"  - {el}", file=sys.stderr)
            if al is not None:
                print(f"  + {al}", file=sys.stderr)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", action="store_true")
    args = parser.parse_args()

    if not FIXTURES.exists():
        print(f"No fixtures at {FIXTURES.relative_to(ROOT)} - run: python tests/export_fixtures.py", file=sys.stderr)
        return 2

    fixture_files = sorted(FIXTURES.glob("*.json"))
    if not fixture_files:
        print("No fixture .json files found.", file=sys.stderr)
        return 2

    L = load_launch_ibm()
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)

    drift = 0
    updated = 0
    for fp in fixture_files:
        name = fp.stem
        fixture = json.loads(fp.read_text(encoding="utf-8"))
        try:
            actual = render_macro_snapshot(L, fixture, name)
        except Exception as exc:
            actual = f"# {name}\n<<macro snapshot threw: {exc}>>\n"
        snap = SNAPSHOTS / f"{name}.macro.txt"

        if args.update:
            prev = read_lf(snap) if snap.exists() else None
            if prev != actual:
                updated += 1
            write_lf(snap, actual)
            continue

        if not snap.exists():
            print(f"MISSING  {name}.macro.txt  (run with --update)", file=sys.stderr)
            drift += 1
            continue
        expected = read_lf(snap)
        if expected != actual:
            drift += 1
            print(f"\nDRIFT    {name}.macro.txt", file=sys.stderr)
            print_diff(expected, actual)

    if args.update:
        print(f"macro snapshots: {updated} changed, {len(fixture_files)} total")
        return 0
    if drift:
        print(f"\nmacro snapshots: {drift} drifted / {len(fixture_files)} checked", file=sys.stderr)
        return 1
    print(f"macro snapshots: {len(fixture_files)} OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
