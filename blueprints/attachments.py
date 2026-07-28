"""Attachment endpoints: upload, list, delete, download, open, download-all."""
from __future__ import annotations

import io
import zipfile
from pathlib import Path

from flask import Blueprint, jsonify, request, send_file

from core import dict_from_row, get_db_connection

attachments_bp = Blueprint('attachments', __name__)


@attachments_bp.route('/api/orders/<int:order_id>/attachments', methods=['GET'])
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

@attachments_bp.route('/api/orders/<int:order_id>/attachments', methods=['POST'])
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

@attachments_bp.route('/api/attachments/<int:attachment_id>', methods=['DELETE'])
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

@attachments_bp.route('/api/attachments/<int:attachment_id>/download', methods=['GET'])
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

@attachments_bp.route('/api/attachments/<int:attachment_id>/open', methods=['GET'])
def open_attachment(attachment_id):
    """Open an attachment inline in the browser when supported"""
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
            as_attachment=False,
            download_name=row['filename']
        )

    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@attachments_bp.route('/api/orders/<int:order_id>/attachments/download-all', methods=['GET'])
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
