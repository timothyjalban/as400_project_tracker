#!/usr/bin/env python3
"""Build a real door quote on marketplace.orepac.com -- every door item in
the order goes on ONE shared quote (Item 1, Item 2, ...) -- download its
"Details" report from the quote's Cart page, and save it into the real
Windows Downloads folder as:

    FirstName_LastName_OrePac_Door_mm-dd-yyyy_quote.<ext>

Windows aren't supported by this automation yet, so any window items in the
order are silently skipped rather than blocking the doors from quoting.
"Go to Cart" here is just navigating to view the quote's cart page
(confirmed by Tim 2026-08-10 as where the right Reports modal lives) -- it
does NOT place or submit an order. Confirmed with Tim 2026-08-07 that this
automation must never place an order, only build and download quotes;
nothing in this script clicks any checkout/place-order/submit action.

Credentials: OREPAC_USERNAME / OREPAC_PASSWORD env vars (never logged).
Set OREPAC_HEADLESS=0 to watch it live.

Input: pass a JSON file path as the first CLI argument. Two shapes accepted:
  - A CustomerOrder (from order_form_screen.dart's debug print): has an
    "items" key. customer_name/phone come from the order itself; every
    door item is built onto the shared quote.
  - A bare LineItem (from add_item_screen.dart's debug print, or hand-
    written): OREPAC_CUSTOMER_NAME / OREPAC_CUSTOMER_PHONE env vars supply
    the name/phone instead.
If no file is given, a built-in sample LineItem is used.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import sys
import time
from datetime import date
from pathlib import Path

from selenium.common.exceptions import NoSuchElementException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from orepac_common import (
    build_driver,
    find_first,
    human_click,
    human_pause,
    login,
    save_debug_artifacts,
    start_reliable_log,
)
from orepac_submit_quote import SAMPLE_LINE_ITEM, configure_door_quote_items

SCRATCH_DOWNLOAD_DIR = Path(__file__).parent / "_orepac_debug" / "downloads"


def real_downloads_folder() -> Path:
    # Windows: honor USERPROFILE so this works regardless of who's logged in.
    home = Path(os.environ.get("USERPROFILE") or Path.home())
    return home / "Downloads"


def wait_for_new_download(before_files: set[str], timeout: int = 60) -> Path:
    """Poll SCRATCH_DOWNLOAD_DIR for a file that wasn't there before and has
    finished downloading (Chrome uses a .crdownload suffix while in
    progress)."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        current = {p.name for p in SCRATCH_DOWNLOAD_DIR.iterdir()}
        new_names = current - before_files
        finished = [n for n in new_names if not n.endswith(".crdownload")]
        if finished:
            return SCRATCH_DOWNLOAD_DIR / finished[0]
        time.sleep(0.5)
    raise TimeoutError(f"No new download appeared in {SCRATCH_DOWNLOAD_DIR} within {timeout}s")


def _sanitize_filename_part(text: str) -> str:
    """Strip characters Windows won't allow in a filename. Confirmed
    2026-08-13: an unsanitized customer name containing "/" and ":" (a
    test name that happened to look like a timestamp, e.g. "tim test
    8/13 11:07") made shutil.move() below fail with no visible error --
    the traceback went to stderr, which start_reliable_log() doesn't
    capture, so the run looked like it silently vanished right after
    "Downloaded: ...". Applies to every dynamic piece that ends up in the
    filename, not just the obviously risky ones."""
    return re.sub(r'[\\/:*?"<>|]', "", text).strip()


def build_target_filename(customer_name: str, ext: str) -> str:
    parts = customer_name.strip().split(None, 1)
    first = _sanitize_filename_part(parts[0]) if parts else "Customer"
    last = _sanitize_filename_part(parts[1]) if len(parts) > 1 else ""
    vendor = "OrePac"
    today = date.today().strftime("%m-%d-%Y")
    # Covers every door item in the quote, so the filename doesn't name a
    # specific one -- "Door" stays generic even for a multi-door quote.
    name_parts = [p for p in (first, last, vendor, "Door", today, "quote") if p]
    return "_".join(name_parts) + ext


def _parse_money(text) -> float | None:
    digits = re.sub(r"[^0-9.]", "", str(text or ""))
    try:
        return float(digits)
    except ValueError:
        return None


def unique_destination(dest: Path) -> Path:
    """Never silently overwrite an existing file -- add a numeric suffix
    instead."""
    if not dest.exists():
        return dest
    stem, suffix = dest.stem, dest.suffix
    n = 2
    while True:
        candidate = dest.with_name(f"{stem}_{n}{suffix}")
        if not candidate.exists():
            return candidate
        n += 1


def main() -> int:
    log_path = start_reliable_log("orepac_download_quote")
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
            data = json.load(f)
        if "items" in data:
            # CustomerOrder-shaped JSON (from order_form_screen.dart's debug
            # print): real customer name/phone + one or more line items.
            # Doors only for now -- windows aren't supported by this
            # automation yet, so any window items are silently skipped
            # rather than blocking the whole order's doors from quoting.
            order_name = data.get("customer_name", "")
            order_phone = data.get("phone", "")
            if order_name:
                os.environ["OREPAC_CUSTOMER_NAME"] = order_name
            if order_phone:
                os.environ["OREPAC_CUSTOMER_PHONE"] = order_phone
            all_items = data.get("items") or []
            skipped = [i for i in all_items if (i.get("product") or "Door") != "Door"]
            line_items = [i for i in all_items if (i.get("product") or "Door") == "Door"]
            if skipped:
                print(f"Skipping {len(skipped)} non-door item(s) -- doors only for now.")
            if not line_items:
                print("Order JSON has no door items -- nothing to quote.", file=sys.stderr)
                return 2
            print(
                f"Loaded order from {sys.argv[1]}: customer={order_name!r} "
                f"phone={order_phone!r}, {len(line_items)} door item(s)"
            )
        else:
            line_items = [data]
            print(f"Loaded line item from {sys.argv[1]}: {data}")
    else:
        line_items = [SAMPLE_LINE_ITEM]
        print(f"No line item file given -- using built-in sample: {SAMPLE_LINE_ITEM}")

    customer_name = os.environ.get("OREPAC_CUSTOMER_NAME", "Customer")

    SCRATCH_DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    before_files = {p.name for p in SCRATCH_DOWNLOAD_DIR.iterdir()}

    driver = build_driver(download_dir=str(SCRATCH_DOWNLOAD_DIR))
    try:
        if not login(driver, username, password):
            print("Login failed, stopping.")
            save_debug_artifacts(driver, "download_login_failed")
            return 1
        print("Login succeeded.")
        human_pause(1.0, 2.0)

        quote_number = configure_door_quote_items(driver, line_items)
        print(f"Quote number: {quote_number or '(not found)'}")
        save_debug_artifacts(driver, "download_item_configured")

        # Navigate to the quote's Cart page first -- confirmed by Tim
        # 2026-08-10 that the Reports modal reached from there is the
        # right one (the Pending Quotes list also has a Reports icon, but
        # it isn't the one we want). This is a page view, not a checkout
        # action -- nothing gets submitted just by loading it.
        print("Navigating to the quote's Cart page via 'Go to Cart' ...")
        # The Configurator page's header doesn't render the main nav
        # (Home/Create Quote/Pending Quotes/Orders Placed) at all while
        # mid-build -- confirmed via a real page dump, no nav markup
        # present. Go to Home first to get the full nav back.
        driver.get("https://marketplace.orepac.com/Home")
        human_pause(1.0, 2.0)
        nav_el, _ = find_first(
            driver, [(By.CSS_SELECTOR, "[data-testid='site-header_pendingQuotes']")]
        )
        human_click(driver, nav_el)
        human_pause(1.5, 2.5)
        save_debug_artifacts(driver, "download_pending_quotes_list")
        try:
            if not quote_number:
                raise NoSuchElementException("no quote number to match a row on")
            cart_el, sel = find_first(
                driver,
                [
                    (
                        By.XPATH,
                        f"//tr[.//*[contains(text(), '{quote_number}')]]"
                        "//*[@tooltipstr='Go to Cart']",
                    )
                ],
                timeout=8,
            )
            print(f"  found via {sel}")
        except NoSuchElementException:
            print(f"  could not find a 'Go to Cart' icon for quote {quote_number!r}.")
            save_debug_artifacts(driver, "download_no_cart_icon")
            return 1

        human_click(driver, cart_el)
        human_pause(1.5, 2.5)
        print(f"URL after Go to Cart: {driver.current_url}")
        save_debug_artifacts(driver, "download_cart_page")

        # Read each item's real, as-built description and price straight off
        # the Cart page -- this reflects what Or-Pac actually configured
        # (which can differ from the request if a default kicked in for an
        # unmapped question), not just an echo of what we asked for. One row
        # per item, in the same order they were added (Item 1, Item 2, ...).
        print("Reading item descriptions and prices from the Cart page ...")
        try:
            WebDriverWait(driver, 8).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "tr.cart-row"))
            )
        except TimeoutException:
            pass
        row_els = driver.find_elements(By.CSS_SELECTOR, "tr.cart-row")
        cart_items = []
        for row_el in row_els:
            try:
                desc = " ".join(
                    row_el.find_element(By.CSS_SELECTOR, "td.cdk-column-description").text.split()
                )
            except NoSuchElementException:
                desc = ""
            try:
                price = " ".join(
                    row_el.find_element(By.CSS_SELECTOR, "td.cdk-column-price").text.split()
                )
            except NoSuchElementException:
                price = ""
            cart_items.append({"price": price, "description": desc})
        if len(cart_items) != len(line_items):
            print(
                f"  warning: found {len(cart_items)} cart row(s) but requested "
                f"{len(line_items)} door item(s) -- see download_cart_page.html/.png."
            )
        for i, entry in enumerate(cart_items, start=1):
            print(f"  item {i} price: {entry['price']!r}")
            print(f"  item {i} description: {entry['description']!r}")

        # Each cart row's own "Price"/"Sub-Total" column is pre-tax --
        # confirmed 2026-08-14 against a real quote (#3027836) where the
        # tracker ended up with $2,026.69 (the row subtotal) instead of the
        # $2,219.22 the customer actually owes once Or-Pac's 9.5% sales tax
        # is included. The page's own summary block (below the item table)
        # has the real tax-inclusive Total, but only as one number for the
        # whole quote -- scale each item's price by the same ratio so a
        # multi-item quote's total still adds back up to that real Total
        # instead of guessing how tax splits across items.
        print("Reading the quote's tax-inclusive Total ...")
        try:
            total_el, sel = find_first(
                driver,
                [(By.XPATH, "//p[starts-with(normalize-space(.), 'Total:')]/strong")],
                timeout=5,
            )
            grand_total = _parse_money(total_el.text)
            print(f"  found via {sel}: {total_el.text.strip()!r}")
        except NoSuchElementException:
            grand_total = None
            print("  could not find the quote's Total -- leaving item prices as pre-tax subtotals.")

        subtotal_sum = sum(
            v for v in (_parse_money(entry["price"]) for entry in cart_items) if v is not None
        )
        if grand_total is not None and subtotal_sum:
            tax_ratio = grand_total / subtotal_sum
            for i, entry in enumerate(cart_items, start=1):
                subtotal_value = _parse_money(entry["price"])
                if subtotal_value is None:
                    continue
                entry["price"] = f"{subtotal_value * tax_ratio:.2f}"
                print(f"  item {i} price with tax applied: {entry['price']!r}")
        elif grand_total is not None:
            print("  item subtotals didn't parse -- leaving item prices as pre-tax subtotals.")

        print("Looking for the 'Reports' link on the Cart page ...")
        try:
            # Confirmed via a real page dump: this one is a plain text link
            # (<a class="btn link"><strong><i .../>Reports</strong></a>),
            # no tooltipstr attribute like the icon-only buttons elsewhere.
            reports_el, sel = find_first(
                driver,
                [(By.XPATH, "//a[.//strong[contains(text(), 'Reports')]]")],
                timeout=8,
            )
            print(f"  found via {sel}")
        except NoSuchElementException:
            print("  could not find a Reports icon on the Cart page.")
            save_debug_artifacts(driver, "download_no_reports_icon")
            return 1

        human_click(driver, reports_el)
        human_pause(1.0, 2.0)
        save_debug_artifacts(driver, "download_reports_modal")

        print("Looking for the 'Details' report row's Download link ...")
        try:
            download_el = WebDriverWait(driver, 8).until(
                EC.element_to_be_clickable(
                    (
                        By.XPATH,
                        "//tr[.//td[contains(@class,'report-name')]"
                        "[starts-with(normalize-space(text()),'Details')]]"
                        "//a[.//i[contains(@class,'fa-download')]]",
                    )
                )
            )
        except TimeoutException:
            print("  could not find a 'Details...' row's Download link.")
            save_debug_artifacts(driver, "download_no_details_download_link")
            return 1

        human_click(driver, download_el)
        print("Clicked Download -- waiting for the file ...")

        try:
            downloaded = wait_for_new_download(before_files)
        except TimeoutError as exc:
            print(f"  {exc}")
            save_debug_artifacts(driver, "download_timed_out")
            return 1

        print(f"Downloaded: {downloaded}")

        try:
            target_name = build_target_filename(customer_name, downloaded.suffix)
            destination = unique_destination(real_downloads_folder() / target_name)
            shutil.move(str(downloaded), str(destination))
        except Exception as exc:
            # Print (not just raise) so this lands in the reliable log --
            # start_reliable_log() only captures stdout, and an unhandled
            # exception's traceback goes to stderr, which made a real
            # failure here look like the run silently vanished right after
            # the line above (confirmed 2026-08-13).
            print(f"  could not save the downloaded file to the real Downloads folder: "
                  f"{type(exc).__name__}: {exc}")
            save_debug_artifacts(driver, "download_save_failed")
            return 1
        print(f"Saved as: {destination}")
        # Machine-readable result markers, one per line, for a calling
        # process (e.g. the FastAPI backend) to parse reliably instead of
        # scraping the human-readable log text above. One shared quote/PDF
        # covers every item, so RESULT_ITEMS_JSON carries the per-item
        # price/description list in the same order they were added.
        print(f"RESULT_QUOTE_NUMBER: {quote_number}")
        print(f"RESULT_PDF_PATH: {destination}")
        print(f"RESULT_ITEMS_JSON: {json.dumps(cart_items, ensure_ascii=False)}")
        return 0
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
