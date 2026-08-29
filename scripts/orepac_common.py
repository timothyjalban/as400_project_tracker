"""Shared Selenium helpers for automating marketplace.orepac.com.

Used by orepac_login_test.py and orepac_explore_quote.py. Credentials are
always read from OREPAC_USERNAME / OREPAC_PASSWORD environment variables by
the calling script -- never hardcoded or logged here.
"""

from __future__ import annotations

import os
import random
import sys
import time
from pathlib import Path

from selenium import webdriver
from selenium.common.exceptions import (
    NoSuchElementException,
    StaleElementReferenceException,
    TimeoutException,
)
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

LOGIN_URL = "https://marketplace.orepac.com/Account/LogOn"
DEBUG_DIR = Path(__file__).parent / "_orepac_debug"


def start_reliable_log(name: str) -> Path:
    """Duplicate everything printed to stdout into a UTF-8 log file under
    DEBUG_DIR, independent of the caller's shell redirection. Confirmed
    2026-08-10: PowerShell's `*>&1 | Tee-Object` has corrupted/dropped
    output in this project before -- a literal "x" character came through
    as "k%" in one run, and an entire stretch of expected log lines vanished
    with no error in another, right as a script hit a real bug. Call this
    once at the start of main() so there's always a trustworthy copy to
    diagnose from, whatever the terminal did. Returns the log file path."""
    # Confirmed 2026-08-14: a subprocess's real stdout stream (what a caller
    # like api_server.py captures via subprocess.PIPE) inherits Windows'
    # console codepage (cp1252) by default, not UTF-8. A special character
    # printed here (Or-Pac's "•" bullet in a cart description) encoded fine
    # as a single cp1252 byte, but the caller decoded the captured bytes as
    # UTF-8, turning that byte into U+FFFD -- silently corrupting the text
    # all the way into the tracker DB and breaking a regex that depended on
    # the real "•" character. Force UTF-8 here so every script that starts
    # its reliable log this way is safe regardless of caller.
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name)
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    DEBUG_DIR.mkdir(exist_ok=True)
    log_path = DEBUG_DIR / f"{name}.log"
    log_file = open(log_path, "w", encoding="utf-8")
    real_stdout = sys.stdout

    class _Tee:
        def write(self, s):
            real_stdout.write(s)
            log_file.write(s)

        def flush(self):
            real_stdout.flush()
            log_file.flush()

    sys.stdout = _Tee()
    return log_path

# Confirmed against a real page dump on 2026-08-07: the site exposes
# data-testid attributes, which are far more stable than formcontrolname
# or generic type selectors, so those are tried first.
USERNAME_SELECTORS = [
    (By.CSS_SELECTOR, "[data-testid='log-on_username']"),
    (By.CSS_SELECTOR, "input[formcontrolname='userName']"),
    (By.CSS_SELECTOR, "input[type='email']"),
    (By.CSS_SELECTOR, "input[type='text']"),
]
PASSWORD_SELECTORS = [
    (By.CSS_SELECTOR, "[data-testid='log-on_password']"),
    (By.CSS_SELECTOR, "input[formcontrolname='password']"),
    (By.CSS_SELECTOR, "input[type='password']"),
]
# NOTE: the "Sign In" control on this page is an <a data-testid="log-on_submit">
# styled as a button, not a real <button type=submit>. Clicking it fires
# Angular's click handler; pressing Enter in the password field instead
# triggers a *native* form submit with no real action, which reloads the
# route and wipes the form (confirmed: caused a false "invalid" result).
SUBMIT_SELECTORS = [
    (By.CSS_SELECTOR, "[data-testid='log-on_submit']"),
    (By.CSS_SELECTOR, "button[type='submit']"),
    (By.XPATH, "//a[contains(translate(., 'SIGN', 'sign'), 'sign')]"),
]


def find_first(driver, selectors, timeout=15):
    last_exc: Exception | None = None
    for by, value in selectors:
        try:
            el = WebDriverWait(driver, timeout).until(
                EC.presence_of_element_located((by, value))
            )
            return el, (by, value)
        except TimeoutException as exc:
            last_exc = exc
            continue
    raise NoSuchElementException(
        f"None of the candidate selectors matched: {selectors}"
    ) from last_exc


def human_pause(min_s: float = 0.4, max_s: float = 1.2) -> None:
    time.sleep(random.uniform(min_s, max_s))


def human_click(driver, element) -> None:
    """Move the mouse to the element like a real user, then click it."""
    ActionChains(driver).move_to_element(element).pause(random.uniform(0.1, 0.3)).click(element).perform()


def human_type(element, text: str) -> None:
    """Type one character at a time with small randomized delays, instead of
    Selenium's instantaneous send_keys fill, which reads as scripted input."""
    for char in text:
        element.send_keys(char)
        time.sleep(random.uniform(0.05, 0.18))


def select_mat_option(driver, trigger_element, option_text_substring: str, timeout: int = 10) -> str:
    """Open an Angular Material <mat-select> (not a native <select> -- clicking
    the trigger renders <mat-option> elements into a CDK overlay appended to
    the document body) and click the option whose text contains
    option_text_substring (case-insensitive). Returns the matched option's
    full text."""
    human_click(driver, trigger_element)
    human_pause(0.4, 0.8)
    try:
        options = WebDriverWait(driver, timeout).until(
            EC.presence_of_all_elements_located((By.CSS_SELECTOR, "mat-option"))
        )
    except TimeoutException:
        # One retry: the overlay occasionally just doesn't render in time
        # (observed as a flaky timeout unrelated to any real page change).
        human_click(driver, trigger_element)
        human_pause(0.6, 1.2)
        options = WebDriverWait(driver, timeout).until(
            EC.presence_of_all_elements_located((By.CSS_SELECTOR, "mat-option"))
        )
    target = option_text_substring.strip().lower()
    for opt in options:
        if target in opt.text.strip().lower():
            human_click(driver, opt)
            return opt.text.strip()
    raise NoSuchElementException(
        f"No mat-option matched {option_text_substring!r}; saw: {[o.text.strip() for o in options]}"
    )


def read_current_question(driver, timeout: int = 10):
    """Return (question_title, [(answer_element, answer_text), ...]) for the
    currently-expanded configurator-question-answer panel, or None if there
    isn't one (e.g. the wizard has moved to a non-card step like a numeric
    input, or has finished). The configurator renders each answered question
    as a collapsed mat-expansion-panel and keeps the newest one expanded, so
    we take the last .mat-expanded panel rather than the first."""
    try:
        WebDriverWait(driver, timeout).until(
            EC.presence_of_element_located((By.CSS_SELECTOR, "mat-expansion-panel.mat-expanded"))
        )
    except TimeoutException:
        return None

    # The accordion can still be mid-transition into the next question when
    # we start reading it (observed: reading answer .text crashed with
    # StaleElementReferenceException as the panel swapped underneath us) --
    # retry the whole read a few times rather than letting a timing race
    # crash the caller.
    last_exc: Exception | None = None
    for _ in range(3):
        try:
            panels = driver.find_elements(By.CSS_SELECTOR, "mat-expansion-panel.mat-expanded")
            if not panels:
                return None
            panel = panels[-1]
            try:
                title = panel.find_element(By.CSS_SELECTOR, "mat-panel-title").text.strip()
            except NoSuchElementException:
                title = "(untitled)"
            answers = panel.find_elements(By.CSS_SELECTOR, "div.answer")
            answer_pairs = [(a, a.text.strip()) for a in answers]
            return title, answer_pairs
        except StaleElementReferenceException as exc:
            last_exc = exc
            time.sleep(0.4)
    raise last_exc


def save_debug_artifacts(driver, label: str) -> None:
    DEBUG_DIR.mkdir(exist_ok=True)
    screenshot_path = DEBUG_DIR / f"{label}.png"
    html_path = DEBUG_DIR / f"{label}.html"
    driver.save_screenshot(str(screenshot_path))
    html_path.write_text(driver.page_source, encoding="utf-8")
    print(f"  saved {screenshot_path}")
    print(f"  saved {html_path}")


def build_driver(headless: bool | None = None, download_dir: str | None = None) -> webdriver.Chrome:
    if headless is None:
        headless = os.environ.get("OREPAC_HEADLESS", "1") != "0"

    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--window-size=1400,1000")
    options.add_argument("--disable-gpu")
    # Reduce headless/automation fingerprints (navigator.webdriver, the
    # "Chrome is being controlled by automated test software" infobar).
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_experimental_option("excludeSwitches", ["enable-automation"])
    options.add_experimental_option("useAutomationExtension", False)
    options.add_argument(
        "user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
    if download_dir:
        options.add_experimental_option(
            "prefs",
            {
                "download.default_directory": download_dir,
                "download.prompt_for_download": False,
                "download.directory_upgrade": True,
                "safebrowsing.enabled": True,
                # Headless Chrome can otherwise open PDFs in its built-in
                # viewer instead of downloading them.
                "plugins.always_open_pdf_externally": True,
            },
        )

    driver = webdriver.Chrome(options=options)
    driver.execute_cdp_cmd(
        "Page.addScriptToEvaluateOnNewDocument",
        {"source": "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"},
    )
    if download_dir:
        # Headless Chrome blocks downloads by default unless explicitly
        # allowed via CDP, even with the prefs set above.
        driver.execute_cdp_cmd(
            "Page.setDownloadBehavior",
            {"behavior": "allow", "downloadPath": download_dir},
        )
    return driver


def login(driver, username: str, password: str) -> bool:
    """Log in at LOGIN_URL using human-paced interaction. Returns True on
    apparent success (navigated away from the login route)."""
    print(f"Loading {LOGIN_URL} ...")
    driver.get(LOGIN_URL)

    print("Locating username field ...")
    user_el, user_sel = find_first(driver, USERNAME_SELECTORS)
    print(f"  found via {user_sel}")

    print("Locating password field ...")
    pass_el, pass_sel = find_first(driver, PASSWORD_SELECTORS)
    print(f"  found via {pass_sel}")

    human_pause(0.8, 2.0)

    human_click(driver, user_el)
    user_el.clear()
    human_type(user_el, username)

    human_pause(0.3, 0.9)

    human_click(driver, pass_el)
    pass_el.clear()
    human_type(pass_el, password)

    human_pause(1.0, 2.0)

    print("Locating submit control ...")
    try:
        submit_el, submit_sel = find_first(driver, SUBMIT_SELECTORS, timeout=5)
        print(f"  found via {submit_sel}, clicking")
        human_click(driver, submit_el)
    except NoSuchElementException:
        print("  no submit control found, pressing Enter in password field as a last resort")
        from selenium.webdriver.common.keys import Keys

        pass_el.send_keys(Keys.RETURN)

    time.sleep(3)

    current_url = driver.current_url
    print(f"Post-login URL: {current_url}")
    logged_in = current_url.rstrip("/") != LOGIN_URL.rstrip("/") and "LogOn" not in current_url

    try:
        error_el = driver.find_element(By.CSS_SELECTOR, ".errortext")
        if error_el.text.strip():
            print(f"On-page error text: {error_el.text.strip()}")
    except NoSuchElementException:
        pass

    return logged_in
