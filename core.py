"""
Shared database, schema, and domain-helper functions used across app.py
and (eventually) Flask blueprint route modules.

Extracted from app.py as a behavior-neutral move: no logic changes, only
relocation, so blueprint modules can import these helpers without a
circular import back to app.py (which imports and registers blueprints).
"""
from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import tempfile
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import request

import data.config as db_config
from data import config
from data.database import ensure_reminders_schema

try:
    from data.vendors import COMMON_VENDORS
except Exception:
    COMMON_VENDORS = []

logger = logging.getLogger(__name__)


def _is_writable_parent(path: Path) -> bool:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        probe_path = path.parent / '.db_write_probe'
        probe_path.write_text('', encoding='utf-8')
        probe_path.unlink(missing_ok=True)
        return True
    except Exception:
        return False


def _count_orders(path: Path) -> int:
    if not path.exists():
        return -1

    try:
        with sqlite3.connect(path) as conn:
            row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='orders'"
            ).fetchone()
            if not row:
                return -1
            return int(conn.execute("SELECT COUNT(*) FROM orders").fetchone()[0])
    except Exception:
        logger.exception('Failed counting orders in %s', path)
        return -1


def _pick_default_db_path() -> Path:
    fallback = Path(tempfile.gettempdir()) / 'orders.db'
    candidates = [
        Path(db_config.DB_PATH),
        Path(r"C:\Projects\Order-Tracker\orders.db"),
        Path(r"C:\tmp\orders.db"),
        fallback,
    ]

    best_path = None
    best_count = -1
    for candidate in candidates:
        if not _is_writable_parent(candidate):
            continue
        count = _count_orders(candidate)
        if count > best_count:
            best_count = count
            best_path = candidate

    return best_path or fallback


def resolve_db_path(preferred_path):
    """Return a writable DB path, preferring populated local DBs when env override is absent."""
    fallback = Path(tempfile.gettempdir()) / 'orders.db'

    if preferred_path:
        candidate = Path(preferred_path)
    else:
        candidate = _pick_default_db_path()

    if _is_writable_parent(candidate):
        return candidate

    if candidate != fallback:
        print(f"WARNING: DB path {candidate} is not writable; falling back to {fallback}")
    fallback.parent.mkdir(parents=True, exist_ok=True)
    return fallback

# Path to the SQLite database. Override via ORDER_TRACKER_DB_PATH env var for production.
_env_db_path = (os.environ.get('ORDER_TRACKER_DB_PATH') or '').strip()
DB_PATH = resolve_db_path(_env_db_path if _env_db_path else None)
db_config.DB_PATH = DB_PATH
DESKTOP_HELPER_BASE_URL = os.environ.get('DESKTOP_HELPER_BASE_URL', 'http://127.0.0.1:5001/api').rstrip('/')


def call_desktop_helper(endpoint: str, method: str = 'GET', payload: Optional[Dict[str, Any]] = None, timeout: float = 2.0):
    """Call local desktop helper service and return (payload_dict, status_code)."""
    url = f"{DESKTOP_HELPER_BASE_URL}/{endpoint.lstrip('/')}"
    body = None
    headers = {}

    if payload is not None:
        body = json.dumps(payload).encode('utf-8')
        headers['Content-Type'] = 'application/json'

    request_obj = urllib.request.Request(url=url, data=body, headers=headers, method=method)

    try:
        with urllib.request.urlopen(request_obj, timeout=timeout) as response:
            raw = response.read().decode('utf-8')
            data = json.loads(raw) if raw else {}
            return data, response.getcode()
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode('utf-8', errors='replace')
        try:
            data = json.loads(raw) if raw else {}
        except Exception:
            data = {'success': False, 'error': raw or str(exc)}
        return data, exc.code
    except Exception as exc:
        return {
            'success': False,
            'error': f'Desktop helper unavailable: {exc}'
        }, 503

# Stage sequence (same as desktop app)
STAGES = [
    "QUOTE_CREATED",
    "QUOTE_SIGNOFF_RECEIVED",
    "INVOICE_CREATED",
    "COST_SHEET_PREPARED",
    "PACKET_TO_BUYER",
    "PO_CREATED",
    "ORDER_PLACED_WITH_VENDOR",
    "VENDOR_ACK_RECEIVED",
    "ETA_CONFIRMED",
    "SHIP_TICKET_RECEIVED",
    "TRANSFERRED_TO_STORE",
    "CUSTOMER_NOTIFIED_READY",
    "INVOICE_TO_WILL_CALL",
    "PICKED_UP",
    "RETURNED",
    "CLOSED",
]


def compute_stage_priority(stage: Any) -> int:
    """Map stage position to a 0-100 priority scale (higher stage => higher priority)."""
    stage_value = str(stage or '').strip()
    if not stage_value or stage_value not in STAGES:
        return 0

    if len(STAGES) == 1:
        return 100

    index = STAGES.index(stage_value)
    ratio = index / (len(STAGES) - 1)
    return int(round(ratio * 100))


def coerce_optional_int(value: Any):
    """Convert value to int if present, else return None."""
    if value is None:
        return None

    if isinstance(value, str):
        value = value.strip()
        if value == '':
            return None

    try:
        return int(value)
    except (TypeError, ValueError):
        return None

ITEM_STYLE_DEFAULTS = {
    'door': ['Slab', 'Prehung', 'French', 'Patio'],
    'window': ['Single Hung', 'Double Hung', 'Casement', 'Sliding', 'Picture', 'Gable'],
    'hardware': ['Handleset', 'Entry Set', 'Deadbolt', 'Passage', 'Privacy', 'Dummy'],
}

ITEM_VENDOR_DEFAULTS = {
    'door': ['Jeld-Wen', 'Masonite', 'Therma-Tru'],
    'window': ['Milgard', 'Andersen', 'Pella'],
    'hardware': ['Emtek'],
}

VENDOR_SERIES_DEFAULTS = {
    'window': {
        'Milgard': ['C700'],
    },
    'door': {},
    'hardware': {'Emtek': ['Select', 'Classic', 'Modern', 'Brass']}
}

FIN_TYPE_DEFAULTS = [
    '1" Setback',
]

FIN_TYPE_ALIASES = {
    '1': '1" Setback',
    '1 setback': '1" Setback',
}


def normalize_fin_type_name(value: Any) -> str:
    """Normalize fin type text and map legacy aliases to canonical labels."""
    clean = str(value or '').strip()
    if not clean:
        return ''
    return FIN_TYPE_ALIASES.get(clean.lower(), clean)


def get_vendor_catalog() -> List[Dict[str, Any]]:
    """Return normalized vendor catalog with SKU values from desktop project data."""
    catalog = []
    seen = set()

    for vendor in COMMON_VENDORS:
        name = str(vendor.get('name') or '').strip()
        if not name:
            continue

        key = name.lower()
        if key in seen:
            continue
        seen.add(key)

        sku_value = vendor.get('sku')
        try:
            sku_value = int(sku_value) if sku_value is not None else None
        except (TypeError, ValueError):
            sku_value = None

        catalog.append({
            'name': name,
            'sku': sku_value
        })

    catalog.sort(key=lambda item: item['name'].lower())
    return catalog

def get_db_connection():
    """Create a database connection"""
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row  # Return rows as dictionaries
    # Reduce transient lock failures when multiple requests write concurrently.
    conn.execute("PRAGMA busy_timeout = 30000")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    ensure_orders_schema(conn)
    ensure_order_notes_schema(conn)
    ensure_attachments_schema(conn)
    ensure_reminders_schema(conn)
    ensure_customer_profiles_schema(conn)
    ensure_item_style_options_schema(conn)
    ensure_item_vendor_options_schema(conn)
    ensure_vendor_series_options_schema(conn)
    ensure_fin_type_options_schema(conn)
    ensure_window_color_options_schema(conn)
    return conn


def ensure_orders_schema(conn):
    """Ensure the orders table exists and all optional columns used by the web app exist."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            customer_name TEXT,
            customer_phone TEXT,
            customer_email TEXT,
            project_name TEXT,
            quote_number TEXT,
            quote_date TEXT,
            quote_total REAL,
            quote_number_2 TEXT,
            quote_date_2 TEXT,
            quote_total_2 REAL,
            invoice_number TEXT,
            invoice_date TEXT,
            invoice_total REAL,
            po_number TEXT,
            po_numbers TEXT,
            po_date_signed TEXT,
            vendor TEXT,
            product_type TEXT,
            stage TEXT,
            priority_manual INTEGER,
            line_items TEXT,
            additional_quotes TEXT,
            additional_invoices TEXT,
            additional_pos TEXT,
            vendor_ack_number TEXT,
            vendor_ack_total REAL,
            eta_date TEXT,
            transfer_location TEXT,
            transfer_done_at TEXT,
            quote_done_at TEXT,
            signoff_done_at TEXT,
            invoice_done_at TEXT,
            costsheet_done_at TEXT,
            packet_done_at TEXT,
            po_done_at TEXT,
            order_placed_done_at TEXT,
            ack_received_done_at TEXT,
            eta_confirmed_done_at TEXT,
            ship_ticket_done_at TEXT,
            customer_arrival_notified_done_at TEXT,
            will_call_done_at TEXT,
            door_shop_will_call_done_at TEXT,
            picked_up_done_at TEXT,
            closed_done_at TEXT,
            install_quote_done_at TEXT,
            install_approved_done_at TEXT,
            install_street TEXT,
            install_city TEXT,
            install_state TEXT,
            install_zip TEXT,
            delivery_street TEXT,
            delivery_city TEXT,
            delivery_state TEXT,
            delivery_zip TEXT,
            address_street TEXT,
            address_city TEXT,
            address_state TEXT,
            address_zip TEXT,
            customer_number TEXT,
            has_customer_account INTEGER DEFAULT 0,
            customer_profile_id INTEGER,
            default_project_notes TEXT,
            needs_prefit INTEGER DEFAULT 0,
            prefit_customer_brought_door INTEGER DEFAULT 0,
            prefit_width TEXT,
            prefit_height TEXT,
            prefit_thickness TEXT,
            prefit_lites TEXT,
            prefit_vent_top INTEGER DEFAULT 0,
            prefit_vent_bottom INTEGER DEFAULT 0,
            prefit_hinge_top TEXT,
            prefit_hinge_middle TEXT,
            prefit_hinge_bottom TEXT,
            prefit_hinge_width TEXT,
            prefit_hinge_backset TEXT,
            prefit_hinge_radius TEXT,
            prefit_hinge_prep TEXT,
            prefit_bore_type TEXT,
            prefit_bore_single TEXT,
            prefit_bore_top TEXT,
            prefit_bore_bottom TEXT,
            prefit_bore_backset TEXT,
            prefit_bore_diameter TEXT DEFAULT '2 1/8"',
            prefit_swing TEXT,
            prefit_notes TEXT,
            archived INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            is_flagged INTEGER DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_stage ON orders(stage)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_customer_name ON orders(customer_name)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_po_number ON orders(po_number)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_orders_po_numbers ON orders(po_numbers)")

    cursor = conn.execute("PRAGMA table_info(orders)")
    columns = {row[1] for row in cursor.fetchall()}

    if 'po_numbers' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN po_numbers TEXT")
        conn.commit()

    if 'is_pinned' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN is_pinned INTEGER DEFAULT 0")
        conn.commit()

    if 'is_flagged' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN is_flagged INTEGER DEFAULT 0")
        conn.commit()

    # Stage-smart fields used by Transfer To Store UI.
    if 'transfer_location' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN transfer_location TEXT")
        conn.commit()

    if 'transfer_done_at' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN transfer_done_at TEXT")
        conn.commit()

    if 'quote_number_2' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN quote_number_2 TEXT")
        conn.commit()

    if 'quote_date_2' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN quote_date_2 TEXT")
        conn.commit()

    if 'quote_total_2' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN quote_total_2 REAL")
        conn.commit()

    if 'vendor_ack_total' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN vendor_ack_total REAL")
        conn.commit()

    if 'additional_quotes' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN additional_quotes TEXT")
        conn.commit()

    if 'additional_invoices' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN additional_invoices TEXT")
        conn.commit()

    if 'additional_pos' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN additional_pos TEXT")
        conn.commit()

    if 'customer_number' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN customer_number TEXT")
        conn.commit()

    if 'has_customer_account' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN has_customer_account INTEGER DEFAULT 0")
        conn.commit()

    if 'customer_profile_id' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN customer_profile_id INTEGER")
        conn.commit()

    if 'needs_prefit' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN needs_prefit INTEGER DEFAULT 0")
        conn.commit()

    if 'prefit_customer_brought_door' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_customer_brought_door INTEGER DEFAULT 0")
        conn.commit()

    if 'prefit_width' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_width TEXT")
        conn.commit()

    if 'prefit_height' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_height TEXT")
        conn.commit()

    if 'prefit_thickness' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_thickness TEXT")
        conn.commit()

    if 'prefit_lites' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_lites TEXT")
        conn.commit()

    if 'prefit_vent_top' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_vent_top INTEGER DEFAULT 0")
        conn.commit()

    if 'prefit_vent_bottom' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_vent_bottom INTEGER DEFAULT 0")
        conn.commit()

    if 'prefit_hinge_top' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_hinge_top TEXT")
        conn.commit()

    if 'prefit_hinge_middle' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_hinge_middle TEXT")
        conn.commit()

    if 'prefit_hinge_bottom' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_hinge_bottom TEXT")
        conn.commit()

    if 'prefit_hinge_width' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_hinge_width TEXT")
        conn.commit()

    if 'prefit_hinge_backset' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_hinge_backset TEXT")
        conn.commit()

    if 'prefit_hinge_radius' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_hinge_radius TEXT")
        conn.commit()

    if 'prefit_hinge_prep' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_hinge_prep TEXT")
        conn.commit()

    if 'prefit_bore_type' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_bore_type TEXT")
        conn.commit()

    if 'prefit_bore_single' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_bore_single TEXT")
        conn.commit()

    if 'prefit_bore_top' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_bore_top TEXT")
        conn.commit()

    if 'prefit_bore_bottom' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_bore_bottom TEXT")
        conn.commit()

    if 'prefit_bore_backset' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_bore_backset TEXT")
        conn.commit()

    if 'prefit_bore_diameter' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_bore_diameter TEXT DEFAULT '2 1/8\"'")
        conn.commit()

    if 'prefit_swing' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_swing TEXT")
        conn.commit()

    if 'prefit_notes' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN prefit_notes TEXT")
        conn.commit()

    # Install stage timestamps and generic address fields.

    if 'install_quote_done_at' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN install_quote_done_at TEXT")
        conn.commit()

    if 'install_approved_done_at' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN install_approved_done_at TEXT")
        conn.commit()

    if 'install_street' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN install_street TEXT")
        conn.commit()

    if 'install_city' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN install_city TEXT")
        conn.commit()

    if 'install_state' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN install_state TEXT")
        conn.commit()

    if 'install_zip' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN install_zip TEXT")
        conn.commit()

    if 'delivery_street' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN delivery_street TEXT")
        conn.commit()

    if 'delivery_city' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN delivery_city TEXT")
        conn.commit()

    if 'delivery_state' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN delivery_state TEXT")
        conn.commit()

    if 'delivery_zip' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN delivery_zip TEXT")
        conn.commit()

    if 'address_street' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN address_street TEXT")
        conn.commit()

    if 'address_city' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN address_city TEXT")
        conn.commit()

    if 'address_state' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN address_state TEXT")
        conn.commit()

    if 'address_zip' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN address_zip TEXT")
        conn.commit()

    # Backfill po_numbers for legacy rows that only used po_number.
    conn.execute(
        """
        UPDATE orders
           SET po_numbers = po_number
         WHERE (po_numbers IS NULL OR TRIM(po_numbers) = '')
           AND po_number IS NOT NULL
           AND TRIM(po_number) != ''
        """
    )

    # Ensure pin/flag values are never NULL for consistent sorting and UI logic.
    conn.execute("UPDATE orders SET is_pinned = 0 WHERE is_pinned IS NULL")
    conn.execute("UPDATE orders SET is_flagged = 0 WHERE is_flagged IS NULL")
    conn.execute("UPDATE orders SET has_customer_account = 0 WHERE has_customer_account IS NULL")

    # Keep account flag aligned when account number exists.
    conn.execute(
        """
        UPDATE orders
           SET has_customer_account = 1
         WHERE customer_number IS NOT NULL
           AND TRIM(customer_number) != ''
        """
    )

    # Normalize legacy transfer-location labels to current UI values.
    conn.execute(
        """
        UPDATE orders
           SET transfer_location = '41st'
         WHERE transfer_location IS NOT NULL
           AND lower(trim(transfer_location)) = 'capitola'
        """
    )
    conn.execute(
        """
        UPDATE orders
           SET transfer_location = 'Door Shop'
         WHERE transfer_location IS NOT NULL
           AND lower(trim(transfer_location)) = 'salinas'
        """
    )
    conn.execute(
        """
        UPDATE orders
           SET transfer_location = NULL
         WHERE transfer_location IS NOT NULL
           AND lower(trim(transfer_location)) = 'aptos'
        """
    )
    conn.commit()


def ensure_order_notes_schema(conn):
    """Create the order notes table used by notes endpoints."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS order_notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            note TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_order_notes_order_id ON order_notes(order_id)")
    conn.commit()


def ensure_attachments_schema(conn):
    """Create the attachments table used by attachment endpoints."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS attachments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            section TEXT,
            filename TEXT NOT NULL,
            rel_path TEXT NOT NULL,
            added_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_attachments_order_id ON attachments(order_id)")
    conn.commit()


def ensure_customer_profiles_schema(conn):
    """Create customer profiles table used for customer-first workflows."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS customer_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_key TEXT NOT NULL UNIQUE,
            customer_name TEXT,
            customer_phone TEXT,
            customer_email TEXT,
            customer_number TEXT,
            default_project_notes TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_customer_profiles_number ON customer_profiles(customer_number)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_customer_profiles_name ON customer_profiles(customer_name)")
    conn.commit()


def normalize_phone_digits(value: Any) -> str:
    return re.sub(r'\D+', '', str(value or ''))


def build_customer_profile_key(name: Any, phone: Any, number: Any) -> str:
    number_key = str(number or '').strip().lower()
    if number_key:
        return f"acct:{number_key}"

    name_key = str(name or '').strip().lower()
    phone_key = normalize_phone_digits(phone)
    return f"name:{name_key}|phone:{phone_key}"


def upsert_customer_profile(conn, payload: Dict[str, Any]):
    """Create/update a customer profile and return profile id."""
    customer_name = str(payload.get('customer_name') or '').strip()
    customer_phone = str(payload.get('customer_phone') or '').strip()
    customer_email = str(payload.get('customer_email') or '').strip()
    customer_number = str(payload.get('customer_number') or '').strip()
    default_project_notes = payload.get('default_project_notes')

    if not customer_name:
        return None

    profile_key = build_customer_profile_key(customer_name, customer_phone, customer_number)

    existing = None
    if customer_number:
        existing = conn.execute(
            "SELECT * FROM customer_profiles WHERE profile_key = ? LIMIT 1",
            (profile_key,),
        ).fetchone()

    if not existing and customer_number:
        existing = conn.execute(
            "SELECT * FROM customer_profiles WHERE customer_number = ? ORDER BY id DESC LIMIT 1",
            (customer_number,),
        ).fetchone()

    if not existing:
        existing = conn.execute(
            "SELECT * FROM customer_profiles WHERE profile_key = ? LIMIT 1",
            (profile_key,),
        ).fetchone()
    if existing:
        updates = {
            'customer_name': customer_name or existing['customer_name'],
            'customer_phone': customer_phone or existing['customer_phone'],
            'customer_email': customer_email or existing['customer_email'],
            'customer_number': customer_number or existing['customer_number'],
            'profile_key': build_customer_profile_key(
                customer_name or existing['customer_name'],
                customer_phone or existing['customer_phone'],
                customer_number or existing['customer_number'],
            ),
            'updated_at': datetime.now().isoformat(),
        }

        if default_project_notes is not None:
            updates['default_project_notes'] = default_project_notes

        set_clause = ', '.join(f"{k} = ?" for k in updates.keys())
        values = list(updates.values()) + [existing['id']]
        conn.execute(f"UPDATE customer_profiles SET {set_clause} WHERE id = ?", values)
        conn.commit()
        return existing['id']

    conn.execute(
        """
        INSERT INTO customer_profiles (
            profile_key, customer_name, customer_phone, customer_email,
            customer_number, default_project_notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            profile_key,
            customer_name,
            customer_phone or None,
            customer_email or None,
            customer_number or None,
            default_project_notes,
            datetime.now().isoformat(),
            datetime.now().isoformat(),
        ),
    )
    conn.commit()
    return conn.execute("SELECT last_insert_rowid()").fetchone()[0]


def ensure_item_style_options_schema(conn):
    """Create and seed persistent style options for line items."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS item_style_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_type TEXT NOT NULL,
            style_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(item_type, style_name COLLATE NOCASE)
        )
        """
    )

    for item_type, style_names in ITEM_STYLE_DEFAULTS.items():
        for style_name in style_names:
            conn.execute(
                "INSERT OR IGNORE INTO item_style_options (item_type, style_name) VALUES (?, ?)",
                (item_type, style_name),
            )

    conn.commit()


def fetch_item_style_options(conn):
    """Return style options grouped by item type."""
    styles = {'door': [], 'window': [], 'hardware': []}
    cursor = conn.execute(
        """
        SELECT item_type, style_name
          FROM item_style_options
         WHERE item_type IN ('door', 'window', 'hardware')
         ORDER BY item_type, style_name COLLATE NOCASE
        """
    )

    for row in cursor.fetchall():
        item_type = row['item_type']
        style_name = row['style_name']
        if item_type in styles:
            styles[item_type].append(style_name)

    return styles


def ensure_item_vendor_options_schema(conn):
    """Create and seed persistent vendor options for line items."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS item_vendor_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_type TEXT NOT NULL,
            vendor_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(item_type, vendor_name COLLATE NOCASE)
        )
        """
    )

    for item_type, vendor_names in ITEM_VENDOR_DEFAULTS.items():
        for vendor_name in vendor_names:
            conn.execute(
                "INSERT OR IGNORE INTO item_vendor_options (item_type, vendor_name) VALUES (?, ?)",
                (item_type, vendor_name),
            )

    # Also seed from the desktop app vendor catalog so SKUs are available in web flow.
    for vendor in get_vendor_catalog():
        vendor_name = vendor.get('name')
        if not vendor_name:
            continue
        for item_type in ('door', 'window', 'hardware'):
            conn.execute(
                "INSERT OR IGNORE INTO item_vendor_options (item_type, vendor_name) VALUES (?, ?)",
                (item_type, vendor_name),
            )

    conn.commit()


def fetch_item_vendor_options(conn):
    """Return vendor options grouped by item type."""
    vendors = {'door': [], 'window': [], 'hardware': []}
    cursor = conn.execute(
        """
        SELECT item_type, vendor_name
          FROM item_vendor_options
         WHERE item_type IN ('door', 'window', 'hardware')
         ORDER BY item_type, vendor_name COLLATE NOCASE
        """
    )

    for row in cursor.fetchall():
        item_type = row['item_type']
        vendor_name = row['vendor_name']
        if item_type in vendors:
            vendors[item_type].append(vendor_name)

    return vendors


def ensure_vendor_series_options_schema(conn):
    """Create and seed vendor-specific series options for line items."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS vendor_series_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_type TEXT NOT NULL,
            vendor_name TEXT NOT NULL,
            series_name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(item_type, vendor_name COLLATE NOCASE, series_name COLLATE NOCASE)
        )
        """
    )

    for item_type, vendors in VENDOR_SERIES_DEFAULTS.items():
        for vendor_name, series_names in vendors.items():
            for series_name in series_names:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO vendor_series_options (item_type, vendor_name, series_name)
                    VALUES (?, ?, ?)
                    """,
                    (item_type, vendor_name, series_name),
                )

    conn.commit()


def fetch_vendor_series_options(conn):
    """Return vendor-specific series options grouped by item_type and vendor."""
    options = {'door': {}, 'window': {}, 'hardware': {}}
    cursor = conn.execute(
        """
        SELECT item_type, vendor_name, series_name
          FROM vendor_series_options
         WHERE item_type IN ('door', 'window', 'hardware')
         ORDER BY item_type, vendor_name COLLATE NOCASE, series_name COLLATE NOCASE
        """
    )

    for row in cursor.fetchall():
        item_type = row['item_type']
        vendor_name = row['vendor_name']
        series_name = row['series_name']

        if item_type not in options:
            continue

        options[item_type].setdefault(vendor_name, []).append(series_name)

    return options


def ensure_fin_type_options_schema(conn):
    """Create and seed global fin type options for line items."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS fin_type_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fin_type_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )

    # Migrate legacy/partial values (e.g., "1") to canonical labels.
    rows = conn.execute(
        "SELECT id, fin_type_name FROM fin_type_options"
    ).fetchall()

    for row in rows:
        option_id = row['id']
        original_name = row['fin_type_name']
        normalized_name = normalize_fin_type_name(original_name)

        if not normalized_name:
            conn.execute("DELETE FROM fin_type_options WHERE id = ?", (option_id,))
            continue

        if normalized_name == original_name:
            continue

        try:
            conn.execute(
                "UPDATE fin_type_options SET fin_type_name = ? WHERE id = ?",
                (normalized_name, option_id),
            )
        except sqlite3.IntegrityError:
            # Duplicate after normalization; keep one canonical row.
            conn.execute("DELETE FROM fin_type_options WHERE id = ?", (option_id,))

    for fin_type_name in FIN_TYPE_DEFAULTS:
        normalized_name = normalize_fin_type_name(fin_type_name)
        if not normalized_name:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO fin_type_options (fin_type_name) VALUES (?)",
            (normalized_name,),
        )

    conn.commit()


def fetch_fin_type_options(conn):
    """Return ordered global fin type option list."""
    rows = conn.execute(
        """
        SELECT fin_type_name
          FROM fin_type_options
         ORDER BY fin_type_name COLLATE NOCASE
        """
    ).fetchall()
    return [row['fin_type_name'] for row in rows]


def ensure_window_color_options_schema(conn):
    """Create persistent window color options. Starts empty by design."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS window_color_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            color_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.commit()


def fetch_window_color_options(conn):
    """Return ordered window color option list."""
    rows = conn.execute(
        """
        SELECT color_name
          FROM window_color_options
         ORDER BY color_name COLLATE NOCASE
        """
    ).fetchall()
    return [row['color_name'] for row in rows]

def normalize_po_numbers(raw_value):
    """Return a de-duplicated list of PO numbers from list/string input."""
    if raw_value is None:
        return []

    if isinstance(raw_value, list):
        candidates = raw_value
    else:
        candidates = re.split(r'[,;\n|]+', str(raw_value))

    normalized = []
    seen = set()
    for value in candidates:
        po = str(value).strip()
        if not po:
            continue
        key = po.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(po)

    return normalized


def apply_po_fields(payload):
    """Normalize PO fields and keep po_number + po_numbers synchronized."""
    raw_po_values = payload.get('po_numbers')
    if raw_po_values is None:
        raw_po_values = payload.get('po_number')

    if raw_po_values is None:
        return

    po_list = normalize_po_numbers(raw_po_values)

    if po_list:
        payload['po_number'] = po_list[0]
        payload['po_numbers'] = ', '.join(po_list)
    else:
        payload['po_number'] = None
        payload['po_numbers'] = None


def attach_po_display(order_dict):
    """Add a display-ready PO string for frontend usage."""
    order_dict['po_numbers_display'] = order_dict.get('po_numbers') or order_dict.get('po_number') or ''
    return order_dict

def dict_from_row(row):
    """Convert sqlite3.Row to dict"""
    return dict(zip(row.keys(), row))


def get_runtime_mode() -> str:
    """Return LOCAL when running on localhost/private network, otherwise LIVE."""
    host = (request.host or '').lower()
    host_only = host.split(':', 1)[0]

    if host_only in ('localhost', '127.0.0.1', '::1'):
        return 'LOCAL'

    if host_only.startswith('192.168.') or host_only.startswith('10.') or host_only.startswith('172.'):
        return 'LOCAL'

    return 'LIVE'


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    return str(value).strip().lower() in ('1', 'true', 'yes', 'on')


def _quote_identifier(identifier: str) -> str:
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', identifier or ''):
        raise ValueError(f'Invalid SQL identifier: {identifier}')
    return f'"{identifier}"'


def _table_exists(conn, table_name: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
        (table_name,)
    ).fetchone()
    return row is not None


def _table_columns(conn, table_name: str) -> List[str]:
    table_sql = _quote_identifier(table_name)
    rows = conn.execute(f"PRAGMA table_info({table_sql})").fetchall()
    columns: List[str] = []
    for row in rows:
        try:
            columns.append(row['name'])
        except Exception:
            columns.append(row[1])
    return columns


def _upsert_table_rows(conn, table_name: str, rows: Any) -> Dict[str, int]:
    stats = {'inserted': 0, 'updated': 0, 'skipped': 0}

    if not isinstance(rows, list) or not rows:
        return stats

    if not _table_exists(conn, table_name):
        stats['skipped'] = len(rows)
        return stats

    columns = _table_columns(conn, table_name)
    if not columns:
        stats['skipped'] = len(rows)
        return stats

    id_column = 'id' if 'id' in columns else None
    writable_columns = [col for col in columns if col != id_column]

    table_sql = _quote_identifier(table_name)

    for entry in rows:
        if not isinstance(entry, dict):
            stats['skipped'] += 1
            continue

        requested_id = None
        if id_column:
            raw_id = entry.get(id_column)
            if raw_id not in (None, ''):
                try:
                    requested_id = int(raw_id)
                except (TypeError, ValueError):
                    requested_id = None

        row_values = {
            col: entry.get(col)
            for col in writable_columns
            if col in entry
        }

        if requested_id is not None and id_column:
            id_sql = _quote_identifier(id_column)
            existing = conn.execute(
                f"SELECT 1 FROM {table_sql} WHERE {id_sql} = ? LIMIT 1",
                (requested_id,)
            ).fetchone()

            if existing:
                if row_values:
                    set_clause = ', '.join(f"{_quote_identifier(col)} = ?" for col in row_values.keys())
                    conn.execute(
                        f"UPDATE {table_sql} SET {set_clause} WHERE {id_sql} = ?",
                        [*row_values.values(), requested_id]
                    )
                stats['updated'] += 1
                continue

        insert_columns = list(row_values.keys())
        insert_values = list(row_values.values())

        if id_column and requested_id is not None:
            insert_columns = [id_column, *insert_columns]
            insert_values = [requested_id, *insert_values]

        if not insert_columns:
            stats['skipped'] += 1
            continue

        cols_sql = ', '.join(_quote_identifier(col) for col in insert_columns)
        placeholders = ', '.join('?' for _ in insert_columns)
        conn.execute(
            f"INSERT INTO {table_sql} ({cols_sql}) VALUES ({placeholders})",
            insert_values
        )
        stats['inserted'] += 1

    return stats

