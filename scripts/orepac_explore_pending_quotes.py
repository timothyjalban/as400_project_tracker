#!/usr/bin/env python3
"""Log in and look at the "Pending Quotes" list to find how to view/download
a quote as a file (PDF, presumably) -- read-only reconnaissance, doesn't
place an order or touch "Go to Cart".

Credentials: OREPAC_USERNAME / OREPAC_PASSWORD env vars. Set
OREPAC_HEADLESS=0 to watch it live.
"""

from __future__ import annotations

import os
import sys

from selenium.common.exceptions import NoSuchElementException
from selenium.webdriver.common.by import By

from orepac_common import (
    build_driver,
    find_first,
    human_click,
    human_pause,
    login,
    save_debug_artifacts,
)


def main() -> int:
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
            save_debug_artifacts(driver, "pending_login_failed")
            return 1
        print("Login succeeded.")
        human_pause(1.0, 2.0)

        print("Clicking 'Pending Quotes' ...")
        nav_el, _ = find_first(
            driver, [(By.CSS_SELECTOR, "[data-testid='site-header_pendingQuotes']")]
        )
        human_click(driver, nav_el)
        human_pause(1.5, 2.5)
        print(f"URL: {driver.current_url}")
        save_debug_artifacts(driver, "pending_quotes_list")

        print("Done. Review pending_quotes_list.png/.html to see what's there.")
        return 0
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
