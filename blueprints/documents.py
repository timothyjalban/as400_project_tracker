"""Document generation endpoints and the desktop-helper proxy."""
from __future__ import annotations

import json
import os

from flask import Blueprint, jsonify, request

from core import DESKTOP_HELPER_LOCAL_ONLY, _is_admin, _is_local_request, call_desktop_helper, get_db_connection

documents_bp = Blueprint('documents', __name__)


@documents_bp.route('/api/orders/<int:order_id>/generate-quote', methods=['POST'])
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

@documents_bp.route('/api/orders/<int:order_id>/generate-invoice', methods=['POST'])
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

@documents_bp.route('/api/orders/<int:order_id>/generate-special-order', methods=['POST'])
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



@documents_bp.route('/api/desktop-helper/health', methods=['GET'])
def desktop_helper_health_proxy():
    """Proxy desktop helper health checks through the web API."""
    if DESKTOP_HELPER_LOCAL_ONLY and not _is_local_request():
        return jsonify({'success': False, 'error': 'Desktop helper access is local-only'}), 403
    if not _is_admin():
        return jsonify({'success': False, 'error': 'Admin role required'}), 403
    data, status = call_desktop_helper('health', method='GET', timeout=1.0)
    return jsonify(data), status


@documents_bp.route('/api/desktop-helper/<action>', methods=['POST'])
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

    # Launch automations can legitimately run for a while (window focus,
    # AS400 navigation, quote capture). Use longer per-action timeouts so the
    # proxy doesn't fail early with "timed out" while helper is still working.
    launch_timeout = float(os.environ.get('ORDER_TRACKER_DESKTOP_HELPER_LAUNCH_TIMEOUT', '180') or '180')
    open_timeout = float(os.environ.get('ORDER_TRACKER_DESKTOP_HELPER_OPEN_TIMEOUT', '45') or '45')
    action_timeout = launch_timeout if action.startswith('launch-') else open_timeout

    data, status = call_desktop_helper(action, method='POST', payload=payload, timeout=action_timeout)
    return jsonify(data), status
