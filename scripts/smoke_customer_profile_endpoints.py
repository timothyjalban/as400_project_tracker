#!/usr/bin/env python3
"""Smoke-test key customer/profile endpoints for the Order Tracker web app.

Default mode is read-only.
Optional --allow-write mode updates default_project_notes for a profile and reverts it.
"""

from __future__ import annotations

import argparse
import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def request_json(
    url: str,
    method: str = "GET",
    body: Optional[Dict[str, Any]] = None,
    opener: Optional[urllib.request.OpenerDirector] = None,
) -> Dict[str, Any]:
    data = None
    headers = {"Accept": "application/json"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url=url, data=data, headers=headers, method=method)
    client = opener or urllib.request.build_opener()
    try:
        with client.open(req, timeout=20) as resp:
            payload = resp.read().decode("utf-8")
            try:
                parsed = json.loads(payload)
            except json.JSONDecodeError as exc:
                raise RuntimeError(f"Invalid JSON response from {url}: {payload[:300]}") from exc
            if not isinstance(parsed, dict):
                raise RuntimeError(f"Unexpected JSON shape from {url}: expected object")
            return parsed
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} for {url}: {payload}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Connection failed for {url}: {exc}") from exc


def expect(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def build_url(base_url: str, path: str, params: Optional[Dict[str, Any]] = None) -> str:
    query = ""
    if params:
        clean = {k: v for k, v in params.items() if v is not None and str(v) != ""}
        query = urllib.parse.urlencode(clean)
    if query:
        return f"{base_url}{path}?{query}"
    return f"{base_url}{path}"


def login(base_url: str, username: str, password: str) -> urllib.request.OpenerDirector:
    print("Authenticating smoke-test client")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    payload = urllib.parse.urlencode({
        "username": username,
        "password": password,
        "next": "/",
    }).encode("utf-8")
    req = urllib.request.Request(
        url=build_url(base_url, "/login"),
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with opener.open(req, timeout=20) as resp:
            resp.read()
            final_url = resp.geturl().rstrip("/")
    except urllib.error.HTTPError as exc:
        payload = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Login failed with HTTP {exc.code}: {payload}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Login connection failed: {exc}") from exc

    login_url = build_url(base_url, "/login").rstrip("/")
    if final_url == login_url or not list(jar):
        raise RuntimeError("Login failed; verify smoke-test credentials")

    return opener


def run_read_only_checks(base_url: str, opener: urllib.request.OpenerDirector) -> Dict[str, Any]:
    print("[1/4] Checking customer search (recent)")
    recent = request_json(build_url(base_url, "/api/customers/search", {
        "include_recent": "true",
        "limit": 5,
    }), opener=opener)
    expect(recent.get("success") is True, "Recent search did not return success=true")
    customers = recent.get("customers") or []
    expect(isinstance(customers, list), "Recent search customers payload is not a list")
    expect(len(customers) > 0, "Recent search returned no customers")

    first = customers[0]
    expect(isinstance(first, dict), "Recent search first customer payload is not an object")
    print(f"  Found {len(customers)} recent customer(s); using '{first.get('customer_name', 'Unknown')}' for follow-up checks")

    print("[2/4] Checking account-only customer search")
    account_only = request_json(build_url(base_url, "/api/customers/search", {
        "include_recent": "true",
        "has_account_only": "true",
        "limit": 10,
    }), opener=opener)
    expect(account_only.get("success") is True, "Account-only search did not return success=true")
    account_customers: List[Dict[str, Any]] = account_only.get("customers") or []
    for idx, customer in enumerate(account_customers):
        acct = str(customer.get("customer_number") or "").strip()
        expect(bool(acct), f"Account-only result #{idx + 1} missing customer_number")

    print("[3/4] Checking contact autofill endpoint")
    contact = request_json(build_url(base_url, "/api/contacts/info", {
        "name": first.get("customer_name", ""),
    }), opener=opener)
    expect(contact.get("success") is True, "Contact info endpoint did not return success=true")
    info = contact.get("info") or {}
    expect(bool(info.get("customer_name")), "Contact info payload missing customer_name")

    print("[4/4] Checking customer profile endpoint")
    profile_params = {
        "customer_profile_id": first.get("customer_profile_id"),
        "customer_number": first.get("customer_number"),
        "name": first.get("customer_name"),
        "phone": first.get("customer_phone"),
    }
    profile_result = request_json(build_url(base_url, "/api/customers/profile", profile_params), opener=opener)
    expect(profile_result.get("success") is True, "Customer profile endpoint did not return success=true")
    profile = profile_result.get("profile") or {}
    orders = profile_result.get("orders") or []
    expect(bool(profile.get("customer_name")), "Profile payload missing customer_name")
    expect(isinstance(orders, list), "Profile orders payload is not a list")

    print("Read-only checks passed.")
    return {
        "sample_customer": first,
        "profile": profile,
    }


def run_write_revert_check(base_url: str, profile_id: int, opener: urllib.request.OpenerDirector) -> None:
    print("[write] Checking profile save + revert")
    current = request_json(build_url(base_url, "/api/customers/profile", {
        "customer_profile_id": profile_id,
    }), opener=opener)
    expect(current.get("success") is True, "Unable to load profile for write test")

    profile = current.get("profile") or {}
    original_notes = profile.get("default_project_notes")

    marker = f"SMOKE_TEST_NOTE_{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}"
    update_payload = {
        "customer_profile_id": profile_id,
        "default_project_notes": marker,
    }
    updated = request_json(build_url(base_url, "/api/customers/profile"), method="PUT", body=update_payload, opener=opener)
    expect(updated.get("success") is True, "Profile update request failed")

    verify = request_json(build_url(base_url, "/api/customers/profile", {
        "customer_profile_id": profile_id,
    }), opener=opener)
    expect(verify.get("success") is True, "Unable to reload updated profile")
    new_notes = (verify.get("profile") or {}).get("default_project_notes")
    expect(new_notes == marker, "Updated default_project_notes value was not persisted")

    revert_payload = {
        "customer_profile_id": profile_id,
        "default_project_notes": original_notes,
    }
    reverted = request_json(build_url(base_url, "/api/customers/profile"), method="PUT", body=revert_payload, opener=opener)
    expect(reverted.get("success") is True, "Profile revert request failed")

    print("Write/revert check passed.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test customer profile endpoints")
    parser.add_argument("--base-url", default="http://127.0.0.1:5000", help="Base URL for running Flask app")
    parser.add_argument("--username", default=os.environ.get("ORDER_TRACKER_ADMIN_USERNAME", "admin"), help="Login username for authenticated smoke checks")
    parser.add_argument("--password", default=os.environ.get("ORDER_TRACKER_ADMIN_PASSWORD", ""), help="Login password for authenticated smoke checks")
    parser.add_argument("--allow-write", action="store_true", help="Enable write/revert test")
    parser.add_argument("--profile-id", type=int, default=None, help="Profile ID used by --allow-write test")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")

    try:
        expect(bool(args.password), "Login password required; pass --password or set ORDER_TRACKER_ADMIN_PASSWORD")
        opener = login(base_url, args.username, args.password)
        results = run_read_only_checks(base_url, opener)

        if args.allow_write:
            profile_id = args.profile_id
            if profile_id is None:
                inferred = (results.get("profile") or {}).get("id")
                expect(bool(inferred), "Could not infer profile id for --allow-write test; pass --profile-id")
                try:
                    profile_id = int(str(inferred))
                except (TypeError, ValueError) as exc:
                    raise RuntimeError(f"Inferred profile id is not a valid integer: {inferred!r}") from exc
            run_write_revert_check(base_url, profile_id, opener)

        print("All smoke checks passed.")
        return 0
    except Exception as exc:
        print(f"Smoke check failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
