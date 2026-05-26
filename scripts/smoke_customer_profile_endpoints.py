#!/usr/bin/env python3
"""Smoke-test key customer/profile endpoints for the Order Tracker web app.

Default mode is read-only.
Optional --allow-write mode updates default_project_notes for a profile and reverts it.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any, Dict, List, Optional


def request_json(url: str, method: str = "GET", body: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data = None
    headers = {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url=url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload)
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


def run_read_only_checks(base_url: str) -> Dict[str, Any]:
    print("[1/4] Checking customer search (recent)")
    recent = request_json(build_url(base_url, "/api/customers/search", {
        "include_recent": "true",
        "limit": 5,
    }))
    expect(recent.get("success") is True, "Recent search did not return success=true")
    customers = recent.get("customers") or []
    expect(isinstance(customers, list), "Recent search customers payload is not a list")
    expect(len(customers) > 0, "Recent search returned no customers")

    first = customers[0]
    print(f"  Found {len(customers)} recent customer(s); using '{first.get('customer_name', 'Unknown')}' for follow-up checks")

    print("[2/4] Checking account-only customer search")
    account_only = request_json(build_url(base_url, "/api/customers/search", {
        "include_recent": "true",
        "has_account_only": "true",
        "limit": 10,
    }))
    expect(account_only.get("success") is True, "Account-only search did not return success=true")
    account_customers: List[Dict[str, Any]] = account_only.get("customers") or []
    for idx, customer in enumerate(account_customers):
        acct = str(customer.get("customer_number") or "").strip()
        expect(bool(acct), f"Account-only result #{idx + 1} missing customer_number")

    print("[3/4] Checking contact autofill endpoint")
    contact = request_json(build_url(base_url, "/api/contacts/info", {
        "name": first.get("customer_name", ""),
    }))
    expect(contact.get("success") is True, "Contact info endpoint did not return success=true")
    info = contact.get("info") or {}
    expect(info.get("customer_name"), "Contact info payload missing customer_name")

    print("[4/4] Checking customer profile endpoint")
    profile_params = {
        "customer_profile_id": first.get("customer_profile_id"),
        "customer_number": first.get("customer_number"),
        "name": first.get("customer_name"),
        "phone": first.get("customer_phone"),
    }
    profile_result = request_json(build_url(base_url, "/api/customers/profile", profile_params))
    expect(profile_result.get("success") is True, "Customer profile endpoint did not return success=true")
    profile = profile_result.get("profile") or {}
    orders = profile_result.get("orders") or []
    expect(profile.get("customer_name"), "Profile payload missing customer_name")
    expect(isinstance(orders, list), "Profile orders payload is not a list")

    print("Read-only checks passed.")
    return {
        "sample_customer": first,
        "profile": profile,
    }


def run_write_revert_check(base_url: str, profile_id: int) -> None:
    print("[write] Checking profile save + revert")
    current = request_json(build_url(base_url, "/api/customers/profile", {
        "customer_profile_id": profile_id,
    }))
    expect(current.get("success") is True, "Unable to load profile for write test")

    profile = current.get("profile") or {}
    original_notes = profile.get("default_project_notes")

    marker = f"SMOKE_TEST_NOTE_{datetime.utcnow().strftime('%Y%m%dT%H%M%SZ')}"
    update_payload = {
        "customer_profile_id": profile_id,
        "default_project_notes": marker,
    }
    updated = request_json(build_url(base_url, "/api/customers/profile"), method="PUT", body=update_payload)
    expect(updated.get("success") is True, "Profile update request failed")

    verify = request_json(build_url(base_url, "/api/customers/profile", {
        "customer_profile_id": profile_id,
    }))
    expect(verify.get("success") is True, "Unable to reload updated profile")
    new_notes = (verify.get("profile") or {}).get("default_project_notes")
    expect(new_notes == marker, "Updated default_project_notes value was not persisted")

    revert_payload = {
        "customer_profile_id": profile_id,
        "default_project_notes": original_notes,
    }
    reverted = request_json(build_url(base_url, "/api/customers/profile"), method="PUT", body=revert_payload)
    expect(reverted.get("success") is True, "Profile revert request failed")

    print("Write/revert check passed.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Smoke-test customer profile endpoints")
    parser.add_argument("--base-url", default="http://127.0.0.1:5000", help="Base URL for running Flask app")
    parser.add_argument("--allow-write", action="store_true", help="Enable write/revert test")
    parser.add_argument("--profile-id", type=int, default=None, help="Profile ID used by --allow-write test")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")

    try:
        results = run_read_only_checks(base_url)

        if args.allow_write:
            profile_id = args.profile_id
            if profile_id is None:
                inferred = (results.get("profile") or {}).get("id")
                expect(bool(inferred), "Could not infer profile id for --allow-write test; pass --profile-id")
                profile_id = int(inferred)
            run_write_revert_check(base_url, profile_id)

        print("All smoke checks passed.")
        return 0
    except Exception as exc:
        print(f"Smoke check failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
