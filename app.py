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
from blueprints.orders import orders_bp
app.register_blueprint(orders_bp)



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

