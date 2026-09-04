#!/usr/bin/env python3
"""Optimistic-lock guard on PUT /api/orders/<id>.

    python tests/test_order_save_guard.py

Exit 0 = all pass, 1 = a check failed. Uses a throwaway DB - never touches
orders.db.

Regression cover for the 2026-09-03 incident: a browser form still holding
order A's data saved over order B, silently overwriting customer_name /
project_name / phone / email / line_items with no trace.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

_db_fd, _db_path = tempfile.mkstemp(suffix='.db')
os.close(_db_fd)
os.environ['ORDER_TRACKER_DB_PATH'] = _db_path
os.environ['ORDER_TRACKER_DISABLE_AUTH'] = '1'

import core  # noqa: E402
from app import app  # noqa: E402

failures: list[str] = []


def check(name: str, cond: bool, detail: str = '') -> None:
    if cond:
        print(f'  ok   {name}')
    else:
        print(f'  FAIL {name}  {detail}')
        failures.append(name)


def _mk_order(client, name, project):
    r = client.post('/api/orders', json={
        'customer_name': name, 'project_name': project, 'stage': 'ORDER_DETAILS',
    })
    return r.get_json()['order']


def main() -> None:
    client = app.test_client()

    mary = _mk_order(client, 'Mary Zilge', 'Bathroom')
    bill = _mk_order(client, 'Bill Hanson', 'Flush doors')

    # --- the incident: Bill's form (base_order_id=bill) saving onto Mary ---
    r = client.put(f"/api/orders/{mary['id']}", json={
        'customer_name': 'Bill Hanson',
        'project_name': 'Flush doors',
        'customer_phone': '650-464-2429',
        'customer_email': 'bill@greengate.solutions',
        'base_order_id': bill['id'],
        'base_updated_at': bill['updated_at'],
        '_full_form_save': True,
        'save_source': 'order-modal',
    })
    check('cross-order save is rejected 409', r.status_code == 409, str(r.status_code))
    body = r.get_json()
    check('error_code wrong_order', body.get('error_code') == 'wrong_order', str(body))

    after = client.get(f"/api/orders/{mary['id']}").get_json()['order']
    check('Mary untouched: customer_name', after['customer_name'] == 'Mary Zilge', after['customer_name'])
    check('Mary untouched: project_name', after['project_name'] == 'Bathroom', after['project_name'])
    check('Mary untouched: phone', not (after['customer_phone'] or ''), repr(after['customer_phone']))

    # --- blocked attempt is logged ---
    conn = core.get_db_connection()
    blocked = conn.execute(
        "SELECT field, blocked, base_order_id FROM order_change_log "
        "WHERE order_id = ? AND blocked = 1", (mary['id'],)
    ).fetchall()
    check('blocked save recorded in order_change_log', len(blocked) >= 1, str([dict(x) for x in blocked]))
    check('blocked row keeps the wrong base_order_id',
          any(x['base_order_id'] == bill['id'] for x in blocked), str([dict(x) for x in blocked]))
    conn.close()

    # --- legit same-order edit still works (base_order_id == target) ---
    r = client.put(f"/api/orders/{mary['id']}", json={
        'customer_name': 'Mary Zilge',
        'project_name': 'Master Bathroom',
        'base_order_id': mary['id'],
        'base_updated_at': mary['updated_at'],
        '_full_form_save': True,
        'save_source': 'order-modal',
    })
    check('same-order edit accepted', r.status_code == 200 and r.get_json().get('success'), str(r.status_code))
    after = client.get(f"/api/orders/{mary['id']}").get_json()['order']
    check('same-order edit applied', after['project_name'] == 'Master Bathroom', after['project_name'])

    # --- same-order protected change is audited + snapshotted ---
    conn = core.get_db_connection()
    logged = conn.execute(
        "SELECT field, old_value, new_value FROM order_change_log "
        "WHERE order_id = ? AND blocked = 0", (mary['id'],)
    ).fetchall()
    check('project_name change logged',
          any(x['field'] == 'project_name' and x['new_value'] == 'Master Bathroom' for x in logged),
          str([dict(x) for x in logged]))
    conn.close()

    # --- a save with no base_order_id is still allowed (narrow inline callers) ---
    r = client.put(f"/api/orders/{bill['id']}", json={'eta_date': '2026-10-01'})
    check('narrow save without base_order_id still works',
          r.status_code == 200 and r.get_json().get('success'), str(r.status_code))

    # --- line_items cross-order clobber is also blocked ---
    r = client.put(f"/api/orders/{bill['id']}", json={
        'line_items': json.dumps([{'type': 'door', 'product': 'Door', 'quantity': 9}]),
        'base_order_id': mary['id'],
        'base_updated_at': mary['updated_at'],
        'save_source': 'line-items',
    })
    check('cross-order line_items save rejected 409', r.status_code == 409, str(r.status_code))
    bill_after = client.get(f"/api/orders/{bill['id']}").get_json()['order']
    check('Bill line_items untouched', not (bill_after['line_items'] or ''), repr(bill_after['line_items'])[:80])

    # --- order #444 incident: 'vendor' is rendered on 4 different stage cards
    # (PO Created, Order Placed w/ Vendor, Vendor Ack Received, ETA Confirmed)
    # but only one card exists in the DOM at a time, so a narrow save fired
    # while a *different* stage is open can carry vendor blank. It must never
    # win over an already-saved value (2026-09-04). ---
    kelleher = _mk_order(client, 'Vendor Test', 'Doors')
    r = client.put(f"/api/orders/{kelleher['id']}", json={'vendor': 'Kelleher'})
    check('vendor set via narrow save', r.get_json()['order']['vendor'] == 'Kelleher',
          str(r.get_json()['order']['vendor']))

    # Simulate the Transferred-to-Store done-checkbox save: no vendor key, plus
    # a stray blank vendor the way a narrow payload could still carry one.
    r = client.put(f"/api/orders/{kelleher['id']}", json={
        'transfer_location': 'Felton', 'vendor': '',
    })
    check('blank vendor from a narrow save is ignored',
          r.get_json()['order']['vendor'] == 'Kelleher', str(r.get_json()['order']['vendor']))

    # A real full-form save (Order Details modal/tab) can still clear it on
    # purpose.
    r = client.put(f"/api/orders/{kelleher['id']}", json={
        'customer_name': 'Vendor Test', 'vendor': '', '_full_form_save': True,
    })
    check('full-form save can still clear vendor intentionally',
          not r.get_json()['order']['vendor'], repr(r.get_json()['order']['vendor']))


if __name__ == '__main__':
    main()
    print()
    if failures:
        print(f'{len(failures)} check(s) failed')
        sys.exit(1)
    print('all checks passed')
