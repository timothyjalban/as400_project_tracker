"""Customer-intake API: narrow, API-key-authenticated endpoints for the
customer-facing order app to submit/update orders and look up returning
customers. Kept separate from the staff-facing /api/orders endpoints since
the caller is an external service, not a logged-in user, and the payload
shape is deliberately simpler than the tracker's internal line-item model.

Field mapping is best-effort: every customer-submitted field that has a
reasonable equivalent in the tracker's schema is mapped directly; anything
without a clean match (window grid pattern, screen, frame material, special
conditions) is appended as readable text to the item's notes (or the
order's notes) so nothing submitted by a customer is silently dropped. As
of 2026-08-11, the app's door JSON keys are named to match the tracker's
own line-item field names 1:1 (door_location, style, jamb_size, boring,
sill, hinge_size, hinge_finish, exterior_trim, finish_type, finish_detail,
panel_style, glass_tint, hardware_option, qlon) -- see the door branch
below for the one intentional exception (material).
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

# OrePac's own as-built item description (scraped from the quote's Cart
# page) is free text, but its wording is consistent enough around a door's
# thickness/finish/configuration to pull a few tracker fields out of it --
# e.g. '... 3/0 x 6/8 1 3/8" Primed 82, 2 Panel ... Interior Wood Single
# Prehung ...'. Deliberately conservative: a pattern that doesn't match
# just means that field is left alone rather than set to a guess.
DOOR_THICKNESS_RE = re.compile(r'\b(1[\s-]?3/8|1[\s-]?3/4)\s*"')
DOOR_MATERIAL_TOKEN_RE = re.compile(r'\b(?:1[\s-]?3/8|1[\s-]?3/4)\s*"\s*([A-Za-z][A-Za-z\-]*)')
DOOR_COUNT_RE = re.compile(r'\b(Single|Double|Triple)\s+(?:Prehung|Slab)\b', re.IGNORECASE)
DOOR_MATERIAL_NORMALIZE = {
    'primed': 'Primed', 'wood': 'Wood', 'fiberglass': 'Fiberglass',
    'steel': 'Steel', 'vinyl': 'Vinyl',
}
# The sticking profile is the word immediately before Or-Pac's "Stkg"
# abbreviation, e.g. '... 2 Panel Square Top Ovolo Stkg Flat Panel' --
# anchoring on "Stkg" (rather than just any of these words appearing
# somewhere in the description) avoids confusing it with "Square Top",
# a different question (door top shape) that can appear right next to it.
DOOR_STICKING_RE = re.compile(r'\b(Square|Ovolo|Shaker)\s+Stkg\b', re.IGNORECASE)
# The Model Number is its own bullet-separated token right before the
# "Interior .../Exterior ..." product-line segment, e.g.
# '... Left Hand Inswing (1A) • 82 • Interior Wood Single Prehung ...'.
# Anchored on the following Interior/Exterior word rather than position,
# since a Slab Only item (no handing question) shifts where this token
# falls in the string.
DOOR_MODEL_NUMBER_RE = re.compile(r'•\s*([\w\-]+)\s*•\s*(?:Interior|Exterior)\b', re.IGNORECASE)


def parse_orepac_description(description):
    """Best-effort extraction of a few structured door fields from OrePac's
    as-built item description. Only returns a key when the match is
    unambiguous, so an unfamiliar wording never overwrites a field with a
    wrong guess -- it just gets left out."""
    fields = {}
    text = description or ''

    thickness_match = DOOR_THICKNESS_RE.search(text)
    if thickness_match:
        fields['thickness'] = f'{thickness_match.group(1).replace(" ", "-")}"'

    material_match = DOOR_MATERIAL_TOKEN_RE.search(text)
    if material_match:
        material = DOOR_MATERIAL_NORMALIZE.get(material_match.group(1).strip().lower())
        if material:
            fields['material'] = material

    count_match = DOOR_COUNT_RE.search(text)
    if count_match:
        fields['door_count'] = count_match.group(1).capitalize()

    sticking_match = DOOR_STICKING_RE.search(text)
    if sticking_match:
        fields['sticking'] = sticking_match.group(1).capitalize()

    model_match = DOOR_MODEL_NUMBER_RE.search(text)
    if model_match:
        # Tracker's own field for this is labeled "Model" in the UI but
        # keyed as 'series' (same key doors and windows share).
        fields['series'] = model_match.group(1).strip()

    return fields


def _format_price(price):
    """'$381.60' -> '381.60' to match the tracker's numeric Unit Price input."""
    digits = re.sub(r'[^0-9.]', '', str(price or ''))
    return digits or None


def _slugify(text):
    text = str(text or '').strip().replace(' ', '_')
    return re.sub(r'[^\w\-]', '', text)


def _split_wxh(value):
    """Split a "36x80"-style string (accepts x, X, or the app's × separator)
    into (width, height); ('', '') if it doesn't parse."""
    parts = re.split(r'[x×X]', str(value or '').strip())
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
    glass = str(raw.get('glass') or '').strip()
    # The tracker's 'color' and 'glass' fields are window-only (exterior/
    # interior color, and a pane-count "Lites" enum) -- doors ask different
    # questions under these same JSON keys (finish/unfinished + species or
    # stain color; tint type), so a door's values get folded into notes
    # below instead of overwriting a structured field with a mismatched
    # value.
    if item_type != 'door':
        if color:
            mapped['color'] = color
        if glass:
            mapped['glass'] = glass

    width = str(raw.get('width') or '').strip()
    height = str(raw.get('height') or '').strip()
    size = str(raw.get('size') or '').strip()
    rough_opening = str(raw.get('rough_opening') or '').strip()
    opening_type = str(raw.get('opening_type') or '').strip().lower()

    if item_type == 'door':
        # Doors always send both a callout size (e.g. "3068") and a
        # rough-opening string calculated from it (or manually overwritten),
        # regardless of which Opening Type the customer picked -- so prefer
        # the rough opening when it parses, and always keep the callout size
        # too so it's not lost either way.
        if size:
            mapped['callout_size'] = size
        ro_width, ro_height = _split_wxh(rough_opening)
        if ro_width and ro_height:
            mapped['size_mode'] = 'rough_opening'
            mapped['width'] = ro_width
            mapped['height'] = ro_height
        elif size:
            mapped['size_mode'] = 'callout'
        elif width and height:
            mapped['size_mode'] = 'callout'
            mapped['width'] = width
            mapped['height'] = height
    elif item_type != 'hardware':
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
        # Every door submitted through the customer app goes through the
        # Or-Pac Marketplace automation -- it's the only vendor this app
        # knows how to quote -- so the vendor (and therefore AS400 group,
        # which the tracker's own UI derives from vendor) is known up
        # front, not just after a quote gets built.
        mapped['vendor'] = 'OrePac'
        mapped['as400_group'] = 'OrePac'
        mapped['as400_group_auto'] = True

        door_location = str(raw.get('door_location') or '').strip()
        if door_location:
            mapped['door_location'] = door_location

        # The app now sends the tracker's own short style values directly
        # ('Slab'/'Prehung'), so this is a straight passthrough -- no more
        # text-matching against the app's old, longer wording.
        style_value = str(raw.get('style') or '').strip()
        if style_value:
            mapped['style'] = style_value

        # door_material is now a direct 3-way choice (Wood/Fiberglass/
        # Steel) on the app side as of 2026-08-14 -- door_slab_material is
        # Or-Pac's own "Material" sub-question, always the same value as
        # door_material for Fiberglass/Steel (no separate app question for
        # it anymore), so this is effectively a straight passthrough now,
        # kept as a fallback chain for older app builds.
        door_material = str(raw.get('door_material') or '').strip()
        slab_material = str(raw.get('door_slab_material') or '').strip()
        if door_material == 'Wood':
            mapped['material'] = 'Wood'
        elif slab_material:
            mapped['material'] = slab_material
        elif door_material:
            mapped['material'] = door_material

        for tracker_field, app_field in (
            ('panel_style', 'panel_style'),
            ('finish_type', 'finish_type'),
            ('finish_detail', 'finish_detail'),
            ('glass_tint', 'glass_tint'),
            ('jamb_size', 'jamb_size'),
            ('boring', 'boring'),
            ('sill', 'sill'),
            ('hinge_size', 'hinge_size'),
            ('hinge_finish', 'hinge_finish'),
            ('exterior_trim', 'exterior_trim'),
            ('hardware_option', 'hardware_option'),
            ('door_texture', 'door_texture'),
            ('door_glass_shape', 'door_glass_shape'),
            ('door_glass_lite_style', 'door_glass_lite_style'),
            ('door_frame_profile', 'door_frame_profile'),
        ):
            value = str(raw.get(app_field) or '').strip()
            if value:
                mapped[tracker_field] = value

        swing = str(raw.get('swing') or '').strip()
        if swing:
            mapped['swing'] = swing

        if 'qlon' in raw:
            mapped['qlon'] = bool(raw.get('qlon'))

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

    # A verbatim copy of what the customer app itself submitted (minus
    # photos, which are saved to disk separately and would just bloat this
    # column) -- kept alongside the tracker's own mapped/notes-folded copy
    # so the app can reload an order for editing with perfect fidelity
    # instead of reverse-engineering it back out of the tracker's schema.
    app_payload = {k: v for k, v in payload.items() if k != 'photos'}

    return {
        'customer_name': str(payload.get('customer_name') or '').strip(),
        'customer_phone': str(payload.get('phone') or '').strip(),
        'customer_email': str(payload.get('email') or '').strip(),
        'project_name': str(payload.get('project') or '').strip(),
        'stage': 'ORDER_DETAILS',
        'line_items': json.dumps(mapped_items, ensure_ascii=False),
        'notes': '\n'.join(notes_parts),
        'customer_app_payload': json.dumps(app_payload, ensure_ascii=False),
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
            project_name = ?, line_items = ?, notes = ?, customer_app_payload = ?,
            updated_at = ?
        WHERE id = ?
        """,
        (
            data['customer_name'], data['customer_phone'], data['customer_email'],
            data['project_name'], data['line_items'], data['notes'],
            data['customer_app_payload'], now, order_id,
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


@customer_intake_bp.route('/api/customer-intake/orders/<int:order_id>/quote-result', methods=['PUT'])
def customer_intake_apply_quote_result(order_id):
    """Fold a completed Or-Pac quote's real per-item price and as-built
    description back into the order's door line items -- the vendor's own
    answer is more authoritative than the customer's initial picks for a
    few fields (unit price, and whatever parse_orepac_description can read
    out of the description), so this overwrites rather than merges those
    specific keys. Called after the quote automation finishes; never blocks
    or affects order submission itself.

    Expects {"quote_number": "...", "items": [{"price": "...",
    "description": "..."}, ...]} -- one entry per door item, in the same
    order they were added to the quote (Item 1, Item 2, ...). Also accepts
    the older single {"price", "description"} shape as a one-item list, for
    callers not yet updated to the list shape."""
    payload = request.get_json(silent=True) or {}
    quote_number = str(payload.get('quote_number') or '').strip()
    item_results = payload.get('items')
    if not item_results and ('price' in payload or 'description' in payload):
        item_results = [{'price': payload.get('price'), 'description': payload.get('description')}]
    item_results = item_results or []

    conn = get_db_connection()
    row = conn.execute("SELECT line_items, notes FROM orders WHERE id = ?", (order_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'success': False, 'error': 'Order not found'}), 404

    try:
        items = json.loads(row['line_items']) if row['line_items'] else []
    except Exception:
        items = []

    if not items:
        conn.close()
        return jsonify({'success': False, 'error': 'Order has no line items to update'}), 400

    # Only door items go on an Or-Pac quote (windows are skipped before the
    # automation ever runs), so results line up positionally with just the
    # door items here, in the same order -- not the order's full item list.
    door_items = [it for it in items if it.get('type') == 'door']
    for door_item, result in zip(door_items, item_results):
        result = result or {}
        formatted_price = _format_price(result.get('price'))
        if formatted_price:
            door_item['price'] = formatted_price
        # A quote result only ever comes from the Or-Pac automation, so
        # vendor/group are certain here too -- reconfirmed in case this is
        # an older order that predates auto-setting them on submission.
        door_item.setdefault('vendor', 'OrePac')
        if not door_item.get('as400_group_custom'):
            door_item['as400_group'] = 'OrePac'
            door_item['as400_group_auto'] = True
        description = str(result.get('description') or '').strip()
        if description:
            door_item.update(parse_orepac_description(description))

    notes = row['notes'] or ''
    if quote_number and f'OrePac Quote #{quote_number}' not in notes:
        descriptions = ' || '.join(
            str(r.get('description') or '').strip() for r in item_results if r and r.get('description')
        )
        quote_note = f'OrePac Quote #{quote_number}: {descriptions}' if descriptions else f'OrePac Quote #{quote_number}'
        notes = f'{notes}\n{quote_note}' if notes else quote_note

    # Order-level summary columns (used by the by-quote-number lookup and
    # the "recent order" quote snippet) -- total across every item's price,
    # and every item's description joined together.
    total_price = None
    price_sum = 0.0
    have_price = False
    for door_item in door_items:
        try:
            price_sum += float(door_item.get('price') or 0)
            have_price = True
        except (TypeError, ValueError):
            pass
    if have_price:
        total_price = f'{price_sum:.2f}'
    combined_description = ' || '.join(
        str(r.get('description') or '').strip() for r in item_results if r and r.get('description')
    ) or None

    now = datetime.now().isoformat()
    conn.execute(
        """
        UPDATE orders
        SET line_items = ?, notes = ?, orepac_quote_number = ?, orepac_price = ?,
            orepac_description = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            json.dumps(items, ensure_ascii=False), notes, quote_number or None,
            total_price, combined_description, now, order_id,
        ),
    )
    conn.commit()
    conn.close()

    return jsonify({'success': True, 'order_id': order_id})


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


ORDER_LOOKUP_COLUMNS = (
    "id, customer_name, customer_phone, customer_email, project_name, line_items, "
    "notes, customer_app_payload, orepac_quote_number, orepac_price, orepac_description"
)


def _order_lookup_payload(row):
    """Build the customer-app-shaped `order` JSON for a lookup response.
    Prefers the verbatim customer_app_payload column, which is exactly what
    CustomerOrder.toJson() produced on submission -- perfect round-trip,
    nothing lost. Only legacy rows saved before that column existed (or a
    row where it somehow failed to parse) fall back to reverse-mapping the
    tracker's own line-item shape, which is best-effort: fields folded into
    notes on the way in don't reappear in their original structured field."""
    if row['customer_app_payload']:
        try:
            order = json.loads(row['customer_app_payload'])
            order.setdefault('photos', [])
            return order
        except Exception:
            pass

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
            'window_type': item.get('style') if product == 'Window' else '',
            'door_type': item.get('door_location') or '',
            'door_configuration': {
                'Slab': 'Door Slab Only',
                'Prehung': 'Single Prehung',
            }.get(item.get('style'), '') if product == 'Door' else '',
            'door_material': item.get('material') if item.get('material') in ('Wood', 'Fiberglass', 'Steel') else '',
            'door_slab_material': item.get('material') if item.get('material') in ('Fiberglass', 'Steel') else '',
            'door_texture': item.get('door_texture') or '',
            'door_glass_shape': item.get('door_glass_shape') or '',
            'door_glass_lite_style': item.get('door_glass_lite_style') or '',
            'door_frame_profile': item.get('door_frame_profile') or '',
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

    return {
        'customer_name': row['customer_name'],
        'phone': row['customer_phone'],
        'email': row['customer_email'] or '',
        'project': row['project_name'] or '',
        'items': items,
        'notes': row['notes'] or '',
        'photos': [],
    }


def _order_lookup_response(row):
    return jsonify({
        'success': True,
        'order_id': row['id'],
        'order': _order_lookup_payload(row),
        'quote_number': row['orepac_quote_number'] or None,
        'price': row['orepac_price'] or None,
        'description': row['orepac_description'] or None,
    })


@customer_intake_bp.route('/api/customer-intake/orders/recent/<phone>', methods=['GET'])
def customer_intake_recent_order(phone):
    """Get the most recent order for a phone number."""
    conn = get_db_connection()
    row = conn.execute(
        f"SELECT {ORDER_LOOKUP_COLUMNS} FROM orders WHERE customer_phone = ? "
        "ORDER BY created_at DESC LIMIT 1",
        (phone,),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'message': 'No orders found for this phone number'})

    return _order_lookup_response(row)


@customer_intake_bp.route('/api/customer-intake/orders/by-order-number/<int:order_id>', methods=['GET'])
def customer_intake_order_by_number(order_id):
    """Look up a specific order by its tracker order number. Requires the
    matching phone number as a ?phone= query param -- the order number
    alone (a small sequential int) isn't proof this is really the
    customer's own order, so this stays consistent with the rest of this
    API's "phone number is the customer's identity" model rather than
    letting anyone enumerate other customers' orders by guessing IDs."""
    phone = (request.args.get('phone') or '').strip()
    if not phone:
        return jsonify({'success': False, 'message': 'phone is required'}), 400

    conn = get_db_connection()
    row = conn.execute(
        f"SELECT {ORDER_LOOKUP_COLUMNS} FROM orders WHERE id = ? AND customer_phone = ?",
        (order_id, phone),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'message': 'No order found for that order number and phone number'})

    return _order_lookup_response(row)


@customer_intake_bp.route('/api/customer-intake/orders/by-quote-number/<quote_number>', methods=['GET'])
def customer_intake_order_by_quote_number(quote_number):
    """Look up a specific order by its Or-Pac quote number, same phone-number
    requirement as the order-number lookup above."""
    phone = (request.args.get('phone') or '').strip()
    if not phone:
        return jsonify({'success': False, 'message': 'phone is required'}), 400

    conn = get_db_connection()
    row = conn.execute(
        f"SELECT {ORDER_LOOKUP_COLUMNS} FROM orders WHERE orepac_quote_number = ? AND customer_phone = ?",
        (quote_number.strip(), phone),
    ).fetchone()
    conn.close()

    if not row:
        return jsonify({'success': False, 'message': 'No order found for that quote number and phone number'})

    return _order_lookup_response(row)
