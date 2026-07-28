"""Bulk import endpoints: parse and import JSON/CSV order form files."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Blueprint, jsonify, request

from core import get_db_connection, normalize_po_numbers

import_export_bp = Blueprint('import_export', __name__)


def _parse_bulk_form_csv(raw_text: str) -> Dict[str, Any]:
    """Parse desktop-exported bulk form CSV into the same shape as JSON imports."""
    data: Dict[str, Any] = {
        'customer_info': {},
        'items': [],
    }

    reader = csv.DictReader(io.StringIO(raw_text))
    for row in reader:
        row_number = str(row.get('Row') or '').strip()
        if not row_number:
            continue
        if row_number.lower() == 'customer information':
            continue
        if not row_number.isdigit():
            continue

        data['items'].append({
            'quantity': str(row.get('Quantity') or '').strip(),
            'width': str(row.get('Width') or '').strip(),
            'height': str(row.get('Height') or '').strip(),
            'config': str(row.get('Config') or '').strip(),
            'jamb_size': str(row.get('Jamb Size') or '').strip(),
            'swing': str(row.get('Swing') or '').strip(),
            'hinges': str(row.get('Hinges') or '').strip(),
            'boring': str(row.get('Boring') or '').strip(),
            'sill_bottom': str(row.get('Sill & Bottom') or '').strip(),
            'color_finish': str(row.get('Color/Finish') or '').strip(),
            'glass_type': str(row.get('Glass Type') or '').strip(),
            'hardware': str(row.get('Hardware') or '').strip(),
            'special_notes': str(row.get('Special Notes') or '').strip(),
        })

    for row in csv.reader(io.StringIO(raw_text)):
        if len(row) < 2:
            continue
        key = str(row[0] or '').strip().lower()
        value = str(row[1] or '').strip()
        if key == 'name':
            data['customer_info']['customer_name'] = value
        elif key == 'phone':
            data['customer_info']['phone'] = value
        elif key == 'email':
            data['customer_info']['email'] = value
        elif key == 'project':
            data['customer_info']['project'] = value
        elif key in ('po', 'po number', 'po_number'):
            data['customer_info']['po_number'] = value

    return data


def _load_bulk_import_data(file_storage) -> Dict[str, Any]:
    filename = (file_storage.filename or '').strip()
    suffix = Path(filename).suffix.lower()
    raw = file_storage.read()

    if suffix == '.json':
        payload = json.loads(raw)
    elif suffix == '.csv':
        payload = _parse_bulk_form_csv(raw.decode('utf-8-sig', errors='replace'))
    else:
        raise ValueError('Only JSON and CSV files are supported')

    if not isinstance(payload, dict):
        raise ValueError('Import file must contain a JSON/CSV object payload')

    return payload


def _import_bulk_payload(data: Dict[str, Any]) -> Dict[str, Any]:
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

    duplicate_id = check_duplicate_order(
        customer_name,
        customer_phone,
        project_name,
        len(items),
        primary_po,
    )

    if duplicate_id:
        return {
            'success': False,
            'duplicate': True,
            'duplicate_id': duplicate_id,
            'message': f'Duplicate of existing Order #{duplicate_id}',
            'customer_name': customer_name,
            'item_count': len(items),
        }

    line_items = []
    for item in items:
        line_items.append({
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
            'special_notes': item.get('special_notes', ''),
        })

    conn = get_db_connection()
    cursor = conn.cursor()
    try:
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
            'updated_at': datetime.now().isoformat(),
        }

        cursor.execute(
            """
            INSERT INTO orders (
                customer_name, customer_phone, customer_email, project_name,
                product_type, stage, po_number, po_numbers, line_items, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
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
                order_data['updated_at'],
            ),
        )
        order_id = cursor.lastrowid
        conn.commit()
    finally:
        conn.close()

    return {
        'success': True,
        'order_id': order_id,
        'customer_name': customer_name,
        'item_count': len(items),
        'message': f'Successfully imported Order #{order_id}: {customer_name} ({len(items)} door(s))',
    }

def _bulk_payload_to_order_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """Convert a JSON/CSV bulk form payload into an order-shaped payload without inserting."""
    customer_info = data.get('customer_info', {}) if isinstance(data, dict) else {}
    items = data.get('items', []) if isinstance(data, dict) else []
    if not isinstance(items, list):
        items = []

    raw_po = customer_info.get('po_number') or data.get('po_number') or data.get('po_numbers')
    po_list = normalize_po_numbers(raw_po)
    primary_po = po_list[0] if po_list else None
    po_numbers = ', '.join(po_list) if po_list else None

    line_items = []
    for item in items:
        if not isinstance(item, dict):
            continue
        line_items.append({
            'product': 'Door',
            'type': 'door',
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
            'special_notes': item.get('special_notes', ''),
        })

    return {
        'customer_name': customer_info.get('customer_name', ''),
        'customer_phone': customer_info.get('phone', ''),
        'customer_email': customer_info.get('email', ''),
        'project_name': customer_info.get('project', ''),
        'product_type': 'Door' if line_items else '',
        'stage': 'QUOTE_CREATED',
        'po_number': primary_po,
        'po_numbers': po_numbers,
        'line_items': json.dumps(line_items) if line_items else None,
        'notes': f"Parsed from imported form file with {len(line_items)} item(s)",
    }

@import_export_bp.route('/api/import/parse-file', methods=['POST'])
def parse_import_file():
    """Parse a JSON/CSV bulk import file without creating an order."""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400

        file = request.files['file']
        filename = (file.filename or '').strip()
        if not filename:
            return jsonify({'success': False, 'error': 'No file selected'}), 400

        data = _load_bulk_import_data(file)
        order_payload = _bulk_payload_to_order_payload(data)
        return jsonify({
            'success': True,
            'parsed': True,
            'data': {'orders': [order_payload]},
            'message': f"Parsed {filename} without creating a new order",
        })
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'success': False, 'error': str(exc)}), 500
@import_export_bp.route('/api/import/bulk', methods=['POST'])
def bulk_import_json():
    """Import one or more JSON/CSV form files with duplicate detection."""
    try:
        files = request.files.getlist('files')
        if not files and 'file' in request.files:
            files = [request.files['file']]

        if not files:
            return jsonify({'success': False, 'error': 'No file provided'}), 400
        imported = []
        duplicates = []
        failed = []

        for file in files:
            filename = (file.filename or '').strip()
            if not filename:
                failed.append({'filename': filename or '(unnamed)', 'error': 'No file selected'})
                continue

            try:
                data = _load_bulk_import_data(file)
                outcome = _import_bulk_payload(data)
            except ValueError as exc:
                if len(files) == 1:
                    return jsonify({'success': False, 'error': str(exc)}), 400
                failed.append({'filename': filename, 'error': str(exc)})
                continue
            except Exception as exc:
                failed.append({'filename': filename, 'error': str(exc)})
                continue

            if outcome.get('duplicate'):
                duplicates.append({
                    'filename': filename,
                    'duplicate_id': outcome.get('duplicate_id'),
                    'message': outcome.get('message'),
                    'customer_name': outcome.get('customer_name'),
                })
            elif outcome.get('success'):
                imported.append({
                    'filename': filename,
                    'order_id': outcome.get('order_id'),
                    'customer_name': outcome.get('customer_name'),
                    'item_count': outcome.get('item_count', 0),
                    'message': outcome.get('message'),
                })
            else:
                failed.append({'filename': filename, 'error': outcome.get('error') or 'Import failed'})

        if len(files) == 1 and not imported and len(duplicates) == 1 and not failed:
            duplicate = duplicates[0]
            return jsonify({
                'success': False,
                'duplicate': True,
                'duplicate_id': duplicate.get('duplicate_id'),
                'message': duplicate.get('message') or 'Duplicate order detected',
            }), 200

        if len(files) == 1 and len(imported) == 1 and not duplicates and not failed:
            result = imported[0]
            return jsonify({
                'success': True,
                'order_id': result.get('order_id'),
                'customer_name': result.get('customer_name'),
                'item_count': result.get('item_count', 0),
                'message': result.get('message') or 'Import succeeded',
            })

        return jsonify({
            'success': len(failed) == 0,
            'mode': 'batch',
            'imported': imported,
            'duplicates': duplicates,
            'failed': failed,
            'imported_count': len(imported),
            'duplicate_count': len(duplicates),
            'failed_count': len(failed),
            'message': f"Batch import complete: {len(imported)} imported, {len(duplicates)} duplicates, {len(failed)} failed",
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
