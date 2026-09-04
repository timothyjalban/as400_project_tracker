"""Line-item field config: user-editable dropdown choices + field labels.

Backs the inline "edit choices" control on each managed dropdown and the
"Line-Item Fields" settings screen. Storage + seeding live in core.py
(line_item_field_options / line_item_field_labels); the frontend cache is
static/js/field-config.js.

Every mutating route returns the whole refreshed {options, labels} so the
frontend can replace its cache wholesale (same contract as the item-style
option routes in blueprints/line_item_options.py).
"""
from __future__ import annotations

import json

from flask import Blueprint, Response, jsonify, request

from core import (
    export_line_item_field_config,
    fetch_line_item_field_config,
    get_db_connection,
    import_line_item_field_config,
    reorder_line_item_field_options,
    reset_line_item_field_config,
    set_line_item_field_label,
    set_line_item_field_option_active,
    update_line_item_field_option,
    upsert_line_item_field_option,
)

field_config_bp = Blueprint('field_config', __name__)

BASE = '/api/line-item-field-config'


def _config_response(conn):
    return jsonify({'success': True, **fetch_line_item_field_config(conn)})


def _fail(message, status=400):
    return jsonify({'success': False, 'error': message}), status


@field_config_bp.route(BASE, methods=['GET'])
def get_field_config():
    conn = get_db_connection()
    try:
        return _config_response(conn)
    finally:
        conn.close()


@field_config_bp.route(f'{BASE}/options', methods=['POST'])
def create_field_option():
    data = request.get_json(silent=True) or {}
    field_key = str(data.get('field_key', '')).strip()
    value = str(data.get('value', '')).strip()
    if not field_key or not value:
        return _fail('field_key and value are required')
    conn = get_db_connection()
    try:
        upsert_line_item_field_option(
            conn, field_key, value,
            item_scope=data.get('item_scope') or '*',
            display_label=data.get('display_label'),
            as400_text=data.get('as400_text'),
            vendor=data.get('vendor') or '',
        )
        return _config_response(conn)
    except ValueError as exc:
        return _fail(str(exc))
    finally:
        conn.close()


@field_config_bp.route(f'{BASE}/options/<int:option_id>', methods=['PUT'])
def edit_field_option(option_id):
    data = request.get_json(silent=True) or {}
    conn = get_db_connection()
    try:
        update_line_item_field_option(
            conn, option_id,
            value=data.get('value'),
            display_label=data.get('display_label'),
            as400_text=data.get('as400_text'),
            active=data.get('active'),
            vendor=data.get('vendor'),
        )
        return _config_response(conn)
    finally:
        conn.close()


@field_config_bp.route(f'{BASE}/options/<int:option_id>', methods=['DELETE'])
def delete_field_option(option_id):
    hard = request.args.get('hard') in ('1', 'true', 'yes')
    conn = get_db_connection()
    try:
        set_line_item_field_option_active(conn, option_id, active=False, hard=hard)
        return _config_response(conn)
    finally:
        conn.close()


@field_config_bp.route(f'{BASE}/options/reorder', methods=['PUT'])
def reorder_field_options():
    data = request.get_json(silent=True) or {}
    field_key = str(data.get('field_key', '')).strip()
    item_scope = str(data.get('item_scope', '*')).strip() or '*'
    ordered_ids = data.get('ordered_ids')
    if not field_key or not isinstance(ordered_ids, list):
        return _fail('field_key and ordered_ids[] are required')
    conn = get_db_connection()
    try:
        reorder_line_item_field_options(conn, field_key, item_scope, [int(i) for i in ordered_ids])
        return _config_response(conn)
    finally:
        conn.close()


@field_config_bp.route(f'{BASE}/labels/<field_key>', methods=['PUT'])
def set_field_label(field_key):
    data = request.get_json(silent=True) or {}
    conn = get_db_connection()
    try:
        set_line_item_field_label(
            conn, field_key, data.get('label', ''),
            item_scope=str(data.get('item_scope', '*')).strip() or '*',
        )
        return _config_response(conn)
    finally:
        conn.close()


@field_config_bp.route(f'{BASE}/reset', methods=['POST'])
def reset_field_config():
    data = request.get_json(silent=True) or {}
    field_key = (str(data.get('field_key', '')).strip() or None)
    conn = get_db_connection()
    try:
        reset_line_item_field_config(conn, field_key)
        return _config_response(conn)
    finally:
        conn.close()


@field_config_bp.route(f'{BASE}/export', methods=['GET'])
def export_field_config():
    conn = get_db_connection()
    try:
        payload = export_line_item_field_config(conn)
    finally:
        conn.close()
    body = json.dumps(payload, indent=2) + '\n'
    return Response(
        body,
        mimetype='application/json',
        headers={'Content-Disposition': 'attachment; filename=line_item_field_config.json'},
    )


@field_config_bp.route(f'{BASE}/import', methods=['POST'])
def import_field_config():
    payload = None
    upload = request.files.get('file')
    if upload is not None:
        try:
            payload = json.loads(upload.read().decode('utf-8'))
        except (ValueError, UnicodeDecodeError) as exc:
            return _fail(f'could not parse uploaded file: {exc}')
    else:
        payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return _fail('expected a JSON object (uploaded file or request body)')
    conn = get_db_connection()
    try:
        summary = import_line_item_field_config(conn, payload)
        return jsonify({'success': True, 'summary': summary, **fetch_line_item_field_config(conn)})
    except ValueError as exc:
        return _fail(str(exc))
    finally:
        conn.close()
