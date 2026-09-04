#!/usr/bin/env python3
"""Regression checks for ocr_processor's vendor-quote parsing.

    python tests/ocr_parse_test.py

Exit 0 = all pass, 1 = a check failed.

These run the real parser chain (ocr_processor.process_ocr_text) against saved
raw-OCR fixtures and assert on the fields that have regressed before. Add a new
fixture under tests/fixtures/ocr/ plus a case here whenever an import misbehaves.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from ocr_processor import process_ocr_text  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures" / "ocr"

failures: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print(f"  ok   {name}")
    else:
        print(f"  FAIL {name}  {detail}")
        failures.append(name)


def first_order(fixture: str) -> dict:
    raw = (FIXTURES / fixture).read_text(encoding="utf-8")
    result = process_ocr_text(raw, "PDF file")
    orders = result.get("orders") or []
    assert orders, f"{fixture}: parser returned no orders"
    return orders[0]


def test_orepac_quote_3040362() -> None:
    # OrePac "Details Report" quote whose header wraps the customer phone number
    # across two lines: "Heinz Hormedinger 831-" / "332-0345".
    print("orepac-quote-3040362:")
    order = first_order("orepac-quote-3040362.txt")

    check("customer_name has no phone fragment",
          order["customer_name"] == "Heinz Hormedinger",
          repr(order["customer_name"]))
    check("customer_phone stitched from wrapped lines",
          order["customer_phone"] == "831-332-0345",
          repr(order["customer_phone"]))
    check("project_name has no phone fragment",
          "831" not in order["project_name"],
          repr(order["project_name"]))
    check("quote_number", order.get("quote_number") == "3040362",
          repr(order.get("quote_number")))
    check("vendor", order.get("vendor") == "Orepac", repr(order.get("vendor")))

    import json
    items = json.loads(order["line_items"])
    check("two line items", len(items) == 2, f"got {len(items)}")
    check("item 1 series", items[0].get("series") == "S4816",
          repr(items[0].get("series")))
    check("item 1 price", items[0].get("price") == "1366.32",
          repr(items[0].get("price")))
    check("item 2 series", items[1].get("series") == "CCA260",
          repr(items[1].get("series")))


def test_pella_quote_21268017() -> None:
    # Pella "Proposal - Detailed" quote. Dealer (Builders FirstSource) is the
    # billing customer; the real customer + phone are in "Quote Name".
    print("pella-quote-21268017:")
    order = first_order("pella-quote-21268017.txt")

    check("vendor is Pella", order.get("vendor") == "Pella", repr(order.get("vendor")))
    check("customer from Quote Name, not the dealer",
          order["customer_name"] == "Heinz H", repr(order["customer_name"]))
    check("customer_phone", order["customer_phone"] == "831-332-0345",
          repr(order["customer_phone"]))
    check("project_name", order["project_name"] == "Door and windows",
          repr(order["project_name"]))
    check("quote_number", order.get("quote_number") == "21268017",
          repr(order.get("quote_number")))
    check("quote_date (quoted, not printed)", order.get("quote_date") == "2026-08-31",
          repr(order.get("quote_date")))
    check("quote_total", order.get("quote_total") == 3501.36,
          repr(order.get("quote_total")))
    check("product_type window", order.get("product_type") == "window",
          repr(order.get("product_type")))

    import json
    items = json.loads(order["line_items"])
    check("two line items", len(items) == 2, f"got {len(items)}")
    check("item 1 qty/price", items[0].get("quantity") == 1 and items[0].get("price") == "542.40",
          repr((items[0].get("quantity"), items[0].get("price"))))
    check("item 2 qty/price", items[1].get("quantity") == 4 and items[1].get("price") == "739.74",
          repr((items[1].get("quantity"), items[1].get("price"))))
    check("item 1 rough opening", items[0].get("width") == "36" and items[0].get("height") == "36",
          repr((items[0].get("width"), items[0].get("height"))))
    check("item 2 rough opening", items[1].get("width") == "48" and items[1].get("height") == "54",
          repr((items[1].get("width"), items[1].get("height"))))
    check("item series Impervia", items[0].get("series") == "Impervia",
          repr(items[0].get("series")))
    check("Pella 'Sliding Window' -> style 'Sliding'",
          items[0].get("style") == "Sliding", repr(items[0].get("style")))
    check("both items are windows",
          all(i.get("type") == "window" for i in items))


def test_orepac_door_spec_enrichment() -> None:
    # The OCR-tool path returns only a few fields per door; the labelled Orepac
    # spec block fills in the rest (texture, glass, sill, hinge finish, ...).
    print("orepac door spec enrichment:")
    from ocr_processor import _enrich_orepac_line_item_from_text
    block = (FIXTURES / "orepac-door-spec-block.txt").read_text(encoding="utf-8")
    item = {
        "type": "door", "boring": "Double Bore (Lockset w/ Deadbolt)",
        "jamb_size": "Custom", "thickness": '1 3/4"', "door_location": "Interior",
    }
    _enrich_orepac_line_item_from_text(item, block)

    want = {
        "door_location": "Exterior",          # from "Exterior Doors"
        "material": "Fiberglass",
        "door_texture": "Classic Craft Fir Grain",
        "thickness": '1-3/4"',
        "glass_tint": "Clear",
        "door_glass_shape": "Craftsman Rectangle",
        "door_glass_lite_style": "6 Lite",
        "panel_style": "2 Panel",
        "sticking": "Square",
        "finish_type": "Prefinished",
        "finish_stain_color": "Wildflower Honey",
        "boring": "Double",
        "hinge_finish": "Oil-Rubbed Bronze",
        "sill": "Bronze Tru-D Composite Adjustable",
        "exterior_trim": "No Exterior Trim",
        "jamb_size": 'Custom 6 1/8"',
    }
    for key, expected in want.items():
        check(f"{key} -> {expected!r}", item.get(key) == expected, repr(item.get(key)))


if __name__ == "__main__":
    test_orepac_quote_3040362()
    test_pella_quote_21268017()
    test_orepac_door_spec_enrichment()
    print()
    if failures:
        print(f"{len(failures)} check(s) failed")
        sys.exit(1)
    print("all checks passed")
