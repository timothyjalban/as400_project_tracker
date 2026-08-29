#!/usr/bin/env python3
"""Build a real door quote item on marketplace.orepac.com from Flutter-style
LineItem data, using the configurator wizard structure mapped out by
orepac_explore_quote.py.

Stops after configuring Item 1 (and filling Sidemark/Quantity) WITHOUT
clicking any final "submit the quote" action -- we haven't identified or
confirmed what that step is yet, so this is a deliberate safe checkpoint.
Review the saved screenshot before deciding whether/how to finalize.

Credentials: OREPAC_USERNAME / OREPAC_PASSWORD env vars (never logged).
Set OREPAC_HEADLESS=0 to watch it live.

Line item input: pass a JSON file path as the first CLI argument, matching
the shape of LineItem.toJson() from
customer_app/flutter_files/lib/models/line_item.dart, e.g.:
    {
      "product": "Door",
      "quantity": 1,
      "size": "2068",
      "door_location": "Exterior",
      "style": "Prehung",
      "swing": "LHIS",
      "jamb_size": "4-9/16\"",
      "hinge_size": "4\"",
      "hinge_finish": "Satin Nickel",
      "boring": "Single",
      "sill": "Bronze",
      "glass_tint": "Low-E",
      "hardware_option": "Standard",
      "exterior_trim": "Brickmould"
    }
If no file is given, a built-in sample (matching the above) is used so the
script can be smoke-tested standalone.

Customer name/phone for the Sidemark come from OREPAC_CUSTOMER_NAME /
OREPAC_CUSTOMER_PHONE env vars (per Tim: "Side Mark is where the customer
name and phone number will go").
"""

from __future__ import annotations

import json
import os
import re
import sys

from selenium.common.exceptions import (
    NoSuchElementException,
    StaleElementReferenceException,
    TimeoutException,
)
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

from orepac_common import (
    build_driver,
    find_first,
    human_click,
    human_pause,
    human_type,
    login,
    read_current_question,
    save_debug_artifacts,
    select_mat_option,
    start_reliable_log,
)

# Confirmed by Tim as the values to use for this account.
CUSTOMER_OPTION_TEXT = "3 Dale B CONTRACTOR SQL"
SHIP_TO_OPTION_TEXT = "PRO BUILD - SANTA CRUZ #405 DOOR SHOP"

def resolve_product_line(line_item):
    """Determines which OrePac Product Line to pick, and thus the entire
    downstream question set (glass/texture questions for Therma-Tru vs.
    wood-species/panel questions for Stile and Rail). Interior doors are
    always wood in OrePac's catalog -- confirmed by Tim 2026-08-07 -- so
    door_material (Fiberglass/Wood) only applies to Exterior doors."""
    door_type = line_item.get("door_location") or "Exterior"
    if door_type == "Exterior" and line_item.get("door_material") == "Wood":
        return "Stile and Rail Wood Doors"
    if door_type == "Exterior":
        return "Therma-Tru Steel and Fiberglass Doors"
    return "Stile and Rail Wood Doors"

SWING_TO_HANDING = {
    "LHIS": "Left Hand Inswing (1A)",
    "RHIS": "Right Hand Inswing (1B)",
    "LHOS": "Left Hand Outswing (1C)",
    "RHOS": "Right Hand Outswing (1D)",
}

BORE_MAP = {
    "Single": "Single Bore (Lockset Only)",
    "Double": "Double Bore (Lockset w/ Deadbolt)",
    "None": "No Bore",
}

# "Model Number" question -- confirmed per Tim 2026-08-10. Interior: 20 = 1
# Panel, 82 = 2 Panel (both under Builders Choice). Exterior: 2 Panel = 4082
# under Builders Choice; 1 Panel isn't offered under Builders Choice at all
# -- it comes from the Rogue Valley Door Special Order series instead
# (Model "4020 1P"), so Product Series has to switch along with it (see
# resolve_product_series below).
#
# NOTE 2026-08-13: this is Builders Choice's Interior catalog specifically.
# Rogue Valley has its own separate catalog with (probably) different model
# numbers for the same styles -- confirmed by Tim that Builders Choice's
# Louver door is Primed-only, so any non-Primed wood species has to route
# to Rogue Valley instead (see resolve_product_series), and these Builders
# Choice numbers would be wrong once that happens. Rogue Valley's Interior
# numbers aren't explored yet -- see
# PANEL_STYLE_TO_MODEL_NUMBER_INTERIOR_ROGUE_VALLEY below.
PANEL_STYLE_TO_MODEL_NUMBER_INTERIOR_BUILDERS_CHOICE = {
    "1 Panel": "20",
    "2 Panel": "82",
    # Confirmed 2026-08-13 via Claude downloading and visually inspecting
    # every option's real image from Or-Pac's own CDN
    # (mpimages.orepac.com) after walking the wizard to the Model Number
    # question -- see scripts/orepac_explore_model_numbers.py and
    # scripts/_orepac_debug/model_numbers_Interior_Wood.json for the raw
    # capture.
    "3 Panel": "30",
    "4 Panel": "4044",
    "5 Panel": "55",
    "6 Panel": "66",
    "1 Lite": "1501",
    "2 Lite": "1502",
    "3 Lite": "1503",
    "5 Lite": "1505",
    "10 Lite": "1510",
    "15 Lite": "1515",
    "Louver": "730",
    "Plank": "7026",
}
# Confirmed 2026-08-14 the same way as Builders Choice -- Claude walked
# the wizard to Rogue Valley's own Interior Model Number question (164
# options total) and visually classified each one from its real catalog
# image. Most of the core styles turned out to share the EXACT same model
# number as Builders Choice (20, 82, 30, 55, 66, 1501, 1505, 1510, 1515,
# 730, 7026 all matched identically); only 4 Panel, 2 Lite, and 3 Lite
# needed a different number here.
PANEL_STYLE_TO_MODEL_NUMBER_INTERIOR_ROGUE_VALLEY = {
    "1 Panel": "20",
    "2 Panel": "82",
    "3 Panel": "30",
    "4 Panel": "44",
    "5 Panel": "55",
    "6 Panel": "66",
    "1 Lite": "1501",
    "2 Lite": "22-G",
    "3 Lite": "30-G",
    "5 Lite": "1505",
    "10 Lite": "1510",
    "15 Lite": "1515",
    "Louver": "730",
    "Plank": "7026",
}
# Confirmed 2026-08-14 the same way as Interior -- Claude visually
# classified both Exterior wood catalogs (39 Builders Choice options, 349
# Rogue Valley options). Builders Choice's Exterior catalog is noticeably
# thinner than Rogue Valley's and doesn't offer every style at all (no 1
# Panel, 3 Panel, 6 Panel, 2 Lite, 10 Lite, or Louver found anywhere in
# its 39 options) -- see PRODUCT_SERIES_BY_EXTERIOR_PANEL_STYLE, which
# routes those styles to Rogue Valley unconditionally, not just for
# non-Primed finishes. 15 Lite not confirmed in either Exterior catalog,
# left unmapped in both (falls back to Or-Pac's first option rather than
# a guess) -- Interior's 15 Lite mapping doesn't carry over here.
PANEL_STYLE_TO_MODEL_NUMBER_EXTERIOR_BUILDERS_CHOICE = {
    "2 Panel": "4082",
    "4 Panel": "4044",
    "5 Panel": "4055",
    "1 Lite": "4501",
    "3 Lite": "4032-G",
    "5 Lite": "4026-G",
    "Plank": "7026",
}
PANEL_STYLE_TO_MODEL_NUMBER_EXTERIOR_ROGUE_VALLEY = {
    "1 Panel": "4020 1P",
    "2 Panel": "4082",
    "3 Panel": "4030",
    "4 Panel": "4044",
    "5 Panel": "4055",
    "6 Panel": "4130 RM",
    "1 Lite": "4501",
    "2 Lite": "4502",
    "3 Lite": "4032-G",
    "5 Lite": "4026-G",
    "10 Lite": "4510",
    "Louver": "4077",
    "Plank": "7026",
}
# Which Product Series an Exterior panel style needs when the finish is
# Primed (non-Primed always goes to Rogue Valley regardless -- see
# resolve_product_series). Styles missing from
# PANEL_STYLE_TO_MODEL_NUMBER_EXTERIOR_BUILDERS_CHOICE above have to route
# to Rogue Valley even when Primed, since Builders Choice doesn't offer
# them in any finish.
PRODUCT_SERIES_BY_EXTERIOR_PANEL_STYLE = {
    "1 Panel": "Rogue Valley Door Special Order",
    "2 Panel": "Builders Choice",
    "3 Panel": "Rogue Valley Door Special Order",
    "4 Panel": "Builders Choice",
    "5 Panel": "Builders Choice",
    "6 Panel": "Rogue Valley Door Special Order",
    "1 Lite": "Builders Choice",
    "2 Lite": "Rogue Valley Door Special Order",
    "3 Lite": "Builders Choice",
    "5 Lite": "Builders Choice",
    "10 Lite": "Rogue Valley Door Special Order",
    "Louver": "Rogue Valley Door Special Order",
    "Plank": "Builders Choice",
}


def resolve_product_series(line_item):
    """Which Or-Pac Product Series ("Builders Choice" vs "Rogue Valley
    Door Special Order") to use for a wood door -- Interior or Exterior.

    Confirmed by Tim 2026-08-13: Builders Choice's catalog is Primed-only
    (at least for Louver; treated here as a general rule across the whole
    catalog rather than verified door-by-door) -- any door where the
    customer picked a real wood species (finish_type == "Unfinished" with
    a species, not "Primed") has to go to Rogue Valley instead, regardless
    of Interior/Exterior or which panel style. This is checked before the
    Exterior panel-style rule below, which only matters for Primed doors."""
    door_type = line_item.get("door_location") or "Exterior"
    finish_type = (line_item.get("finish_type") or "").strip().lower()
    if finish_type and finish_type != "primed":
        return "Rogue Valley Door Special Order"
    if door_type == "Exterior":
        return PRODUCT_SERIES_BY_EXTERIOR_PANEL_STYLE.get(
            line_item.get("panel_style"), "Builders Choice"
        )
    return "Builders Choice"

# Style Number is an exact-SKU shortcut into the Therma-Tru catalog that
# bypasses Door Category/Material/Door Texture entirely (confirmed
# 2026-08-14: searching an exact number like "2000" jumps straight to that
# one item, so those three questions never even appear). Only ever set
# from an explicit override now -- until 2026-08-14 this defaulted to
# "2000" (Smooth-Star) for every Therma-Tru door regardless of what
# material/texture the customer actually picked, silently discarding that
# choice. Leaving it unset instead makes the wizard take the "No Style
# Number" path, which walks Door Category/Material/Door Texture for real --
# see build_question_handler below.
def resolve_style_number(line_item):
    return line_item.get("style_number") or None

SAMPLE_LINE_ITEM = {
    "product": "Door",
    "quantity": 1,
    "size": "3068",
    "door_location": "Exterior",
    "style": "Prehung",
    "swing": "LHIS",
    "jamb_size": '4-9/16"',
    "boring": "Single",
    "sill": "Bronze",
    "glass_tint": "Low-E",
}


def parse_size_code(size):
    """"2068" -> ("2/0", "6/8"). Returns (None, None) if it doesn't parse."""
    if not size or len(size) < 4:
        return None, None
    width_code, height_code = size[:2], size[2:4]
    if not (width_code.isdigit() and height_code.isdigit()):
        return None, None
    return f"{width_code[0]}/{width_code[1]}", f"{height_code[0]}/{height_code[1]}"


DOOR_STYLE_TO_CONFIGURATION = {
    "Slab": "Door Slab Only",
    "Prehung": "Single Prehung",
}


def build_question_handler(line_item):
    door_type = line_item.get("door_location") or "Exterior"
    configuration = DOOR_STYLE_TO_CONFIGURATION.get(
        line_item.get("style"), "Door Slab Only"
    )
    product_line = resolve_product_line(line_item)
    slab_material_target = line_item.get("door_slab_material")
    swing_target = SWING_TO_HANDING.get((line_item.get("swing") or "").upper())
    width_code, height_code = parse_size_code(line_item.get("size"))
    boring_target = BORE_MAP.get(line_item.get("boring"))
    product_series_target = resolve_product_series(line_item)
    if door_type == "Interior":
        # Builders Choice and Rogue Valley are separate catalogs -- the
        # same panel_style needs a different Model Number depending on
        # which series resolve_product_series actually picked.
        panel_map = (
            PANEL_STYLE_TO_MODEL_NUMBER_INTERIOR_ROGUE_VALLEY
            if product_series_target == "Rogue Valley Door Special Order"
            else PANEL_STYLE_TO_MODEL_NUMBER_INTERIOR_BUILDERS_CHOICE
        )
    else:
        panel_map = (
            PANEL_STYLE_TO_MODEL_NUMBER_EXTERIOR_ROGUE_VALLEY
            if product_series_target == "Rogue Valley Door Special Order"
            else PANEL_STYLE_TO_MODEL_NUMBER_EXTERIOR_BUILDERS_CHOICE
        )
    model_number_target = panel_map.get(line_item.get("panel_style"))
    hardware_present = bool(line_item.get("hardware_option"))
    glass_value = (line_item.get("glass_tint") or "").lower()
    sill_value = (line_item.get("sill") or "").lower()
    trim_value = (line_item.get("exterior_trim") or "").lower()
    hinge_finish_value = (line_item.get("hinge_finish") or "").lower()
    jamb_value = (line_item.get("jamb_size") or "").lower().replace("-", " ").strip()
    color_value = (line_item.get("finish_type") or "").strip().lower()
    finish_detail = line_item.get("finish_detail")
    door_texture_target = line_item.get("door_texture")
    glass_shape_target = line_item.get("door_glass_shape")
    # Curated Flutter-side text (e.g. "10 Lite", "6 Lite Colonial") --
    # matched against whatever OrePac's real "Glass Name" options are for
    # the chosen shape, since that list varies per shape rather than being
    # one fixed catalog. "(no grid)" is UI-only framing, stripped before
    # matching.
    glass_lite_style_target = (line_item.get("door_glass_lite_style") or "").split(" (")[0].strip()
    frame_profile_target = line_item.get("door_frame_profile")

    def handler(title: str, options: list[str]):
        """Return the desired answer text for this question, or None to
        just take the first option (the agreed default for anything we
        don't have a real mapping for yet)."""
        if title == "Product Type":
            return f"{door_type} Doors"
        if title == "Product Line":
            return product_line
        if title == "Material":
            # The Therma-Tru branch's own "Fiberglass vs. Steel" slab
            # question -- distinct from the Product Line/door_material
            # choice above (which decides Wood vs. Fiberglass in the
            # first place).
            return slab_material_target if slab_material_target in options else None
        if title == "Door Configuration":
            return configuration
        if title == "Door Handing":
            return swing_target if swing_target in options else None
        if title == "Door Height":
            return height_code if height_code in options else None
        if title == "Door Width":
            if width_code in options:
                return width_code
            # Shop-standard default for a typical/basic door, per Tim
            # 2026-08-07, when no usable size was given.
            return "3/0" if "3/0" in options else None
        if title == "Product Series":
            return product_series_target if product_series_target in options else None
        if title == "Door Bore":
            return boring_target
        if title == "Model Number":
            return model_number_target if model_number_target in options else None
        if title == "Low-E Glass":
            return "Yes" if "low-e" in glass_value or "low e" in glass_value else "No"
        if title == "Door Category":
            # Confirmed 2026-08-14 against the real options (Decorative
            # Glass Doors, Privacy Glass Doors, Clear Glass Doors,
            # Panel/Flush Doors) -- previously unreachable (the old "2000"
            # Style Number shortcut skipped straight past this question),
            # so its old "default to the first option" fallback had never
            # actually been exercised and would've picked Decorative Glass
            # Doors for every plain door.
            if not glass_value:
                return "Panel/Flush Doors" if "Panel/Flush Doors" in options else None
            if "obscure" in glass_value:
                return "Privacy Glass Doors" if "Privacy Glass Doors" in options else None
            return "Clear Glass Doors" if "Clear Glass Doors" in options else None
        if title == "Door Texture":
            # The real grain/finish choice for a Therma-Tru fiberglass or
            # steel door -- confirmed 2026-08-14 against the real 6
            # fiberglass options (Smooth-Star, Classic Craft Fir Grain,
            # Classic Craft Mahogany Grain, Classic Craft Canvas,
            # Fiber-Classic Oak Collection, Fiber-Classic Mahogany
            # Collection) and 2 steel options (Traditions, Profiles).
            if door_texture_target in options:
                return door_texture_target
            return "Smooth-Star" if "Smooth-Star" in options else None
        if title == "Glass Shape":
            # Confirmed 2026-08-14: reachable now that Door Category is,
            # same story -- its untested "first option" default was the
            # ornate "Craftsman Rectangle" shape, which forces a whole
            # different (painted-finish) branch downstream and is how
            # order 438 ended up as an expensive decorative door instead
            # of the plain clear-glass door the customer actually picked.
            # Real choice as of 2026-08-14 (all 29 real shapes, with
            # images, in the app's Lite Shape step) -- "Full Lite
            # Rectangle" is the plain, no-decoration fallback for anything
            # picked before this field existed.
            if glass_shape_target in options:
                return glass_shape_target
            return "Full Lite Rectangle" if "Full Lite Rectangle" in options else None
        if title == "Glass Collection":
            # Confirmed by Tim 2026-08-14 against a real quote (order 439,
            # #3028553): plain "Clear Glass" resolved to Style S140-ADVF,
            # but "Flush-Glazed Clear Glass" is the better standard choice
            # for a basic clear-glass door and resolves to the S2000
            # series instead -- a cheaper, more standard build. Preferring
            # "Flush-Glazed" by substring match (rather than an exact
            # name) since some shapes may phrase it slightly differently.
            flush_match = next((opt for opt in options if "flush" in opt.lower()), None)
            if flush_match:
                return flush_match
            return "Clear Glass" if "Clear Glass" in options else None
        if title == "Glass Name":
            # The real "how many lites / what lite style" choice. OrePac's
            # actual option list is different for every Glass Shape (e.g.
            # "Clear 10 Lite" for Full Lite Rectangle vs. "Craftsman Clear
            # 6 Lite" for Craftsman Rectangle), so this matches the app's
            # curated lite-style text (door_glass_lite_style, e.g. "10
            # Lite", "6 Lite Colonial") against whatever this shape's real
            # options actually are, rather than a fixed answer -- confirmed
            # 2026-08-14 by walking both a Full Lite Rectangle and a
            # Craftsman Rectangle branch and seeing genuinely different
            # option lists. Falls back to the plain single-pane option
            # (never guesses a specific lite count/grid) when there's no
            # target or no match for this particular shape.
            if glass_lite_style_target:
                if glass_lite_style_target in options:
                    return glass_lite_style_target
                match = next(
                    (opt for opt in options if glass_lite_style_target.lower() in opt.lower()),
                    None,
                )
                if match:
                    return match
            # No target, or this shape/collection doesn't offer that lite
            # style/count (e.g. "Craftsman Rectangle" has no "Colonial"
            # options at all). The plain single-pane option never has a
            # digit in its name -- every decorated variant does, since it
            # names a lite count (confirmed 2026-08-14 against "Clear
            # Lite" / "Craftsman Clear Lite" / "Clear Lite Flush-Glazed",
            # none containing a digit, vs. every "N Lite ..." option).
            # Picking the *shortest* option instead (an earlier version of
            # this fix) got this wrong for "Clear Lite Flush-Glazed" --
            # it's longer than several "N Lite" options that are actually
            # decorated, so it picked "Clear 10 Lite" by mistake and that
            # then triggered a whole separate "Grille Type" question this
            # code has no answer for either.
            no_digit_options = [opt for opt in options if not any(ch.isdigit() for ch in opt)]
            if no_digit_options:
                return min(no_digit_options, key=len)
            return min(options, key=len) if options else None
        if title == "Frame Profile":
            if frame_profile_target in options:
                return frame_profile_target
            # The lite frame/grid style choice -- default to the plain
            # frame rather than guessing "Scrolled Lite Frame".
            return "Flat Lite Frame" if "Flat Lite Frame" in options else None
        if title == "Door Prefinished":
            if color_value == "prefinished":
                for opt in options:
                    if "yes" in opt.lower():
                        return opt
            for opt in options:
                if "no" in opt.lower():
                    return opt
            return None
        if title == "Door Finishing" and color_value == "prefinished":
            for opt in options:
                if "stain" in opt.lower():
                    return opt
            return None
        if title in ("Stain Door", "Stain Door Frame") and color_value == "prefinished" and finish_detail:
            for opt in options:
                if opt.strip().lower() == finish_detail.strip().lower():
                    return opt
            return None
        if title == "Wood Species":
            if color_value == "primed":
                for opt in options:
                    if opt.strip().lower() == "primed":
                        return opt
            elif color_value == "unfinished" and finish_detail:
                for opt in options:
                    if opt.strip().lower() == finish_detail.strip().lower():
                        return opt
            return None
        if title == "Lock System Type":
            return "Standard Hardware Sets" if hardware_present else "Lock Prep Only - No Hardware"
        if title == "Jamb Width":
            for opt in options:
                if opt.lower().strip() == jamb_value:
                    return opt
            return None
        if title == "Exterior Trim":
            if "brick" in trim_value:
                return "Brickmould"
            if trim_value in ("", "none", "no trim"):
                return "No Exterior Trim"
            return None
        if title == "Sill":
            if "bronze" in sill_value:
                for opt in options:
                    if "bronze" in opt.lower() and "ada" not in opt.lower():
                        return opt
            if "alumin" in sill_value or "mill" in sill_value:
                for opt in options:
                    if "mill" in opt.lower() and "ada" not in opt.lower():
                        return opt
            return None
        if title == "Sill Cover":
            # Shop-standard default: skip the sill cover unless asked for.
            for opt in options:
                if "no" in opt.lower():
                    return opt
            return None
        if title == "Hinge Finish":
            for needle in ("nickel", "bronze", "brass", "black", "chrome", "stainless"):
                if needle in hinge_finish_value:
                    for opt in options:
                        if needle in opt.lower():
                            return opt
            # Shop-standard default finish when the line item doesn't specify one.
            for opt in options:
                if "black" in opt.lower():
                    return opt
            return None
        if title == "Hinge Type":
            # Shop-standard preference: ball-bearing hinges whenever offered.
            for opt in options:
                if "ball-bearing" in opt.lower() or "ball bearing" in opt.lower():
                    return opt
            return None
        if title == "Door Sticking Option":
            # Shop-standard default per Tim 2026-08-11 -- Square, not
            # Or-Pac's own default of Ovolo, unless the line item ever
            # specifies otherwise (no LineItem field for this yet).
            for opt in options:
                if opt.strip().lower() == "square":
                    return opt
            return None
        return None

    return handler


def _start_new_quote(driver) -> None:
    """Create a new quote and select Customer/Ship-To/quote-level Sidemark.
    Leaves the driver on the page where clicking a product-type card (e.g.
    Doors) starts configuring Item 1."""
    customer_name = os.environ.get("OREPAC_CUSTOMER_NAME", "")
    customer_phone = os.environ.get("OREPAC_CUSTOMER_PHONE", "")
    sidemark = " ".join(p for p in (customer_name, customer_phone) if p).strip()[:30]

    create_quote_el, _ = find_first(
        driver, [(By.CSS_SELECTOR, "[data-testid='site-header_createQuote']")]
    )
    human_click(driver, create_quote_el)
    human_pause(1.5, 2.5)

    customer_trigger, _ = find_first(
        driver, [(By.CSS_SELECTOR, "[data-testid='create_customerField']")]
    )
    select_mat_option(driver, customer_trigger, CUSTOMER_OPTION_TEXT)
    human_pause(0.5, 1.0)

    location_trigger, _ = find_first(
        driver, [(By.CSS_SELECTOR, "[formcontrolname='location']")]
    )
    select_mat_option(driver, location_trigger, SHIP_TO_OPTION_TEXT)
    human_pause(0.5, 1.0)

    # This is the quote-level Sidemark (Customer/Ship-To/Sidemark/Note, on
    # the "Create New Quote" page) -- confirmed by Tim 2026-08-07 as where
    # the customer name/phone belongs, not the per-item Sidemark inside the
    # door configurator.
    if sidemark:
        print(f"Filling quote-level Sidemark: {sidemark!r}")
        quote_sidemark_el, _ = find_first(driver, [(By.CSS_SELECTOR, "#sidemark")], timeout=5)
        quote_sidemark_el.clear()
        human_type(quote_sidemark_el, sidemark)
        quote_sidemark_el.send_keys(Keys.TAB)
        human_pause(0.5, 1.0)


def _click_doors_card(driver) -> None:
    """Click the Doors product-type card. Used to start Item 1 on a fresh
    quote."""
    door_el, _ = find_first(
        driver, [(By.CSS_SELECTOR, "[data-testid='create_doorsCard']")], timeout=8
    )
    human_click(driver, door_el)
    human_pause(1.5, 2.5)
    print(f"URL after clicking Door: {driver.current_url}")


def _click_add_item(driver) -> None:
    """Click the "Add Item" button that appears after an item's wizard is
    configured, to add another item to the current quote -- confirmed by
    Tim 2026-08-11: <input type="button" value="Add Item" class="btn
    btn-primary">. No data-testid/id on it, so matched by its value text."""
    add_item_el, _ = find_first(
        driver,
        [(By.CSS_SELECTOR, "input[type='button'][value='Add Item']")],
        timeout=8,
    )
    human_click(driver, add_item_el)
    human_pause(1.5, 2.5)
    print(f"URL after clicking Add Item: {driver.current_url}")


def _configure_one_door_item(
    driver, line_item: dict, item_number: int, stop_before_titles: set[str] | None = None
):
    """Walk the configurator wizard with mapped answers and fill Quantity/
    Note for whichever item's wizard is currently on screen (the caller is
    responsible for having gotten there -- _click_doors_card for a fresh
    item). Does not click anything beyond that -- no "Go to Cart", no order
    placement.

    If a question's title is in stop_before_titles, stops immediately
    without answering it (or anything after) and returns
    (title, answer_pairs) for the caller to inspect -- used by
    orepac_explore_model_numbers.py to see the full Model Number list
    without ever selecting one. Normal quote-building callers don't pass
    this and get the original behavior (returns None)."""
    handler = build_question_handler(line_item)
    style_number_target = resolve_style_number(line_item)
    stop_before_titles = stop_before_titles or set()

    print(f"Walking the door configurator wizard for item {item_number} with mapped answers ...")
    for step in range(1, 51):
        question = read_current_question(driver)
        if question is None:
            print(f"  step {step}: no question panel -- wizard configuration complete.")
            break
        title, answer_pairs = question
        if title in stop_before_titles:
            print(f"  step {step}: {title!r} -- stopping here as requested, not answering it.")
            return title, answer_pairs
        answer_texts = [text for _, text in answer_pairs]

        if not answer_pairs:
            if title == "Style Number":
                if style_number_target:
                    print(f"  step {step}: 'Style Number' -- searching for {style_number_target!r}.")
                    try:
                        search_el, _ = find_first(
                            driver, [(By.CSS_SELECTOR, "input[type='search']")], timeout=5
                        )
                        human_click(driver, search_el)
                        human_type(search_el, style_number_target)
                        human_pause(1.5, 2.5)
                        result = read_current_question(driver)
                        result_pairs = result[1] if result else []
                        match = next(
                            (el for el, text in result_pairs if text.strip() == style_number_target),
                            None,
                        )
                        # Deliberately NOT falling back to "whatever the
                        # first search result is" -- confirmed 2026-08-12
                        # that this can select a completely unrelated,
                        # far more expensive door (e.g. searching "2000"
                        # for a 2/4-wide door returned no exact match and
                        # the old fallback clicked a $1,977 decorative
                        # glass door instead). An inexact match here is
                        # worse than no match -- skip to "No Style Number"
                        # instead, same as when there's no target at all.
                        if match is not None:
                            print("    found an exact style match, clicking it.")
                            human_click(driver, match)
                            human_pause(1.2, 2.0)
                            continue
                        print(
                            f"    no EXACT search result for {style_number_target!r} "
                            f"(got {[text for _, text in result_pairs]}) -- "
                            "falling back to 'No Style Number' rather than guessing."
                        )
                    except Exception as exc:
                        # Fail loudly and fall back, rather than letting the
                        # wizard silently stall on this step -- confirmed
                        # 2026-08-10: a stall here left Item 1 completely
                        # unconfigured with no visible error.
                        print(
                            f"    Style Number search raised {type(exc).__name__}: {exc} -- "
                            "falling back to 'No Style Number'."
                        )
                        save_debug_artifacts(driver, "style_number_search_failed")
                print(f"  step {step}: 'Style Number' -- clicking 'No Style Number'.")
                try:
                    skip_el, _ = find_first(
                        driver, [(By.CSS_SELECTOR, "#styleNumberNoneBtn")], timeout=5
                    )
                    human_click(driver, skip_el)
                    human_pause(1.2, 2.0)
                    continue
                except Exception as exc:
                    print(
                        f"    could not click 'No Style Number' either "
                        f"({type(exc).__name__}: {exc}) -- stopping."
                    )
                    save_debug_artifacts(driver, "style_number_no_fallback_failed")
                    break
            print(f"  step {step}: question={title!r} has no answer cards -- stopping.")
            break

        desired_text = handler(title, answer_texts)
        if desired_text:
            chosen = next((el for el, text in answer_pairs if text == desired_text), None)
            if chosen is None:
                print(
                    f"  step {step}: {title!r} -- wanted {desired_text!r} but it wasn't "
                    f"offered (options={answer_texts}); using first option instead."
                )
                chosen = answer_pairs[0][0]
        else:
            chosen = answer_pairs[0][0]
        chosen_text = chosen.text.strip()
        print(f"  step {step}: {title!r} -> {chosen_text!r}")

        try:
            human_click(driver, chosen)
        except StaleElementReferenceException:
            human_pause(0.5, 1.0)
            requery = read_current_question(driver)
            if requery is None:
                break
            _, requery_pairs = requery
            retry_el = next((el for el, text in requery_pairs if text == chosen_text), None)
            if retry_el is None and requery_pairs:
                retry_el = requery_pairs[0][0]
            if retry_el is None:
                break
            human_click(driver, retry_el)
        human_pause(1.0, 1.8)

    # Note: NOT filling the per-item Sidemark here -- confirmed by Tim
    # 2026-08-07 that the customer name/phone belongs in the quote-level
    # Sidemark (already filled above, right after Customer/Ship-To), not
    # this one.
    print("Filling Quantity ...")
    try:
        # Blur after any field edit before moving on -- the field's autosave
        # to the server fires on blur/change, not on keystroke. Typing then
        # navigating straight away left the on-screen value correct but
        # never actually saved, so the downloaded report reflected stale
        # server state.
        quantity_el, _ = find_first(driver, [(By.CSS_SELECTOR, "#quantity")], timeout=5)
        quantity_el.clear()
        human_type(quantity_el, str(line_item.get("quantity", 1)))
        quantity_el.send_keys(Keys.TAB)
        human_pause(0.3, 0.6)

        special_conditions = line_item.get("special_conditions")
        if special_conditions:
            note_el, _ = find_first(driver, [(By.CSS_SELECTOR, "#note")], timeout=5)
            note_el.clear()
            human_type(note_el, special_conditions)
            note_el.send_keys(Keys.TAB)
    except NoSuchElementException:
        print("  could not find Quantity/Note fields -- skipping.")

    # Give the autosave network call time to actually complete before the
    # caller navigates away (e.g. to add another item, or to Pending Quotes
    # for the Reports step).
    human_pause(1.5, 2.5)


def configure_door_quote_items(driver, line_items: list[dict]) -> str:
    """Log in already assumed done. Create ONE new quote and configure every
    door in line_items onto it as Item 1, Item 2, etc, sharing the same
    Customer/Ship-To/Sidemark. Returns the shared quote number (e.g.
    "3021549"), or "" if it couldn't be found. Does not click anything
    beyond configuring the last item -- no "Go to Cart", no order placement.

    Item 1 starts via the Doors product-type card; items 2+ start via the
    "Add Item" button that appears once the previous item's wizard is
    configured -- confirmed by Tim 2026-08-11."""
    if not line_items:
        raise ValueError("configure_door_quote_items requires at least one line item")

    _start_new_quote(driver)

    for index, line_item in enumerate(line_items, start=1):
        try:
            if index == 1:
                _click_doors_card(driver)
            else:
                _click_add_item(driver)
        except (NoSuchElementException, TimeoutException) as exc:
            if index == 1:
                raise
            print(
                f"Could not find the Add Item button to add item {index} "
                f"({type(exc).__name__}: {exc}) -- stopping after {index - 1} item(s)."
            )
            save_debug_artifacts(driver, f"multi_item_add_item_{index}_failed")
            break
        _configure_one_door_item(driver, line_item, index)

    quote_number = ""
    match = re.search(r"Quote\s+(\d+)", driver.page_source)
    if match:
        quote_number = match.group(1)
    return quote_number


def configure_door_quote_item(driver, line_item: dict) -> str:
    """Single-item convenience wrapper around configure_door_quote_items."""
    return configure_door_quote_items(driver, [line_item])


def main() -> int:
    log_path = start_reliable_log("orepac_submit_quote")
    print(f"Writing a reliable copy of this run's output to {log_path}")

    username = os.environ.get("OREPAC_USERNAME")
    password = os.environ.get("OREPAC_PASSWORD")
    if not username or not password:
        print(
            "Set OREPAC_USERNAME and OREPAC_PASSWORD environment variables first.",
            file=sys.stderr,
        )
        return 2

    if len(sys.argv) > 1:
        with open(sys.argv[1], "r", encoding="utf-8") as f:
            line_item = json.load(f)
        print(f"Loaded line item from {sys.argv[1]}: {line_item}")
    else:
        line_item = SAMPLE_LINE_ITEM
        print(f"No line item file given -- using built-in sample: {line_item}")

    driver = build_driver()
    try:
        if not login(driver, username, password):
            print("Login failed, stopping.")
            save_debug_artifacts(driver, "submit_login_failed")
            return 1
        print("Login succeeded.")
        human_pause(1.0, 2.0)

        quote_number = configure_door_quote_item(driver, line_item)
        save_debug_artifacts(driver, "submit_item_configured")
        print(f"\nQuote number: {quote_number or '(not found)'}")
        print(
            "Stopped here deliberately -- Item 1 is configured but nothing has been "
            "finalized/submitted. Review submit_item_configured.png before deciding "
            "on a final-submit step."
        )
        return 0
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
