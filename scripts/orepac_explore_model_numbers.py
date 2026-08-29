#!/usr/bin/env python3
"""Walk the wood-door wizard up to (but never past) the "Model Number"
question, for each product-series branch, and dump every answer option's
text plus any image/tooltip attached to it -- without selecting a Model
Number or going any further. Nothing gets submitted; each branch stops
right at that question.

Reuses the same question-answering logic real quote-building uses
(_start_new_quote / _click_doors_card / _configure_one_door_item from
orepac_submit_quote.py) rather than a separate hand-rolled sequence --
confirmed 2026-08-13 that a rigid fixed list of expected questions breaks
the moment Or-Pac inserts an extra one (e.g. "20 Min Fire Rated" only
appears for Exterior wood doors), whereas the real wizard-walker already
handles unexpected questions by defaulting to the first option instead of
stalling.

Purpose: we only know the Model Number for "1 Panel"/"2 Panel" doors
because Tim looked them up directly (20/82 interior, 4020 1P/4082
exterior). To offer more panel styles we need to know what the other ~150
catalog numbers actually look like. Or-Pac's answer cards for this
question link to real images on their own CDN
(https://mpimages.orepac.com/answers/...), so once this script captures
those URLs, Claude can download and look at each one directly -- no need
for Tim to eyeball the site himself.

Credentials: OREPAC_USERNAME / OREPAC_PASSWORD env vars (never logged).
Runs headless by default like every other script here -- set
OREPAC_HEADLESS=0 only if you actually want to watch it.
"""

from __future__ import annotations

import json
import os
import sys

from selenium.webdriver.common.by import By

from orepac_common import (
    build_driver,
    human_pause,
    login,
    save_debug_artifacts,
    start_reliable_log,
)
from orepac_submit_quote import (
    _click_doors_card,
    _configure_one_door_item,
    _start_new_quote,
)

DEBUG_DIR = os.path.join(os.path.dirname(__file__), "_orepac_debug")

# (label, line_item) -- line_item is enough for build_question_handler to
# drive the real wizard-answering logic. panel_style is only set here to
# steer Product Series (see PRODUCT_SERIES_BY_EXTERIOR_PANEL_STYLE) --
# it's irrelevant to Model Number itself, which is what we're about to see
# the full list of.
BRANCHES = [
    # finish_type: "Primed" here is what keeps this one on Builders Choice
    # -- resolve_product_series() routes any non-Primed finish to Rogue
    # Valley instead (confirmed 2026-08-13: Builders Choice's Louver door
    # is Primed-only, generalized as a rule to the whole catalog).
    ("Interior_Wood", {"door_location": "Interior", "style": "Prehung", "panel_style": "2 Panel", "finish_type": "Primed"}),
    # Same branch, but a real wood species instead of Primed -- this is
    # what actually reaches Rogue Valley's Interior catalog, which we
    # don't have Model Numbers for yet (PANEL_STYLE_TO_MODEL_NUMBER_INTERIOR_ROGUE_VALLEY
    # is still empty).
    ("Interior_Wood_RogueValley", {"door_location": "Interior", "style": "Prehung", "panel_style": "2 Panel", "finish_type": "Unfinished", "finish_detail": "Fir"}),
    # door_material: "Wood" is required for Exterior -- resolve_product_line()
    # only picks "Stile and Rail Wood Doors" when it's explicitly set;
    # otherwise Exterior defaults to Therma-Tru Fiberglass, which has no
    # "Model Number" question at all (confirmed 2026-08-13: both Exterior
    # branches silently walked the fiberglass path and never reached it).
    ("Exterior_Wood_BuildersChoice", {"door_location": "Exterior", "door_material": "Wood", "style": "Prehung", "panel_style": "2 Panel"}),
    ("Exterior_Wood_RogueValley", {"door_location": "Exterior", "door_material": "Wood", "style": "Prehung", "panel_style": "1 Panel"}),
]


def describe_options(answer_pairs):
    """Text + any image/tooltip info for each answer card, without
    clicking any of them."""
    details = []
    for el, text in answer_pairs:
        info = {"text": text}
        try:
            imgs = el.find_elements(By.TAG_NAME, "img")
            if imgs:
                info["image_src"] = imgs[0].get_attribute("src")
                info["image_alt"] = imgs[0].get_attribute("alt")
        except Exception:
            pass
        for attr in ("title", "tooltipstr", "aria-label"):
            val = el.get_attribute(attr)
            if val:
                info[attr] = val
        details.append(info)
    return details


def explore_branch(driver, label, line_item):
    print(f"\n=== {label} ===")
    # login() only checks that the URL moved off the login page, not that
    # the header nav actually rendered -- confirmed 2026-08-10 that
    # landing somewhere without the nav (e.g. mid-build on the
    # Configurator page) makes "Create Quote" unfindable. Go to Home
    # explicitly first, every branch, regardless of where the previous
    # branch left the browser.
    driver.get("https://marketplace.orepac.com/Home")
    human_pause(1.0, 2.0)

    _start_new_quote(driver)
    _click_doors_card(driver)
    result = _configure_one_door_item(driver, line_item, 1, stop_before_titles={"Model Number"})

    if result is None:
        print("  wizard finished (or stalled) without ever reaching 'Model Number' -- see saved artifacts.")
        save_debug_artifacts(driver, f"model_numbers_{label}_no_model_number_question")
        return

    title, answer_pairs = result
    details = describe_options(answer_pairs)
    os.makedirs(DEBUG_DIR, exist_ok=True)
    save_debug_artifacts(driver, f"model_numbers_{label}")
    out_path = os.path.join(DEBUG_DIR, f"model_numbers_{label}.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"question_title": title, "options": details}, f, indent=2)
    print(f"  saved {len(details)} option(s) to {out_path}")
    has_images = any("image_src" in d for d in details)
    print(f"  any images found in the option cards? {has_images}")


def main() -> int:
    log_path = start_reliable_log("orepac_explore_model_numbers")
    print(f"Writing a reliable copy of this run's output to {log_path}")

    username = os.environ.get("OREPAC_USERNAME")
    password = os.environ.get("OREPAC_PASSWORD")
    if not username or not password:
        print(
            "Set OREPAC_USERNAME and OREPAC_PASSWORD environment variables first.",
            file=sys.stderr,
        )
        return 2

    driver = build_driver()
    try:
        if not login(driver, username, password):
            print("Login failed, stopping.")
            save_debug_artifacts(driver, "explore_model_numbers_login_failed")
            return 1
        print("Login succeeded.")
        human_pause(1.0, 2.0)

        for label, line_item in BRANCHES:
            try:
                explore_branch(driver, label, line_item)
            except Exception as exc:
                # Never let one branch's failure lose the browser state or
                # skip the rest of the branches.
                print(f"  {label} failed: {type(exc).__name__}: {exc}")
                save_debug_artifacts(driver, f"model_numbers_{label}_failed")
    finally:
        driver.quit()

    print("\nDone. Results saved to scripts/_orepac_debug/model_numbers_<branch>.json "
          "(plus a screenshot/HTML dump per branch) -- Claude can take it from here.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
