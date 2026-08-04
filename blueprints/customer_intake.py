"""Customer-intake API: narrow, API-key-authenticated endpoints for the
customer-facing order app to submit/update orders and look up returning
customers. Kept separate from the staff-facing /api/orders endpoints since
the caller is an external service, not a logged-in user, and the payload
shape is deliberately simpler than the tracker's internal line-item model.

Field mapping is best-effort: every customer-submitted field that has a
reasonable equivalent in the tracker's schema is mapped directly; anything
without a clean match (hinges, trim, boring, sill, grid pattern, screen,
frame material, free-text hardware, special conditions) is appended as
readable text to the item's notes (or the order's notes) so nothing
submitted by a customer is silently dropped.
"""
from __future__ import annotations

import base64
import json
import re
from datetime import datetime
from pathlib import Path

from flask import Blueprint, jsonify, request

from core import (
    attach_po_display,
    compute_stage_priority,
    dict_from_row,
    get_db_connection,
    upsert_customer_profile,
)

customer_intake_bp = Blueprint('customer_intake', __name__)

# Matches the existing (pre-existing, unrelated-to-this-feature) convention
# used by blueprints/attachments.py for where uploaded files physically live.
ATTACHMENTS_BASE = Path(r"C:\Projects\Order-Tracker\attachments")


def _slugify(text):
    text = str(text or '').strip().replace(' ', '_')
    return re.sub(r'[^\w\-]', '', text)


def _split_wxh(value):
    """Split a "36x80"-style string into (width, height); ('', '') if it doesn't parse."""
    parts = re.split(r'[xX]', str(value or '').strip())
    if len(parts) == 2 and parts[0].strip() and parts[1].strip():
        return parts[0].strip(), parts[1].strip()
    return '', ''


def map_customer_line_item(raw):
    """Map one customer-app line item into the tracker's line-item shape."""
    raw = raw or {}
    product = str(raw.get('product') or '').strip().lower()
    if 'window' in product:
        item_type = 'window'
    elif 'hardware' in product:
        item_type = 'hardware'
    else:
        item_type = 'door'

    mapped = {'type': item_type, 'quantity': raw.get('quantity') or 1}
    notes_parts = []

    if raw.get('is_milgard'):
        mapped['vendor'] = 'Milgard'
        if raw.get('milgard_series'):
            mapped['series'] = raw['milgard_series']
        if raw.get('milgard_operation_style'):
            mapped['operation'] = raw['milgard_operation_style']
        if raw.get('milgard_exterior_finish'):
            mapped['exterior_color'] = raw['milgard_exterior_finish']
        if raw.get('milgard_interior_finish'):
            mapped['interior_color'] = raw['milgard_interior_finish']

    color = str(raw.get('color') or '').strip()
    if color:
        mapped['color'] = color
    glass = str(raw.get('glass') or '').strip()
    if glass:
        mapped['glass'] = glass

    width = str(raw.get('width') or '').strip()
    height = str(raw.get('height') or '').strip()
    size = str(raw.get('size') or '').strip()
    rough_opening = str(raw.get('rough_opening') or '').strip()
    opening_type = str(raw.get('opening_type') or '').strip().lower()

    if item_type != 'hardware':
        if opening_type:
            # Windows always send opening_type; it's authoritative over the
            # auto-calculated rough_opening display string, which is present
            # regardless of which opening type the customer actually picked.
            if 'rough' in opening_type:
                mapped['size_mode'] = 'rough_opening'
            elif 'net' in opening_type:
                mapped['size_mode'] = 'net_size'
            else:
                mapped['size_mode'] = 'callout'
            if width and height:
                mapped['width'] = width
                mapped['height'] = height
        elif rough_opening:
            # Doors never send opening_type; a manually-entered rough
            # opening takes priority over a picked callout size.
            mapped['size_mode'] = 'rough_opening'
            ro_width, ro_height = _split_wxh(rough_opening)
            if ro_width and ro_height:
                mapped['width'] = ro_width
                mapped['height'] = ro_height
            elif width and height:
                mapped['width'] = width
                mapped['height'] = height
        elif size:
            mapped['size_mode'] = 'callout'
            mapped['callout_size'] = size
        elif width and height:
            mapped['size_mode'] = 'callout'
            mapped['width'] = width
            mapped['height'] = height

    if item_type == 'window':
        window_type = str(raw.get('window_type') or '').strip()
        if window_type:
            mapped['style'] = window_type
        frame_material = str(raw.get('frame_material') or '').strip()
        if frame_material:
            notes_parts.append(f"Frame material: {frame_material}")
        grid_pattern = str(raw.get('grid_pattern') or '').strip()
        if grid_pattern and grid_pattern.lower() != 'none':
            notes_parts.append(f"Grid pattern: {grid_pattern}")
        if raw.get('screen'):
            notes_parts.append('Screen requested')

    elif item_type == 'door':
        jamb = str(raw.get('jamb') or '').strip()
        if jamb:
            mapped['jamb_size'] = jamb
        swing = str(raw.get('swing') or '').strip()
        if swing:
            mapped['swing'] = swing
        for label, key in (('Hinges', 'hinges'), ('Trim', 'trim'), ('Boring', 'boring'), ('Sill', 'sill')):
            val = str(raw.get(key) or '').strip()
            if val:
                notes_parts.append(f"{label}: {val}")
        if raw.get('qlon'):
            notes_parts.append('Q-lon weatherstripping requested')

    hardware_text = str(raw.get('hardware') or '').strip()
    if hardware_text:
        notes_parts.append(f"Hardware: {hardware_text}")
    special = str(raw.get('special_conditions') or '').strip()
    if special:
        notes_parts.append(f"Special conditions: {special}")

    if notes_parts:
        mapped['notes'] = ' | '.join(notes_parts)

    return mapped


def build_order_data(payload):
    """Map a full customer-app order submission into an orders-table insert dict."""
    items = payload.get('items') or []
    mapped_items = [map_customer_line_item(item) for item in items]

    notes_parts = []
    customer_notes = str(payload.get('notes') or '').strip()
    if customer_notes:
        notes_parts.append(customer_notes)
    notes_parts.append('Submitted via customer app')

    return {
        'customer_name': str(payload.get('customer_name') or '').strip(),
        'customer_phone': str(payload.get('phone') or '').strip(),
        'customer_email': str(payload.get('email') or '').strip(),
        'project_name': str(payload.get('project') or '').strip(),
        'stage': 'ORDER_DETAILS',
        'line_items': json.dumps(mapped_items, ensure_ascii=False),
        'notes': '\n'.join(notes_parts),
    }


def _save_photos(conn, order_id, customer_name, photos_base64):
    """Decode and save base64 photos, matching attachments.py's existing save convention."""
    if not photos_base64:
        return

    customer_slug = _slugify(customer_name or 'customer')
    folder_name = f"{customer_slug}__ID-{order_id}"
    order_dir = ATTACHMENTS_BASE / folder_name
    order_dir.mkdir(parents=True, exist_ok=True)

    now = datetime.now().isoformat()
    for idx, photo_b64 in enumerate(photos_base64):
        try:
            photo_data = base64.b64decode(photo_b64)
        except Exception:
            continue

        filename = f"customer_photo_{idx + 1}.jpg"
        file_path = order_dir / filename
        counter = 1
        while file_path.exists():
            filename = f"customer_photo_{idx + 1}_{counter}.jpg"
            file_path = order_dir / filename
            counter += 1

        file_path.write_bytes(photo_data)
        rel_path = f"{folder_name}/{filename}"
        conn.execute(
            """
            INSERT INTO attachments (order_id, section, filename, rel_path, added_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (order_id, 'customer_photos', filename, rel_path, now),
        )


@customer_intake_bp.route('/api/customer-intake/orders', methods=['POST'])
def customer_intake_create_order():
    """Create a new order from the customer-facing app."""
    payload = request.get_json(silent=True) or {}

    if not str(payload.get('customer_name') or '').strip():
        return jsonify({'success': False, 'error': 'Customer name is required'}), 400

    data = build_order_data(payload)
    data['priority_manual'] = compute_stage_priority(data['stage'])

    conn = get_db_connection()

    cursor = conn.execute("PRAGMA table_info(orders)")
    columns = {row[1] for row in cursor.fetchall()}
    columns.discard('id')
    insert_fields = {k: v for k, v in data.items() if k in columns}

    profile_id = upsert_customer_profile(conn, {
        'customer_name': insert_fields.get('customer_name'),
        'customer_phone': insert_fields.get('customer_phone'),
        'customer_email': insert_fields.get('customer_email'),
    })
    if profile_id and 'customer_profile_id' in columns:
        insert_fields['customer_profile_id'] = profile_id

    now = datetime.now().isoformat()
    insert_fields['created_at'] = now
    insert_fields['updated_at'] = now
    insert_fields['archived'] = 0

    field_names = list(insert_fields.keys())
    placeholders = ', '.join('?' * len(field_names))
    field_list = ', '.join(field_names)
    values = [insert_fields[f] for f in field_names]

    cursor = conn.execute(f"INSERT INTO orders ({field_list}) VALUES ({placeholders})", values)
    order_id = cursor.lastrowid

    _save_photos(conn, order_id, insert_fields.get('customer_name'), payload.get('photos'))

    conn.commit()
    row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    conn.close()

    return jsonify({
        'success': True,
        'order_id': order_id,
        'message': f'Order #{order_id} created successfully',
        'order': attach_po_display(dict_from_row(row)),
    }), 201


@customer_intake_bp.route('/api/customer-intake/orders/<int:order_id>', methods=['PUT'])
def customer_intake_update_order(order_id):
    """Update an existing order (edit-before-final-submit flow)."""
    payload = request.get_json(silent=True) or {}

    conn = get_db_connection()
    existing = conn.execute("SELECT id FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not existing:
        conn.close()
        return jsonify({'success': False, 'error': 'Order not found'}), 404

    data = build_order_data(payload)
    now = datetime.now().isoformat()

    conn.execute(
        """
        UPDATE orders
        SET customer_name = ?, customer_phone = ?, customer_email = ?,
            project_name = ?, line_items = ?, notes = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            data['customer_name'], data['customer_phone'], data['customer_email'],
            data['project_name'], data['line_items'], data['notes'], now, order_id,
        ),
    )

    _save_photos(conn, order_id, data.get('customer_name'), payload.get('photos'))

    conn.commit()
    row = conn.execute("SELECT * FROM orders WHERE id = ?", (order_id,)).fetchone()
    conn.close()

    return jsonify({
        'success': True,
        'order_id': order_id,
        'message': f'Order #{order_id} updated successfully',
        'order': attach_po_display(dict_from_row(row)),
    })


@customer_intake_bp.route('/api/customer-intake/customer/<phone>', methods=['GET'])
def customer_intake_lookup_customer(phone):
    """Look up a returning customer's info by phone number."""
    conn = get_db_connection()
    row = conn.execute(
        """
        SELECT customer_name, customer_email, project_name
        FROM orders
        WHERE customer_phone = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (phone,),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'message': 'No orders found for this phone number'})

    return jsonify({
        'success': True,
        'customer_name': row['customer_name'] or '',
        'email': row['customer_email'] or '',
        'project': row['project_name'] or '',
        'phone': phone,
    })


@customer_intake_bp.route('/api/customer-intake/orders/recent/<phone>', methods=['GET'])
def customer_intake_recent_order(phone):
    """Get the most recent order for a phone number, reverse-mapped to the
    customer app's simpler item shape. Best-effort: fields folded into notes
    on the way in don't reappear in their original structured field."""
    conn = get_db_connection()
    row = conn.execute(
        """
        SELECT id, customer_name, customer_phone, customer_email, project_name, line_items, notes
        FROM orders
        WHERE customer_phone = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (phone,),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'message': 'No orders found for this phone number'})

    try:
        tracker_items = json.loads(row['line_items']) if row['line_items'] else []
    except Exception:
        tracker_items = []

    items = []
    for item in tracker_items:
        item_type = str(item.get('type') or 'door')
        product = 'Window' if item_type == 'window' else ('Hardware' if item_type == 'hardware' else 'Door')
        items.append({
            'product': product,
            'quantity': item.get('quantity') or 1,
            'size': item.get('callout_size') or '',
            'width': item.get('width') or '',
            'height': item.get('height') or '',
            'rough_opening': f"{item['width']}x{item['height']}" if item.get('size_mode') == 'rough_opening' and item.get('width') and item.get('height') else '',
            'jamb': item.get('jamb_size') or '',
            'swing': item.get('swing') or '',
            'color': item.get('color') or '',
            'glass': item.get('glass') or '',
            'window_type': item.get('style') or '',
            'opening_type': {
                'rough_opening': 'Rough Opening',
                'net_size': 'Net Frame',
                'callout': 'Call Out',
            }.get(item.get('size_mode'), ''),
            'is_milgard': str(item.get('vendor') or '').strip().lower() == 'milgard',
            'milgard_series': item.get('series') or '',
            'milgard_operation_style': item.get('operation') or '',
            'milgard_exterior_finish': item.get('exterior_color') or '',
            'milgard_interior_finish': item.get('interior_color') or '',
        })

    return jsonify({
        'success': True,
        'order_id': row['id'],
        'order': {
            'customer_name': row['customer_name'],
            'phone': row['customer_phone'],
            'email': row['customer_email'] or '',
            'project': row['project_name'] or '',
            'items': items,
            'notes': row['notes'] or '',
            'photos': [],
        },
    })
