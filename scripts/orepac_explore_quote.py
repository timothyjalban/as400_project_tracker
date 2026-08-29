#!/usr/bin/env python3
"""Log in and walk into the "Create Quote" flow on marketplace.orepac.com,
dumping a screenshot + HTML at each step to scripts/_orepac_debug/.

Purpose: figure out what product categories, fields, and dropdown options the
site expects when building a door quote, so we can map them against what the
Flutter customer app already collects (customer_app/flutter_files/lib/models
/line_item.dart) before writing any real submission logic. Does NOT submit
a quote -- read-only exploration, stops after reaching the door builder (or
as far as it can get) and dumps what it finds.

Credentials: OREPAC_USERNAME / OREPAC_PASSWORD env vars, same as
orepac_login_test.py. Set OREPAC_HEADLESS=0 to watch it live.

Which wizard branch to walk is controlled by:
    OREPAC_PRODUCT_TYPE   "Exterior" (default) or "Interior"
    OREPAC_CONFIGURATION  "Door Slab Only" (default) or "Single Prehung"
    OREPAC_PRODUCT_LINE   optional -- forces this Product Line answer (e.g.
                          "Stile and Rail Wood Doors") instead of the first
                          option, since Product Line otherwise always
                          defaults to Therma-Tru for Exterior.
Every other question just picks its first available answer, since we only
care about the question labels/options for now, not a valid finished quote.
"""

from __future__ import annotations

import os
import sys

from selenium.common.exceptions import NoSuchElementException, StaleElementReferenceException
from selenium.webdriver.common.by import By

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

# Fixed for this exploration pass -- confirmed by Tim as the values to use.
CUSTOMER_OPTION_TEXT = "3 Dale B CONTRACTOR SQL"
SHIP_TO_OPTION_TEXT = "PRO BUILD - SANTA CRUZ #405 DOOR SHOP"

# If set, type this into the Style Number search box instead of clicking
# "No Style Number", then dump whatever results appear (read-only look at
# the search UI -- doesn't click a result).
STYLE_SEARCH = os.environ.get("OREPAC_STYLE_SEARCH")

# Which branch of the wizard to walk this run. Scope decided 2026-08-07:
# only Door Slab Only + Single Prehung, for both Exterior and Interior, are
# needed for now -- everything else defaults to "pick the first option" just
# to see what's there.
PRODUCT_TYPE = os.environ.get("OREPAC_PRODUCT_TYPE", "Exterior")
CONFIGURATION = os.environ.get("OREPAC_CONFIGURATION", "Door Slab Only")
# If set, force this exact Product Line answer instead of taking the first
# option -- e.g. "Stile and Rail Wood Doors" to explore the Exterior+Wood
# branch, which otherwise defaults to Therma-Tru (the first option).
PRODUCT_LINE = os.environ.get("OREPAC_PRODUCT_LINE")
# If set, force this exact Product Series answer (wood-door branch only) --
# e.g. "Rogue Valley Door Special Order" instead of the default "Builders
# Choice", to see its Model Number list.
PRODUCT_SERIES = os.environ.get("OREPAC_PRODUCT_SERIES")
# Optional -- force these instead of taking the first option. Confirmed
# 2026-08-07: which Model Number/Product Series options exist for a wood
# door depends on the chosen Door Width, so exploring with the wrong
# default width can show a completely different (and wrong) option set.
DOOR_WIDTH = os.environ.get("OREPAC_DOOR_WIDTH")
DOOR_HEIGHT = os.environ.get("OREPAC_DOOR_HEIGHT")


def pick_answer(answer_pairs, target_text):
    """Prefer an exact (case-insensitive) text match over substring, since
    e.g. "Single Prehung" is itself a substring of "Single Prehung Dutch
    Door" and several other configuration options."""
    target = target_text.strip().lower()
    for el, text in answer_pairs:
        if text.strip().lower() == target:
            return el
    for el, text in answer_pairs:
        if target in text.strip().lower():
            return el
    return answer_pairs[0][0]


def main() -> int:
    log_path = start_reliable_log("orepac_explore_quote")
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
            save_debug_artifacts(driver, "explore_login_failed")
            return 1
        print("Login succeeded.")

        human_pause(1.0, 2.0)

        print("Clicking 'Create Quote' ...")
        try:
            create_quote_el, sel = find_first(
                driver, [(By.CSS_SELECTOR, "[data-testid='site-header_createQuote']")]
            )
            print(f"  found via {sel}")
            human_click(driver, create_quote_el)
        except NoSuchElementException:
            print("  could not find 'Create Quote' nav link.")
            save_debug_artifacts(driver, "explore_no_create_quote_link")
            return 1

        human_pause(1.5, 2.5)
        print(f"URL after Create Quote: {driver.current_url}")
        save_debug_artifacts(driver, "explore_create_quote_page")

        print(f"Selecting Customer: {CUSTOMER_OPTION_TEXT!r} ...")
        try:
            customer_trigger, sel = find_first(
                driver, [(By.CSS_SELECTOR, "[data-testid='create_customerField']")]
            )
            print(f"  trigger found via {sel}")
            matched = select_mat_option(driver, customer_trigger, CUSTOMER_OPTION_TEXT)
            print(f"  selected option: {matched!r}")
        except NoSuchElementException as exc:
            print(f"  failed to select Customer: {exc}")
            save_debug_artifacts(driver, "explore_customer_select_failed")
            return 1

        human_pause(0.5, 1.0)

        print(f"Selecting Ship-To Location: {SHIP_TO_OPTION_TEXT!r} ...")
        try:
            location_trigger, sel = find_first(
                driver, [(By.CSS_SELECTOR, "[formcontrolname='location']")]
            )
            print(f"  trigger found via {sel}")
            matched = select_mat_option(driver, location_trigger, SHIP_TO_OPTION_TEXT)
            print(f"  selected option: {matched!r}")
        except NoSuchElementException as exc:
            print(f"  failed to select Ship-To Location: {exc}")
            save_debug_artifacts(driver, "explore_location_select_failed")
            return 1

        human_pause(0.5, 1.0)
        save_debug_artifacts(driver, "explore_customer_and_location_filled")

        # The "Doors" category tile is an image-only link (data-testid,
        # confirmed via a real page dump: <a data-testid="create_doorsCard">
        # wrapping an <img alt="Doors">, no text node) -- text-based XPath
        # won't find it.
        print("Looking for the 'Doors' category tile ...")
        try:
            door_el, sel = find_first(
                driver,
                [(By.CSS_SELECTOR, "[data-testid='create_doorsCard']")],
                timeout=8,
            )
            print(f"  found via {sel}")
            human_click(driver, door_el)
            human_pause(1.5, 2.5)
            print(f"URL after clicking Door: {driver.current_url}")
            save_debug_artifacts(driver, "explore_door_page")
        except NoSuchElementException:
            print("  no 'Door' link found on this page -- stopping here.")
            print("  Review explore_create_quote_page.png/.html to see what's on the page.")
            return 0

        # Walk the question/answer wizard: pick "Exterior Doors" for the
        # first question (we know that's the branch we want), then just the
        # first available answer at every question after that -- this isn't
        # meant to produce a real, valid quote, only to surface every
        # question label + its option set so we can compare against
        # line_item.dart. Stops automatically when a question has no
        # clickable answer cards (e.g. a numeric width/height input instead).
        print("Walking the door configurator wizard ...")
        transcript = []
        for step in range(1, 51):
            question = read_current_question(driver)
            if question is None:
                print(f"  step {step}: no question panel found -- wizard ended or needs manual input.")
                break
            title, answer_pairs = question
            answer_texts = [text for _, text in answer_pairs]
            print(f"  step {step}: question={title!r} options={answer_texts}")

            if not answer_pairs:
                if title == "Style Number":
                    if STYLE_SEARCH:
                        print(f"    'Style Number' step -- searching for {STYLE_SEARCH!r}.")
                        search_el, _ = find_first(
                            driver, [(By.CSS_SELECTOR, "input[type='search']")], timeout=5
                        )
                        human_click(driver, search_el)
                        human_type(search_el, STYLE_SEARCH)
                        human_pause(1.5, 2.5)
                        save_debug_artifacts(driver, f"style_search_{STYLE_SEARCH}")
                        print(
                            f"    saved search results for {STYLE_SEARCH!r} -- "
                            "stopping here so we can look at them before clicking anything."
                        )
                        break
                    # Confirmed via a real page dump: this step is a search
                    # box plus an <a id="styleNumberNoneBtn">No Style
                    # Number</a> button to skip picking a specific style.
                    # Whatever's gated behind it (jamb/hinges/sill/glass/
                    # hardware, we expect) is what we actually need to map.
                    print("    'Style Number' step -- clicking 'No Style Number' to skip it.")
                    try:
                        skip_el, sel = find_first(
                            driver, [(By.CSS_SELECTOR, "#styleNumberNoneBtn")], timeout=5
                        )
                        human_click(driver, skip_el)
                        human_pause(1.2, 2.0)
                        transcript.append((title, [], "(skipped via No Style Number)"))
                        continue
                    except NoSuchElementException:
                        print("    could not find 'No Style Number' button -- stopping.")
                        break
                print("    no clickable answer cards on this question -- stopping (likely a text/number input).")
                break

            if title == "Product Type":
                chosen = pick_answer(answer_pairs, PRODUCT_TYPE)
            elif title == "Door Configuration":
                chosen = pick_answer(answer_pairs, CONFIGURATION)
            elif title == "Product Line" and PRODUCT_LINE:
                chosen = pick_answer(answer_pairs, PRODUCT_LINE)
            elif title == "Door Width" and DOOR_WIDTH:
                chosen = pick_answer(answer_pairs, DOOR_WIDTH)
            elif title == "Door Height" and DOOR_HEIGHT:
                chosen = pick_answer(answer_pairs, DOOR_HEIGHT)
            elif title == "Product Series" and PRODUCT_SERIES:
                chosen = pick_answer(answer_pairs, PRODUCT_SERIES)
            else:
                chosen = answer_pairs[0][0]
            chosen_text = chosen.text.strip()
            transcript.append((title, answer_texts, chosen_text))
            try:
                human_click(driver, chosen)
            except StaleElementReferenceException:
                # The panel can re-render between reading it and clicking
                # (observed: a second "Low-E Glass" panel replaced the first
                # one underneath us). Re-read the now-current panel and
                # click the same-text answer if it's still there.
                print("    stale element on click -- re-reading the panel and retrying once.")
                human_pause(0.5, 1.0)
                requery = read_current_question(driver)
                if requery is None:
                    print("    question panel disappeared on retry -- stopping.")
                    break
                _, requery_pairs = requery
                retry_el = next((el for el, text in requery_pairs if text == chosen_text), None)
                if retry_el is None and requery_pairs:
                    retry_el = requery_pairs[0][0]
                if retry_el is None:
                    print("    no answer available on retry -- stopping.")
                    break
                human_click(driver, retry_el)
            human_pause(1.0, 1.8)

        run_label = f"explore_wizard_end_{PRODUCT_TYPE}_{CONFIGURATION}".replace(" ", "_")
        save_debug_artifacts(driver, run_label)

        print("\nWizard transcript (question -> options -> chosen):")
        for title, options, chosen in transcript:
            print(f"  - {title}: options={options} chosen={chosen!r}")

        print("\nDone. Review the saved screenshots/HTML in scripts/_orepac_debug/.")
        return 0
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
