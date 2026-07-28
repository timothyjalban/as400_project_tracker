"""Line item option endpoints: style, vendor, vendor-series, fin-type, window-color."""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from core import (
    fetch_fin_type_options,
    fetch_item_style_options,
    fetch_item_vendor_options,
    fetch_vendor_series_options,
    fetch_window_color_options,
    get_db_connection,
    get_vendor_catalog,
    normalize_fin_type_name,
)

line_item_options_bp = Blueprint('line_item_options', __name__)


@line_item_options_bp.route('/api/item-style-options', methods=['GET'])
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


@line_item_options_bp.route('/api/item-style-options', methods=['POST'])
def create_item_style_option():
    """Create a new persistent style option for door/window line items."""
    try:
        data = request.get_json() or {}
        item_type = str(data.get('item_type', '')).strip().lower()
        style_name = str(data.get('style_name', '')).strip()

        if item_type not in ('door', 'window', 'hardware'):
            return jsonify({
                'success': False,
                'error': 'item_type must be door, window, or hardware'
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


@line_item_options_bp.route('/api/item-style-options', methods=['DELETE'])
def delete_item_style_option():
    """Delete a saved style option for door/window line items."""
    try:
        data = request.get_json() or {}
        item_type = str(data.get('item_type', '')).strip().lower()
        style_name = str(data.get('style_name', '')).strip()

        if item_type not in ('door', 'window', 'hardware'):
            return jsonify({
                'success': False,
                'error': 'item_type must be door, window, or hardware'
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


@line_item_options_bp.route('/api/item-vendor-options', methods=['GET'])
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


@line_item_options_bp.route('/api/vendor-catalog', methods=['GET'])
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


@line_item_options_bp.route('/api/item-vendor-options', methods=['POST'])
def create_item_vendor_option():
    """Create a new persistent vendor option for door/window line items."""
    try:
        data = request.get_json() or {}
        item_type = str(data.get('item_type', '')).strip().lower()
        vendor_name = str(data.get('vendor_name', '')).strip()

        if item_type not in ('door', 'window', 'hardware'):
            return jsonify({
                'success': False,
                'error': 'item_type must be door, window, or hardware'
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


@line_item_options_bp.route('/api/vendor-series-options', methods=['GET'])
def get_vendor_series_options_api():
    """Get vendor-specific series options for door/window line items."""
    try:
        conn = get_db_connection()
        series = fetch_vendor_series_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'series': series
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@line_item_options_bp.route('/api/vendor-series-options', methods=['POST'])
def create_vendor_series_option_api():
    """Create a vendor-specific series option."""
    try:
        data = request.get_json() or {}
        item_type = str(data.get('item_type', '')).strip().lower()
        vendor_name = str(data.get('vendor_name', '')).strip()
        series_name = str(data.get('series_name', '')).strip()

        if item_type not in ('door', 'window', 'hardware'):
            return jsonify({
                'success': False,
                'error': 'item_type must be door, window, or hardware'
            }), 400

        if not vendor_name:
            return jsonify({
                'success': False,
                'error': 'vendor_name is required'
            }), 400

        if not series_name:
            return jsonify({
                'success': False,
                'error': 'series_name is required'
            }), 400

        conn = get_db_connection()
        conn.execute(
            """
            INSERT OR IGNORE INTO vendor_series_options (item_type, vendor_name, series_name)
            VALUES (?, ?, ?)
            """,
            (item_type, vendor_name, series_name),
        )
        conn.commit()

        series = fetch_vendor_series_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'series': series
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@line_item_options_bp.route('/api/fin-type-options', methods=['GET'])
def get_fin_type_options_api():
    """Get global fin type options for line items."""
    try:
        conn = get_db_connection()
        fin_types = fetch_fin_type_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'fin_types': fin_types
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@line_item_options_bp.route('/api/fin-type-options', methods=['POST'])
def create_fin_type_option_api():
    """Create a global fin type option."""
    try:
        data = request.get_json() or {}
        fin_type_name = normalize_fin_type_name(data.get('fin_type_name', ''))

        if not fin_type_name:
            return jsonify({
                'success': False,
                'error': 'fin_type_name is required'
            }), 400

        conn = get_db_connection()
        conn.execute(
            "INSERT OR IGNORE INTO fin_type_options (fin_type_name) VALUES (?)",
            (fin_type_name,),
        )
        conn.commit()

        fin_types = fetch_fin_type_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'fin_types': fin_types
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@line_item_options_bp.route('/api/window-color-options', methods=['GET'])
def get_window_color_options_api():
    """Get global window color options for line items."""
    try:
        conn = get_db_connection()
        colors = fetch_window_color_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'colors': colors
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500


@line_item_options_bp.route('/api/window-color-options', methods=['POST'])
def create_window_color_option_api():
    """Create a global window color option."""
    try:
        data = request.get_json() or {}
        color_name = str(data.get('color_name', '')).strip()

        if not color_name:
            return jsonify({
                'success': False,
                'error': 'color_name is required'
            }), 400

        conn = get_db_connection()
        conn.execute(
            "INSERT OR IGNORE INTO window_color_options (color_name) VALUES (?)",
            (color_name,),
        )
        conn.commit()

        colors = fetch_window_color_options(conn)
        conn.close()

        return jsonify({
            'success': True,
            'colors': colors
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
