#!/usr/bin/env python3
"""Log in to the Or-Pac marketplace portal with Selenium and confirm the session works.

This is step 1 of automating quote requests: prove we can authenticate.
It does NOT submit any quote / form data.

Credentials are read from environment variables, never hardcoded or logged:
    OREPAC_USERNAME
    OREPAC_PASSWORD

Usage (PowerShell):
    $env:OREPAC_USERNAME = "your-username"
    $env:OREPAC_PASSWORD = "your-password"
    python scripts/orepac_login_test.py

Set OREPAC_HEADLESS=0 to watch it run in a visible Chrome window.
"""

from __future__ import annotations

import os
import sys

from orepac_common import login, build_driver, save_debug_artifacts


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
        logged_in = login(driver, username, password)
        cookies = driver.get_cookies()
        print(f"Cookies present after login attempt: {len(cookies)}")

        if logged_in:
            print("SUCCESS: navigated away from the login page -- session looks established.")
            save_debug_artifacts(driver, "login_success")
            return 0
        else:
            print("Still on/near the login URL -- login likely failed.")
            save_debug_artifacts(driver, "login_uncertain")
            return 1
    finally:
        driver.quit()


if __name__ == "__main__":
    raise SystemExit(main())
