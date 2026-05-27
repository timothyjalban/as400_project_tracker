"""
Flask backend for Order Tracker Web App
Connects to existing SQLite database and provides REST API
"""
from flask import Flask, jsonify, render_template, request, send_file, session, redirect, url_for
from flask_cors import CORS
import sqlite3
import sys
from pathlib import Path
from typing import List, Dict, Any, Optional
import json
import re
from datetime import datetime
import zipfile
import io
import logging
from datetime import timedelta
from werkzeug.security import check_password_hash

# Use the local in-repo data package so the app can run outside the desktop environment.
import data.config as db_config

# Now import database functions with correct DB_PATH
from data.database import ensure_reminders_schema, backup_order, insert_reminder, list_due_reminders, snooze_reminder, complete_reminder
import tempfile
import os
import urllib.request
import urllib.error

try:
    from data.vendors import COMMON_VENDORS
except Exception:
    COMMON_VENDORS = []

# Import OCR processor
try:
    from ocr_processor import process_bulk_form_pdf, ocr_pdf
    HAS_OCR = True
    print("✅ OCR processor loaded successfully")
except ImportError as e:
    HAS_OCR = False
    process_bulk_form_pdf = None
    ocr_pdf = None
    print(f"⚠️  OCR processor not available: {e}")

app = Flask(__name__)

# CORS: only enabled when an explicit allowlist is configured via env.
# When frontend and API share the same origin (typical deploy), CORS is not needed.
_cors_origins_raw = os.environ.get('ORDER_TRACKER_ALLOWED_ORIGINS', '').strip()
if _cors_origins_raw:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(',') if o.strip()]
    CORS(app, origins=_cors_origins, supports_credentials=True)
# else: no cross-origin access permitted

logger = logging.getLogger(__name__)

# Rate limiter – keyed on remote IP so brute-force attempts are blocked per-client.
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
_limiter = Limiter(
    key_func=get_remote_address,
    app=app,
    default_limits=[],          # no blanket limit; only routes we decorate
    storage_uri='memory://',    # upgrade to redis:// in multi-process deploys
)

# Session/security configuration
app.secret_key = os.environ.get('ORDER_TRACKER_SECRET_KEY') or os.urandom(32)
if not os.environ.get('ORDER_TRACKER_SECRET_KEY'):
    logger.warning('ORDER_TRACKER_SECRET_KEY not set; using ephemeral secret key for this process')

app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = os.environ.get('ORDER_TRACKER_COOKIE_SAMESITE', 'Lax')
app.config['SESSION_COOKIE_SECURE'] = (os.environ.get('ORDER_TRACKER_COOKIE_SECURE', '0') or '0').strip().lower() in ('1', 'true', 'yes', 'on')
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(hours=int(os.environ.get('ORDER_TRACKER_SESSION_HOURS', '12')))

AUTH_USERS_JSON = os.environ.get('ORDER_TRACKER_AUTH_USERS_JSON', '').strip()
AUTH_DEFAULT_USERNAME = os.environ.get('ORDER_TRACKER_ADMIN_USERNAME', 'admin').strip()
AUTH_DEFAULT_PASSWORD = os.environ.get('ORDER_TRACKER_ADMIN_PASSWORD', '').strip()
AUTH_DEFAULT_PASSWORD_HASH = os.environ.get('ORDER_TRACKER_ADMIN_PASSWORD_HASH', '').strip()
AUTH_ALLOW_INSECURE_DEFAULT_LOGIN = (os.environ.get('ORDER_TRACKER_ALLOW_INSECURE_DEFAULT_LOGIN', '1') or '1').strip().lower() in ('1', 'true', 'yes', 'on')
ENFORCE_HTTPS = (os.environ.get('ORDER_TRACKER_ENFORCE_HTTPS', '0') or '0').strip().lower() in ('1', 'true', 'yes', 'on')
DESKTOP_HELPER_LOCAL_ONLY = (os.environ.get('ORDER_TRACKER_DESKTOP_HELPER_LOCAL_ONLY', '1') or '1').strip().lower() in ('1', 'true', 'yes', 'on')


def resolve_db_path(preferred_path):
    """Return a writable DB path, falling back to /tmp when needed."""
    import tempfile

    candidate = Path(preferred_path) if preferred_path else Path(tempfile.gettempdir()) / 'orders.db'
    fallback = Path(tempfile.gettempdir()) / 'orders.db'

    try:
        candidate.parent.mkdir(parents=True, exist_ok=True)
        probe_path = candidate.parent / '.db_write_probe'
        probe_path.write_text('', encoding='utf-8')
        probe_path.unlink(missing_ok=True)
        return candidate
    except Exception:
        if candidate != fallback:
            print(f"WARNING: DB path {candidate} is not writable; falling back to {fallback}")
        fallback.parent.mkdir(parents=True, exist_ok=True)
        return fallback


def _load_auth_users() -> Dict[str, Dict[str, str]]:
    """Load users from env JSON with fallback single-admin credentials."""
    users: Dict[str, Dict[str, str]] = {}

    if AUTH_USERS_JSON:
        try:
            raw = json.loads(AUTH_USERS_JSON)
            if isinstance(raw, list):
                for entry in raw:
                    if not isinstance(entry, dict):
                        continue
                    username = str(entry.get('username') or '').strip()
                    if not username:
                        continue
                    users[username] = {
                        'password_hash': str(entry.get('password_hash') or '').strip(),
                        'password': str(entry.get('password') or '').strip(),
                        'role': str(entry.get('role') or 'user').strip() or 'user',
                    }
        except Exception as exc:
            logger.error('Failed to parse ORDER_TRACKER_AUTH_USERS_JSON: %s', exc)

    if not users and AUTH_DEFAULT_USERNAME:
        if AUTH_DEFAULT_PASSWORD_HASH or AUTH_DEFAULT_PASSWORD:
            users[AUTH_DEFAULT_USERNAME] = {
                'password_hash': AUTH_DEFAULT_PASSWORD_HASH,
                'password': AUTH_DEFAULT_PASSWORD,
                'role': 'admin',
            }
        elif AUTH_ALLOW_INSECURE_DEFAULT_LOGIN:
            users[AUTH_DEFAULT_USERNAME] = {
                'password_hash': '',
                'password': 'changeme',
                'role': 'admin',
            }
            logger.warning('Using insecure default credentials %s/changeme. Set ORDER_TRACKER_AUTH_USERS_JSON for production.', AUTH_DEFAULT_USERNAME)

    return users


def _verify_login(username: str, password: str) -> Optional[Dict[str, str]]:
    users = _load_auth_users()
    user = users.get(username)
    if not user:
        return None

    stored_hash = user.get('password_hash') or ''
    stored_password = user.get('password') or ''

    valid = False
    if stored_hash:
        try:
            valid = check_password_hash(stored_hash, password)
        except Exception:
            valid = False
    elif stored_password:
        valid = (password == stored_password)

    if not valid:
        return None

    return {
        'username': username,
        'role': user.get('role') or 'user',
    }


def _is_api_request() -> bool:
    return request.path.startswith('/api/')


def _is_local_request() -> bool:
    remote = (request.remote_addr or '').strip()
    if remote in ('127.0.0.1', '::1'):
        return True

    forwarded_for = (request.headers.get('X-Forwarded-For') or '').split(',')[0].strip()
    if forwarded_for in ('127.0.0.1', '::1'):
        return True

    return False


def _is_authenticated() -> bool:
    return bool(session.get('username'))


def _is_admin() -> bool:
    return session.get('role') == 'admin'


@app.before_request
def security_before_request():
    public_paths = {'/', '/login'}
    if request.path in public_paths or request.path.startswith('/static/'):
        return None

    if not _is_authenticated():
        if _is_api_request():
            return jsonify({'success': False, 'error': 'Authentication required'}), 401
        next_url = request.full_path if request.query_string else request.path
        return redirect(url_for('login', next=next_url))

    return None


@app.after_request
def security_after_request(response):
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    # CSP allows existing inline handlers/scripts used by current templates.
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "script-src-attr 'unsafe-inline'; "
        "script-src-elem 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: blob:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'self';"
    )
    if ENFORCE_HTTPS:
        response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    return response

# Path to the SQLite database. Override via ORDER_TRACKER_DB_PATH env var for production.
DB_PATH = resolve_db_path(os.environ.get('ORDER_TRACKER_DB_PATH', db_config.DB_PATH))
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
    'window': ['Single Hung', 'Double Hung', 'Casement', 'Sliding', 'Picture'],
}

ITEM_VENDOR_DEFAULTS = {
    'door': ['Jeld-Wen', 'Masonite', 'Therma-Tru'],
    'window': ['Milgard', 'Andersen', 'Pella'],
}


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
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Return rows as dictionaries
    ensure_orders_schema(conn)
    ensure_order_notes_schema(conn)
    ensure_attachments_schema(conn)
    ensure_reminders_schema(conn)
    ensure_customer_profiles_schema(conn)
    ensure_item_style_options_schema(conn)
    ensure_item_vendor_options_schema(conn)
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

    if 'customer_number' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN customer_number TEXT")
        conn.commit()

    if 'has_customer_account' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN has_customer_account INTEGER DEFAULT 0")
        conn.commit()

    if 'customer_profile_id' not in columns:
        conn.execute("ALTER TABLE orders ADD COLUMN customer_profile_id INTEGER")
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
    styles = {'door': [], 'window': []}
    cursor = conn.execute(
        """
        SELECT item_type, style_name
          FROM item_style_options
         WHERE item_type IN ('door', 'window')
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
        for item_type in ('door', 'window'):
            conn.execute(
                "INSERT OR IGNORE INTO item_vendor_options (item_type, vendor_name) VALUES (?, ?)",
                (item_type, vendor_name),
            )

    conn.commit()


def fetch_item_vendor_options(conn):
    """Return vendor options grouped by item type."""
    vendors = {'door': [], 'window': []}
    cursor = conn.execute(
        """
        SELECT item_type, vendor_name
          FROM item_vendor_options
         WHERE item_type IN ('door', 'window')
         ORDER BY item_type, vendor_name COLLATE NOCASE
        """
    )

    for row in cursor.fetchall():
        item_type = row['item_type']
        vendor_name = row['vendor_name']
        if item_type in vendors:
            vendors[item_type].append(vendor_name)

    return vendors


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

@app.route('/')
def index():
    """Serve the main HTML page"""
    if not _is_authenticated():
        return render_template('login.html', error=None, next_url='/')
    return render_template('index.html')


@app.route('/login', methods=['GET', 'POST'])
@_limiter.limit('15 per minute; 50 per hour', methods=['POST'])
def login():
    error = None
    next_url = request.args.get('next', '/')
    if not str(next_url).startswith('/'):
        next_url = '/'

    if request.method == 'POST':
        username = (request.form.get('username') or '').strip()
        password = request.form.get('password') or ''
        next_url = request.form.get('next') or '/'
        if not str(next_url).startswith('/'):
            next_url = '/'

        auth_user = _verify_login(username, password)
        if auth_user:
            session.clear()
            session['username'] = auth_user['username']
            session['role'] = auth_user.get('role', 'user')
            session.permanent = True
            return redirect(next_url or '/')

        error = 'Invalid username or password'

    return render_template('login.html', error=error, next_url=next_url)


@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return redirect(url_for('login'))

@app.route('/api/orders', methods=['GET'])
def get_orders():
    """
    Get all orders with optional filtering
    Query params:
        - search: text search across customer_name, project_name, quote_number, po_number
        - stage: filter by stage
        - show_completed: include archived orders (default: false)
    """
    search = request.args.get('search', '').strip()
    stage = request.args.get('stage', '')
    show_completed = request.args.get('show_completed', 'false').lower() == 'true'
    
    try:
        conn = get_db_connection()
        
        # Build query
        query = "SELECT * FROM orders WHERE 1=1"
        params = []
        
        # Filter archived orders
        if not show_completed:
            query += " AND (archived IS NULL OR archived = 0)"
        
        # Search filter
        if search:
            query += """ AND (
                customer_name LIKE ? OR 
                REPLACE(customer_phone, '-', '') LIKE ? OR
                project_name LIKE ? OR 
                quote_number LIKE ? OR 
                po_number LIKE ? OR
                po_numbers LIKE ?
            )"""
            search_term = f"%{search}%"
            search_term_no_dash = f"%{search.replace('-', '')}%"
            params.extend([search_term, search_term_no_dash, search_term, search_term, search_term, search_term])
        
        # Stage filter
        if stage and stage != '(All)':
            query += " AND stage = ?"
            params.append(stage)
        
        # Pinned orders stay at the top, then newest order IDs first.
        query += " ORDER BY COALESCE(is_pinned, 0) DESC, id DESC"
        
        cursor = conn.execute(query, params)
        rows = cursor.fetchall()
        
        # Convert to list of dicts
        orders = [attach_po_display(dict_from_row(row)) for row in rows]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'orders': orders,
            'count': len(orders)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>', methods=['GET'])
def get_order(order_id):
    """Get a single order by ID"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return jsonify({
                'success': True,
                'order': attach_po_display(dict_from_row(row))
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>', methods=['PUT'])
def update_order(order_id):
    """Update an existing order"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400

        apply_po_fields(data)

        if 'customer_number' in data and 'has_customer_account' not in data:
            data['has_customer_account'] = 1 if str(data.get('customer_number') or '').strip() else 0
        
        conn = get_db_connection()

        # Pull current values so we can preserve manual-priority overrides.
        existing_row = conn.execute(
            "SELECT * FROM orders WHERE id = ?",
            (order_id,)
        ).fetchone()

        if not existing_row:
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
        
        # Get current table columns
        cursor = conn.execute("PRAGMA table_info(orders)")
        columns = {row[1] for row in cursor.fetchall()}
        
        # Filter data to only include fields that exist in the database
        update_fields = {k: v for k, v in data.items() if k in columns and k != 'id'}

        profile_payload = {
            'customer_name': update_fields.get('customer_name', existing_row['customer_name']),
            'customer_phone': update_fields.get('customer_phone', existing_row['customer_phone']),
            'customer_email': update_fields.get('customer_email', existing_row['customer_email']),
            'customer_number': update_fields.get('customer_number', existing_row['customer_number']),
        }
        if 'default_project_notes' in data:
            profile_payload['default_project_notes'] = data.get('default_project_notes')

        profile_id = upsert_customer_profile(conn, profile_payload)
        if profile_id and 'customer_profile_id' in columns:
            update_fields['customer_profile_id'] = profile_id

        if 'priority_manual' in columns and 'stage' in update_fields:
            has_manual_priority = (
                'priority_manual' in update_fields
                and update_fields.get('priority_manual') not in (None, '')
            )

            if not has_manual_priority:
                previous_stage = existing_row['stage']
                previous_auto_priority = compute_stage_priority(previous_stage)
                current_priority = coerce_optional_int(existing_row['priority_manual'])
                auto_managed = (
                    current_priority is None
                    or current_priority == previous_auto_priority
                )

                if auto_managed:
                    update_fields['priority_manual'] = compute_stage_priority(update_fields['stage'])
        
        if not update_fields:
            conn.close()
            return jsonify({
                'success': False,
                'error': 'No valid fields to update'
            }), 400
        
        # Add updated_at timestamp
        update_fields['updated_at'] = datetime.now().isoformat()
        
        # Build UPDATE query
        set_clause = ', '.join(f"{field} = ?" for field in update_fields.keys())
        values = list(update_fields.values())
        values.append(order_id)  # for WHERE clause
        
        query = f"UPDATE orders SET {set_clause} WHERE id = ?"
        conn.execute(query, values)
        conn.commit()
        
        # Fetch updated order
        cursor = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return jsonify({
                'success': True,
                'order': attach_po_display(dict_from_row(row)),
                'message': 'Order updated successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Order not found after update'
            }), 404
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/stages', methods=['GET'])
def get_stages():
    """Get list of all unique stages in the database"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("SELECT DISTINCT stage FROM orders WHERE stage IS NOT NULL ORDER BY stage")
        stages = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({
            'success': True,
            'stages': stages
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/item-style-options', methods=['GET'])
def get_item_style_options():
    """Get persistent style options for door/window line items."""
    try:
        conn = get_db_connection()
        styles = fetch_item_style_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'styles': styles
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/item-style-options', methods=['POST'])
def create_item_style_option():
    """Create a new persistent style option for door/window line items."""
    try:
        data = request.get_json() or {}
        item_type = str(data.get('item_type', '')).strip().lower()
        style_name = str(data.get('style_name', '')).strip()

        if item_type not in ('door', 'window'):
            return jsonify({
                'success': False,
                'error': 'item_type must be door or window'
            }), 400

        if not style_name:
            return jsonify({
                'success': False,
                'error': 'style_name is required'
            }), 400

        conn = get_db_connection()
        conn.execute(
            "INSERT OR IGNORE INTO item_style_options (item_type, style_name) VALUES (?, ?)",
            (item_type, style_name),
        )
        conn.commit()

        styles = fetch_item_style_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'styles': styles
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/item-style-options', methods=['DELETE'])
def delete_item_style_option():
    """Delete a saved style option for door/window line items."""
    try:
        data = request.get_json() or {}
        item_type = str(data.get('item_type', '')).strip().lower()
        style_name = str(data.get('style_name', '')).strip()

        if item_type not in ('door', 'window'):
            return jsonify({
                'success': False,
                'error': 'item_type must be door or window'
            }), 400

        if not style_name:
            return jsonify({
                'success': False,
                'error': 'style_name is required'
            }), 400

        conn = get_db_connection()
        conn.execute(
            "DELETE FROM item_style_options WHERE item_type = ? AND style_name = ?",
            (item_type, style_name),
        )
        conn.commit()

        styles = fetch_item_style_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'styles': styles
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/item-vendor-options', methods=['GET'])
def get_item_vendor_options():
    """Get persistent vendor options for door/window line items."""
    try:
        conn = get_db_connection()
        vendors = fetch_item_vendor_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'vendors': vendors
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/vendor-catalog', methods=['GET'])
def get_vendor_catalog_api():
    """Get vendor catalog from desktop project, including SKU values."""
    try:
        return jsonify({
            'success': True,
            'vendors': get_vendor_catalog()
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/item-vendor-options', methods=['POST'])
def create_item_vendor_option():
    """Create a new persistent vendor option for door/window line items."""
    try:
        data = request.get_json() or {}
        item_type = str(data.get('item_type', '')).strip().lower()
        vendor_name = str(data.get('vendor_name', '')).strip()

        if item_type not in ('door', 'window'):
            return jsonify({
                'success': False,
                'error': 'item_type must be door or window'
            }), 400

        if not vendor_name:
            return jsonify({
                'success': False,
                'error': 'vendor_name is required'
            }), 400

        conn = get_db_connection()
        conn.execute(
            "INSERT OR IGNORE INTO item_vendor_options (item_type, vendor_name) VALUES (?, ?)",
            (item_type, vendor_name),
        )
        conn.commit()

        vendors = fetch_item_vendor_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'vendors': vendors
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders', methods=['POST'])
def create_order():
    """Create a new order"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400

        apply_po_fields(data)

        if 'customer_number' in data and 'has_customer_account' not in data:
            data['has_customer_account'] = 1 if str(data.get('customer_number') or '').strip() else 0

        # Ensure default stage for new orders
        if not data.get('stage'):
            data['stage'] = 'ORDER_DETAILS'
        
        if 'priority_manual' not in data or data.get('priority_manual') in (None, ''):
            data['priority_manual'] = compute_stage_priority(data.get('stage'))
        
        # Validate required fields
        if not data.get('customer_name'):
            return jsonify({
                'success': False,
                'error': 'Customer name is required'
            }), 400
        
        if not data.get('stage'):
            return jsonify({
                'success': False,
                'error': 'Stage is required'
            }), 400
        
        conn = get_db_connection()
        
        # Get current table columns
        cursor = conn.execute("PRAGMA table_info(orders)")
        columns = {row[1] for row in cursor.fetchall()}
        columns.remove('id')  # Don't include auto-increment ID
        
        # Filter data to only include fields that exist in the database
        insert_fields = {k: v for k, v in data.items() if k in columns}

        profile_payload = {
            'customer_name': insert_fields.get('customer_name'),
            'customer_phone': insert_fields.get('customer_phone'),
            'customer_email': insert_fields.get('customer_email'),
            'customer_number': insert_fields.get('customer_number'),
            'default_project_notes': data.get('default_project_notes'),
        }
        profile_id = upsert_customer_profile(conn, profile_payload)
        if profile_id and 'customer_profile_id' in columns:
            insert_fields['customer_profile_id'] = profile_id
        
        # Add timestamps
        now = datetime.now().isoformat()
        insert_fields['created_at'] = now
        insert_fields['updated_at'] = now
        insert_fields['archived'] = 0  # New orders are not archived
        
        # Build INSERT query
        field_names = list(insert_fields.keys())
        placeholders = ', '.join('?' * len(field_names))
        field_list = ', '.join(field_names)
        values = [insert_fields[f] for f in field_names]
        
        query = f"INSERT INTO orders ({field_list}) VALUES ({placeholders})"
        cursor = conn.execute(query, values)
        conn.commit()
        
        # Get the newly created order
        new_id = cursor.lastrowid
        cursor = conn.execute("SELECT * FROM orders WHERE id = ?", (new_id,))
        row = cursor.fetchone()
        conn.close()
        
        return jsonify({
            'success': True,
            'order': attach_po_display(dict_from_row(row)),
            'message': 'Order created successfully'
        }), 201
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>', methods=['DELETE'])
def delete_order(order_id):
    """Delete an order and all its attachments"""
    try:
        conn = get_db_connection()
        
        # Check if order exists
        cursor = conn.execute("SELECT customer_name, po_number, po_numbers FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
        
        # Get all attachments to delete files
        cursor = conn.execute("SELECT rel_path FROM attachments WHERE order_id = ?", (order_id,))
        attachments = cursor.fetchall()
        
        # Delete attachment files
        import shutil
        attach_base = Path(r"C:\Projects\Order-Tracker\attachments")
        
        # Delete each file
        for att in attachments:
            try:
                file_path = attach_base / att['rel_path']
                if file_path.exists():
                    file_path.unlink()
            except Exception as e:
                print(f"Error deleting file {att['rel_path']}: {e}")
        
        # Try to delete the order's folder
        def slugify(text):
            import re
            text = str(text).strip().replace(' ', '_')
            return re.sub(r'[^\w\-]', '', text)
        
        customer_slug = slugify(order['customer_name'] or 'customer')
        # Prefer po_numbers (web workflow), fallback to po_number.
        po_candidates = normalize_po_numbers(order['po_numbers'] or order['po_number'])
        po = (po_candidates[0] if po_candidates else '').strip()
        if po:
            folder_name = f"{customer_slug}__PO-{slugify(po)}"
        else:
            folder_name = f"{customer_slug}__ID-{order_id}"
        
        order_folder = attach_base / folder_name
        if order_folder.exists() and order_folder.is_dir():
            try:
                shutil.rmtree(order_folder)
            except Exception as e:
                print(f"Error deleting folder {order_folder}: {e}")
        
        # Delete attachments from database
        conn.execute("DELETE FROM attachments WHERE order_id = ?", (order_id,))
        
        # Delete order from database
        conn.execute("DELETE FROM orders WHERE id = ?", (order_id,))
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Order deleted successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/export', methods=['GET'])
def export_orders():
    """Export orders to CSV with same filters as main view"""
    search = request.args.get('search', '').strip()
    stage = request.args.get('stage', '')
    show_completed = request.args.get('show_completed', 'false').lower() == 'true'
    
    try:
        conn = get_db_connection()
        
        # Build query (same as get_orders)
        query = "SELECT * FROM orders WHERE 1=1"
        params = []
        
        # Filter archived orders
        if not show_completed:
            query += " AND (archived IS NULL OR archived = 0)"
        
        # Search filter
        if search:
            query += """ AND (
                customer_name LIKE ? OR 
                REPLACE(customer_phone, '-', '') LIKE ? OR
                project_name LIKE ? OR 
                quote_number LIKE ? OR 
                po_number LIKE ? OR
                po_numbers LIKE ?
            )"""
            search_term = f"%{search}%"
            search_term_no_dash = f"%{search.replace('-', '')}%"
            params.extend([search_term, search_term_no_dash, search_term, search_term, search_term, search_term])
        
        # Stage filter
        if stage and stage != '(All)':
            query += " AND stage = ?"
            params.append(stage)
        
        # Pinned orders stay at the top in exports as well, then newest IDs first.
        query += " ORDER BY COALESCE(is_pinned, 0) DESC, id DESC"
        
        cursor = conn.execute(query, params)
        rows = cursor.fetchall()
        conn.close()
        
        # Create CSV
        import csv
        from io import StringIO
        
        output = StringIO()
        
        if rows:
            # Get column names from first row
            fieldnames = rows[0].keys()
            writer = csv.DictWriter(output, fieldnames=fieldnames)
            
            writer.writeheader()
            for row in rows:
                writer.writerow(dict(row))
        else:
            # Empty CSV with headers
            writer = csv.writer(output)
            writer.writerow(['id', 'customer_name', 'project_name', 'quote_number', 'po_number', 'stage', 'created_at', 'updated_at'])
        
        # Prepare response
        from flask import Response
        
        csv_data = output.getvalue()
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f'orders_export_{timestamp}.csv'
        
        return Response(
            csv_data,
            mimetype='text/csv',
            headers={'Content-Disposition': f'attachment; filename={filename}'}
        )
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/orders/backup-json', methods=['GET'])
def backup_orders_json_download():
    """Download a full JSON backup suitable for cloud restore."""
    include_archived = _coerce_bool(request.args.get('include_archived', 'true'), default=True)

    try:
        conn = get_db_connection()

        orders_query = "SELECT * FROM orders"
        params: List[Any] = []
        if not include_archived:
            orders_query += " WHERE (archived IS NULL OR archived = 0)"
        orders_query += " ORDER BY id"

        orders = [dict_from_row(row) for row in conn.execute(orders_query, params).fetchall()]

        payload: Dict[str, Any] = {
            'version': 1,
            'generated_at': datetime.utcnow().isoformat() + 'Z',
            'include_archived': include_archived,
            'orders': orders,
        }

        if _table_exists(conn, 'order_notes'):
            payload['order_notes'] = [
                dict_from_row(row)
                for row in conn.execute("SELECT * FROM order_notes ORDER BY id").fetchall()
            ]

        if _table_exists(conn, 'reminders'):
            payload['reminders'] = [
                dict_from_row(row)
                for row in conn.execute("SELECT * FROM reminders ORDER BY id").fetchall()
            ]

        if _table_exists(conn, 'attachments'):
            payload['attachments'] = [
                dict_from_row(row)
                for row in conn.execute("SELECT * FROM attachments ORDER BY id").fetchall()
            ]

        conn.close()

        stream = io.BytesIO(json.dumps(payload, indent=2, default=str).encode('utf-8'))
        stream.seek(0)
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')

        return send_file(
            stream,
            as_attachment=True,
            download_name=f'order_tracker_backup_{timestamp}.json',
            mimetype='application/json'
        )

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/orders/restore-json', methods=['POST'])
def restore_orders_json():
    """Restore orders and related metadata from a JSON backup file."""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400

        file = request.files['file']
        if not file or not file.filename:
            return jsonify({'success': False, 'error': 'No file selected'}), 400

        payload = json.loads(file.read())
        if not isinstance(payload, dict):
            return jsonify({'success': False, 'error': 'Invalid backup format'}), 400

        if not isinstance(payload.get('orders'), list):
            return jsonify({'success': False, 'error': 'Backup is missing orders list'}), 400

        conn = get_db_connection()
        try:
            conn.execute('BEGIN')

            orders_stats = _upsert_table_rows(conn, 'orders', payload.get('orders'))
            notes_stats = _upsert_table_rows(conn, 'order_notes', payload.get('order_notes'))
            reminders_stats = _upsert_table_rows(conn, 'reminders', payload.get('reminders'))
            attachments_stats = _upsert_table_rows(conn, 'attachments', payload.get('attachments'))

            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

        summary = {
            'orders': orders_stats,
            'order_notes': notes_stats,
            'reminders': reminders_stats,
            'attachments': attachments_stats,
        }

        return jsonify({
            'success': True,
            'message': 'Backup restored successfully',
            'summary': summary
        })

    except json.JSONDecodeError:
        return jsonify({'success': False, 'error': 'Invalid JSON file'}), 400
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>/notes', methods=['GET'])
def get_notes_endpoint(order_id):
    """Get all notes for an order"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("""
            SELECT id, note, created_at
            FROM order_notes
            WHERE order_id = ?
            ORDER BY id DESC
        """, (order_id,))
        rows = cursor.fetchall()
        conn.close()
        
        notes = [dict_from_row(row) for row in rows]
        
        return jsonify({
            'success': True,
            'notes': notes,
            'count': len(notes)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>/notes', methods=['POST'])
def add_note_endpoint(order_id):
    """Add a note to an order"""
    try:
        data = request.get_json()
        
        if not data or not data.get('note'):
            return jsonify({
                'success': False,
                'error': 'Note text is required'
            }), 400
        
        note_text = data['note'].strip()
        if not note_text:
            return jsonify({
                'success': False,
                'error': 'Note cannot be empty'
            }), 400
        
        # Check if order exists
        conn = get_db_connection()
        cursor = conn.execute("SELECT id FROM orders WHERE id = ?", (order_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
        
        # Add note
        from datetime import datetime
        now = datetime.now().isoformat()
        cursor = conn.execute("""
            INSERT INTO order_notes (order_id, note, created_at)
            VALUES (?, ?, ?)
        """, (order_id, note_text, now))
        conn.commit()
        
        note_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            'success': True,
            'note': {
                'id': note_id,
                'note': note_text,
                'created_at': now
            },
            'message': 'Note added successfully'
        }), 201
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/notes/<int:note_id>', methods=['PUT'])
def update_note_endpoint(note_id):
    """Update an existing note"""
    try:
        data = request.get_json()
        
        if not data or not data.get('note'):
            return jsonify({
                'success': False,
                'error': 'Note text is required'
            }), 400
        
        note_text = data['note'].strip()
        if not note_text:
            return jsonify({
                'success': False,
                'error': 'Note cannot be empty'
            }), 400
        
        conn = get_db_connection()
        
        # Check if note exists
        cursor = conn.execute("SELECT id FROM order_notes WHERE id = ?", (note_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Note not found'
            }), 404
        
        # Update note
        conn.execute("UPDATE order_notes SET note = ? WHERE id = ?", (note_text, note_id))
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Note updated successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/notes/<int:note_id>', methods=['DELETE'])
def delete_note_endpoint(note_id):
    """Delete a note"""
    try:
        conn = get_db_connection()
        
        # Check if note exists
        cursor = conn.execute("SELECT id FROM order_notes WHERE id = ?", (note_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Note not found'
            }), 404
        
        # Delete note
        conn.execute("DELETE FROM order_notes WHERE id = ?", (note_id,))
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Note deleted successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>/attachments', methods=['GET'])
def get_attachments(order_id):
    """Get all attachments for an order"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("""
            SELECT id, filename, rel_path, section, added_at
            FROM attachments
            WHERE order_id = ?
            ORDER BY added_at DESC
        """, (order_id,))
        rows = cursor.fetchall()
        conn.close()
        
        attachments = [dict_from_row(row) for row in rows]
        
        return jsonify({
            'success': True,
            'attachments': attachments,
            'count': len(attachments)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>/attachments', methods=['POST'])
def upload_attachment(order_id):
    """Upload an attachment for an order"""
    try:
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file provided'
            }), 400
        
        file = request.files['file']
        section = request.form.get('section', 'general')
        
        if file.filename == '':
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400
        
        # Get order info to create folder name
        conn = get_db_connection()
        cursor = conn.execute("SELECT customer_name, po_number FROM orders WHERE id = ?", (order_id,))
        order = cursor.fetchone()
        
        if not order:
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
        
        # Create folder name: customer__PO-number or customer__ID-orderid
        def slugify(text):
            import re
            text = str(text).strip().replace(' ', '_')
            return re.sub(r'[^\w\-]', '', text)
        
        customer_slug = slugify(order['customer_name'] or 'customer')
        po = (order['po_number'] or '').strip()
        if po:
            folder_name = f"{customer_slug}__PO-{slugify(po)}"
        else:
            folder_name = f"{customer_slug}__ID-{order_id}"
        
        # Create attachments directory
        attach_base = Path(r"C:\Projects\Order-Tracker\attachments")
        order_dir = attach_base / folder_name
        order_dir.mkdir(parents=True, exist_ok=True)
        
        # Save file
        from werkzeug.utils import secure_filename
        raw_filename = file.filename or ''
        filename = secure_filename(raw_filename)
        file_path = order_dir / filename
        
        # Handle duplicate filenames
        import os
        counter = 1
        while file_path.exists():
            name, ext = os.path.splitext(filename)
            filename = f"{name}_{counter}{ext}"
            file_path = order_dir / filename
            counter += 1
        
        file.save(str(file_path))
        
        # Store in database
        rel_path = f"{folder_name}/{filename}"
        from datetime import datetime
        now = datetime.now().isoformat()
        
        cursor = conn.execute("""
            INSERT INTO attachments (order_id, section, filename, rel_path, added_at)
            VALUES (?, ?, ?, ?, ?)
        """, (order_id, section, filename, rel_path, now))
        conn.commit()
        
        attachment_id = cursor.lastrowid
        conn.close()
        
        return jsonify({
            'success': True,
            'attachment': {
                'id': attachment_id,
                'filename': filename,
                'rel_path': rel_path,
                'section': section,
                'added_at': now
            },
            'message': 'File uploaded successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/attachments/<int:attachment_id>', methods=['DELETE'])
def delete_attachment_endpoint(attachment_id):
    """Delete an attachment"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("SELECT rel_path FROM attachments WHERE id = ?", (attachment_id,))
        row = cursor.fetchone()
        
        if not row:
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Attachment not found'
            }), 404
        
        # Delete physical file
        attach_base = Path(r"C:\Projects\Order-Tracker\attachments")
        file_path = attach_base / row['rel_path']
        
        try:
            if file_path.exists():
                file_path.unlink()
        except Exception as e:
            print(f"Error deleting file: {e}")
        
        # Delete from database
        conn.execute("DELETE FROM attachments WHERE id = ?", (attachment_id,))
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Attachment deleted successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/attachments/<int:attachment_id>/download', methods=['GET'])
def download_attachment(attachment_id):
    """Download an attachment file"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("SELECT filename, rel_path FROM attachments WHERE id = ?", (attachment_id,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return jsonify({
                'success': False,
                'error': 'Attachment not found'
            }), 404
        
        from flask import send_file
        
        attach_base = Path(r"C:\Projects\Order-Tracker\attachments")
        file_path = attach_base / row['rel_path']
        
        if not file_path.exists():
            return jsonify({
                'success': False,
                'error': 'File not found on disk'
            }), 404
        
        return send_file(
            str(file_path),
            as_attachment=True,
            download_name=row['filename']
        )
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>/archive', methods=['PUT'])
def archive_order(order_id):
    """Archive an order (mark as completed)"""
    try:
        conn = get_db_connection()
        
        # Check if order exists
        cursor = conn.execute("SELECT id FROM orders WHERE id = ?", (order_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
        
        # Archive the order
        from datetime import datetime
        now = datetime.now().isoformat()
        conn.execute(
            "UPDATE orders SET archived = 1, updated_at = ? WHERE id = ?",
            (now, order_id)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Order archived successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>/unarchive', methods=['PUT'])
def unarchive_order(order_id):
    """Unarchive an order (restore from completed)"""
    try:
        conn = get_db_connection()
        
        # Check if order exists
        cursor = conn.execute("SELECT id FROM orders WHERE id = ?", (order_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
        
        # Unarchive the order
        from datetime import datetime
        now = datetime.now().isoformat()
        conn.execute(
            "UPDATE orders SET archived = 0, updated_at = ? WHERE id = ?",
            (now, order_id)
        )
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Order restored successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/stages/next/<stage>', methods=['GET'])
def get_next_stage(stage):
    """Get the next stage in sequence"""
    try:
        if stage not in STAGES:
            return jsonify({
                'success': False,
                'error': 'Invalid stage'
            }), 400
        
        current_index = STAGES.index(stage)
        if current_index >= len(STAGES) - 1:
            return jsonify({
                'success': False,
                'error': 'Already at final stage',
                'current': stage
            }), 400
        
        next_stage = STAGES[current_index + 1]
        return jsonify({
            'success': True,
            'next_stage': next_stage,
            'current': stage
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/stages/previous/<stage>', methods=['GET'])
def get_previous_stage(stage):
    """Get the previous stage in sequence"""
    try:
        if stage not in STAGES:
            return jsonify({
                'success': False,
                'error': 'Invalid stage'
            }), 400
        
        current_index = STAGES.index(stage)
        if current_index <= 0:
            return jsonify({
                'success': False,
                'error': 'Already at first stage',
                'current': stage
            }), 400
        
        previous_stage = STAGES[current_index - 1]
        return jsonify({
            'success': True,
            'previous_stage': previous_stage,
            'current': stage
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>/backup', methods=['POST'])
def backup_order_endpoint(order_id):
    """Create a backup of an order (data + attachments)"""
    try:
        conn = get_db_connection()
        
        # Check if order exists
        cursor = conn.execute("SELECT id FROM orders WHERE id = ?", (order_id,))
        if not cursor.fetchone():
            conn.close()
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
        conn.close()
        
        # Call the backup function from data.database
        backup_path = backup_order(order_id)
        
        return jsonify({
            'success': True,
            'message': 'Order backed up successfully',
            'backup_path': str(backup_path)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/backup-all', methods=['POST'])
def backup_all_orders_endpoint():
    """Create backups of all orders"""
    try:
        # Get filters from request
        data = request.get_json() or {}
        include_archived = data.get('include_archived', False)
        
        conn = get_db_connection()
        
        # Build query to get all order IDs
        if include_archived:
            query = "SELECT id FROM orders ORDER BY id"
        else:
            query = "SELECT id FROM orders WHERE (archived IS NULL OR archived = 0) ORDER BY id"
        
        cursor = conn.execute(query)
        order_ids = [row['id'] for row in cursor.fetchall()]
        conn.close()
        
        if not order_ids:
            return jsonify({
                'success': True,
                'message': 'No orders to backup',
                'backed_up': 0,
                'failed': 0
            })
        
        # Backup each order
        backed_up = 0
        failed = 0
        errors = []
        
        for order_id in order_ids:
            try:
                backup_order(order_id)
                backed_up += 1
            except Exception as e:
                failed += 1
                errors.append(f"Order {order_id}: {str(e)}")
        
        return jsonify({
            'success': True,
            'message': f'Backed up {backed_up} orders successfully',
            'backed_up': backed_up,
            'failed': failed,
            'errors': errors[:5] if errors else []  # Limit to first 5 errors
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/orders/<int:order_id>/attachments/download-all', methods=['GET'])
def download_all_attachments(order_id):
    """Download all attachments for an order as a ZIP file"""
    try:
        conn = get_db_connection()
        
        # Get order info for folder name
        order = conn.execute("SELECT customer_name, po_number, id FROM orders WHERE id = ?", (order_id,)).fetchone()
        if not order:
            conn.close()
            return jsonify({'success': False, 'error': 'Order not found'}), 404
        
        # Get all attachments
        cursor = conn.execute("""
            SELECT filename, rel_path
            FROM attachments
            WHERE order_id = ?
            ORDER BY added_at
        """, (order_id,))
        attachments = cursor.fetchall()
        conn.close()
        
        if not attachments:
            return jsonify({'success': False, 'error': 'No attachments found'}), 404
        
        # Create ZIP in memory
        memory_file = io.BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            attachments_dir = Path(r"C:\Projects\Order-Tracker\attachments")
            
            for attachment in attachments:
                file_path = attachments_dir / attachment['rel_path']
                if file_path.exists():
                    # Add file to ZIP with just the filename (no subdirectories)
                    zf.write(file_path, arcname=attachment['filename'])
        
        memory_file.seek(0)
        
        # Generate filename: CustomerName_PO-Number_Attachments.zip
        customer_name = order['customer_name'].replace(' ', '_')
        po_number = order['po_number'] if order['po_number'] else f"ID-{order['id']}"
        zip_filename = f"{customer_name}_{po_number}_Attachments.zip"
        
        return send_file(
            memory_file,
            mimetype='application/zip',
            as_attachment=True,
            download_name=zip_filename
        )
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ===== REMINDERS ENDPOINTS =====

@app.route('/api/reminders', methods=['GET'])
def get_reminders():
    """Get all reminders (optionally filter by done status)"""
    try:
        show_done = request.args.get('show_done', 'false').lower() == 'true'
        order_id = request.args.get('order_id', type=int)
        
        conn = get_db_connection()
        
        query = """
            SELECT r.*, 
                   o.customer_name, o.project_name, o.po_number
            FROM reminders r
            LEFT JOIN orders o ON o.id = r.order_id
            WHERE 1=1
        """
        params = []
        
        if not show_done:
            query += " AND r.done = 0"
        
        if order_id:
            query += " AND r.order_id = ?"
            params.append(order_id)
        
        query += " ORDER BY r.due_at ASC"
        
        cursor = conn.execute(query, params)
        reminders = [dict_from_row(row) for row in cursor.fetchall()]
        conn.close()
        
        return jsonify({
            'success': True,
            'reminders': reminders,
            'count': len(reminders)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/reminders/<int:reminder_id>', methods=['GET'])
def get_reminder(reminder_id):
    """Get a single reminder"""
    try:
        conn = get_db_connection()
        cursor = conn.execute("""
            SELECT r.*, 
                   o.customer_name, o.project_name, o.po_number
            FROM reminders r
            LEFT JOIN orders o ON o.id = r.order_id
            WHERE r.id = ?
        """, (reminder_id,))
        row = cursor.fetchone()
        conn.close()
        
        if row:
            return jsonify({
                'success': True,
                'reminder': dict_from_row(row)
            })
        else:
            return jsonify({
                'success': False,
                'error': 'Reminder not found'
            }), 404
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/reminders', methods=['POST'])
def create_reminder():
    """Create a new reminder"""
    try:
        data = request.get_json()
        
        # Validate required fields
        if not data.get('title'):
            return jsonify({'success': False, 'error': 'Title is required'}), 400
        if not data.get('due_at'):
            return jsonify({'success': False, 'error': 'Due date is required'}), 400
        
        # Insert reminder using database function
        reminder_id = insert_reminder(
            order_id=data.get('order_id'),
            title=data['title'],
            due_iso=data['due_at'],
            repeat=data.get('repeat'),
            guest=data.get('guest')
        )
        
        return jsonify({
            'success': True,
            'reminder_id': reminder_id,
            'message': 'Reminder created successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/reminders/<int:reminder_id>', methods=['PUT'])
def update_reminder(reminder_id):
    """Update an existing reminder"""
    try:
        data = request.get_json()
        
        conn = get_db_connection()
        
        # Build UPDATE query dynamically based on provided fields
        fields = []
        params = []
        
        if 'title' in data:
            fields.append('title = ?')
            params.append(data['title'])
        
        if 'due_at' in data:
            fields.append('due_at = ?')
            params.append(data['due_at'])
        
        if 'repeat' in data:
            fields.append('repeat = ?')
            params.append(data['repeat'])
        
        if 'guest' in data:
            fields.append('guest = ?')
            params.append(data['guest'])
        
        if 'order_id' in data:
            fields.append('order_id = ?')
            params.append(data['order_id'])
        
        if not fields:
            conn.close()
            return jsonify({'success': False, 'error': 'No fields to update'}), 400
        
        # Add updated_at timestamp
        from datetime import datetime
        fields.append('updated_at = ?')
        params.append(datetime.now().isoformat())
        
        # Add reminder_id to params
        params.append(reminder_id)
        
        query = f"UPDATE reminders SET {', '.join(fields)} WHERE id = ?"
        conn.execute(query, params)
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Reminder updated successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/reminders/<int:reminder_id>', methods=['DELETE'])
def delete_reminder(reminder_id):
    """Delete a reminder"""
    try:
        conn = get_db_connection()
        conn.execute("DELETE FROM reminders WHERE id = ?", (reminder_id,))
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'message': 'Reminder deleted successfully'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/reminders/<int:reminder_id>/complete', methods=['PUT'])
def complete_reminder_endpoint(reminder_id):
    """Mark a reminder as complete"""
    try:
        complete_reminder(reminder_id)
        
        return jsonify({
            'success': True,
            'message': 'Reminder marked as complete'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/reminders/<int:reminder_id>/snooze', methods=['PUT'])
def snooze_reminder_endpoint(reminder_id):
    """Snooze a reminder"""
    try:
        data = request.get_json()
        minutes = data.get('minutes', 30)  # Default 30 minutes
        
        snooze_reminder(reminder_id, minutes)
        
        return jsonify({
            'success': True,
            'message': f'Reminder snoozed for {minutes} minutes'
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/reminders/due', methods=['GET'])
def get_due_reminders():
    """Get reminders that are currently due"""
    try:
        reminders = list_due_reminders()
        
        return jsonify({
            'success': True,
            'reminders': reminders,
            'count': len(reminders)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ===== Customer History Endpoint =====

@app.route('/api/customers/history', methods=['GET'])
def get_customer_history():
    """Get recent orders for a customer by name and/or phone."""
    try:
        name = request.args.get('name', '').strip()
        phone = request.args.get('phone', '').strip()
        exclude_id = request.args.get('exclude_id', type=int)
        limit = request.args.get('limit', default=20, type=int)

        if not name and not phone:
            return jsonify({
                'success': False,
                'error': 'Either name or phone is required'
            }), 400

        limit = max(1, min(limit or 20, 100))

        conn = get_db_connection()

        criteria_sql = []
        criteria_params = []

        if name:
            criteria_sql.append("LOWER(TRIM(customer_name)) = LOWER(?)")
            criteria_params.append(name)

        if phone:
            phone_digits = re.sub(r'\D+', '', phone)
            if phone_digits:
                criteria_sql.append("REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') = ?")
                criteria_params.append(phone_digits)
            else:
                criteria_sql.append("TRIM(COALESCE(customer_phone, '')) = ?")
                criteria_params.append(phone)

        where_sql = f"({' OR '.join(criteria_sql)})"
        where_params = list(criteria_params)

        if exclude_id:
            where_sql += " AND id != ?"
            where_params.append(exclude_id)

        query = f"""
            SELECT id, customer_name, customer_phone, project_name, stage,
                   quote_number, quote_total, invoice_number, invoice_total,
                   po_number, po_numbers, archived, updated_at, created_at
              FROM orders
             WHERE {where_sql}
             ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
             LIMIT ?
        """
        where_params.append(limit)

        rows = conn.execute(query, where_params).fetchall()
        conn.close()

        orders = [attach_po_display(dict_from_row(row)) for row in rows]

        return jsonify({
            'success': True,
            'orders': orders,
            'count': len(orders)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ===== Contacts & Auto-Complete Endpoints =====

@app.route('/api/contacts', methods=['GET'])
def get_contacts():
    """Get list of known customer names for autocomplete"""
    try:
        limit = request.args.get('limit', 200, type=int)
        
        conn = get_db_connection()
        cursor = conn.cursor()
        
        rows = cursor.execute("""
            SELECT name FROM (
                SELECT DISTINCT TRIM(customer_name) AS name
                  FROM orders
                 WHERE customer_name IS NOT NULL AND TRIM(customer_name) != ''
                UNION
                SELECT DISTINCT TRIM(guest) AS name
                  FROM reminders
                 WHERE guest IS NOT NULL AND TRIM(guest) != ''
            )
            WHERE name IS NOT NULL AND name != ''
            ORDER BY name COLLATE NOCASE
            LIMIT ?
        """, (limit,)).fetchall()
        
        contacts = [r[0] for r in rows if r and r[0]]
        conn.close()
        
        return jsonify({
            'success': True,
            'contacts': contacts,
            'count': len(contacts)
        })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ===== BULK IMPORT ENDPOINTS =====

@app.route('/api/import/bulk', methods=['POST'])
def bulk_import_json():
    """Import multiple orders from JSON file with duplicate detection"""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400
        
        filename = file.filename or ''
        if not filename.endswith('.json'):
            return jsonify({'success': False, 'error': 'Only JSON files are supported'}), 400
        
        # Parse JSON data
        data = json.loads(file.read())
        
        # Extract customer info
        customer_info = data.get('customer_info', {})
        customer_name = customer_info.get('customer_name', '')
        customer_phone = customer_info.get('phone', '')
        customer_email = customer_info.get('email', '')
        project_name = customer_info.get('project', '')
        raw_po = customer_info.get('po_number') or data.get('po_number') or data.get('po_numbers')
        po_list = normalize_po_numbers(raw_po)
        primary_po = po_list[0] if po_list else None
        po_numbers = ', '.join(po_list) if po_list else None
        items = data.get('items', [])
        
        # Check for duplicate
        duplicate_id = check_duplicate_order(
            customer_name, 
            customer_phone, 
            project_name, 
            len(items),
            primary_po
        )
        
        if duplicate_id:
            return jsonify({
                'success': False,
                'duplicate': True,
                'duplicate_id': duplicate_id,
                'message': f'Duplicate of existing Order #{duplicate_id}'
            }), 200
        
        # Create line_items JSON
        line_items = []
        for item in items:
            line_item = {
                'product': 'Door',
                'quantity': item.get('quantity', ''),
                'width': item.get('width', ''),
                'height': item.get('height', ''),
                'size': f"{item.get('width', '')}x{item.get('height', '')}" if item.get('width') and item.get('height') else '',
                'config': item.get('config', ''),
                'jamb_size': item.get('jamb_size', ''),
                'swing': item.get('swing', ''),
                'hinges': item.get('hinges', ''),
                'boring': item.get('boring', ''),
                'sill_bottom': item.get('sill_bottom', ''),
                'color': item.get('color_finish', ''),
                'glass': item.get('glass_type', ''),
                'hardware': item.get('hardware', ''),
                'special_notes': item.get('special_notes', '')
            }
            line_items.append(line_item)
        
        # Create order
        conn = get_db_connection()
        cursor = conn.cursor()
        
        order_data = {
            'customer_name': customer_name,
            'customer_phone': customer_phone,
            'customer_email': customer_email,
            'project_name': project_name,
            'product_type': 'Door',
            'stage': 'QUOTE_CREATED',
            'po_number': primary_po,
            'po_numbers': po_numbers,
            'line_items': json.dumps(line_items),
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat()
        }
        
        cursor.execute("""
            INSERT INTO orders (
                customer_name, customer_phone, customer_email, project_name,
                product_type, stage, po_number, po_numbers, line_items, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            order_data['customer_name'],
            order_data['customer_phone'],
            order_data['customer_email'],
            order_data['project_name'],
            order_data['product_type'],
            order_data['stage'],
            order_data['po_number'],
            order_data['po_numbers'],
            order_data['line_items'],
            order_data['created_at'],
            order_data['updated_at']
        ))
        
        order_id = cursor.lastrowid
        conn.commit()
        conn.close()
        
        return jsonify({
            'success': True,
            'order_id': order_id,
            'customer_name': customer_name,
            'item_count': len(items),
            'message': f'Successfully imported Order #{order_id}: {customer_name} ({len(items)} door(s))'
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

def check_duplicate_order(
    customer_name: str,
    customer_phone: str,
    project_name: Optional[str] = None,
    item_count: int = 0,
    po_number: Optional[str] = None
):
    """Check if an order with similar details already exists (within last 30 days)"""
    conn = get_db_connection()
    cursor = conn.cursor()
    
    query = """
        SELECT id, customer_name, customer_phone, project_name, po_number, po_numbers, line_items, created_at
        FROM orders
        WHERE LOWER(customer_name) = LOWER(?)
    """
    params = [customer_name.strip()]
    
    # Add phone filter if provided
    if customer_phone and customer_phone.strip():
        query += " AND customer_phone = ?"
        params.append(customer_phone.strip())
    
    # Limit to recent orders (last 30 days)
    query += " AND datetime(created_at) >= datetime('now', '-30 days')"
    query += " ORDER BY created_at DESC LIMIT 10"
    
    rows = cursor.execute(query, params).fetchall()
    
    for row in rows:
        if po_number:
            row_po_numbers = normalize_po_numbers(row['po_numbers'] or row['po_number'])
            has_same_po = any(existing_po.lower() == po_number.lower() for existing_po in row_po_numbers)

            # If a PO is provided, only exact PO matches are treated as duplicates.
            if has_same_po:
                conn.close()
                return row['id']

            continue

        # Check project name match
        if project_name and row['project_name']:
            if row['project_name'].strip().lower() == project_name.strip().lower():
                conn.close()
                return row['id']
        
        # Check line items count match
        if row['line_items']:
            try:
                existing_items = json.loads(row['line_items'])
                if len(existing_items) == item_count and item_count > 0:
                    conn.close()
                    return row['id']
            except:
                pass
    
    conn.close()
    return None

# ===== DOCUMENT GENERATION ENDPOINTS =====

@app.route('/api/orders/<int:order_id>/generate-quote', methods=['POST'])
def generate_quote(order_id):
    """Generate quote document for order"""
    try:
        conn = get_db_connection()
        order = conn.execute('SELECT * FROM orders WHERE id = ?', (order_id,)).fetchone()
        conn.close()
        
        if not order:
            return jsonify({'success': False, 'error': 'Order not found'}), 404
        
        # Return quote data for frontend to display or download
        quote_data = {
            'order_id': order['id'],
            'customer_name': order['customer_name'],
            'customer_phone': order['customer_phone'],
            'customer_email': order['customer_email'],
            'project_name': order['project_name'],
            'quote_number': order['quote_number'],
            'quote_date': order['quote_date'],
            'quote_total': order['quote_total'],
            'items': json.loads(order['line_items']) if order['line_items'] else []
        }
        
        return jsonify({
            'success': True,
            'quote_data': quote_data,
            'message': 'Quote data generated. Use AS400 to create official quote.'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/orders/<int:order_id>/generate-invoice', methods=['POST'])
def generate_invoice(order_id):
    """Generate invoice document for order"""
    try:
        conn = get_db_connection()
        order = conn.execute('SELECT * FROM orders WHERE id = ?', (order_id,)).fetchone()
        conn.close()
        
        if not order:
            return jsonify({'success': False, 'error': 'Order not found'}), 404
        
        invoice_data = {
            'order_id': order['id'],
            'customer_name': order['customer_name'],
            'invoice_number': order['invoice_number'],
            'invoice_date': order['invoice_date'],
            'invoice_total': order['invoice_total'],
            'items': json.loads(order['line_items']) if order['line_items'] else []
        }
        
        return jsonify({
            'success': True,
            'invoice_data': invoice_data,
            'message': 'Invoice data generated. Use AS400 to create official invoice.'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/orders/<int:order_id>/generate-special-order', methods=['POST'])
def generate_special_order(order_id):
    """Generate special order document for order"""
    try:
        conn = get_db_connection()
        order = conn.execute('SELECT * FROM orders WHERE id = ?', (order_id,)).fetchone()
        conn.close()
        
        if not order:
            return jsonify({'success': False, 'error': 'Order not found'}), 404
        
        so_data = {
            'order_id': order['id'],
            'customer_name': order['customer_name'],
            'vendor': order['vendor'],
            'po_number': order['po_number'],
            'po_numbers': order['po_numbers'] if 'po_numbers' in order.keys() else order['po_number'],
            'items': json.loads(order['line_items']) if order['line_items'] else []
        }
        
        return jsonify({
            'success': True,
            'so_data': so_data,
            'message': 'Special Order data generated. Use AS400 to create official special order.'
        })
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ===== CONTACTS ENDPOINTS =====

@app.route('/api/contacts/info', methods=['GET'])
def get_contact_info():
    """Get customer info by phone or name for auto-fill"""
    try:
        phone = request.args.get('phone', '').strip()
        name = request.args.get('name', '').strip()
        
        if not phone and not name:
            return jsonify({
                'success': False,
                'error': 'Either phone or name parameter required'
            }), 400
        
        conn = get_db_connection()
        cursor = conn.cursor()

        def _profile_payload(row):
            payload = dict_from_row(row)
            return {
                'customer_name': payload.get('customer_name'),
                'customer_phone': payload.get('customer_phone'),
                'customer_email': payload.get('customer_email'),
                'customer_number': payload.get('customer_number'),
                'has_customer_account': 1 if str(payload.get('customer_number') or '').strip() else 0,
                'customer_profile_id': payload.get('id'),
                'default_project_notes': payload.get('default_project_notes'),
                'project_name': payload.get('last_project_name'),
            }

        # Try customer profile table first.
        if phone:
            phone_digits = normalize_phone_digits(phone)
            row = cursor.execute(
                """
                SELECT id, customer_name, customer_phone, customer_email,
                       customer_number, default_project_notes,
                       NULL AS last_project_name
                  FROM customer_profiles
                 WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') = ?
                 ORDER BY datetime(updated_at) DESC, id DESC
                 LIMIT 1
                """,
                (phone_digits,),
            ).fetchone()
            if row:
                conn.close()
                return jsonify({'success': True, 'info': _profile_payload(row)})

        if name:
            row = cursor.execute(
                """
                SELECT id, customer_name, customer_phone, customer_email,
                       customer_number, default_project_notes,
                       NULL AS last_project_name
                  FROM customer_profiles
                 WHERE LOWER(TRIM(customer_name)) = LOWER(?)
                 ORDER BY datetime(updated_at) DESC, id DESC
                 LIMIT 1
                """,
                (name,),
            ).fetchone()
            if row:
                conn.close()
                return jsonify({'success': True, 'info': _profile_payload(row)})
        
        # Try phone first (more reliable)
        if phone:
            row = cursor.execute("""
                  SELECT customer_name, customer_phone, customer_email, project_name,
                      customer_number, has_customer_account, customer_profile_id
                FROM orders
                WHERE customer_phone = ?
                ORDER BY updated_at DESC
                LIMIT 1
            """, (phone,)).fetchone()
            
            if row:
                info = dict(row)
                conn.close()
                return jsonify({
                    'success': True,
                    'info': info
                })
        
        # Fall back to name match
        if name:
            row = cursor.execute("""
                  SELECT customer_name, customer_phone, customer_email, project_name,
                      customer_number, has_customer_account, customer_profile_id
                FROM orders
                WHERE LOWER(TRIM(customer_name)) = LOWER(?)
                ORDER BY updated_at DESC
                LIMIT 1
            """, (name,)).fetchone()
            
            if row:
                info = dict(row)
                conn.close()
                return jsonify({
                    'success': True,
                    'info': info
                })
        
        conn.close()
        return jsonify({
            'success': False,
            'error': 'Customer not found'
        }), 404
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/customers/search', methods=['GET'])
def search_customers():
    """Search customer directory regardless of active/completed order state."""
    try:
        query = request.args.get('q', '').strip()
        limit = request.args.get('limit', default=25, type=int)
        include_recent = request.args.get('include_recent', 'false').lower() == 'true'
        has_account_only = request.args.get('has_account_only', 'false').lower() == 'true'

        if len(query) < 2 and not include_recent:
            return jsonify({'success': True, 'customers': [], 'count': 0})

        limit = max(1, min(limit or 25, 100))
        query_like = f"%{query}%"

        query_digits = re.sub(r'\D+', '', query)

        conn = get_db_connection()
        params = []
        where_clauses = [
            "customer_name IS NOT NULL",
            "TRIM(customer_name) != ''",
        ]

        if has_account_only:
            where_clauses.append("customer_number IS NOT NULL AND TRIM(customer_number) != ''")

        if len(query) >= 2:
            search_clause = """
                (
                    customer_name LIKE ?
                    OR COALESCE(customer_phone, '') LIKE ?
                    OR COALESCE(customer_email, '') LIKE ?
                    OR COALESCE(customer_number, '') LIKE ?
                )
            """
            params.extend([query_like, query_like, query_like, query_like])

            if query_digits:
                search_clause = """
                    (
                        customer_name LIKE ?
                        OR COALESCE(customer_phone, '') LIKE ?
                        OR COALESCE(customer_email, '') LIKE ?
                        OR COALESCE(customer_number, '') LIKE ?
                        OR REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') LIKE ?
                    )
                """
                params.append(f"%{query_digits}%")

            where_clauses.append(search_clause)

        sql = f"""
            SELECT id, customer_name, customer_phone, customer_email, customer_number,
                   project_name, stage, updated_at, created_at, archived, customer_profile_id
              FROM orders
             WHERE {' AND '.join(where_clauses)}
             ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
             LIMIT 500
        """

        rows = conn.execute(sql, params).fetchall()

        customers = []
        seen_keys = set()

        for row in rows:
            item = dict_from_row(row)
            name_key = str(item.get('customer_name') or '').strip().lower()
            number_key = str(item.get('customer_number') or '').strip()
            phone_key = re.sub(r'\D+', '', str(item.get('customer_phone') or ''))
            dedupe_key = (name_key, number_key or phone_key)

            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)

            customers.append({
                'customer_name': item.get('customer_name'),
                'customer_phone': item.get('customer_phone'),
                'customer_email': item.get('customer_email'),
                'customer_number': item.get('customer_number'),
                'customer_profile_id': item.get('customer_profile_id'),
                'last_project_name': item.get('project_name'),
                'last_stage': item.get('stage'),
                'last_order_id': item.get('id'),
                'archived': item.get('archived'),
                'last_updated': item.get('updated_at') or item.get('created_at')
            })

            if len(customers) >= limit:
                break

        # Enrich with profile IDs/default notes where available.
        if customers:
            numbers = sorted({str(c.get('customer_number') or '').strip() for c in customers if str(c.get('customer_number') or '').strip()})
            profile_ids = sorted({int(c.get('customer_profile_id')) for c in customers if c.get('customer_profile_id')})
            by_number = {}
            by_id = {}

            if profile_ids:
                placeholders = ','.join('?' for _ in profile_ids)
                profile_rows = conn.execute(
                    f"""
                    SELECT id, customer_number, customer_name, customer_phone, default_project_notes, updated_at
                      FROM customer_profiles
                     WHERE id IN ({placeholders})
                     ORDER BY datetime(updated_at) DESC, id DESC
                    """,
                    profile_ids,
                ).fetchall()
                for profile_row in profile_rows:
                    profile_item = dict_from_row(profile_row)
                    by_id[profile_item['id']] = profile_item

            if numbers:
                placeholders = ','.join('?' for _ in numbers)
                profile_rows = conn.execute(
                    f"""
                    SELECT id, customer_number, customer_name, customer_phone, default_project_notes, updated_at
                      FROM customer_profiles
                     WHERE customer_number IN ({placeholders})
                     ORDER BY datetime(updated_at) DESC, id DESC
                    """,
                    numbers,
                ).fetchall()
                for profile_row in profile_rows:
                    profile_item = dict_from_row(profile_row)
                    key = str(profile_item.get('customer_number') or '').strip()
                    if key and key not in by_number:
                        by_number[key] = profile_item

            for customer in customers:
                profile = None
                customer_profile_id = customer.get('customer_profile_id')
                if customer_profile_id and int(customer_profile_id) in by_id:
                    profile = by_id[int(customer_profile_id)]

                number = str(customer.get('customer_number') or '').strip()
                if not profile and number and number in by_number:
                    profile = by_number[number]

                if profile:
                    customer['customer_profile_id'] = customer.get('customer_profile_id') or profile.get('id')
                    customer['default_project_notes'] = profile.get('default_project_notes')

        # Lightweight ranking when querying by text: exact name/number matches bubble to the top.
        if len(query) >= 2:
            lowered = query.lower()

            def rank(item):
                name = str(item.get('customer_name') or '').lower()
                number = str(item.get('customer_number') or '').lower()
                phone = normalize_phone_digits(item.get('customer_phone'))
                score = 0
                if number and lowered == number:
                    score += 300
                if name and lowered == name:
                    score += 200
                if name.startswith(lowered):
                    score += 120
                if number.startswith(lowered):
                    score += 90
                if query_digits and phone and phone.startswith(query_digits):
                    score += 80
                if lowered in name:
                    score += 40
                return score

            customers.sort(key=lambda c: (rank(c), c.get('last_updated') or ''), reverse=True)
            customers = customers[:limit]

        conn.close()

        return jsonify({
            'success': True,
            'customers': customers,
            'count': len(customers)
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@app.route('/api/customers/profile', methods=['GET'])
def get_customer_profile():
    """Return customer profile details with full order history."""
    try:
        profile_id = request.args.get('customer_profile_id', type=int)
        customer_number = request.args.get('customer_number', '').strip()
        name = request.args.get('name', '').strip()
        phone = request.args.get('phone', '').strip()

        conn = get_db_connection()
        row = None

        if profile_id:
            row = conn.execute("SELECT * FROM customer_profiles WHERE id = ?", (profile_id,)).fetchone()
        elif customer_number:
            row = conn.execute(
                "SELECT * FROM customer_profiles WHERE customer_number = ? ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1",
                (customer_number,),
            ).fetchone()
        elif name:
            row = conn.execute(
                "SELECT * FROM customer_profiles WHERE LOWER(TRIM(customer_name)) = LOWER(?) ORDER BY datetime(updated_at) DESC, id DESC LIMIT 1",
                (name,),
            ).fetchone()

        order_clauses = []
        order_params = []

        if row:
            profile = dict_from_row(row)
        else:
            # Fallback: infer from orders when profile row does not yet exist.
            if not (name or phone or customer_number):
                conn.close()
                return jsonify({'success': False, 'error': 'Profile identifier required'}), 400

            if customer_number:
                order_clauses.append("COALESCE(customer_number, '') = ?")
                order_params.append(customer_number)
            if name:
                order_clauses.append("LOWER(TRIM(customer_name)) = LOWER(?)")
                order_params.append(name)
            if phone:
                order_clauses.append("REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') = ?")
                order_params.append(normalize_phone_digits(phone))

            order_rows = conn.execute(
                f"""
                SELECT *
                  FROM orders
                 WHERE {' OR '.join(order_clauses)}
                 ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
                 LIMIT 200
                """,
                order_params,
            ).fetchall()

            if not order_rows:
                conn.close()
                return jsonify({'success': False, 'error': 'Customer profile not found'}), 404

            latest = dict_from_row(order_rows[0])
            inferred_payload = {
                'customer_name': latest.get('customer_name'),
                'customer_phone': latest.get('customer_phone'),
                'customer_email': latest.get('customer_email'),
                'customer_number': latest.get('customer_number'),
            }
            persisted_profile_id = upsert_customer_profile(conn, inferred_payload)
            row = conn.execute("SELECT * FROM customer_profiles WHERE id = ?", (persisted_profile_id,)).fetchone()
            profile = dict_from_row(row) if row else {
                'id': persisted_profile_id,
                'customer_name': latest.get('customer_name'),
                'customer_phone': latest.get('customer_phone'),
                'customer_email': latest.get('customer_email'),
                'customer_number': latest.get('customer_number'),
                'default_project_notes': None,
                'created_at': latest.get('created_at'),
                'updated_at': latest.get('updated_at'),
            }

        if profile.get('id'):
            order_clauses.append("customer_profile_id = ?")
            order_params.append(profile['id'])
        if profile.get('customer_number'):
            order_clauses.append("COALESCE(customer_number, '') = ?")
            order_params.append(profile['customer_number'])
        if profile.get('customer_name'):
            order_clauses.append("LOWER(TRIM(customer_name)) = LOWER(?)")
            order_params.append(profile['customer_name'])
        if profile.get('customer_phone'):
            order_clauses.append("REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(customer_phone, ''), '-', ''), '(', ''), ')', ''), ' ', '') = ?")
            order_params.append(normalize_phone_digits(profile['customer_phone']))

        order_rows = conn.execute(
            f"""
            SELECT *
              FROM orders
             WHERE {' OR '.join(order_clauses)}
             ORDER BY datetime(COALESCE(updated_at, created_at)) DESC, id DESC
             LIMIT 200
            """,
            order_params,
        ).fetchall()

        orders = [attach_po_display(dict_from_row(o)) for o in order_rows]
        conn.close()

        return jsonify({
            'success': True,
            'profile': profile,
            'orders': orders,
            'count': len(orders)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/customers/profile', methods=['PUT'])
def update_customer_profile():
    """Update persisted customer profile fields such as default project notes."""
    try:
        data = request.get_json() or {}
        profile_id = data.get('customer_profile_id')

        if not profile_id:
            return jsonify({'success': False, 'error': 'customer_profile_id is required'}), 400

        conn = get_db_connection()
        existing = conn.execute("SELECT * FROM customer_profiles WHERE id = ?", (profile_id,)).fetchone()
        if not existing:
            conn.close()
            return jsonify({'success': False, 'error': 'Profile not found'}), 404

        update_fields = {}
        for field in ('customer_name', 'customer_phone', 'customer_email', 'customer_number', 'default_project_notes'):
            if field in data:
                update_fields[field] = data.get(field)

        if not update_fields:
            conn.close()
            return jsonify({'success': False, 'error': 'No valid profile fields provided'}), 400

        next_name = update_fields.get('customer_name', existing['customer_name'])
        next_phone = update_fields.get('customer_phone', existing['customer_phone'])
        next_number = update_fields.get('customer_number', existing['customer_number'])
        update_fields['profile_key'] = build_customer_profile_key(next_name, next_phone, next_number)
        update_fields['updated_at'] = datetime.now().isoformat()

        set_clause = ', '.join(f"{field} = ?" for field in update_fields.keys())
        values = list(update_fields.values()) + [profile_id]
        conn.execute(f"UPDATE customer_profiles SET {set_clause} WHERE id = ?", values)
        conn.commit()

        row = conn.execute("SELECT * FROM customer_profiles WHERE id = ?", (profile_id,)).fetchone()
        conn.close()

        return jsonify({'success': True, 'profile': dict_from_row(row)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/desktop-helper/health', methods=['GET'])
def desktop_helper_health_proxy():
    """Proxy desktop helper health checks through the web API."""
    if DESKTOP_HELPER_LOCAL_ONLY and not _is_local_request():
        return jsonify({'success': False, 'error': 'Desktop helper access is local-only'}), 403
    if not _is_admin():
        return jsonify({'success': False, 'error': 'Admin role required'}), 403
    data, status = call_desktop_helper('health', method='GET', timeout=1.0)
    return jsonify(data), status


@app.route('/api/desktop-helper/<action>', methods=['POST'])
def desktop_helper_action_proxy(action):
    """Proxy approved desktop helper AS400 actions through the web API."""
    if DESKTOP_HELPER_LOCAL_ONLY and not _is_local_request():
        return jsonify({'success': False, 'error': 'Desktop helper access is local-only'}), 403
    if not _is_admin():
        return jsonify({'success': False, 'error': 'Admin role required'}), 403

    allowed_actions = {
        'launch-quote',
        'launch-invoice',
        'launch-special-order',
        'open-quote',
        'open-invoice',
        'open-special-order',
    }

    if action not in allowed_actions:
        return jsonify({'success': False, 'error': 'Unsupported desktop helper action'}), 404

    payload = request.get_json() or {}
    data, status = call_desktop_helper(action, method='POST', payload=payload, timeout=20.0)
    return jsonify(data), status


# ===== OCR PROCESSING ENDPOINT =====

@app.route('/api/ocr/process-pdf', methods=['POST'])
def ocr_process_pdf():
    """Process a PDF file with OCR and extract text/data"""
    if not HAS_OCR:
        return jsonify({
            'success': False,
            'error': 'OCR functionality not available. Install pytesseract and Tesseract-OCR.'
        }), 500
    
    try:
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file provided'
            }), 400
        
        file = request.files['file']
        
        if not file.filename:
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400
        
        if not file.filename.lower().endswith('.pdf'):
            return jsonify({
                'success': False,
                'error': 'Only PDF files are supported'
            }), 400
        
        # Save to temporary file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_file:
            file.save(tmp_file.name)
            tmp_path = tmp_file.name
        
        try:
            # Extract text from PDF
            if ocr_pdf is None or process_bulk_form_pdf is None:
                return jsonify({
                    'success': False,
                    'error': 'OCR functionality not available. Install pytesseract and Tesseract-OCR.'
                }), 500

            all_text, page_texts = ocr_pdf(tmp_path)
            
            if not all_text or len(all_text.strip()) < 50:
                return jsonify({
                    'success': False,
                    'error': 'Could not extract sufficient text from PDF'
                }), 400
            
            # DEBUG: Show extracted text
            print("\n" + "="*80)
            print("DEBUG: EXTRACTED TEXT FROM PDF:")
            print("="*80)
            print(all_text[:1000])  # First 1000 characters
            print("="*80 + "\n")
            
            # Try to parse as bulk form
            result = process_bulk_form_pdf(tmp_path)
            
            print(f"DEBUG: process_bulk_form_pdf returned: {result}")
            print(f"DEBUG: result type: {type(result)}")
            if 'orders' in result:
                print(f"DEBUG: orders type: {type(result['orders'])}")
                print(f"DEBUG: First order data: {result['orders'][0] if result['orders'] else 'empty'}")
            
            if 'error' in result:
                # Return raw text if parsing fails
                return jsonify({
                    'success': True,
                    'raw_text': all_text,
                    'page_count': len(page_texts),
                    'parsed': False,
                    'message': 'Text extracted but could not parse as order form'
                })
            
            return jsonify({
                'success': True,
                'parsed': True,
                'data': result,
                'raw_text': all_text,
                'page_count': len(page_texts)
            })
        
        finally:
            # Clean up temp file
            try:
                os.unlink(tmp_path)
            except:
                pass
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'OCR processing error: {str(e)}'
        }), 500


if __name__ == '__main__':
    # First-run bootstrap: create parent folder/db file and initialize schema if needed.
    if not DB_PATH.exists():
        print(f"Database not found at {DB_PATH}; creating a new database...")

        conn = get_db_connection()
        ensure_orders_schema(conn)
        ensure_order_notes_schema(conn)
        ensure_attachments_schema(conn)
        ensure_reminders_schema(conn)
        ensure_customer_profiles_schema(conn)
        ensure_item_style_options_schema(conn)
        ensure_item_vendor_options_schema(conn)
        conn.close()
        print("Database initialized successfully.")
    
    print(f"Connected to database: {DB_PATH}")
    print("Starting Flask server...")
    print("Open http://localhost:5000 in your browser")
    
    _production = os.environ.get('ORDER_TRACKER_PRODUCTION', '0').strip().lower() in ('1', 'true', 'yes', 'on')
    _port = int(os.environ.get('PORT', '5000'))
    _host = os.environ.get('ORDER_TRACKER_HOST', '127.0.0.1')

    if _production:
        from waitress import serve
        print(f'Starting production server on {_host}:{_port} ...')
        serve(app, host=_host, port=_port, threads=4)
    else:
        print(f'Starting development server on http://localhost:{_port} ...')
        app.run(debug=True, host='127.0.0.1', port=_port)
