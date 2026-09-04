"""Core order CRUD, export/backup/restore, archive, and stage-nav endpoints."""
from __future__ import annotations

import csv
import io
import json
import logging
import re
import shutil
from datetime import datetime
from io import StringIO
from pathlib import Path
from typing import Any, Dict, List

from flask import Blueprint, Response, jsonify, request, send_file

from core import (
    PROTECTED_ORDER_FIELDS,
    STAGES,
    _coerce_bool,
    _table_exists,
    _upsert_table_rows,
    apply_po_fields,
    attach_po_display,
    coerce_optional_int,
    compute_stage_priority,
    dict_from_row,
    get_db_connection,
    normalize_po_numbers,
    record_order_field_changes,
    upsert_customer_profile,
)
from data.database import backup_order

logger = logging.getLogger(__name__)

orders_bp = Blueprint('orders', __name__)


def _norm_for_compare(value: Any) -> str:
    """Loose equality for change detection: None/'' are the same, whitespace and
    surrounding quotes don't count, line_items JSON is compared structurally."""
    if value is None:
        return ''
    text = str(value).strip()
    return text


def _line_items_equivalent(a: Any, b: Any) -> bool:
    def _load(v):
        if v is None or v == '':
            return None
        if isinstance(v, (list, dict)):
            return v
        try:
            return json.loads(v)
        except (TypeError, ValueError):
            return v
    return _load(a) == _load(b)


def _protected_field_changes(update_fields: Dict[str, Any], existing_row) -> List[tuple]:
    """(field, old, new) for every protected field this payload would actually
    change. Empty list => the save touches nothing identity-critical."""
    changes: List[tuple] = []
    existing_keys = set(existing_row.keys())
    for field in PROTECTED_ORDER_FIELDS:
        if field not in update_fields:
            continue
        old = existing_row[field] if field in existing_keys else None
        new = update_fields[field]
        if field == 'line_items':
            if not _line_items_equivalent(old, new):
                changes.append((field, old, new))
        elif _norm_for_compare(old) != _norm_for_compare(new):
            changes.append((field, old, new))
    return changes


@orders_bp.route('/api/orders', methods=['GET'])
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

@orders_bp.route('/api/orders/<int:order_id>', methods=['GET'])
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

@orders_bp.route('/api/orders/<int:order_id>', methods=['PUT'])
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

        # Optimistic-lock metadata: the id of the order the browser form was
        # populated from. If the form's data belongs to a *different* order than
        # the one being saved, this write would silently clobber the target.
        base_order_id = data.pop('base_order_id', None)
        base_updated_at = data.pop('base_updated_at', None)
        save_source = str(data.pop('save_source', '') or '') or None

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

        # --- Optimistic-lock guard -------------------------------------------
        # If this payload would change any identity-critical field AND the
        # browser says the form was populated from a *different* order, refuse:
        # this is the stale/cross-order form bug that silently overwrote real
        # orders (Mary Zilge -> Bill Hanson, 2026-09-03). Same-order saves are
        # allowed through (last-write-wins) but still audited below.
        parsed_base_id = coerce_optional_int(base_order_id)
        prelim_protected = _protected_field_changes(update_fields, existing_row)
        if prelim_protected and parsed_base_id is not None and parsed_base_id != order_id:
            try:
                record_order_field_changes(
                    conn, order_id, prelim_protected,
                    source=save_source, base_order_id=parsed_base_id, blocked=True,
                )
                conn.commit()
            except Exception:
                logger.exception('failed to log blocked cross-order save (order_id=%s)', order_id)
            logger.warning(
                'BLOCKED cross-order save: PUT /api/orders/%s carried form data '
                'from order #%s (fields=%s, source=%s)',
                order_id, parsed_base_id, [c[0] for c in prelim_protected], save_source,
            )
            return jsonify({
                'success': False,
                'error': 'wrong_order',
                'error_code': 'wrong_order',
                'message': (
                    f'This edit was made against order #{parsed_base_id}, not '
                    f'order #{order_id}. Nothing was saved — reload the order '
                    f'and re-enter your change.'
                ),
                'order': attach_po_display(dict_from_row(existing_row)),
            }), 409

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
            # 'vendor' is rendered on 4 different stage cards (PO Created, Order
            # Placed w/ Vendor, Vendor Ack Received, ETA Confirmed) but only one
            # stage's card exists in the DOM at a time, so any other stage's
            # narrow save can carry it blank. Guard it like its sibling fields
            # above, or it silently resets (2026-09-04, order #444).
            'vendor',
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

        # Audit + safety-snapshot every identity-critical change before it lands,
        # so a bad overwrite can always be traced and undone.
        final_protected = _protected_field_changes(update_fields, existing_row)
        if final_protected:
            try:
                backup_order(order_id)
            except Exception:
                logger.exception('pre-change backup failed (order_id=%s)', order_id)
            try:
                record_order_field_changes(
                    conn, order_id, final_protected,
                    source=save_source, base_order_id=parsed_base_id, blocked=False,
                )
            except Exception:
                logger.exception('failed to log order field changes (order_id=%s)', order_id)
            logger.info(
                'order #%s protected fields changed: %s (source=%s, base=%s)',
                order_id, [c[0] for c in final_protected], save_source, parsed_base_id,
            )

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

@orders_bp.route('/api/stages', methods=['GET'])
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



@orders_bp.route('/api/orders', methods=['POST'])
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

@orders_bp.route('/api/orders/<int:order_id>', methods=['DELETE'])
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
        attach_base = ATTACHMENTS_DIR
        
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

@orders_bp.route('/api/orders/export', methods=['GET'])
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


@orders_bp.route('/api/orders/backup-json', methods=['GET'])
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


@orders_bp.route('/api/orders/restore-json', methods=['POST'])
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


@orders_bp.route('/api/orders/<int:order_id>/archive', methods=['PUT'])
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

@orders_bp.route('/api/orders/<int:order_id>/unarchive', methods=['PUT'])
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

@orders_bp.route('/api/stages/next/<stage>', methods=['GET'])
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

@orders_bp.route('/api/stages/previous/<stage>', methods=['GET'])
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

@orders_bp.route('/api/orders/<int:order_id>/backup', methods=['POST'])
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

@orders_bp.route('/api/orders/backup-all', methods=['POST'])
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
