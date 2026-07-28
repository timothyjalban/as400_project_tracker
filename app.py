"""
Flask backend for Order Tracker Web App
Connects to existing SQLite database and provides REST API
"""
from flask import Flask, jsonify, render_template, request, send_file, session, redirect, url_for
from flask_cors import CORS
import csv
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
from data.database import ensure_reminders_schema, backup_order
import tempfile
import os
import urllib.request
import urllib.error


from data import config

print("DB PATH:", config.DB_PATH)



try:
    from data.vendors import COMMON_VENDORS
except Exception:
    COMMON_VENDORS = []


app = Flask(__name__)

# CORS: only enabled when an explicit allowlist is configured via env.
# When frontend and API share the same origin (typical deploy), CORS is not needed.
_cors_origins_raw = os.environ.get('ORDER_TRACKER_ALLOWED_ORIGINS', '').strip()
if _cors_origins_raw:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(',') if o.strip()]
    CORS(app, origins=_cors_origins, supports_credentials=True)
# else: no cross-origin access permitted

logger = logging.getLogger(__name__)

# Rate limiter - keyed on remote IP so brute-force attempts are blocked per-client.
try:
    from flask_limiter import Limiter
    from flask_limiter.util import get_remote_address
    _limiter = Limiter(
        key_func=get_remote_address,
        app=app,
        default_limits=[],          # no blanket limit; only routes we decorate
        storage_uri='memory://',    # upgrade to redis:// in multi-process deploys
    )
except ImportError:
    class _NoopLimiter:
        def limit(self, *_args, **_kwargs):
            def decorator(func):
                return func
            return decorator

    _limiter = _NoopLimiter()
    logger.warning('flask_limiter is not installed; login rate limiting is disabled')

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


from core import (
    AUTH_DISABLE_LOGIN,
    DESKTOP_HELPER_LOCAL_ONLY,
    _is_local_request,
    _is_admin,
    DB_PATH,
    DESKTOP_HELPER_BASE_URL,
    call_desktop_helper,
    STAGES,
    compute_stage_priority,
    coerce_optional_int,
    ITEM_STYLE_DEFAULTS,
    ITEM_VENDOR_DEFAULTS,
    VENDOR_SERIES_DEFAULTS,
    FIN_TYPE_DEFAULTS,
    FIN_TYPE_ALIASES,
    normalize_fin_type_name,
    get_vendor_catalog,
    get_db_connection,
    ensure_orders_schema,
    ensure_order_notes_schema,
    ensure_attachments_schema,
    ensure_customer_profiles_schema,
    normalize_phone_digits,
    build_customer_profile_key,
    upsert_customer_profile,
    ensure_item_style_options_schema,
    fetch_item_style_options,
    ensure_item_vendor_options_schema,
    fetch_item_vendor_options,
    ensure_vendor_series_options_schema,
    fetch_vendor_series_options,
    ensure_fin_type_options_schema,
    fetch_fin_type_options,
    ensure_window_color_options_schema,
    fetch_window_color_options,
    normalize_po_numbers,
    apply_po_fields,
    attach_po_display,
    dict_from_row,
    get_runtime_mode,
    _coerce_bool,
    _quote_identifier,
    _table_exists,
    _table_columns,
    _upsert_table_rows,
)
from blueprints.reminders import reminders_bp
app.register_blueprint(reminders_bp)
from blueprints.ocr import ocr_bp
app.register_blueprint(ocr_bp)
from blueprints.attachments import attachments_bp
app.register_blueprint(attachments_bp)
from blueprints.notes import notes_bp
app.register_blueprint(notes_bp)
from blueprints.line_item_options import line_item_options_bp
app.register_blueprint(line_item_options_bp)
from blueprints.customers import customers_bp
app.register_blueprint(customers_bp)
from blueprints.documents import documents_bp
app.register_blueprint(documents_bp)
from blueprints.import_export import import_export_bp
app.register_blueprint(import_export_bp)



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


def _is_authenticated() -> bool:
    if AUTH_DISABLE_LOGIN:
        return True
    return bool(session.get('username'))


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


@app.route('/')
def index():
    """Serve the main HTML page"""
    if not _is_authenticated():
        return render_template('login.html', error=None, next_url='/')

    runtime_mode = get_runtime_mode()
    runtime_mode_class = 'runtime-badge-local' if runtime_mode == 'LOCAL' else 'runtime-badge-live'
    return render_template(
        'index.html',
        runtime_mode=runtime_mode,
        runtime_mode_class=runtime_mode_class
    )


@app.route('/login', methods=['GET', 'POST'])
@_limiter.limit('15 per minute; 50 per hour', methods=['POST'])
def login():
    if AUTH_DISABLE_LOGIN:
        return redirect(request.args.get('next', '/') or '/')

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
    
    conn = None
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
        
        return jsonify({
            'success': True,
            'orders': orders,
            'count': len(orders)
        })
    
    except Exception as e:
        logger.exception('get_orders failed (search=%r, stage=%r, show_completed=%r)', search, stage, show_completed)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

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
    conn = None
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400

        apply_po_fields(data)

        auto_added_has_customer_account = False
        if 'customer_number' in data and 'has_customer_account' not in data:
            data['has_customer_account'] = 1 if str(data.get('customer_number') or '').strip() else 0
            auto_added_has_customer_account = True
        
        conn = get_db_connection()

        # Pull current values so we can preserve manual-priority overrides.
        existing_row = conn.execute(
            "SELECT * FROM orders WHERE id = ?",
            (order_id,)
        ).fetchone()

        if not existing_row:
            return jsonify({
                'success': False,
                'error': 'Order not found'
            }), 404
        
        # Get current table columns
        cursor = conn.execute("PRAGMA table_info(orders)")
        columns = {row[1] for row in cursor.fetchall()}
        
        # Filter data to only include fields that exist in the database
        update_fields = {k: v for k, v in data.items() if k in columns and k != 'id'}

        # The main order edit form always submits a full, freshly-populated snapshot of
        # every field (see showOrderModal in app.js), so a blank there means the user
        # deliberately cleared it and must be saved as-is. Only narrow, partial-update
        # callers (quick inline edits that intentionally omit unrelated fields) still get
        # the blank-preserve safety net below, since those can't be trusted to represent
        # an intentional clear of a field they weren't even editing.
        full_form_save = bool(data.get('_full_form_save'))

        # Stale/hidden forms can send blank customer fields while the visible inline
        # fields still contain the real values. Never let those blanks wipe saved data.
        blank_preserve_fields = set() if full_form_save else {
            'customer_name',
            'customer_phone',
            'customer_email',
            'customer_number',
            'project_name',
            'quote_number',
            'quote_date',
            'quote_total',
            'quote_number_2',
            'quote_date_2',
            'quote_total_2',
            'invoice_number',
            'invoice_date',
            'invoice_total',
            'po_numbers',
            'po_date_signed',
            'vendor_ack_number',
            'vendor_ack_total',
            'eta_date',
        }
        for field in blank_preserve_fields:
            if field not in update_fields:
                continue
            if str(update_fields.get(field) or '').strip():
                continue

            existing_value = str(existing_row[field] or '').strip() if field in existing_row.keys() else ''
            if existing_value or field != 'customer_name':
                update_fields.pop(field, None)
            else:
                return jsonify({
                    'success': False,
                    'error': 'Customer name is required'
                }), 400

        if auto_added_has_customer_account and 'customer_number' not in update_fields:
            update_fields.pop('has_customer_account', None)
        # If a quote number is newly set and quote_date is blank, auto-stamp today.
        if 'quote_number' in columns and 'quote_date' in columns and 'quote_number' in update_fields:
            incoming_quote = str(update_fields.get('quote_number') or '').strip()
            existing_quote = str(existing_row['quote_number'] or '').strip()
            existing_quote_date = str(existing_row['quote_date'] or '').strip()
            incoming_quote_date = str(update_fields.get('quote_date') or '').strip() if 'quote_date' in update_fields else ''

            if incoming_quote and incoming_quote != existing_quote and not existing_quote_date and not incoming_quote_date:
                update_fields['quote_date'] = datetime.now().date().isoformat()

        # If an invoice number is newly set and invoice_date is blank, auto-stamp today.
        if 'invoice_number' in columns and 'invoice_date' in columns and 'invoice_number' in update_fields:
            incoming_invoice = str(update_fields.get('invoice_number') or '').strip()
            existing_invoice = str(existing_row['invoice_number'] or '').strip()
            existing_invoice_date = str(existing_row['invoice_date'] or '').strip()
            incoming_invoice_date = str(update_fields.get('invoice_date') or '').strip() if 'invoice_date' in update_fields else ''

            if incoming_invoice and incoming_invoice != existing_invoice and not existing_invoice_date and not incoming_invoice_date:
                update_fields['invoice_date'] = datetime.now().date().isoformat()

        # If PO/special-order number is newly set and PO date is blank, auto-stamp today.
        if 'po_date_signed' in columns and ('po_number' in update_fields or 'po_numbers' in update_fields):
            incoming_po = str(update_fields.get('po_numbers') or update_fields.get('po_number') or '').strip()
            existing_po = str(existing_row['po_numbers'] or existing_row['po_number'] or '').strip()
            existing_po_date = str(existing_row['po_date_signed'] or '').strip()
            incoming_po_date = str(update_fields.get('po_date_signed') or '').strip() if 'po_date_signed' in update_fields else ''

            if incoming_po and incoming_po != existing_po and not existing_po_date and not incoming_po_date:
                update_fields['po_date_signed'] = datetime.now().date().isoformat()

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
        payload_keys = sorted(list((data or {}).keys())) if 'data' in locals() and isinstance(data, dict) else []
        logger.exception('update_order failed (order_id=%s, payload_keys=%s)', order_id, payload_keys)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass

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

        # Compatibility normalization for OCR/import payload variants.
        if not data.get('customer_phone') and data.get('phone'):
            data['customer_phone'] = data.get('phone')
        if not data.get('customer_email') and data.get('email'):
            data['customer_email'] = data.get('email')
        if not data.get('address_street') and data.get('address'):
            data['address_street'] = data.get('address')

        if not data.get('line_items') and data.get('bulk_items'):
            bulk_items = data.get('bulk_items')
            if isinstance(bulk_items, str):
                try:
                    bulk_items = json.loads(bulk_items)
                except Exception:
                    bulk_items = []

            if isinstance(bulk_items, list):
                normalized_items = []
                for item in bulk_items:
                    if not isinstance(item, dict):
                        continue
                    normalized_items.append({
                        'product': item.get('product') or 'Door',
                        'quantity': item.get('quantity', ''),
                        'width': item.get('width', ''),
                        'height': item.get('height', ''),
                        'size': item.get('size') or (f"{item.get('width', '')}x{item.get('height', '')}" if item.get('width') and item.get('height') else ''),
                        'config': item.get('config', ''),
                        'jamb_size': item.get('jamb_size', ''),
                        'swing': item.get('swing', ''),
                        'hinges': item.get('hinges', ''),
                        'boring': item.get('boring', ''),
                        'sill_bottom': item.get('sill_bottom', ''),
                        'color': item.get('color') or item.get('color_finish', ''),
                        'glass': item.get('glass') or item.get('glass_type', ''),
                        'hardware': item.get('hardware', ''),
                        'special_notes': item.get('special_notes', ''),
                    })

                if normalized_items:
                    data['line_items'] = json.dumps(normalized_items)

        apply_po_fields(data)

        auto_added_has_customer_account = False
        if 'customer_number' in data and 'has_customer_account' not in data:
            data['has_customer_account'] = 1 if str(data.get('customer_number') or '').strip() else 0
            auto_added_has_customer_account = True

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
        app.run(debug=False, host=_host, port=_port, use_reloader=False)

